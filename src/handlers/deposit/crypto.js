/**
 * Deposit — Cryptomus gateway flow.
 *
 * Handles: Web mode + Inline mode (currency→amount→QR).
 * Includes auto-check loop for instant payment detection.
 */
import { Composer, InlineKeyboard, InputFile } from 'grammy';
import * as settingsRepo from '../../database/repositories/settingsRepo.js';
import * as walletRepo from '../../database/repositories/walletRepo.js';
import * as transactionRepo from '../../database/repositories/transactionRepo.js';
import * as cryptomusService from '../../services/cryptomusService.js';
import * as binanceRate from '../../services/binanceRateService.js';
import { formatNumber } from '../../utils/formatters.js';
import { generateBrandedQR } from '../../services/qrImageService.js';
import logger from '../../utils/logger.js';
import {
  userStates, checkCooldowns, COOLDOWN_MS, activeChecks,
  safeReply, buildSuccessMessage, applyBenefits, processReferralOnDeposit,
  _coinEmoji, _networkLabel,
} from './shared.js';

const composer = new Composer();

// ═══════════════════════════════════════════════════════════════════
//  CRYPTO AUTO-CHECK LOOP — Instant payment detection
// ═══════════════════════════════════════════════════════════════════
const _activeOrders = new Map(); // orderId → { intervalId, ...data }

function startCryptoAutoCheck(api, pool, orderId, uuid, userId, chatId, msgId, apiKey, merchantId) {
  if (_activeOrders.has(orderId)) return;

  const CHECK_INTERVAL = 3_000;
  const MAX_AGE = 65 * 60_000;
  const startTime = Date.now();

  const intervalId = setInterval(async () => {
    try {
      if (Date.now() - startTime > MAX_AGE) {
        _stopOrder(orderId);
        const txn = await transactionRepo.getByOrderId(pool, orderId);
        if (txn?.status === 'pending') {
          await transactionRepo.updateStatus(pool, orderId, 'expired');
          try { await api.deleteMessage(chatId, msgId); } catch {}
          await api.sendMessage(chatId,
            `⏰ <b>Payment Expired</b>\n\n` +
            `📋 <b>Order:</b> <code>${orderId}</code>\n\n` +
            `<i>Payment time has expired. Please create a new order.</i>`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '💰 Deposit', callback_data: 'deposit:menu' }]] } }
          );
        }
        return;
      }

      const result = await cryptomusService.checkPayment(apiKey, merchantId, uuid);

      if (result.success) {
        _stopOrder(orderId);
        const txn = await transactionRepo.getByOrderId(pool, orderId);
        if (!txn || txn.status === 'success') return;

        const creditAmount = parseFloat(txn.amount);
        const updated = await transactionRepo.updateStatus(pool, orderId, 'success', uuid, { cryptomus_status: result.status });
        if (!updated) return;
        await walletRepo.addBalance(pool, userId, creditAmount);
        const { benefits, newBalance, netCreditAmount } = await applyBenefits(pool, userId, creditAmount, orderId);
        await processReferralOnDeposit(pool, api, userId, netCreditAmount, orderId);

        try { await api.deleteMessage(chatId, msgId); } catch {}
        await api.sendMessage(chatId, buildSuccessMessage(creditAmount, newBalance, orderId, benefits),
          { parse_mode: 'HTML' }
        );
        logger.info(`[Crypto] ✅ ${orderId} ₹${creditAmount} → user ${userId}`);

      } else if (['cancel', 'system_fail', 'fail', 'wrong_amount'].includes(result.status)) {
        _stopOrder(orderId);
        const txn = await transactionRepo.getByOrderId(pool, orderId);
        if (!txn || txn.status !== 'pending') return;

        await transactionRepo.updateStatus(pool, orderId, 'failed', uuid, { cryptomus_status: result.status });
        try { await api.deleteMessage(chatId, msgId); } catch {}
        await api.sendMessage(chatId,
          `❌ <b>Payment Failed</b>\n\n` +
          `📋 <b>Order:</b> <code>${orderId}</code>\n` +
          `📊 <b>Status:</b> ${result.status}\n\n` +
          `<i>Please try again with a new order.</i>`,
          { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '💰 Deposit', callback_data: 'deposit:menu' }]] } }
        );
        logger.info(`[Crypto] ❌ ${orderId} failed (${result.status})`);
      }
    } catch {
      // API error — silently retry next interval
    }
  }, CHECK_INTERVAL);

  _activeOrders.set(orderId, { intervalId, uuid, userId, chatId, msgId, apiKey, merchantId });
}

function _stopOrder(orderId) {
  const order = _activeOrders.get(orderId);
  if (order) {
    clearInterval(order.intervalId);
    _activeOrders.delete(orderId);
  }
}

export function stopCryptoAutoCheck(orderId) {
  _stopOrder(orderId);
}

// ═══════════════════════════════════════════════════════════════════
//  CRYPTO ENTRY — mode selection (web vs inline)
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('deposit:cryptomus', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const mode = await settingsRepo.getSetting(pool, 'cryptomus_mode') || 'web';

  if (mode === 'web') {
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

  const uniqueAssets = [...new Set(selectedCurrencies.map(c => c.currency))];
  const rateResults = {};
  await Promise.all(uniqueAssets.map(async (asset) => {
    rateResults[asset] = await binanceRate.getLiveRate(asset, 'INR');
  }));

  let text =
    `🪙 <b>Please select your payment method (Crypto):</b>\n\n` +
    `Choose any one option below 👇`;

  const kb = new InlineKeyboard();
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

// ═══════════════════════════════════════════════════════════════════
//  CRYPTO: WEB MODE HANDLERS
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery(/^deposit:crypto_web_amt:\d+$/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const amount = parseFloat(ctx.callbackQuery.data.split(':')[2]);
  await handleCryptoWebDeposit(ctx, amount);
});

composer.callbackQuery('deposit:crypto_web_custom', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
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

export async function handleCryptoWebDeposit(ctx, amount) {
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
    await ctx.reply('⚠️ Gateway not configured. Contact admin.');
    return;
  }

  const orderId = `CX-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  await walletRepo.ensureWallet(pool, ctx.from.id);

  const result = await cryptomusService.createInvoice(apiKey, merchantId, {
    amount, currency: 'INR', orderId,
  });

  if (!result.success) {
    const minMatch = result.error?.match(/(\d+\.?\d*)\s*INR/i);
    if (minMatch) {
      await ctx.reply(
        `⚠️ <b>Amount Too Low</b>\n\n` +
        `Gateway requires minimum <b>₹${Math.ceil(parseFloat(minMatch[1]))}</b> for this payment.\n\n` +
        `<i>Please try again with a higher amount.</i>`,
        { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('💰 Try Again', 'deposit:cryptomus').text('‹ Back', 'deposit:menu') }
      );
    } else {
      await ctx.reply(`⚠️ Invoice error: ${result.error}`);
    }
    return;
  }

  await transactionRepo.createTransaction(pool, {
    userId: ctx.from.id, gateway: 'cryptomus', orderId, amount,
    gatewayData: { uuid: result.uuid, paymentUrl: result.paymentUrl },
  });

  const rateResult = await binanceRate.getLiveRate('USDT', 'INR');
  let rateInfo = '';
  if (rateResult.price) {
    const approxUsdt = (amount / rateResult.price).toFixed(2);
    rateInfo = `📊 <b>Live Rate:</b> 1 USDT ≈ ₹${rateResult.price.toFixed(2)}\n` +
               `💱 <b>Approx:</b> ${approxUsdt} USDT\n`;
  }

  const kb = new InlineKeyboard()
    .webApp('🌐 Pay Now', result.paymentUrl).row()
    .text('✅ Verify Payment', `deposit:check_crypto:${orderId}`);

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

  startCryptoAutoCheck(ctx.api, pool, orderId, result.uuid, ctx.from.id, ctx.chat.id, sentMsg.message_id, apiKey, merchantId);
}

// ═══════════════════════════════════════════════════════════════════
//  CRYPTO: INLINE MODE HANDLERS
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery(/^deposit:crypto_cur:/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const parts = ctx.callbackQuery.data.split(':');
  const currency = parts[2];
  const network = parts[3];
  const pool = ctx.dbPool;
  const minAmount = parseInt(await settingsRepo.getSetting(pool, 'cryptomus_min_amount')) || 1;
  const maxAmount = parseInt(await settingsRepo.getSetting(pool, 'cryptomus_max_amount')) || 0;

  const rateResult = await binanceRate.getLiveRate(currency, 'INR');
  const rateText = rateResult.price
    ? `📊 <b>Live Rate:</b> 1 ${currency} = ₹${rateResult.price.toFixed(2)}`
    : `📊 <b>Rate:</b> Fetching...`;

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

composer.callbackQuery(/^deposit:crypto_amt:/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const parts = ctx.callbackQuery.data.split(':');
  const currency = parts[2];
  const network = parts[3];
  const amount = parseFloat(parts[4]);
  await handleCryptomusDeposit(ctx, currency, network, amount);
});

composer.callbackQuery(/^deposit:crypto_custom:/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
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
export async function handleCryptomusDeposit(ctx, currency, network, amount) {
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
    await ctx.reply('⚠️ Gateway not configured. Contact admin.');
    return;
  }

  let commissionPercent = 0;
  try {
    const services = await cryptomusService.listServices(apiKey, merchantId);
    const match = services.find(s => s.currency === currency && s.network === network);
    if (match?.commission?.percent) {
      commissionPercent = parseFloat(match.commission.percent) || 0;
    }
  } catch { /* fallback to 0% commission */ }

  const commissionAmount = commissionPercent > 0 ? Math.ceil(amount * commissionPercent / 100) : 0;
  const invoiceAmount = amount + commissionAmount;

  const orderId = `CX-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  await walletRepo.ensureWallet(pool, ctx.from.id);

  const result = await cryptomusService.createInvoice(apiKey, merchantId, {
    amount: invoiceAmount, currency: 'INR', toCurrency: currency, network, orderId,
  });

  if (!result.success) {
    const minMatch = result.error?.match(/(\d+\.?\d*)\s*INR/i);
    if (minMatch) {
      await ctx.reply(
        `⚠️ <b>Amount Too Low</b>\n\n` +
        `Gateway requires minimum <b>₹${Math.ceil(parseFloat(minMatch[1]))}</b> for ${_coinEmoji(currency)} <b>${currency}</b> on <b>${_networkLabel(network)}</b>.\n\n` +
        `<i>Please try again with a higher amount.</i>`,
        { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('💰 Try Again', 'deposit:cryptomus').text('‹ Back', 'deposit:menu') }
      );
    } else {
      await ctx.reply(`⚠️ Invoice error: ${result.error}`);
    }
    return;
  }

  await transactionRepo.createTransaction(pool, {
    userId: ctx.from.id, gateway: 'cryptomus', orderId, amount,
    gatewayData: {
      uuid: result.uuid, paymentUrl: result.paymentUrl, address: result.address,
      payAmount: result.payAmount, payCurrency: result.payCurrency, network: result.network,
      commissionPercent, commissionAmount, invoiceAmount,
    },
  });

  const rateResult = await binanceRate.getLiveRate(currency, 'INR');
  const nwDisplay = network.charAt(0).toUpperCase() + network.slice(1);

  let rateInfo = '';
  if (rateResult.price) {
    const approxCrypto = (amount / rateResult.price).toFixed(currency === 'BTC' ? 8 : ['USDT', 'USDC', 'BUSD', 'FDUSD'].includes(currency) ? 2 : 4);
    rateInfo = `📊 <b>Rate:</b> 1 ${currency} = ₹${rateResult.price.toFixed(2)}\n` +
               `💱 <b>Approx:</b> ${approxCrypto} ${currency}\n`;
  }

  const commissionLine = commissionPercent > 0
    ? `💸 <b>Gateway Fee:</b> ${commissionPercent}% (₹${commissionAmount.toFixed(2)})\n` +
      `💵 <b>Total Payable:</b> ₹${invoiceAmount.toFixed(2)}\n`
    : '';

  const caption =
    `✨ <b>Invoice Generated</b>\n\n` +
    `🎯 <b>Payment Time Limit:</b> 60 Minutes\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 <b>Deposit Amount:</b> ₹${amount.toFixed(2)}\n` +
    `${commissionLine}` +
    `🪙 <b>Crypto Payable:</b> ${result.payAmount} ${result.payCurrency}\n` +
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
  kb.text('✅ PAID', `deposit:check_crypto:${orderId}`);

  if (result.address) {
    const qrImageBuffer = await generateBrandedQR({
      storeName: `${currency} (${nwDisplay})`,
      amount: result.payAmount,
      currency: result.payCurrency + ' ',
      refId: orderId,
      upiLink: result.address,
      developer: '@Erroroo',
      subtitle: 'Send exact amount to this address',
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

    startCryptoAutoCheck(ctx.api, pool, orderId, result.uuid, ctx.from.id, ctx.chat.id, sentMsg.message_id, apiKey, merchantId);
  } else {
    const sentMsg2 = await ctx.reply(caption, { parse_mode: 'HTML', reply_markup: kb });
    startCryptoAutoCheck(ctx.api, pool, orderId, result.uuid, ctx.from.id, ctx.chat.id, sentMsg2.message_id, apiKey, merchantId);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  CRYPTO CHECK PAYMENT (manual button click)
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery(/^deposit:check_crypto:CX-/, async (ctx) => {
  const orderId = ctx.callbackQuery.data.replace('deposit:check_crypto:', '');
  const chatId = ctx.chat.id;
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
    const txn = await transactionRepo.getByOrderId(pool, orderId);
    if (!txn) { await ctx.reply('⚠️ Order not found.'); return; }
    if (txn.status === 'success') {
      try { await ctx.answerCallbackQuery(); } catch {}
      return;
    }

    const apiKey = await settingsRepo.getSetting(pool, 'cryptomus_api_key');
    const merchantId = await settingsRepo.getSetting(pool, 'cryptomus_merchant_id');
    const uuid = txn.gateway_data?.uuid;
    if (!apiKey || !merchantId || !uuid) { await ctx.reply('⚠️ Config error.'); return; }

    const result = await cryptomusService.checkPayment(apiKey, merchantId, uuid);

    if (result.success) {
      stopCryptoAutoCheck(orderId);
      const creditAmount = parseFloat(txn.amount);
      const updated = await transactionRepo.updateStatus(pool, orderId, 'success', uuid, { cryptomus_status: result.status });
      if (!updated) {
        const newBalance = await walletRepo.getBalance(pool, ctx.from.id);
        try { await ctx.deleteMessage(); } catch {}
        await ctx.reply(`✅ Already credited! Balance: ₹${formatNumber(newBalance)}`, { parse_mode: 'HTML' });
        return;
      }
      await walletRepo.addBalance(pool, ctx.from.id, creditAmount);
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      const { benefits, newBalance, netCreditAmount } = await applyBenefits(pool, ctx.from.id, creditAmount, orderId);
      await processReferralOnDeposit(pool, ctx.api, ctx.from.id, netCreditAmount, orderId);
      await ctx.reply(buildSuccessMessage(creditAmount, newBalance, orderId, benefits),
        { parse_mode: 'HTML' }
      );
    } else {
      try { await ctx.answerCallbackQuery(); } catch {}
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
    try { await ctx.answerCallbackQuery(); } catch {}
    return;
  }

  const apiKey = await settingsRepo.getSetting(pool, 'cryptomus_api_key');
  const merchantId = await settingsRepo.getSetting(pool, 'cryptomus_merchant_id');
  const uuid = txn.gateway_data?.uuid;
  if (!apiKey || !merchantId || !uuid) { try { await ctx.answerCallbackQuery(); } catch {} return; }

  const result = await cryptomusService.checkPayment(apiKey, merchantId, uuid);

  if (result.success) {
    const creditAmount = parseFloat(txn.amount);
    await transactionRepo.updateStatus(pool, orderId, 'success', uuid, result);
    await walletRepo.addBalance(pool, ctx.from.id, creditAmount);
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    const { benefits, newBalance, netCreditAmount } = await applyBenefits(pool, ctx.from.id, creditAmount, orderId);
    await processReferralOnDeposit(pool, ctx.api, ctx.from.id, netCreditAmount, orderId);
    await ctx.reply(buildSuccessMessage(creditAmount, newBalance, orderId, benefits),
      { parse_mode: 'HTML' }
    );
  } else {
    try { await ctx.answerCallbackQuery(); } catch {}
  }
});

export default composer;
