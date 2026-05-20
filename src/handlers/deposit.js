import { Composer, InlineKeyboard } from 'grammy';
import { checkForceJoin } from '../middleware/forceJoinCheck.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import * as walletRepo from '../database/repositories/walletRepo.js';
import * as transactionRepo from '../database/repositories/transactionRepo.js';
import * as paytmService from '../services/paytmService.js';
import * as bharatpayService from '../services/bharatpayService.js';
import * as cryptomusService from '../services/cryptomusService.js';
import { ActionType } from '../utils/constants.js';
import { formatNumber, escapeHtml } from '../utils/formatters.js';
import logger from '../utils/logger.js';

const composer = new Composer();
const userStates = new Map(); // chatId → { step, gateway, msgId }

// ═══════════════════════════════════════════════════════════════════
//  DEPOSIT ENTRY — show payment method buttons
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('deposit:menu', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showDepositMenu(ctx);
});

async function showDepositMenu(ctx) {
  const pool = ctx.dbPool;
  const [paytmOn, bharatpayOn, cryptomusOn] = await Promise.all([
    settingsRepo.getSetting(pool, 'paytm_enabled'),
    settingsRepo.getSetting(pool, 'bharatpay_enabled'),
    settingsRepo.getSetting(pool, 'cryptomus_enabled'),
  ]);
  const balance = await walletRepo.getBalance(pool, ctx.from.id);

  let text = `💰 <b>Deposit Funds</b>\n\n💳 <b>Your Balance:</b> ₹${formatNumber(balance)}\n\nChoose a payment method:`;
  const kb = new InlineKeyboard();
  if (paytmOn) kb.text('💳 Paytm UPI', 'deposit:paytm').row();
  if (bharatpayOn) kb.text('🏦 Bharat Pay', 'deposit:bharatpay').row();
  if (cryptomusOn) kb.text('₿ Cryptomus', 'deposit:cryptomus').row();
  if (!paytmOn && !bharatpayOn && !cryptomusOn) text += '\n\n⚠️ No payment methods available.';
  kb.text('❌ Close', 'deposit:close');

  if (ctx.callbackQuery) {
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch { /* ignore */ }
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

// ═══════════════════════════════════════════════════════════════════
//  PAYTM FLOW
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('deposit:paytm', async (ctx) => {
  await ctx.answerCallbackQuery();
  const pool = ctx.dbPool;
  const minAmount = await settingsRepo.getSetting(pool, 'paytm_min_amount') || 10;
  const maxAmount = await settingsRepo.getSetting(pool, 'paytm_max_amount') || 50000;

  const kb = new InlineKeyboard().text('❌ Cancel', 'deposit:cancel_state');
  const sent = await ctx.editMessageText(
    `💳 <b>Paytm UPI Deposit</b>\n\n` +
    `Enter the amount you want to deposit.\n` +
    `<b>Minimum:</b> ₹${minAmount}\n` +
    `<b>Maximum:</b> ₹${maxAmount}`,
    { parse_mode: 'HTML', reply_markup: kb }
  );
  userStates.set(ctx.chat.id, { step: 'paytm_amount' });
});

// ── Paytm: receive amount → generate QR ─────────────────────────
async function handlePaytmAmount(ctx) {
  const pool = ctx.dbPool;
  const amount = parseFloat(ctx.message.text.trim());
  const minAmount = await settingsRepo.getSetting(pool, 'paytm_min_amount') || 10;
  const maxAmount = await settingsRepo.getSetting(pool, 'paytm_max_amount') || 50000;

  if (isNaN(amount) || amount < minAmount) {
    await ctx.reply(`⚠️ Minimum deposit is ₹${minAmount}.`, {
      reply_markup: new InlineKeyboard().text('❌ Cancel', 'deposit:cancel_state')
    });
    return;
  }
  if (amount > maxAmount) {
    await ctx.reply(`⚠️ Maximum deposit is ₹${maxAmount}.`, {
      reply_markup: new InlineKeyboard().text('❌ Cancel', 'deposit:cancel_state')
    });
    return;
  }

  userStates.delete(ctx.chat.id);
  const upiId = await settingsRepo.getSetting(pool, 'paytm_upi_id');
  const timeLimit = await settingsRepo.getSetting(pool, 'paytm_time_limit') || 600;

  if (!upiId) {
    await ctx.reply('⚠️ Paytm is not configured yet. Contact admin.');
    return;
  }

  const orderId = `DX-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const { qrUrl, txnRef } = paytmService.generatePaymentQR(upiId, amount, orderId);

  await walletRepo.ensureWallet(pool, ctx.from.id);
  await transactionRepo.createTransaction(pool, {
    userId: ctx.from.id, gateway: 'paytm', orderId, amount,
    gatewayData: { txnRef, upiId, qrUrl },
  });

  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.FINANCIAL_DEPOSIT, {
    gateway: 'paytm', amount, orderId, status: 'pending',
  });

  const minutes = Math.floor(timeLimit / 60);
  const botName = await settingsRepo.getSetting(pool, 'bot_name') || 'OTP Bot';

  const caption =
    `💳 <b>Payment Required — Paytm</b>\n\n` +
    `🤖 ${escapeHtml(botName)}\n` +
    `💰 Amount: ₹${amount.toFixed(2)}\n` +
    `📋 Order: <code>${orderId}</code>\n` +
    `💎 Ref: <code>${txnRef}</code>\n\n` +
    `⏰ Expires in ${minutes} minutes\n\n` +
    `Scan the QR code with any UPI app.`;

  const kb = new InlineKeyboard()
    .text('🔄 Check Payment', `deposit:check:${orderId}`).row()
    .text('❌ Cancel Order', `deposit:cancel_txn:${orderId}`);

  await ctx.replyWithPhoto(qrUrl, { caption, parse_mode: 'HTML', reply_markup: kb });
}

// ── Paytm: check payment (manual click) ─────────────────────────
composer.callbackQuery(/^deposit:check:DX-/, async (ctx) => {
  await ctx.answerCallbackQuery('🔍 Checking payment…');
  const orderId = ctx.callbackQuery.data.replace('deposit:check:', '');
  const pool = ctx.dbPool;

  const txn = await transactionRepo.getByOrderId(pool, orderId);
  if (!txn) { await ctx.answerCallbackQuery('⚠️ Order not found.'); return; }
  if (txn.status === 'success') { await ctx.answerCallbackQuery('✅ Already verified!'); return; }

  // Check time limit
  const timeLimit = await settingsRepo.getSetting(pool, 'paytm_time_limit') || 600;
  const elapsed = (Date.now() - new Date(txn.created_at).getTime()) / 1000;
  if (elapsed > timeLimit) {
    await transactionRepo.updateStatus(pool, orderId, 'expired');
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    await ctx.reply(
      `⏰ <b>Payment Expired!</b>\n\nYour payment for order <code>${orderId}</code> has expired.`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('💰 Pay Again', 'deposit:paytm').text('‹ Back', 'deposit:menu') }
    );
    return;
  }

  // Check via Paytm API
  const merchantKey = await settingsRepo.getSetting(pool, 'paytm_merchant_key');
  const txnRef = txn.gateway_data?.txnRef;
  if (!merchantKey || !txnRef) {
    await ctx.answerCallbackQuery('⚠️ Verification not configured.');
    return;
  }

  const result = await paytmService.checkPaymentStatus(merchantKey, txnRef);

  if (result.success) {
    const creditAmount = result.amount || parseFloat(txn.amount);
    await transactionRepo.updateStatus(pool, orderId, 'success', txnRef, result);
    await walletRepo.addBalance(pool, ctx.from.id, creditAmount);

    ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.FINANCIAL_DEPOSIT, {
      gateway: 'paytm', amount: creditAmount, orderId, status: 'success',
    });

    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    const newBalance = await walletRepo.getBalance(pool, ctx.from.id);
    await ctx.reply(
      `✅ <b>Payment Successful!</b>\n\n💰 <b>Amount:</b> ₹${creditAmount}\n💳 <b>New Balance:</b> ₹${formatNumber(newBalance)}\n\nThank you! 🎉`,
      { parse_mode: 'HTML' }
    );
  } else {
    await ctx.answerCallbackQuery('❌ Payment not found yet. Try again after paying.');
  }
});

// ═══════════════════════════════════════════════════════════════════
//  BHARAT PAY FLOW
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('deposit:bharatpay', async (ctx) => {
  await ctx.answerCallbackQuery();
  const pool = ctx.dbPool;
  const qrFileId = await settingsRepo.getSetting(pool, 'bharatpay_qr_file_id');
  const upiId = await settingsRepo.getSetting(pool, 'bharatpay_upi_id');
  const minAmount = await settingsRepo.getSetting(pool, 'bharatpay_min_amount') || 10;

  if (!qrFileId) {
    try {
      await ctx.editMessageText('⚠️ Bharat Pay is not configured yet. Contact admin.', {
        reply_markup: new InlineKeyboard().text('‹ Back', 'deposit:menu')
      });
    } catch {
      await ctx.reply('⚠️ Bharat Pay is not configured yet. Contact admin.');
    }
    return;
  }

  const text =
    `🏦 <b>Bharat Pay UPI Deposit</b>\n\n` +
    `📱 Scan the QR code and pay using any UPI app.\n` +
    (upiId ? `\n💳 <b>UPI ID:</b> <code>${escapeHtml(upiId)}</code>\n` : '') +
    `\n<b>Minimum:</b> ₹${minAmount}\n\n` +
    `After payment, send your <b>UTR number</b> (12-digit bank reference).`;

  userStates.set(ctx.chat.id, { step: 'bharatpay_utr' });
  const kb = new InlineKeyboard().text('❌ Cancel', 'deposit:cancel_state');
  await ctx.replyWithPhoto(qrFileId, { caption: text, parse_mode: 'HTML', reply_markup: kb });
});

// ── Bharat Pay: receive UTR ─────────────────────────────────────
async function handleBharatpayUTR(ctx) {
  const pool = ctx.dbPool;
  const utr = ctx.message.text.trim();

  if (!/^[a-zA-Z0-9]{1,12}$/.test(utr)) {
    await ctx.reply('⚠️ Invalid UTR. Should be alphanumeric, max 12 chars.', {
      reply_markup: new InlineKeyboard().text('❌ Cancel', 'deposit:cancel_state')
    });
    return;
  }
  if (utr.startsWith('0')) {
    await ctx.reply('⚠️ Invalid UTR. Cannot start with 0.', {
      reply_markup: new InlineKeyboard().text('❌ Cancel', 'deposit:cancel_state')
    });
    return;
  }

  userStates.delete(ctx.chat.id);
  await ctx.reply('🔍 Verifying your payment…');

  const existing = await transactionRepo.getByGatewayTxnId(pool, utr);
  if (existing) {
    await ctx.reply('⚠️ This UTR has already been used.', {
      reply_markup: new InlineKeyboard().text('🔄 Try Again', 'deposit:bharatpay').text('‹ Back', 'deposit:menu')
    });
    return;
  }

  const merchantId = await settingsRepo.getSetting(pool, 'bharatpay_merchant_id');
  const token = await settingsRepo.getSetting(pool, 'bharatpay_token');
  const minAmount = await settingsRepo.getSetting(pool, 'bharatpay_min_amount') || 10;

  if (!merchantId || !token) {
    await ctx.reply('⚠️ Bharat Pay verification not configured. Contact admin.');
    return;
  }

  const result = await bharatpayService.verifyUTR(merchantId, token, utr);

  if (result.found && result.amount >= minAmount) {
    const orderId = `BP_${ctx.from.id}_${Date.now()}`;
    await walletRepo.ensureWallet(pool, ctx.from.id);
    await transactionRepo.createTransaction(pool, {
      userId: ctx.from.id, gateway: 'bharatpay', orderId, amount: result.amount,
      gatewayData: { utr, payerName: result.payerName, payerHandle: result.payerHandle },
    });
    await transactionRepo.updateStatus(pool, orderId, 'success', utr, result);
    await walletRepo.addBalance(pool, ctx.from.id, result.amount);

    ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.FINANCIAL_DEPOSIT, {
      gateway: 'bharatpay', amount: result.amount, orderId, utr, status: 'success',
    });

    const newBalance = await walletRepo.getBalance(pool, ctx.from.id);
    await ctx.reply(
      `✅ <b>Payment Verified!</b>\n\n💰 <b>Amount:</b> ₹${result.amount}\n👤 <b>Payer:</b> ${escapeHtml(result.payerName || 'N/A')}\n💳 <b>New Balance:</b> ₹${formatNumber(newBalance)}\n\n🎉 Thank you!`,
      { parse_mode: 'HTML' }
    );
  } else if (result.found && result.amount < minAmount) {
    await ctx.reply(`⚠️ Payment of ₹${result.amount} is below minimum ₹${minAmount}. Contact support.`);
  } else {
    await ctx.reply('❌ Payment not found. Please check your UTR and try again.', {
      reply_markup: new InlineKeyboard().text('🔄 Try Again', 'deposit:bharatpay').text('‹ Back', 'deposit:menu')
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
//  CRYPTOMUS FLOW
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('deposit:cryptomus', async (ctx) => {
  await ctx.answerCallbackQuery();
  const pool = ctx.dbPool;
  const minAmount = await settingsRepo.getSetting(pool, 'cryptomus_min_amount') || 1;
  const maxAmount = await settingsRepo.getSetting(pool, 'cryptomus_max_amount') || 10000;

  const kb = new InlineKeyboard().text('❌ Cancel', 'deposit:cancel_state');
  await ctx.editMessageText(
    `₿ <b>Cryptomus Deposit</b>\n\n` +
    `Enter the amount in <b>USD</b>.\n` +
    `<b>Minimum:</b> $${minAmount}  |  <b>Maximum:</b> $${maxAmount}`,
    { parse_mode: 'HTML', reply_markup: kb }
  );
  userStates.set(ctx.chat.id, { step: 'cryptomus_amount' });
});

async function handleCryptomusAmount(ctx) {
  const pool = ctx.dbPool;
  const amount = parseFloat(ctx.message.text.trim());
  const minAmount = await settingsRepo.getSetting(pool, 'cryptomus_min_amount') || 1;
  const maxAmount = await settingsRepo.getSetting(pool, 'cryptomus_max_amount') || 10000;

  if (isNaN(amount) || amount < minAmount) {
    await ctx.reply(`⚠️ Minimum is $${minAmount}.`, {
      reply_markup: new InlineKeyboard().text('❌ Cancel', 'deposit:cancel_state')
    });
    return;
  }
  if (amount > maxAmount) {
    await ctx.reply(`⚠️ Maximum is $${maxAmount}.`, {
      reply_markup: new InlineKeyboard().text('❌ Cancel', 'deposit:cancel_state')
    });
    return;
  }

  userStates.delete(ctx.chat.id);
  const apiKey = await settingsRepo.getSetting(pool, 'cryptomus_api_key');
  const merchantId = await settingsRepo.getSetting(pool, 'cryptomus_merchant_id');

  if (!apiKey || !merchantId) {
    await ctx.reply('⚠️ Cryptomus not configured. Contact admin.');
    return;
  }

  const orderId = `CRYPTO_${ctx.from.id}_${Date.now()}`;
  await walletRepo.ensureWallet(pool, ctx.from.id);
  const result = await cryptomusService.createInvoice(apiKey, merchantId, { amount, currency: 'USD', orderId });

  if (!result.success) {
    await ctx.reply(`⚠️ Failed to create invoice: ${result.error}`);
    return;
  }

  await transactionRepo.createTransaction(pool, {
    userId: ctx.from.id, gateway: 'cryptomus', orderId, amount,
    gatewayData: { uuid: result.uuid, paymentUrl: result.paymentUrl },
  });

  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.FINANCIAL_DEPOSIT, {
    gateway: 'cryptomus', amount, orderId, status: 'pending',
  });

  const kb = new InlineKeyboard()
    .url('🔗 Pay Now', result.paymentUrl).row()
    .text('✅ Check Payment', `deposit:check_crypto:${orderId}`).row()
    .text('❌ Cancel', `deposit:cancel_txn:${orderId}`);

  await ctx.reply(
    `₿ <b>Cryptomus Payment</b>\n\n💰 <b>Amount:</b> $${amount}\n📋 <b>Order:</b> <code>${orderId}</code>\n\nClick below to pay. All currencies accepted.`,
    { parse_mode: 'HTML', reply_markup: kb }
  );
}

// ── Cryptomus: check payment ────────────────────────────────────
composer.callbackQuery(/^deposit:check_crypto:CRYPTO_/, async (ctx) => {
  await ctx.answerCallbackQuery('🔍 Checking…');
  const orderId = ctx.callbackQuery.data.replace('deposit:check_crypto:', '');
  const pool = ctx.dbPool;

  const txn = await transactionRepo.getByOrderId(pool, orderId);
  if (!txn || txn.status === 'success') {
    await ctx.answerCallbackQuery(txn?.status === 'success' ? '✅ Already verified!' : '⚠️ Not found.');
    return;
  }

  const apiKey = await settingsRepo.getSetting(pool, 'cryptomus_api_key');
  const merchantId = await settingsRepo.getSetting(pool, 'cryptomus_merchant_id');
  const uuid = txn.gateway_data?.uuid;
  if (!apiKey || !merchantId || !uuid) { await ctx.answerCallbackQuery('⚠️ Config error.'); return; }

  const result = await cryptomusService.checkPayment(apiKey, merchantId, uuid);

  if (result.success) {
    const creditAmount = result.amount || parseFloat(txn.amount);
    await transactionRepo.updateStatus(pool, orderId, 'success', uuid, result);
    await walletRepo.addBalance(pool, ctx.from.id, creditAmount);
    ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.FINANCIAL_DEPOSIT, {
      gateway: 'cryptomus', amount: creditAmount, orderId, status: 'success',
    });
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    const newBalance = await walletRepo.getBalance(pool, ctx.from.id);
    await ctx.reply(
      `✅ <b>Crypto Payment Successful!</b>\n\n💰 <b>Amount:</b> $${creditAmount}\n💳 <b>New Balance:</b> ₹${formatNumber(newBalance)}\n\n🎉`,
      { parse_mode: 'HTML' }
    );
  } else {
    await ctx.answerCallbackQuery('❌ Not confirmed yet. Try again later.');
  }
});

// ═══════════════════════════════════════════════════════════════════
//  COMMON CALLBACKS
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery(/^deposit:cancel_txn:/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const orderId = ctx.callbackQuery.data.replace('deposit:cancel_txn:', '');
  await transactionRepo.updateStatus(ctx.dbPool, orderId, 'cancelled');
  try { await ctx.deleteMessage(); } catch { /* ignore */ }
  await ctx.reply('❌ Order cancelled.', {
    reply_markup: new InlineKeyboard().text('💰 Deposit Again', 'deposit:menu')
  });
});

composer.callbackQuery('deposit:cancel_state', async (ctx) => {
  await ctx.answerCallbackQuery();
  userStates.delete(ctx.chat.id);
  try { await ctx.deleteMessage(); } catch { /* ignore */ }
  await ctx.reply('❌ Cancelled.', {
    reply_markup: new InlineKeyboard().text('💰 Deposit Again', 'deposit:menu')
  });
});

composer.callbackQuery('deposit:close', async (ctx) => {
  await ctx.answerCallbackQuery();
  try { await ctx.deleteMessage(); } catch { /* ignore */ }
});

// ═══════════════════════════════════════════════════════════════════
//  TEXT INPUT ROUTER (no /cancel needed — use buttons above)
// ═══════════════════════════════════════════════════════════════════
composer.on('message:text', async (ctx, next) => {
  const state = userStates.get(ctx.chat.id);
  if (!state) return next();

  switch (state.step) {
    case 'paytm_amount': return handlePaytmAmount(ctx);
    case 'bharatpay_utr': return handleBharatpayUTR(ctx);
    case 'cryptomus_amount': return handleCryptomusAmount(ctx);
    default: return next();
  }
});

export default composer;
