/**
 * Deposit — Paytm UPI gateway flow.
 *
 * Handles: amount selection → QR generation → 3-attempt payment check.
 */
import { Composer, InlineKeyboard, InputFile } from 'grammy';
import * as settingsRepo from '../../database/repositories/settingsRepo.js';
import * as walletRepo from '../../database/repositories/walletRepo.js';
import * as transactionRepo from '../../database/repositories/transactionRepo.js';
import * as paytmService from '../../services/paytmService.js';
import { formatNumber, escapeHtml } from '../../utils/formatters.js';
import { generateBrandedQR } from '../../services/qrImageService.js';
import logger from '../../utils/logger.js';
import {
  userStates, checkCooldowns, COOLDOWN_MS, activeChecks,
  safeReply, buildSuccessMessage, applyBenefits, processReferralOnDeposit,
} from './shared.js';

const composer = new Composer();

// ═══════════════════════════════════════════════════════════════════
//  PAYTM FLOW
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('deposit:paytm', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const minAmount = parseInt(await settingsRepo.getSetting(pool, 'paytm_min_amount')) || 1;
  const maxAmount = parseInt(await settingsRepo.getSetting(pool, 'paytm_max_amount')) || 0;

  let text =
    `💰 <b>Select Deposit Amount</b>\n\n` +
    `📌 <b>Min:</b> ₹${minAmount}` +
    (maxAmount ? `  •  <b>Max:</b> ₹${maxAmount}` : '') + `\n\n` +
    `👇 <b>Choose an amount or enter custom</b>`;

  const presets = [10, 50, 100, 300, 500, 1000, 5000, 10000].filter(a => a >= minAmount && (!maxAmount || a <= maxAmount));
  const kb = new InlineKeyboard();
  for (let i = 0; i < presets.length; i += 2) {
    kb.text(`₹${presets[i]}`, `deposit:paytm_amt:${presets[i]}`);
    if (presets[i + 1]) kb.text(`₹${presets[i + 1]}`, `deposit:paytm_amt:${presets[i + 1]}`);
    kb.row();
  }
  kb.text('💲 Custom Amount', 'deposit:paytm_custom').row();
  kb.text('‹ Back', 'deposit:menu').text('❌ Cancel', 'deposit:close');

  await safeReply(ctx, text, { parse_mode: 'HTML', reply_markup: kb });
});

// ── Paytm: preset amount clicked ────────────────────────────────
composer.callbackQuery(/^deposit:paytm_amt:\d+$/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const amount = parseFloat(ctx.callbackQuery.data.split(':')[2]);
  await handlePaytmAmount(ctx, amount);
});

// ── Paytm: custom amount requested ─────────────────────────────
composer.callbackQuery('deposit:paytm_custom', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const minAmount = parseInt(await settingsRepo.getSetting(pool, 'paytm_min_amount')) || 1;
  const maxAmount = parseInt(await settingsRepo.getSetting(pool, 'paytm_max_amount')) || 0;

  await safeReply(ctx,
    `💲 <b>Enter Custom Amount</b>\n\n` +
    `Type the amount you want to deposit.\n\n` +
    `<b>Example:</b> <code>100</code> , <code>500</code> , <code>1000</code>\n\n` +
    `📌 <b>Min:</b> ₹${minAmount}` +
    (maxAmount ? `  •  <b>Max:</b> ₹${maxAmount}` : '') + `\n\n` +
    `✅ Just type the amount below, payment link will appear instantly.`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('‹ Back', 'deposit:paytm').text('❌ Cancel', 'deposit:cancel_state') }
  );
  userStates.set(ctx.chat.id, { step: 'paytm_amount' });
});

// ── Paytm: receive amount → generate QR ─────────────────────────
export async function handlePaytmAmount(ctx, presetAmount = null) {
  const pool = ctx.dbPool;
  const amount = presetAmount || parseFloat(ctx.message.text.trim());
  const minAmount = await settingsRepo.getSetting(pool, 'paytm_min_amount') || 1;
  const maxAmount = parseInt(await settingsRepo.getSetting(pool, 'paytm_max_amount')) || 0;

  if (isNaN(amount) || amount < minAmount) {
    await ctx.reply(`⚠️ Minimum deposit is ₹${minAmount}.`, {
      reply_markup: new InlineKeyboard().text('❌ Cancel', 'deposit:cancel_state')
    });
    return;
  }
  if (maxAmount > 0 && amount > maxAmount) {
    await ctx.reply(`⚠️ Maximum deposit is ₹${maxAmount}.`, {
      reply_markup: new InlineKeyboard().text('❌ Cancel', 'deposit:cancel_state')
    });
    return;
  }

  userStates.delete(ctx.chat.id);
  const upiId = await settingsRepo.getSetting(pool, 'paytm_upi_id');
  const timeLimitRaw = await settingsRepo.getSetting(pool, 'paytm_time_limit');
  const timeLimit = (timeLimitRaw === 0 || timeLimitRaw === '0') ? 0 : (parseInt(timeLimitRaw) || 600);
  const payeeName = await settingsRepo.getSetting(pool, 'paytm_payee_name') || 'Paytm Merchant';
  const paytmQr = await settingsRepo.getSetting(pool, 'paytm_qr_code') || '';

  if (!upiId) {
    await ctx.reply('⚠️ Paytm is not configured yet. Contact admin.');
    return;
  }

  const orderId = `DX-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const { upiLink, txnRef } = paytmService.generatePaymentQR(upiId, amount, orderId, payeeName, paytmQr);

  await walletRepo.ensureWallet(pool, ctx.from.id);
  const expiresAt = timeLimit > 0 ? new Date(Date.now() + timeLimit * 1000) : null;
  await transactionRepo.createTransaction(pool, {
    userId: ctx.from.id, gateway: 'paytm', orderId, amount,
    gatewayData: { txnRef, upiId },
    expiresAt,
  });

  const minutes = timeLimit > 0 ? Math.floor(timeLimit / 60) : 0;
  const botName = await settingsRepo.getSetting(pool, 'bot_name') || 'OTPBOT';

  const qrImageBuffer = await generateBrandedQR({
    storeName: botName,
    amount: amount.toFixed(2),
    currency: '₹',
    refId: txnRef,
    upiLink,
    developer: '@Erroroo',
  });

  const displayName = await settingsRepo.getSetting(pool, 'paytm_display_name') || 'Pay via Automatic Gateway';

  const timeText = timeLimit > 0 ? `⏰ Expires in <b>${minutes} minutes</b>` : '⏰ <b>No time limit</b>';
  const caption =
    `💳 <b>${escapeHtml(displayName)}</b>\n\n` +
    `🏪 <b>${escapeHtml(botName)}</b>\n` +
    `💰 <b>Amount:</b> ₹${amount.toFixed(2)}\n` +
    `📋 <b>Order:</b> <code>${orderId}</code>\n` +
    `💎 <b>Ref:</b> <code>${txnRef}</code>\n\n` +
    `${timeText}\n\n` +
    `Scan the QR code with any UPI app.\n` +
    `<i>Ref will appear in your bank statement.</i>`;

  const kb = new InlineKeyboard()
    .text('🔄 Check Payment', `deposit:check:${orderId}`).row()
    .text('❌ Cancel Order', `deposit:cancel_txn:${orderId}`);

  const sentMsg = await ctx.replyWithPhoto(new InputFile(qrImageBuffer, 'payment_qr.png'), {
    caption, parse_mode: 'HTML', reply_markup: kb,
  });

  const photoFileId = sentMsg.photo?.[sentMsg.photo.length - 1]?.file_id;
  if (photoFileId) {
    await transactionRepo.updateGatewayData(pool, orderId, {
      txnRef, upiId, photoFileId, caption, qrMsgId: sentMsg.message_id,
    });
  }
}

// ── Paytm: check payment (manual click) ─────────────────────────
composer.callbackQuery(/^deposit:check:DX-/, async (ctx) => {
  const chatId = ctx.chat.id;
  const orderId = ctx.callbackQuery.data.replace('deposit:check:', '');
  const pool = ctx.dbPool;

  const lastCheck = checkCooldowns.get(chatId);
  if (lastCheck && Date.now() - lastCheck < COOLDOWN_MS) {
    try { await ctx.answerCallbackQuery(); } catch {}
    return;
  }

  if (activeChecks.has(chatId)) {
    try { await ctx.answerCallbackQuery(); } catch {}
    return;
  }

  try { await ctx.answerCallbackQuery(); } catch {}
  activeChecks.add(chatId);
  checkCooldowns.set(chatId, Date.now());

  try {
    await _doPaytmCheck(ctx, pool, orderId);
  } finally {
    activeChecks.delete(chatId);
  }
});

/**
 * Core Paytm check logic — 3-attempt polling.
 */
async function _doPaytmCheck(ctx, pool, orderId) {
  const txn = await transactionRepo.getByOrderId(pool, orderId);
  if (!txn) {
    await ctx.reply('⚠️ Order not found.', {
      reply_markup: new InlineKeyboard().text('💰 Deposit', 'deposit:menu'),
    });
    return;
  }
  if (txn.status === 'success') {
    try { await ctx.answerCallbackQuery(); } catch {}
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

  const timeLimitRaw = await settingsRepo.getSetting(pool, 'paytm_time_limit');
  const timeLimit = (timeLimitRaw === 0 || timeLimitRaw === '0') ? 0 : (parseInt(timeLimitRaw) || 600);
  const elapsed = (Date.now() - new Date(txn.created_at).getTime()) / 1000;
  if (timeLimit > 0 && elapsed > timeLimit) {
    await transactionRepo.updateStatus(pool, orderId, 'expired');
    try { await ctx.deleteMessage(); } catch { /* ignore */ }

    const supportUser = await settingsRepo.getSetting(pool, 'support_username');
    let expiredText =
      `╔═══════════════════════╗\n` +
      `║   ⏰ <b>PAYMENT EXPIRED</b>        ║\n` +
      `╚═══════════════════════╝\n\n` +
      `📋 Order: <code>${orderId}</code>\n` +
      `💰 Amount: ₹${parseFloat(txn.amount).toFixed(2)}\n\n` +
      `Your payment window has closed.\n` +
      `Please create a new deposit to continue.\n\n` +
      `<i>💡 Already paid? Contact support with your UTR/Ref number and we will credit your account.</i>`;

    if (supportUser) {
      expiredText += `\n\n🛡 <b>Support:</b> @${escapeHtml(supportUser)}`;
    }

    await ctx.reply(expiredText, {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('💰 New Deposit', 'deposit:paytm').text('‹ Menu', 'deposit:menu'),
    });
    return;
  }

  const mid = await settingsRepo.getSetting(pool, 'paytm_merchant_key');
  const txnRef = txn.gateway_data?.txnRef;
  const upiId = txn.gateway_data?.upiId;
  if (!mid || !txnRef) {
    await ctx.reply('⚠️ Verification not configured. Contact admin.');
    return;
  }
  if (!/^[A-Za-z0-9]+$/.test(mid)) {
    logger.error(`[PAYTM] MID is invalid (contains emojis/spaces). Current value starts with: "${String(mid).substring(0, 5)}...". Admin must fix it.`);
    await ctx.reply('⚠️ Paytm MID is invalid. Admin needs to re-set it in Payments → Paytm → Set MID.');
    return;
  }

  try { await ctx.deleteMessage(); } catch { /* ignore */ }

  const verifyMsg = await ctx.reply(
    `🔄 <b>Verifying your payment...</b>\n\n` +
    `📋 Order: <code>${orderId}</code>\n` +
    `💰 Amount: ₹${parseFloat(txn.amount).toFixed(2)}\n\n` +
    `⏳ Attempt 1/3 — checking...`,
    { parse_mode: 'HTML' }
  );

  const MAX_ATTEMPTS = 3;
  const DELAY_MS = 3000;
  let finalResult = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await paytmService.checkPaymentStatus(mid, txnRef, parseFloat(txn.amount));

    if (result.success) {
      const creditAmount = result.amount || parseFloat(txn.amount);
      await transactionRepo.updateStatus(pool, orderId, 'success', txnRef, {
        paytm_txnId: result.txnId,
        paytm_utr: result.utr,
        paytm_status: result.status,
      });
      await walletRepo.addBalance(pool, ctx.from.id, creditAmount);
      try { await ctx.api.deleteMessage(ctx.chat.id, verifyMsg.message_id); } catch { /* ignore */ }
      const { benefits, newBalance } = await applyBenefits(pool, ctx.from.id, creditAmount, orderId);
      await processReferralOnDeposit(pool, ctx.api, ctx.from.id, creditAmount, orderId);
      await ctx.reply(buildSuccessMessage(creditAmount, newBalance, orderId, benefits),
        { parse_mode: 'HTML' }
      );
      return;
    }

    if (result.failed) {
      await transactionRepo.updateStatus(pool, orderId, 'failed');
      try { await ctx.api.deleteMessage(ctx.chat.id, verifyMsg.message_id); } catch { /* ignore */ }

      const newOrderId = `DX-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const payeeName = await settingsRepo.getSetting(pool, 'paytm_payee_name') || 'Paytm Merchant';
      const paytmQr = await settingsRepo.getSetting(pool, 'paytm_qr_code') || '';
      const botName = await settingsRepo.getSetting(pool, 'bot_name') || 'OTPBOT';
      const displayName = await settingsRepo.getSetting(pool, 'paytm_display_name') || 'Pay via Automatic Gateway';
      const { upiLink: newUpiLink, txnRef: newTxnRef } = paytmService.generatePaymentQR(upiId, parseFloat(txn.amount), newOrderId, payeeName, paytmQr);

      const newExpiresAt = timeLimit > 0 ? new Date(Date.now() + timeLimit * 1000) : null;
      await transactionRepo.createTransaction(pool, {
        userId: ctx.from.id, gateway: 'paytm', orderId: newOrderId, amount: parseFloat(txn.amount),
        gatewayData: { txnRef: newTxnRef, upiId },
        expiresAt: newExpiresAt,
      });

      const qrBuf = await generateBrandedQR({
        storeName: botName, amount: parseFloat(txn.amount).toFixed(2),
        currency: '₹', refId: newTxnRef, upiLink: newUpiLink, developer: '@Erroroo',
      });

      const failCaption =
        `❌ <b>Payment Not Verified</b>\n\n` +
        `Previous order <code>${orderId}</code> could not be verified.\n` +
        `A new QR has been generated for you.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `💳 <b>${escapeHtml(displayName)}</b>\n` +
        `💰 <b>Amount:</b> ₹${parseFloat(txn.amount).toFixed(2)}\n` +
        `📋 <b>New Order:</b> <code>${newOrderId}</code>\n` +
        `💎 <b>Ref:</b> <code>${newTxnRef}</code>\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Scan the QR code with any UPI app.`;

      const failKb = new InlineKeyboard()
        .text('🔄 Check Payment', `deposit:check:${newOrderId}`).row()
        .text('❌ Cancel', `deposit:cancel_txn:${newOrderId}`);

      const sentMsg = await ctx.replyWithPhoto(new InputFile(qrBuf, 'payment_qr.png'), {
        caption: failCaption, parse_mode: 'HTML', reply_markup: failKb,
      });

      const photoFileId = sentMsg.photo?.[sentMsg.photo.length - 1]?.file_id;
      if (photoFileId) {
        await transactionRepo.updateGatewayData(pool, newOrderId, {
          txnRef: newTxnRef, upiId, photoFileId, caption: failCaption, qrMsgId: sentMsg.message_id,
        });
      }
      return;
    }

    finalResult = result;

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

  // Not verified after all attempts — re-send QR
  try { await ctx.api.deleteMessage(ctx.chat.id, verifyMsg.message_id); } catch { /* ignore */ }

  const freshTxn = await transactionRepo.getByOrderId(pool, orderId);
  const storedFileId = freshTxn?.gateway_data?.photoFileId;
  const remaining = timeLimit > 0 ? Math.max(0, Math.ceil((timeLimit - elapsed) / 60)) : 0;
  const timeText = timeLimit > 0 ? `⏰ Expires in <b>${remaining} minutes</b>` : '⏰ <b>No time limit</b>';

  const resendKb = new InlineKeyboard()
    .text('🔄 Check Payment', `deposit:check:${orderId}`).row()
    .text('❌ Cancel Order', `deposit:cancel_txn:${orderId}`);

  if (storedFileId) {
    const displayName = await settingsRepo.getSetting(pool, 'paytm_display_name') || 'Pay via Automatic Gateway';
    const botName = await settingsRepo.getSetting(pool, 'bot_name') || 'OTPBOT';
    const resendCaption =
      `⚠️ <b>Payment Not Yet Received</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `💳 <b>${escapeHtml(displayName)}</b>\n` +
      `🏪 <b>${escapeHtml(botName)}</b>\n` +
      `💰 <b>Amount:</b> ₹${parseFloat(txn.amount).toFixed(2)}\n` +
      `📋 <b>Order:</b> <code>${orderId}</code>\n` +
      `💎 <b>Ref:</b> <code>${txnRef}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `${timeText}\n\n` +
      `<i>If you've paid, wait a moment and tap Check Payment again.</i>`;

    await ctx.replyWithPhoto(storedFileId, {
      caption: resendCaption, parse_mode: 'HTML', reply_markup: resendKb,
    });
  } else {
    const botName = await settingsRepo.getSetting(pool, 'bot_name') || 'OTPBOT';
    const payeeName = await settingsRepo.getSetting(pool, 'paytm_payee_name') || 'Paytm Merchant';
    const paytmQr = await settingsRepo.getSetting(pool, 'paytm_qr_code') || '';
    const displayName = await settingsRepo.getSetting(pool, 'paytm_display_name') || 'Pay via Automatic Gateway';

    const { upiLink: rebuildUpiLink } = paytmService.generatePaymentQR(upiId, parseFloat(txn.amount), orderId, payeeName, paytmQr, txnRef);
    const qrImageBuffer = await generateBrandedQR({
      storeName: botName, amount: parseFloat(txn.amount).toFixed(2),
      currency: '₹', refId: txnRef, upiLink: rebuildUpiLink, developer: '@Erroroo',
    });
    const fallbackCaption =
      `⚠️ <b>Payment Not Yet Received</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `💳 <b>${escapeHtml(displayName)}</b>\n` +
      `🏪 <b>${escapeHtml(botName)}</b>\n` +
      `💰 <b>Amount:</b> ₹${parseFloat(txn.amount).toFixed(2)}\n` +
      `📋 <b>Order:</b> <code>${orderId}</code>\n` +
      `💎 <b>Ref:</b> <code>${txnRef}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `${timeText}\n\n` +
      `<i>If you've paid, wait a moment and tap Check Payment again.</i>`;

    await ctx.replyWithPhoto(new InputFile(qrImageBuffer, 'payment_qr.png'), {
      caption: fallbackCaption, parse_mode: 'HTML', reply_markup: resendKb,
    });
  }

  await ctx.reply(
    `╔══════════════════════╗\n` +
    `   ❌ <b>Payment Not Received</b>\n` +
    `╚══════════════════════╝\n\n` +
    `We checked <b>${MAX_ATTEMPTS} times</b> but could not find your payment.\n\n` +
    `📋 <b>Order:</b> <code>${orderId}</code>\n` +
    `💰 <b>Amount:</b> ₹${parseFloat(txn.amount).toFixed(2)}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📌 <b>Please ensure:</b>\n\n` +
    `  ✅ You completed the payment for the exact amount\n` +
    `  ✅ You paid using the QR code shown above\n` +
    `  ✅ Wait a minute and try Check Payment again\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `<i>💡 If you already paid, please wait 1-2 minutes and try again.</i>`,
    { parse_mode: 'HTML' }
  );
}

export default composer;
