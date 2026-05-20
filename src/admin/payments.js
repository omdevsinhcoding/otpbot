import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import { ActionType } from '../utils/constants.js';
import { escapeHtml } from '../utils/formatters.js';
import logger from '../utils/logger.js';

const composer = new Composer();
const editStates = new Map(); // chatId → { step, key, gateway }

// ═══════════════════════════════════════════════════════════════════
//  PAYMENTS MAIN MENU
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('admin:payments', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const pool = ctx.dbPool;
  const [paytmOn, bharatOn, cryptoOn] = await Promise.all([
    settingsRepo.getSetting(pool, 'paytm_enabled'),
    settingsRepo.getSetting(pool, 'bharatpay_enabled'),
    settingsRepo.getSetting(pool, 'cryptomus_enabled'),
  ]);

  const text =
    `💰 <b>Payment Settings</b>\n\n` +
    `💳 Paytm: ${paytmOn ? '✅ On' : '❌ Off'}\n` +
    `🏦 Bharat Pay: ${bharatOn ? '✅ On' : '❌ Off'}\n` +
    `₿ Cryptomus: ${cryptoOn ? '✅ On' : '❌ Off'}`;

  const kb = new InlineKeyboard()
    .text('💳 Paytm Settings', 'pay:paytm').row()
    .text('🏦 Bharat Pay Settings', 'pay:bharatpay').row()
    .text('₿ Cryptomus Settings', 'pay:cryptomus').row()
    .text('‹ Back', 'admin:back');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
});

// ═══════════════════════════════════════════════════════════════════
//  PAYTM SETTINGS
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('pay:paytm', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showPaytmSettings(ctx);
});

async function showPaytmSettings(ctx) {
  const pool = ctx.dbPool;
  const [enabled, upiId, merchantKey, timeLimit, minAmount] = await Promise.all([
    settingsRepo.getSetting(pool, 'paytm_enabled'),
    settingsRepo.getSetting(pool, 'paytm_upi_id'),
    settingsRepo.getSetting(pool, 'paytm_merchant_key'),
    settingsRepo.getSetting(pool, 'paytm_time_limit'),
    settingsRepo.getSetting(pool, 'paytm_min_amount'),
  ]);

  const text =
    `💳 <b>Paytm Settings</b>\n\n` +
    `📊 <b>Status:</b> ${enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
    `💳 <b>UPI ID:</b> ${upiId ? `<code>${escapeHtml(upiId)}</code>` : '❌ Not set'}\n` +
    `🔑 <b>Merchant Key:</b> ${merchantKey ? '✅ Set' : '❌ Not set'}\n` +
    `⏱ <b>Time Limit:</b> ${timeLimit || 600}s\n` +
    `💰 <b>Min Amount:</b> ₹${minAmount || 10}`;

  const kb = new InlineKeyboard()
    .text(enabled ? '🔴 Disable' : '🟢 Enable', 'pay:paytm:toggle').row()
    .text('📝 Set UPI ID', 'pay:paytm:edit:paytm_upi_id').row()
    .text('🔑 Set Merchant Key', 'pay:paytm:edit:paytm_merchant_key').row()
    .text('⏱ Set Time Limit', 'pay:paytm:edit:paytm_time_limit').row()
    .text('💰 Set Min Amount', 'pay:paytm:edit:paytm_min_amount').row()
    .text('‹ Back', 'admin:payments');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
}

composer.callbackQuery('pay:paytm:toggle', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const pool = ctx.dbPool;
  const current = await settingsRepo.getSetting(pool, 'paytm_enabled');
  await settingsRepo.setSetting(pool, 'paytm_enabled', !current, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { key: 'paytm_enabled', value: !current });
  await showPaytmSettings(ctx);
});

// ═══════════════════════════════════════════════════════════════════
//  BHARAT PAY SETTINGS
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('pay:bharatpay', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showBharatpaySettings(ctx);
});

async function showBharatpaySettings(ctx) {
  const pool = ctx.dbPool;
  const [enabled, merchantId, token, upiId, minAmount, qrFileId] = await Promise.all([
    settingsRepo.getSetting(pool, 'bharatpay_enabled'),
    settingsRepo.getSetting(pool, 'bharatpay_merchant_id'),
    settingsRepo.getSetting(pool, 'bharatpay_token'),
    settingsRepo.getSetting(pool, 'bharatpay_upi_id'),
    settingsRepo.getSetting(pool, 'bharatpay_min_amount'),
    settingsRepo.getSetting(pool, 'bharatpay_qr_file_id'),
  ]);

  const text =
    `🏦 <b>Bharat Pay Settings</b>\n\n` +
    `📊 <b>Status:</b> ${enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
    `🏪 <b>Merchant ID:</b> ${merchantId ? '✅ Set' : '❌ Not set'}\n` +
    `🔑 <b>Token:</b> ${token ? '✅ Set' : '❌ Not set'}\n` +
    `💳 <b>UPI ID:</b> ${upiId ? `<code>${escapeHtml(upiId)}</code>` : '❌ Not set'}\n` +
    `💰 <b>Min Amount:</b> ₹${minAmount || 10}\n` +
    `🖼 <b>QR Image:</b> ${qrFileId ? '✅ Uploaded' : '❌ Not uploaded'}`;

  const kb = new InlineKeyboard()
    .text(enabled ? '🔴 Disable' : '🟢 Enable', 'pay:bharatpay:toggle').row()
    .text('🏪 Set Merchant ID', 'pay:bharatpay:edit:bharatpay_merchant_id').row()
    .text('🔑 Set Token', 'pay:bharatpay:edit:bharatpay_token').row()
    .text('💳 Set UPI ID', 'pay:bharatpay:edit:bharatpay_upi_id').row()
    .text('💰 Set Min Amount', 'pay:bharatpay:edit:bharatpay_min_amount').row()
    .text('🖼 Upload QR Image', 'pay:bharatpay:upload_qr').row()
    .text(qrFileId ? '🗑 Remove QR Image' : '', qrFileId ? 'pay:bharatpay:remove_qr' : 'noop').row()
    .text('‹ Back', 'admin:payments');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
}

composer.callbackQuery('pay:bharatpay:toggle', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const pool = ctx.dbPool;
  const current = await settingsRepo.getSetting(pool, 'bharatpay_enabled');
  await settingsRepo.setSetting(pool, 'bharatpay_enabled', !current, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { key: 'bharatpay_enabled', value: !current });
  await showBharatpaySettings(ctx);
});

// ── Upload QR ───────────────────────────────────────────────────
composer.callbackQuery('pay:bharatpay:upload_qr', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  editStates.set(ctx.chat.id, { step: 'upload_qr', gateway: 'bharatpay' });
  await ctx.editMessageText(
    '🖼 <b>Upload QR Image</b>\n\nSend the BharatPay QR code as a <b>photo</b>.\n\nSend /cancel to abort.',
    { parse_mode: 'HTML' }
  );
});

// ── Remove QR ───────────────────────────────────────────────────
composer.callbackQuery('pay:bharatpay:remove_qr', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  await settingsRepo.setSetting(ctx.dbPool, 'bharatpay_qr_file_id', '', ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'remove_bharatpay_qr' });
  await showBharatpaySettings(ctx);
});

// ═══════════════════════════════════════════════════════════════════
//  CRYPTOMUS SETTINGS
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('pay:cryptomus', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showCryptomusSettings(ctx);
});

async function showCryptomusSettings(ctx) {
  const pool = ctx.dbPool;
  const [enabled, apiKey, merchantId, minAmount] = await Promise.all([
    settingsRepo.getSetting(pool, 'cryptomus_enabled'),
    settingsRepo.getSetting(pool, 'cryptomus_api_key'),
    settingsRepo.getSetting(pool, 'cryptomus_merchant_id'),
    settingsRepo.getSetting(pool, 'cryptomus_min_amount'),
  ]);

  const text =
    `₿ <b>Cryptomus Settings</b>\n\n` +
    `📊 <b>Status:</b> ${enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
    `🔑 <b>API Key:</b> ${apiKey ? '✅ Set' : '❌ Not set'}\n` +
    `🏪 <b>Merchant ID:</b> ${merchantId ? '✅ Set' : '❌ Not set'}\n` +
    `💰 <b>Min Amount:</b> $${minAmount || 1}`;

  const kb = new InlineKeyboard()
    .text(enabled ? '🔴 Disable' : '🟢 Enable', 'pay:cryptomus:toggle').row()
    .text('🔑 Set API Key', 'pay:cryptomus:edit:cryptomus_api_key').row()
    .text('🏪 Set Merchant ID', 'pay:cryptomus:edit:cryptomus_merchant_id').row()
    .text('💰 Set Min Amount', 'pay:cryptomus:edit:cryptomus_min_amount').row()
    .text('‹ Back', 'admin:payments');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
}

composer.callbackQuery('pay:cryptomus:toggle', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const pool = ctx.dbPool;
  const current = await settingsRepo.getSetting(pool, 'cryptomus_enabled');
  await settingsRepo.setSetting(pool, 'cryptomus_enabled', !current, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { key: 'cryptomus_enabled', value: !current });
  await showCryptomusSettings(ctx);
});

// ═══════════════════════════════════════════════════════════════════
//  GENERIC EDIT HANDLER (for all payment settings text values)
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery(/^pay:(paytm|bharatpay|cryptomus):edit:.+$/, adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const parts = ctx.callbackQuery.data.split(':');
  const gateway = parts[1];
  const key = parts.slice(3).join(':');
  editStates.set(ctx.chat.id, { step: 'edit_value', key, gateway });

  const labels = {
    paytm_upi_id: 'Paytm UPI ID',
    paytm_merchant_key: 'Paytm Merchant Key (MID)',
    paytm_time_limit: 'Time Limit (seconds)',
    paytm_min_amount: 'Minimum Amount (₹)',
    bharatpay_merchant_id: 'BharatPe Merchant ID',
    bharatpay_token: 'BharatPe API Token',
    bharatpay_upi_id: 'BharatPe UPI ID',
    bharatpay_min_amount: 'Minimum Amount (₹)',
    cryptomus_api_key: 'Cryptomus API Key',
    cryptomus_merchant_id: 'Cryptomus Merchant ID',
    cryptomus_min_amount: 'Minimum Amount ($)',
  };

  await ctx.editMessageText(
    `📝 <b>Edit ${labels[key] || key}</b>\n\nSend the new value.\n\nSend /cancel to abort.`,
    { parse_mode: 'HTML' }
  );
});

// ═══════════════════════════════════════════════════════════════════
//  TEXT INPUT HANDLER
// ═══════════════════════════════════════════════════════════════════
composer.on('message:text', async (ctx, next) => {
  const state = editStates.get(ctx.chat.id);
  if (!state) return next();

  if (ctx.message.text === '/cancel') {
    editStates.delete(ctx.chat.id);
    await ctx.reply('❌ Cancelled.');
    return;
  }

  if (state.step === 'edit_value') {
    editStates.delete(ctx.chat.id);
    let value = ctx.message.text.trim();

    // Convert numeric fields
    const numericKeys = ['paytm_time_limit', 'paytm_min_amount', 'bharatpay_min_amount', 'cryptomus_min_amount'];
    if (numericKeys.includes(state.key)) {
      const num = parseFloat(value);
      if (isNaN(num) || num <= 0) {
        await ctx.reply('⚠️ Invalid number. Please try again.');
        return;
      }
      value = num;
    }

    await settingsRepo.setSetting(ctx.dbPool, state.key, value, ctx.from.id);
    ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { key: state.key });
    await ctx.reply(`✅ <b>${escapeHtml(state.key)}</b> updated!`, { parse_mode: 'HTML' });
    return;
  }

  return next();
});

// ── Photo handler (for QR upload) ───────────────────────────────
composer.on('message:photo', async (ctx, next) => {
  const state = editStates.get(ctx.chat.id);
  if (!state || state.step !== 'upload_qr') return next();

  editStates.delete(ctx.chat.id);
  const photo = ctx.message.photo;
  const fileId = photo[photo.length - 1].file_id; // highest resolution

  await settingsRepo.setSetting(ctx.dbPool, 'bharatpay_qr_file_id', fileId, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'upload_bharatpay_qr' });
  await ctx.reply('✅ BharatPay QR image uploaded!');
});

export default composer;
