import { Composer, InlineKeyboard, InputFile } from 'grammy';
import { checkForceJoin } from '../middleware/forceJoinCheck.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import * as walletRepo from '../database/repositories/walletRepo.js';
import * as transactionRepo from '../database/repositories/transactionRepo.js';
import * as paytmService from '../services/paytmService.js';
import * as bharatpayService from '../services/bharatpayService.js';
import * as cryptomusService from '../services/cryptomusService.js';

import { formatNumber, escapeHtml } from '../utils/formatters.js';
import { generateBrandedQR } from '../services/qrImageService.js';
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
  const [paytmOn, bharatpayOn, cryptomusOn, paytmName, bharatpayName] = await Promise.all([
    settingsRepo.getSetting(pool, 'paytm_enabled'),
    settingsRepo.getSetting(pool, 'bharatpay_enabled'),
    settingsRepo.getSetting(pool, 'cryptomus_enabled'),
    settingsRepo.getSetting(pool, 'paytm_display_name'),
    settingsRepo.getSetting(pool, 'bharatpay_display_name'),
  ]);
  const balance = await walletRepo.getBalance(pool, ctx.from.id);

  let text = `💰 <b>Deposit Funds</b>\n\n💳 <b>Your Balance:</b> ₹${formatNumber(balance)}\n\nChoose a payment method:`;
  const kb = new InlineKeyboard();
  if (paytmOn) kb.text(`✅ ${paytmName || 'Pay via Automatic Gateway'}`, 'deposit:paytm').row();
  if (bharatpayOn) kb.text(`🏦 ${bharatpayName || 'Pay via UTR / Transaction ID based Gateway'}`, 'deposit:bharatpay').row();
  if (cryptomusOn) kb.text('₿ Cryptomus', 'deposit:cryptomus').row();
  if (!paytmOn && !bharatpayOn && !cryptomusOn) text += '\n\n⚠️ No payment methods available.';
  kb.text('❌ Cancel', 'deposit:close');

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
  const payeeName = await settingsRepo.getSetting(pool, 'paytm_payee_name') || 'Paytm Merchant';
  const paytmQr = await settingsRepo.getSetting(pool, 'paytm_qr_code') || '';

  if (!upiId) {
    await ctx.reply('⚠️ Paytm is not configured yet. Contact admin.');
    return;
  }

  const orderId = `DX-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const { upiLink, txnRef } = paytmService.generatePaymentQR(upiId, amount, orderId, payeeName, paytmQr);

  await walletRepo.ensureWallet(pool, ctx.from.id);
  await transactionRepo.createTransaction(pool, {
    userId: ctx.from.id, gateway: 'paytm', orderId, amount,
    gatewayData: { txnRef, upiId },
  });



  const minutes = Math.floor(timeLimit / 60);
  const botName = await settingsRepo.getSetting(pool, 'bot_name') || 'OTP BOT';

  // Generate branded QR image
  const qrImageBuffer = await generateBrandedQR({
    storeName: botName,
    amount: amount.toFixed(2),
    currency: '₹',
    refId: txnRef,
    upiLink,
    developer: '@Erroroo',
  });

  const displayName = await settingsRepo.getSetting(pool, 'paytm_display_name') || 'Pay via Automatic Gateway';
  
  const caption =
    `💳 <b>${escapeHtml(displayName)}</b>\n\n` +
    `🏪 <b>${escapeHtml(botName)}</b>\n` +
    `💰 <b>Amount:</b> ₹${amount.toFixed(2)}\n` +
    `📋 <b>Order:</b> <code>${orderId}</code>\n` +
    `💎 <b>Ref:</b> <code>${txnRef}</code>\n\n` +
    `⏰ Expires in <b>${minutes} minutes</b>\n\n` +
    `Scan the QR code with any UPI app.\n\n` +
    `<i>Payment will be auto-detected. You can also click Check Payment below.</i>`;

  const kb = new InlineKeyboard()
    .text('🔄 Check Payment', `deposit:check:${orderId}`).row()
    .text('❌ Cancel Order', `deposit:cancel_txn:${orderId}`);

  const sentMsg = await ctx.replyWithPhoto(new InputFile(qrImageBuffer, 'payment_qr.png'), {
    caption, parse_mode: 'HTML', reply_markup: kb,
  });

  // Store file_id so we reuse EXACT same image when re-sending after failed check
  const photoFileId = sentMsg.photo?.[sentMsg.photo.length - 1]?.file_id;
  if (photoFileId) {
    await transactionRepo.updateGatewayData(pool, orderId, {
      txnRef, upiId, photoFileId, caption,
    });
  }
}

// ── Paytm: check payment (manual click) ─────────────────────────
composer.callbackQuery(/^deposit:check:DX-/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const orderId = ctx.callbackQuery.data.replace('deposit:check:', '');
  const pool = ctx.dbPool;

  const txn = await transactionRepo.getByOrderId(pool, orderId);
  if (!txn) {
    await ctx.reply('⚠️ Order not found.', {
      reply_markup: new InlineKeyboard().text('💰 Deposit Again', 'deposit:menu'),
    });
    return;
  }
  if (txn.status === 'success') {
    await ctx.answerCallbackQuery('✅ Already verified!');
    return;
  }
  if (txn.status === 'expired' || txn.status === 'failed' || txn.status === 'cancelled') {
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    await ctx.reply(
      `⚠️ <b>Order ${escapeHtml(txn.status)}.</b>\n\nThis order is no longer active.`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('💰 Pay Again', 'deposit:paytm').text('‹ Back', 'deposit:menu') }
    );
    return;
  }

  // Check time limit
  const timeLimit = await settingsRepo.getSetting(pool, 'paytm_time_limit') || 600;
  const elapsed = (Date.now() - new Date(txn.created_at).getTime()) / 1000;
  if (elapsed > timeLimit) {
    await transactionRepo.updateStatus(pool, orderId, 'expired');
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    await ctx.reply(
      `⏰ <b>Payment Expired!</b>\n\nOrder <code>${orderId}</code> has expired.`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('💰 Pay Again', 'deposit:paytm').text('‹ Back', 'deposit:menu') }
    );
    return;
  }

  const mid = await settingsRepo.getSetting(pool, 'paytm_merchant_key');
  const txnRef = txn.gateway_data?.txnRef;
  const upiId = txn.gateway_data?.upiId;
  if (!mid || !txnRef) {
    await ctx.reply('⚠️ Verification not configured. Contact admin.');
    return;
  }

  // ── Step 1: Delete the QR photo message ──────────────────────
  try { await ctx.deleteMessage(); } catch { /* ignore */ }

  // ── Step 2: Send "Verifying..." message ──────────────────────
  const verifyMsg = await ctx.reply(
    `🔄 <b>Verifying your payment...</b>\n\n` +
    `📋 Order: <code>${orderId}</code>\n` +
    `💰 Amount: ₹${parseFloat(txn.amount).toFixed(2)}\n\n` +
    `⏳ Attempt 1/3 — checking...`,
    { parse_mode: 'HTML' }
  );

  // ── Step 3: Poll Paytm API 3 times with 3s gaps ─────────────
  const MAX_ATTEMPTS = 3;
  const DELAY_MS = 3000;
  let finalResult = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await paytmService.checkPaymentStatus(mid, txnRef);

    if (result.success) {
      // ── Payment verified! ──────────────────────────────────
      const creditAmount = result.amount || parseFloat(txn.amount);
      await transactionRepo.updateStatus(pool, orderId, 'success', txnRef, {
        paytm_txnId: result.txnId,
        paytm_utr: result.utr,
        paytm_status: result.status,
      });
      await walletRepo.addBalance(pool, ctx.from.id, creditAmount);
      try { await ctx.api.deleteMessage(ctx.chat.id, verifyMsg.message_id); } catch { /* ignore */ }
      const newBalance = await walletRepo.getBalance(pool, ctx.from.id);
      await ctx.reply(
        `✅ <b>Payment Successful!</b>\n\n` +
        `💰 <b>Amount:</b> ₹${creditAmount}\n` +
        `💳 <b>New Balance:</b> ₹${formatNumber(newBalance)}\n\n` +
        `Thank you! 🎉`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    if (result.failed) {
      // ── Genuinely failed ───────────────────────────────────
      await transactionRepo.updateStatus(pool, orderId, 'failed');
      try { await ctx.api.deleteMessage(ctx.chat.id, verifyMsg.message_id); } catch { /* ignore */ }
      await ctx.reply(
        `❌ <b>Payment Failed!</b>\n\nYour payment was declined.`,
        { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('💰 Try Again', 'deposit:paytm').text('‹ Back', 'deposit:menu') }
      );
      return;
    }

    finalResult = result;

    // Update attempt counter
    if (attempt < MAX_ATTEMPTS) {
      try {
        await ctx.api.editMessageText(
          ctx.chat.id, verifyMsg.message_id,
          `🔄 <b>Verifying your payment...</b>\n\n` +
          `📋 Order: <code>${orderId}</code>\n` +
          `💰 Amount: ₹${parseFloat(txn.amount).toFixed(2)}\n\n` +
          `⏳ Attempt ${attempt + 1}/${MAX_ATTEMPTS} — rechecking in ${DELAY_MS / 1000}s...`,
          { parse_mode: 'HTML' }
        );
      } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  // ── Step 4: Not verified after all attempts ────────────────────
  // Delete the verifying message
  try { await ctx.api.deleteMessage(ctx.chat.id, verifyMsg.message_id); } catch { /* ignore */ }

  // Re-fetch transaction to get stored photoFileId
  const freshTxn = await transactionRepo.getByOrderId(pool, orderId);
  const storedFileId = freshTxn?.gateway_data?.photoFileId;
  const storedCaption = freshTxn?.gateway_data?.caption;
  const remaining = Math.max(0, Math.ceil((timeLimit - elapsed) / 60));

  const resendKb = new InlineKeyboard()
    .text('🔄 Check Payment', `deposit:check:${orderId}`).row()
    .text('❌ Cancel Order', `deposit:cancel_txn:${orderId}`);

  if (storedFileId) {
    // ── Re-send the EXACT SAME image (no regeneration) ────────
    const displayName = await settingsRepo.getSetting(pool, 'paytm_display_name') || 'Pay via Automatic Gateway';
    const botName = await settingsRepo.getSetting(pool, 'bot_name') || 'OTP BOT';
    const resendCaption =
      `💳 <b>${escapeHtml(displayName)}</b>\n\n` +
      `🏪 <b>${escapeHtml(botName)}</b>\n` +
      `💰 <b>Amount:</b> ₹${parseFloat(txn.amount).toFixed(2)}\n` +
      `📋 <b>Order:</b> <code>${orderId}</code>\n` +
      `💎 <b>Ref:</b> <code>${txnRef}</code>\n\n` +
      `⏰ Expires in <b>${remaining} minutes</b>\n\n` +
      `Scan the QR code with any UPI app.\n\n` +
      `<i>Payment will be auto-detected. You can also click Check Payment below.</i>`;

    await ctx.replyWithPhoto(storedFileId, {
      caption: resendCaption, parse_mode: 'HTML', reply_markup: resendKb,
    });
  } else {
    // ── Fallback: regenerate QR if file_id not stored ──────────
    const botName = await settingsRepo.getSetting(pool, 'bot_name') || 'OTP BOT';
    const payeeName = await settingsRepo.getSetting(pool, 'paytm_payee_name') || 'Paytm Merchant';
    const paytmQr = await settingsRepo.getSetting(pool, 'paytm_qr_code') || '';
    const displayName = await settingsRepo.getSetting(pool, 'paytm_display_name') || 'Pay via Automatic Gateway';

    const { upiLink: rebuildUpiLink } = paytmService.generatePaymentQR(upiId, parseFloat(txn.amount), orderId, payeeName, paytmQr, txnRef);
    const qrImageBuffer = await generateBrandedQR({
      storeName: botName, amount: parseFloat(txn.amount).toFixed(2),
      currency: '₹', refId: txnRef, upiLink: rebuildUpiLink, developer: '@Erroroo',
    });
    const fallbackCaption =
      `💳 <b>${escapeHtml(displayName)}</b>\n\n` +
      `🏪 <b>${escapeHtml(botName)}</b>\n` +
      `💰 <b>Amount:</b> ₹${parseFloat(txn.amount).toFixed(2)}\n` +
      `📋 <b>Order:</b> <code>${orderId}</code>\n` +
      `💎 <b>Ref:</b> <code>${txnRef}</code>\n\n` +
      `⏰ Expires in <b>${remaining} minutes</b>\n\n` +
      `Scan the QR code with any UPI app.\n\n` +
      `<i>Payment will be auto-detected. You can also click Check Payment below.</i>`;

    await ctx.replyWithPhoto(new InputFile(qrImageBuffer, 'payment_qr.png'), {
      caption: fallbackCaption, parse_mode: 'HTML', reply_markup: resendKb,
    });
  }

  // Send separate "not received" message
  await ctx.reply(
    `❌ <b>Payment Not Received</b>\n\n` +
    `We checked ${MAX_ATTEMPTS} times but could not find your payment.\n\n` +
    `📋 Order: <code>${orderId}</code>\n` +
    `💰 Amount: ₹${parseFloat(txn.amount).toFixed(2)}\n\n` +
    `<b>Please ensure:</b>\n` +
    `• You completed the payment for the exact amount\n` +
    `• You paid using the QR code shown above\n` +
    `• Wait a minute and try Check Payment again\n\n` +
    `<i>If you already paid, please wait 1-2 minutes and try again.</i>`,
    { parse_mode: 'HTML' }
  );
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

// Reply keyboard button texts — if user presses these, clear state & forward
const MENU_BUTTONS = new Set([
  '📠 GET OTP', '💰 DEPOSIT', '👤 PROFILE', '🔥 MORE',
  '📮 SMS CHECKER', '🛡 SUPPORT', '🎁 REFER & EARN', '💎 READYMADE ACCOUNT',
  '📧 GET EMAIL', '😊 Favorite', 'Promo Code 👾', '◀️ RETURN',
  '📊 TOP SERVICES', '⚙️ API', '🔮 Reseller Account', '🔧 ADMIN PANEL',
]);

composer.on('message:text', async (ctx, next) => {
  const state = userStates.get(ctx.chat.id);
  if (!state) return next();

  // If user presses a reply keyboard button, clear state and forward
  if (MENU_BUTTONS.has(ctx.message.text.trim())) {
    userStates.delete(ctx.chat.id);
    return next();
  }

  switch (state.step) {
    case 'paytm_amount': return handlePaytmAmount(ctx);
    case 'bharatpay_utr': return handleBharatpayUTR(ctx);
    case 'cryptomus_amount': return handleCryptomusAmount(ctx);
    default: return next();
  }
});

export default composer;

