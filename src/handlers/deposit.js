import { Composer, InlineKeyboard, InputFile } from 'grammy';
import { checkForceJoin } from '../middleware/forceJoinCheck.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import * as walletRepo from '../database/repositories/walletRepo.js';
import * as transactionRepo from '../database/repositories/transactionRepo.js';
import * as paytmService from '../services/paytmService.js';
import * as bharatpayService from '../services/bharatpayService.js';
import * as cryptomusService from '../services/cryptomusService.js';
import * as binanceRate from '../services/binanceRateService.js';

import { formatNumber, escapeHtml } from '../utils/formatters.js';
import { generateBrandedQR } from '../services/qrImageService.js';
import logger from '../utils/logger.js';

// ── Crypto display helpers ──────────────────────────────────────
function _coinEmoji(coin) {
  const map = {
    'USDT': '🟢', 'BTC': '🟠', 'ETH': '🔵', 'TRX': '🔴',
    'DOGE': '🐶', 'LTC': '⚪', 'BNB': '🟡', 'SOL': '🟣',
    'XRP': '⚫', 'MATIC': '🟣', 'TON': '💎', 'USDC': '🔵',
    'ADA': '🔵', 'AVAX': '🔺', 'SHIB': '🐕', 'DAI': '🟡',
    'DOT': '🩷', 'DASH': '🔵', 'FDUSD': '🟢', 'BUSD': '🟡',
  };
  return map[coin] || '🪙';
}

function _networkLabel(nw) {
  const map = {
    'tron': 'TRC20', 'bsc': 'BEP20', 'eth': 'ERC20', 'polygon': 'Polygon',
    'arbitrum': 'Arbitrum', 'optimism': 'Optimism', 'avalanche': 'AVAX-C',
    'btc': 'Bitcoin', 'ltc': 'Litecoin', 'doge': 'Dogecoin', 'dash': 'Dash',
    'sol': 'Solana', 'ton': 'TON', 'xrp': 'XRP', 'ada': 'Cardano',
  };
  return map[nw?.toLowerCase()] || nw?.toUpperCase() || nw;
}

const composer = new Composer();
const userStates = new Map(); // chatId → { step, gateway, msgId }

// ── Per-user rate limit for Check Payment (anti-spam at 400K scale) ──
const checkCooldowns = new Map(); // chatId → timestamp of last check
const COOLDOWN_MS = 3_000; // 3 seconds between checks per user

// ── Concurrent check guard (prevents double-click issues) ───────────
const activeChecks = new Set(); // chatIds currently being verified

// ═══════════════════════════════════════════════════════════════════
//  CRYPTO AUTO-POLL: auto-detect payment & auto-expire
//  Polls Cryptomus API every 15s → instant credit on payment
// ═══════════════════════════════════════════════════════════════════
const cryptoPollers = new Map(); // orderId → intervalId

function startCryptoAutoCheck(bot, pool, orderId, uuid, userId, chatId, msgId, apiKey, merchantId) {
  // Don't double-start
  if (cryptoPollers.has(orderId)) return;

  const POLL_INTERVAL = 15_000; // 15 seconds
  const MAX_DURATION = 65 * 60_000; // 65 minutes (a bit more than Cryptomus's 1 hour)
  const startedAt = Date.now();

  const intervalId = setInterval(async () => {
    try {
      // Check if max duration exceeded → auto-expire
      if (Date.now() - startedAt > MAX_DURATION) {
        clearInterval(intervalId);
        cryptoPollers.delete(orderId);
        const txn = await transactionRepo.getByOrderId(pool, orderId);
        if (txn && txn.status === 'pending') {
          await transactionRepo.updateStatus(pool, orderId, 'expired');
          try {
            await bot.api.sendMessage(chatId,
              `⏰ <b>Payment Expired</b>\n\n` +
              `📋 <b>Order:</b> <code>${orderId}</code>\n\n` +
              `<i>Your payment time has expired.\nPlease create a new order.</i>`,
              { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '💰 Deposit', callback_data: 'deposit:menu' }]] } }
            );
          } catch { /* user may have blocked bot */ }
          // Try to delete old invoice message
          try { await bot.api.deleteMessage(chatId, msgId); } catch { /* ignore */ }
        }
        return;
      }

      // Check Cryptomus API status
      const result = await cryptomusService.checkPayment(apiKey, merchantId, uuid);

      if (result.success) {
        // ✅ PAID — instant credit!
        clearInterval(intervalId);
        cryptoPollers.delete(orderId);

        const txn = await transactionRepo.getByOrderId(pool, orderId);
        if (!txn || txn.status === 'success') return; // already credited

        const creditAmount = parseFloat(txn.amount);
        await transactionRepo.updateStatus(pool, orderId, 'success', uuid, { cryptomus_status: result.status });
        await walletRepo.addBalance(pool, userId, creditAmount);
        const newBalance = await walletRepo.getBalance(pool, userId);

        // Delete old invoice message
        try { await bot.api.deleteMessage(chatId, msgId); } catch { /* ignore */ }

        // Send instant success notification
        await bot.api.sendMessage(chatId,
          `╔══════════════════════╗\n` +
          `   ✅ <b>Payment Received!</b>\n` +
          `╚══════════════════════╝\n\n` +
          `💰 <b>Credited:</b> ₹${creditAmount.toFixed(2)}\n` +
          `💳 <b>New Balance:</b> ₹${formatNumber(newBalance)}\n` +
          `📋 <b>Order:</b> <code>${orderId}</code>\n\n` +
          `🎉 <i>Your wallet has been updated instantly!</i>`,
          { parse_mode: 'HTML' }
        );
        logger.info(`[Crypto AutoPoll] Payment ${orderId} credited ₹${creditAmount} to user ${userId}`);

      } else if (['cancel', 'system_fail', 'fail', 'wrong_amount', 'wrong_amount_waiting'].includes(result.status)) {
        // ❌ FAILED
        clearInterval(intervalId);
        cryptoPollers.delete(orderId);

        const txn = await transactionRepo.getByOrderId(pool, orderId);
        if (!txn || txn.status !== 'pending') return;

        await transactionRepo.updateStatus(pool, orderId, 'failed', uuid, { cryptomus_status: result.status });
        try { await bot.api.deleteMessage(chatId, msgId); } catch { /* ignore */ }
        await bot.api.sendMessage(chatId,
          `❌ <b>Payment Failed</b>\n\n` +
          `📋 <b>Order:</b> <code>${orderId}</code>\n` +
          `📊 <b>Status:</b> ${result.status}\n\n` +
          `<i>Please try again with a new order.</i>`,
          { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '💰 Deposit', callback_data: 'deposit:menu' }]] } }
        );
      }
      // else status is 'process', 'check', 'confirming' etc → keep polling
    } catch (err) {
      logger.error(`[Crypto AutoPoll] Error checking ${orderId}: ${err.message}`);
      // Don't stop polling on transient errors
    }
  }, POLL_INTERVAL);

  cryptoPollers.set(orderId, intervalId);
  logger.info(`[Crypto AutoPoll] Started for order ${orderId}, user ${userId}`);
}

function stopCryptoAutoCheck(orderId) {
  const intervalId = cryptoPollers.get(orderId);
  if (intervalId) {
    clearInterval(intervalId);
    cryptoPollers.delete(orderId);
  }
}


// ═══════════════════════════════════════════════════════════════════
//  SAFE REPLY HELPER
//  Telegram cannot editMessageText on a photo message.
//  This helper always works: delete old message → send new one.
// ═══════════════════════════════════════════════════════════════════
async function safeReply(ctx, text, opts = {}) {
  try { await ctx.deleteMessage(); } catch { /* old or already deleted */ }
  return ctx.reply(text, opts);
}


// ═══════════════════════════════════════════════════════════════════
//  DEPOSIT ENTRY — show payment method buttons
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('deposit:menu', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showDepositMenu(ctx);
});

async function showDepositMenu(ctx) {
  const pool = ctx.dbPool;
  const [paytmOn, bharatpayOn, cryptomusOn, minAmount, botName, paytmDisplayName, bharatDisplayName, cryptoDisplayName] = await Promise.all([
    settingsRepo.getSetting(pool, 'paytm_enabled'),
    settingsRepo.getSetting(pool, 'bharatpay_enabled'),
    settingsRepo.getSetting(pool, 'cryptomus_enabled'),
    settingsRepo.getSetting(pool, 'paytm_min_amount'),
    settingsRepo.getSetting(pool, 'bot_name'),
    settingsRepo.getSetting(pool, 'paytm_display_name'),
    settingsRepo.getSetting(pool, 'bharatpay_display_name'),
    settingsRepo.getSetting(pool, 'cryptomus_display_name'),
  ]);
  const balance = await walletRepo.getBalance(pool, ctx.from.id);
  const name = ctx.from.first_name || 'User';

  let text =
    `👋 <b>Hey ${escapeHtml(name)}!</b>\n\n` +
    `💰 <b>Deposit Information</b>\n\n` +
    `💳 <b>Balance:</b> ₹${formatNumber(balance)}\n` +
    `📌 <b>Min Deposit:</b> ₹${minAmount || 1}\n\n` +
    `⚠️ <b>Note:</b> Once deposited, funds are non-refundable.\n` +
    `You can use your balance for all services.\n\n` +
    `👇 <b>Select Payment Method</b>`;

  const kb = new InlineKeyboard();
  if (paytmOn) kb.text(`💎 ${paytmDisplayName || 'UPI'}`, 'deposit:paytm');
  if (cryptomusOn) kb.text(`💎 ${cryptoDisplayName || 'CRYPTO'}`, 'deposit:cryptomus');
  kb.row();
  if (bharatpayOn) kb.text(`🏦 ${bharatDisplayName || 'UPI (Manual)'}`, 'deposit:bharatpay').row();
  if (!paytmOn && !bharatpayOn && !cryptomusOn) text += '\n\n⚠️ No payment methods available.';
  kb.text('❌ Cancel', 'deposit:close');

  await safeReply(ctx, text, { parse_mode: 'HTML', reply_markup: kb });
}

// ═══════════════════════════════════════════════════════════════════
//  PAYTM FLOW
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('deposit:paytm', async (ctx) => {
  await ctx.answerCallbackQuery();
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
  await ctx.answerCallbackQuery();
  const amount = parseFloat(ctx.callbackQuery.data.split(':')[2]);
  await handlePaytmAmount(ctx, amount);
});

// ── Paytm: custom amount requested ─────────────────────────────
composer.callbackQuery('deposit:paytm_custom', async (ctx) => {
  await ctx.answerCallbackQuery();
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
async function handlePaytmAmount(ctx, presetAmount = null) {
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

  // Store file_id so we reuse EXACT same image when re-sending after failed check
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

  // ── Rate limit: 1 check per 5s per user (protects Paytm API at scale) ──
  const lastCheck = checkCooldowns.get(chatId);
  if (lastCheck && Date.now() - lastCheck < COOLDOWN_MS) {
    const waitSec = Math.ceil((COOLDOWN_MS - (Date.now() - lastCheck)) / 1000);
    await ctx.answerCallbackQuery({ text: `⏳ Please wait ${waitSec}s before checking again.`, show_alert: false });
    return;
  }

  // ── Concurrent guard: prevent double-click spam ──
  if (activeChecks.has(chatId)) {
    await ctx.answerCallbackQuery({ text: '🔄 Already checking...', show_alert: false });
    return;
  }

  await ctx.answerCallbackQuery();
  activeChecks.add(chatId);
  checkCooldowns.set(chatId, Date.now());

  try {
    await _doPaytmCheck(ctx, pool, orderId);
  } finally {
    activeChecks.delete(chatId);
  }
});

/**
 * Core Paytm check logic — extracted for clarity.
 * Handles: expired, failed, success, and "not yet received" states.
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

  // Check time limit (0 = no limit)
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
  // Validate MID format — must be alphanumeric (e.g. MgjdFH15397320634096)
  if (!/^[A-Za-z0-9]+$/.test(mid)) {
    logger.error(`[PAYTM] MID is invalid (contains emojis/spaces). Current value starts with: "${String(mid).substring(0, 5)}...". Admin must fix it.`);
    await ctx.reply('⚠️ Paytm MID is invalid. Admin needs to re-set it in Payments → Paytm → Set MID.');
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
    const result = await paytmService.checkPaymentStatus(mid, txnRef, parseFloat(txn.amount));

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
      // ── Genuinely failed — show inline with new QR ───────────
      await transactionRepo.updateStatus(pool, orderId, 'failed');
      try { await ctx.api.deleteMessage(ctx.chat.id, verifyMsg.message_id); } catch { /* ignore */ }

      // Generate new order with new QR inline
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
    // ── Fallback: regenerate QR if file_id not stored ──────────
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

  // Send separate "not received" message
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

// ═══════════════════════════════════════════════════════════════════
//  BHARAT PAY FLOW
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('deposit:bharatpay', async (ctx) => {
  await ctx.answerCallbackQuery();
  const pool = ctx.dbPool;
  const qrFileId = await settingsRepo.getSetting(pool, 'bharatpay_qr_file_id');
  const upiId = await settingsRepo.getSetting(pool, 'bharatpay_upi_id');
  const minAmount = await settingsRepo.getSetting(pool, 'bharatpay_min_amount') || 1;

  if (!qrFileId) {
    await safeReply(ctx, '⚠️ Bharat Pay is not configured yet. Contact admin.', {
      reply_markup: new InlineKeyboard().text('‹ Back', 'deposit:menu')
    });
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
  // Delete old message first (safe for photo messages), then send QR
  try { await ctx.deleteMessage(); } catch { /* ignore */ }
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
  const minAmount = await settingsRepo.getSetting(pool, 'bharatpay_min_amount') || 1;

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
  const mode = await settingsRepo.getSetting(pool, 'cryptomus_mode') || 'web';

  if (mode === 'web') {
    // ── WEB MODE: amount → Cryptomus web page ──────────────────
    const minAmount = parseInt(await settingsRepo.getSetting(pool, 'cryptomus_min_amount')) || 1;
    const maxAmount = parseInt(await settingsRepo.getSetting(pool, 'cryptomus_max_amount')) || 0;

    let text =
      `🪙 <b>Crypto Deposit</b>\n\n` +
      `💰 <b>Select Deposit Amount (INR)</b>\n\n` +
      `📌 <b>Min:</b> ₹${minAmount}` +
      (maxAmount ? `  •  <b>Max:</b> ₹${maxAmount}` : '') + `\n\n` +
      `👇 <b>Choose an amount or enter custom</b>`;

    const presets = [100, 300, 500, 1000, 2000, 5000, 10000].filter(a => a >= minAmount && (!maxAmount || a <= maxAmount));
    const kb = new InlineKeyboard();
    for (let i = 0; i < presets.length; i += 2) {
      kb.text(`₹${presets[i]}`, `deposit:crypto_web_amt:${presets[i]}`);
      if (presets[i + 1]) kb.text(`₹${presets[i + 1]}`, `deposit:crypto_web_amt:${presets[i + 1]}`);
      kb.row();
    }
    kb.text('💲 Custom Amount', 'deposit:crypto_web_custom').row();
    kb.text('‹ Back', 'deposit:menu').text('❌ Cancel', 'deposit:close');

    await safeReply(ctx, text, { parse_mode: 'HTML', reply_markup: kb });
    return;
  }

  // ── INLINE MODE: currency selection → amount → QR ──────────
  let selectedCurrencies = [];
  try {
    const raw = await settingsRepo.getSetting(pool, 'cryptomus_currencies');
    selectedCurrencies = JSON.parse(raw || '[]');
  } catch { selectedCurrencies = []; }

  if (selectedCurrencies.length === 0) {
    await safeReply(ctx, '⚠️ No crypto currencies configured. Contact admin.', { parse_mode: 'HTML' });
    return;
  }

  // Fetch live rates for all unique assets
  const uniqueAssets = [...new Set(selectedCurrencies.map(c => c.currency))];
  const rateResults = {};
  await Promise.all(uniqueAssets.map(async (asset) => {
    rateResults[asset] = await binanceRate.getLiveRate(asset, 'INR');
  }));

  let text =
    `🪙 <b>Please select your payment method (Crypto):</b>\n\n` +
    `Choose any one option below 👇`;

  const kb = new InlineKeyboard();
  // Place 2 buttons per row with proper crypto brand icons
  for (let i = 0; i < selectedCurrencies.length; i += 2) {
    const cur1 = selectedCurrencies[i];
    const icon1 = _coinEmoji(cur1.currency);
    const nw1 = _networkLabel(cur1.network);
    kb.text(`${icon1} ${cur1.currency} (${nw1})`, `deposit:crypto_cur:${cur1.currency}:${cur1.network}`);
    if (i + 1 < selectedCurrencies.length) {
      const cur2 = selectedCurrencies[i + 1];
      const icon2 = _coinEmoji(cur2.currency);
      const nw2 = _networkLabel(cur2.network);
      kb.text(`${icon2} ${cur2.currency} (${nw2})`, `deposit:crypto_cur:${cur2.currency}:${cur2.network}`);
    }
    kb.row();
  }
  kb.text('◀️ Back', 'deposit:menu').text('❌ Cancel', 'deposit:close');

  await safeReply(ctx, text, { parse_mode: 'HTML', reply_markup: kb });
});

// ── Crypto: currency selected → show amount buttons ─────────────
// ═══════════════════════════════════════════════════════════════════
//  CRYPTO: WEB MODE HANDLERS
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery(/^deposit:crypto_web_amt:\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const amount = parseFloat(ctx.callbackQuery.data.split(':')[2]);
  await handleCryptoWebDeposit(ctx, amount);
});

composer.callbackQuery('deposit:crypto_web_custom', async (ctx) => {
  await ctx.answerCallbackQuery();
  const pool = ctx.dbPool;
  const minAmount = parseInt(await settingsRepo.getSetting(pool, 'cryptomus_min_amount')) || 1;
  const maxAmount = parseInt(await settingsRepo.getSetting(pool, 'cryptomus_max_amount')) || 0;

  await safeReply(ctx,
    `💲 <b>Enter Custom Amount (INR)</b>\n\n` +
    `<b>Example:</b> <code>100</code> , <code>500</code> , <code>1000</code>\n\n` +
    `📌 <b>Min:</b> ₹${minAmount}` +
    (maxAmount ? `  •  <b>Max:</b> ₹${maxAmount}` : '') + `\n\n` +
    `✅ Type the amount below:`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('‹ Back', 'deposit:cryptomus').text('❌ Cancel', 'deposit:cancel_state') }
  );
  userStates.set(ctx.chat.id, { step: 'cryptomus_web_amount' });
});

async function handleCryptoWebDeposit(ctx, amount) {
  const pool = ctx.dbPool;
  const minAmount = parseInt(await settingsRepo.getSetting(pool, 'cryptomus_min_amount')) || 1;
  const maxAmount = parseInt(await settingsRepo.getSetting(pool, 'cryptomus_max_amount')) || 0;

  if (isNaN(amount) || amount < minAmount) {
    await ctx.reply(`⚠️ Minimum deposit is ₹${minAmount}.`);
    return;
  }
  if (maxAmount > 0 && amount > maxAmount) {
    await ctx.reply(`⚠️ Maximum deposit is ₹${maxAmount}.`);
    return;
  }

  userStates.delete(ctx.chat.id);
  const apiKey = await settingsRepo.getSetting(pool, 'cryptomus_api_key');
  const merchantId = await settingsRepo.getSetting(pool, 'cryptomus_merchant_id');

  if (!apiKey || !merchantId) {
    await ctx.reply('⚠️ Cryptomus not configured. Contact admin.');
    return;
  }

  const orderId = `CX-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  await walletRepo.ensureWallet(pool, ctx.from.id);

  const result = await cryptomusService.createInvoice(apiKey, merchantId, {
    amount, currency: 'INR', orderId,
  });

  if (!result.success) {
    await ctx.reply(`⚠️ Failed to create invoice: ${result.error}`);
    return;
  }

  await transactionRepo.createTransaction(pool, {
    userId: ctx.from.id, gateway: 'cryptomus', orderId, amount,
    gatewayData: { uuid: result.uuid, paymentUrl: result.paymentUrl },
  });

  // Fetch live rate for display
  const rateResult = await binanceRate.getLiveRate('USDT', 'INR');
  let rateInfo = '';
  if (rateResult.price) {
    const approxUsdt = (amount / rateResult.price).toFixed(2);
    rateInfo = `📊 <b>Live Rate:</b> 1 USDT ≈ ₹${rateResult.price.toFixed(2)}\n` +
               `💱 <b>Approx:</b> ${approxUsdt} USDT\n`;
  }

  const kb = new InlineKeyboard()
    .webApp('🌐 Pay Now', result.paymentUrl).row()
    .text('✅ Verify Payment', `deposit:check_crypto:${orderId}`).row()
    .text('❌ Cancel', `deposit:cancel_txn:${orderId}`);

  const sentMsg = await ctx.reply(
    `✨ <b>Invoice Generated</b>\n\n` +
    `🎯 <b>Payment Time Limit:</b> 60 Minutes\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 <b>Amount:</b> ₹${amount.toFixed(2)}\n` +
    `📋 <b>Order:</b> <code>${orderId}</code>\n` +
    `${rateInfo}` +
    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Tap <b>Pay Now</b> to pay inside Telegram.\n` +
    `All crypto currencies are accepted.\n\n` +
    `🔄 <i>Payment will be verified automatically.</i>`,
    { parse_mode: 'HTML', reply_markup: kb }
  );

  // Start background auto-polling for instant credit
  startCryptoAutoCheck(ctx.api, pool, orderId, result.uuid, ctx.from.id, ctx.chat.id, sentMsg.message_id, apiKey, merchantId);
}

// ═══════════════════════════════════════════════════════════════════
//  CRYPTO: INLINE MODE HANDLERS
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery(/^deposit:crypto_cur:/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const parts = ctx.callbackQuery.data.split(':');
  const currency = parts[2];
  const network = parts[3];
  const pool = ctx.dbPool;
  const minAmount = parseInt(await settingsRepo.getSetting(pool, 'cryptomus_min_amount')) || 1;
  const maxAmount = parseInt(await settingsRepo.getSetting(pool, 'cryptomus_max_amount')) || 0;

  // Fetch live Binance P2P rate
  const rateResult = await binanceRate.getLiveRate(currency, 'INR');
  const rateText = rateResult.price
    ? `📊 <b>Live Rate:</b> 1 ${currency} = ₹${rateResult.price.toFixed(2)}`
    : `📊 <b>Rate:</b> Fetching from Cryptomus...`;

  const nwDisplay = network.charAt(0).toUpperCase() + network.slice(1);
  let text =
    `💰 <b>DEPOSIT</b>\n\n` +
    `💲 Please select the amount in rupees you want to add.\n\n` +
    `🪙 <b>Paying via:</b> ${currency} (${nwDisplay})\n` +
    `${rateText}\n\n` +
    `📌 <b>Min:</b> ₹${minAmount}` +
    (maxAmount ? `  •  <b>Max:</b> ₹${maxAmount}` : '') + `\n\n` +
    `👇 <b>Choose an amount or enter custom</b>`;

  const presets = [10, 50, 100, 300, 500, 1000, 5000, 10000].filter(a => a >= minAmount && (!maxAmount || a <= maxAmount));
  const kb = new InlineKeyboard();
  for (let i = 0; i < presets.length; i += 2) {
    kb.text(`₹${presets[i]}`, `deposit:crypto_amt:${currency}:${network}:${presets[i]}`);
    if (presets[i + 1]) kb.text(`₹${presets[i + 1]}`, `deposit:crypto_amt:${currency}:${network}:${presets[i + 1]}`);
    kb.row();
  }
  kb.text('💲 Custom Amount', `deposit:crypto_custom:${currency}:${network}`).row();
  kb.text('‹ Back', 'deposit:cryptomus').text('❌ Cancel', 'deposit:close');

  await safeReply(ctx, text, { parse_mode: 'HTML', reply_markup: kb });
});

// ── Crypto: preset amount clicked ───────────────────────────────
composer.callbackQuery(/^deposit:crypto_amt:/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const parts = ctx.callbackQuery.data.split(':');
  const currency = parts[2];
  const network = parts[3];
  const amount = parseFloat(parts[4]);
  await handleCryptomusDeposit(ctx, currency, network, amount);
});

// ── Crypto: custom amount requested ─────────────────────────────
composer.callbackQuery(/^deposit:crypto_custom:/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const parts = ctx.callbackQuery.data.split(':');
  const currency = parts[2];
  const network = parts[3];
  const pool = ctx.dbPool;
  const minAmount = parseInt(await settingsRepo.getSetting(pool, 'cryptomus_min_amount')) || 1;
  const maxAmount = parseInt(await settingsRepo.getSetting(pool, 'cryptomus_max_amount')) || 0;

  await safeReply(ctx,
    `💲 <b>Enter Custom Amount (INR)</b>\n\n` +
    `Paying via <b>${currency} (${network})</b>\n\n` +
    `<b>Example:</b> <code>100</code> , <code>500</code> , <code>1000</code>\n\n` +
    `📌 <b>Min:</b> ₹${minAmount}` +
    (maxAmount ? `  •  <b>Max:</b> ₹${maxAmount}` : '') + `\n\n` +
    `✅ Type the amount below:`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('‹ Back', `deposit:crypto_cur:${currency}:${network}`).text('❌ Cancel', 'deposit:cancel_state') }
  );
  userStates.set(ctx.chat.id, { step: 'cryptomus_amount', currency, network });
});

// ── Crypto: process deposit — create invoice + show QR ──────────
async function handleCryptomusDeposit(ctx, currency, network, amount) {
  const pool = ctx.dbPool;
  const minAmount = parseInt(await settingsRepo.getSetting(pool, 'cryptomus_min_amount')) || 1;
  const maxAmount = parseInt(await settingsRepo.getSetting(pool, 'cryptomus_max_amount')) || 0;

  if (isNaN(amount) || amount < minAmount) {
    await ctx.reply(`⚠️ Minimum deposit is ₹${minAmount}.`);
    return;
  }
  if (maxAmount > 0 && amount > maxAmount) {
    await ctx.reply(`⚠️ Maximum deposit is ₹${maxAmount}.`);
    return;
  }

  userStates.delete(ctx.chat.id);
  const apiKey = await settingsRepo.getSetting(pool, 'cryptomus_api_key');
  const merchantId = await settingsRepo.getSetting(pool, 'cryptomus_merchant_id');

  if (!apiKey || !merchantId) {
    await ctx.reply('⚠️ Cryptomus not configured. Contact admin.');
    return;
  }

  const orderId = `CX-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  await walletRepo.ensureWallet(pool, ctx.from.id);

  const result = await cryptomusService.createInvoice(apiKey, merchantId, {
    amount, currency: 'INR', toCurrency: currency, network, orderId,
  });

  if (!result.success) {
    await ctx.reply(`⚠️ Failed to create invoice: ${result.error}`);
    return;
  }

  await transactionRepo.createTransaction(pool, {
    userId: ctx.from.id, gateway: 'cryptomus', orderId, amount,
    gatewayData: { uuid: result.uuid, paymentUrl: result.paymentUrl, address: result.address, payAmount: result.payAmount, payCurrency: result.payCurrency, network: result.network },
  });

  // Fetch live Binance P2P rate for display
  const rateResult = await binanceRate.getLiveRate(currency, 'INR');
  const nwDisplay = network.charAt(0).toUpperCase() + network.slice(1);

  let rateInfo = '';
  if (rateResult.price) {
    const approxCrypto = (amount / rateResult.price).toFixed(currency === 'BTC' ? 8 : ['USDT', 'USDC', 'BUSD', 'FDUSD'].includes(currency) ? 2 : 4);
    rateInfo = `📊 <b>Rate:</b> 1 ${currency} = ₹${rateResult.price.toFixed(2)}\n` +
               `💱 <b>Approx:</b> ${approxCrypto} ${currency}\n`;
  }

  const caption =
    `✨ <b>Invoice Generated</b>\n\n` +
    `🎯 <b>Payment Time Limit:</b> 60 Minutes\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 <b>Amount:</b> ₹${amount.toFixed(2)}\n` +
    `🪙 <b>Amount Payable:</b> ${result.payAmount} ${result.payCurrency}\n` +
    `🚀 <b>Pay using:</b> ${result.payCurrency}\n` +
    `🔗 <b>Network:</b> ${nwDisplay}\n` +
    `📋 <b>Order:</b> <code>${orderId}</code>\n` +
    `${rateInfo}` +
    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
    (result.address ? `🏦 <b>Payment Address:</b>\n<code>${result.address}</code>\n\n` : '') +
    `⚠️ <b>Send exact amount to this address only.</b>\n` +
    `🔄 <i>Payment will be verified automatically.</i>`;

  const kb = new InlineKeyboard();
  if (result.paymentUrl) kb.webApp('🌐 Pay via Web', result.paymentUrl).row();
  kb.text('✅ PAID', `deposit:check_crypto:${orderId}`).row()
    .text('❌ Cancel', `deposit:cancel_txn:${orderId}`);

  if (result.address) {
    // Generate QR with crypto address
    const qrImageBuffer = await generateBrandedQR({
      storeName: `${currency} (${nwDisplay})`,
      amount: result.payAmount,
      currency: result.payCurrency,
      refId: orderId,
      upiLink: result.address,
      developer: '@Erroroo',
    });

    const sentMsg = await ctx.replyWithPhoto(new InputFile(qrImageBuffer, 'crypto_qr.png'), {
      caption, parse_mode: 'HTML', reply_markup: kb,
    });

    const photoFileId = sentMsg.photo?.[sentMsg.photo.length - 1]?.file_id;
    if (photoFileId) {
      await transactionRepo.updateGatewayData(pool, orderId, {
        uuid: result.uuid, address: result.address, photoFileId, qrMsgId: sentMsg.message_id,
      });
    }

    // Start auto-polling for instant credit
    startCryptoAutoCheck(ctx.api, pool, orderId, result.uuid, ctx.from.id, ctx.chat.id, sentMsg.message_id, apiKey, merchantId);
  } else {
    // No address returned — show text-only with web link
    const sentMsg2 = await ctx.reply(caption, { parse_mode: 'HTML', reply_markup: kb });
    // Start auto-polling for instant credit
    startCryptoAutoCheck(ctx.api, pool, orderId, result.uuid, ctx.from.id, ctx.chat.id, sentMsg2.message_id, apiKey, merchantId);
  }
}

// ── Cryptomus: check payment ────────────────────────────────────
composer.callbackQuery(/^deposit:check_crypto:CX-/, async (ctx) => {
  const orderId = ctx.callbackQuery.data.replace('deposit:check_crypto:', '');
  const chatId = ctx.chat.id;
  const pool = ctx.dbPool;

  // Rate limit
  const lastCheck = checkCooldowns.get(chatId);
  if (lastCheck && Date.now() - lastCheck < COOLDOWN_MS) {
    const waitSec = Math.ceil((COOLDOWN_MS - (Date.now() - lastCheck)) / 1000);
    await ctx.answerCallbackQuery({ text: `⏳ Wait ${waitSec}s`, show_alert: false });
    return;
  }
  if (activeChecks.has(chatId)) {
    await ctx.answerCallbackQuery({ text: '🔄 Already checking...', show_alert: false });
    return;
  }

  await ctx.answerCallbackQuery('🔍 Checking...');
  activeChecks.add(chatId);
  checkCooldowns.set(chatId, Date.now());

  try {
    const txn = await transactionRepo.getByOrderId(pool, orderId);
    if (!txn) { await ctx.reply('⚠️ Order not found.'); return; }
    if (txn.status === 'success') { await ctx.answerCallbackQuery('✅ Already verified!'); return; }

    const apiKey = await settingsRepo.getSetting(pool, 'cryptomus_api_key');
    const merchantId = await settingsRepo.getSetting(pool, 'cryptomus_merchant_id');
    const uuid = txn.gateway_data?.uuid;
    if (!apiKey || !merchantId || !uuid) { await ctx.reply('⚠️ Config error.'); return; }

    const result = await cryptomusService.checkPayment(apiKey, merchantId, uuid);

    if (result.success) {
      stopCryptoAutoCheck(orderId); // Stop background polling
      const creditAmount = parseFloat(txn.amount);
      await transactionRepo.updateStatus(pool, orderId, 'success', uuid, { cryptomus_status: result.status });
      await walletRepo.addBalance(pool, ctx.from.id, creditAmount);
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      const newBalance = await walletRepo.getBalance(pool, ctx.from.id);
      await ctx.reply(
        `✅ <b>Crypto Payment Successful!</b>\n\n` +
        `💰 <b>Credited:</b> ₹${creditAmount.toFixed(2)}\n` +
        `💳 <b>New Balance:</b> ₹${formatNumber(newBalance)}\n\n` +
        `🎉 Thank you!`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.answerCallbackQuery({ text: `⏳ Status: ${result.status}. Try again later.`, show_alert: true });
    }
  } finally {
    activeChecks.delete(chatId);
  }
});

// ── Backward compat: old CRYPTO_ order check ────────────────────
composer.callbackQuery(/^deposit:check_crypto:CRYPTO_/, async (ctx) => {
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
    const creditAmount = parseFloat(txn.amount);
    await transactionRepo.updateStatus(pool, orderId, 'success', uuid, result);
    await walletRepo.addBalance(pool, ctx.from.id, creditAmount);
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    const newBalance = await walletRepo.getBalance(pool, ctx.from.id);
    await ctx.reply(
      `✅ <b>Crypto Payment Successful!</b>\n\n💰 <b>Credited:</b> ₹${creditAmount.toFixed(2)}\n💳 <b>New Balance:</b> ₹${formatNumber(newBalance)}\n\n🎉`,
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
  stopCryptoAutoCheck(orderId); // Stop background polling
  const txn = await transactionRepo.getByOrderId(ctx.dbPool, orderId);
  await transactionRepo.updateStatus(ctx.dbPool, orderId, 'cancelled');
  try { await ctx.deleteMessage(); } catch { /* ignore */ }
  await ctx.reply(
    `╔══════════════════════╗\n` +
    `   🚫 <b>Payment Cancelled</b>\n` +
    `╚══════════════════════╝\n\n` +
    `📋 <b>Order:</b> <code>${orderId}</code>\n` +
    `💰 <b>Amount:</b> ₹${txn ? parseFloat(txn.amount).toFixed(2) : '0.00'}\n\n` +
    `<i>Your payment order has been cancelled.\nYou can create a new order anytime.</i>`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('💰 Deposit', 'deposit:menu') }
  );
});

composer.callbackQuery('deposit:cancel_state', async (ctx) => {
  await ctx.answerCallbackQuery();
  userStates.delete(ctx.chat.id);
  try { await ctx.deleteMessage(); } catch { /* ignore */ }
  await ctx.reply(
    `🚫 <b>Cancelled</b>\n\n<i>Deposit process cancelled. You can start again anytime.</i>`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('💰 Deposit', 'deposit:menu') }
  );
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
  // Admin static buttons
  '📢 Broadcast', '👥 Users', '🔗 Force Join', '👑 Admins',
  '💬 Welcome Msg', '⚙️ Settings', '💰 Payments', '🤖 Bot Stats',
  '📋 Admin Logs', '◀️ BACK',
  // Payment sub-buttons
  '💳 Paytm', '🏦 BharatPay', '₿ Crypto', '◀️ Back to Admin',
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
    case 'cryptomus_amount': return handleCryptomusDeposit(ctx, state.currency, state.network, parseFloat(ctx.message.text.trim()));
    case 'cryptomus_web_amount': return handleCryptoWebDeposit(ctx, parseFloat(ctx.message.text.trim()));
    default: return next();
  }
});

export default composer;
