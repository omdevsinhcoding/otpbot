import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import { ActionType } from '../utils/constants.js';
import { escapeHtml } from '../utils/formatters.js';
import logger from '../utils/logger.js';
import * as cryptomusService from '../services/cryptomusService.js';

const composer = new Composer();
const editStates = new Map(); // chatId → { step, key, gateway }

// ═══════════════════════════════════════════════════════════════════
//  PAYMENTS MAIN MENU
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('admin:payments', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showPaymentsMenu(ctx);
});

async function showPaymentsMenu(ctx) {
  const pool = ctx.dbPool;
  const [paytmOn, bharatOn, cryptoOn, paytmName, bharatName] = await Promise.all([
    settingsRepo.getSetting(pool, 'paytm_enabled'),
    settingsRepo.getSetting(pool, 'bharatpay_enabled'),
    settingsRepo.getSetting(pool, 'cryptomus_enabled'),
    settingsRepo.getSetting(pool, 'paytm_display_name'),
    settingsRepo.getSetting(pool, 'bharatpay_display_name'),
  ]);

  const text =
    `💰 <b>Payment Settings</b>\n\n` +
    `💳 Paytm: ${paytmOn ? '✅ On' : '❌ Off'}  ➜ <i>${escapeHtml(paytmName || 'Pay via Automatic Gateway')}</i>\n` +
    `🏦 Bharat Pay: ${bharatOn ? '✅ On' : '❌ Off'}  ➜ <i>${escapeHtml(bharatName || 'Pay via UTR / Transaction ID')}</i>\n` +
    `₿ Cryptomus: ${cryptoOn ? '✅ On' : '❌ Off'}`;

  const kb = new InlineKeyboard()
    .text('💳 Paytm Settings', 'pay:paytm').row()
    .text('🏦 Bharat Pay Settings', 'pay:bharatpay').row()
    .text('₿ Cryptomus Settings', 'pay:cryptomus').row()
    .text('✏️ Rename Paytm', 'pay:paytm:edit:paytm_display_name').text('✏️ Rename BharatPe', 'pay:bharatpay:edit:bharatpay_display_name').row()
    .text('‹ Back', 'admin:back');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
}

// ═══════════════════════════════════════════════════════════════════
//  PAYTM SETTINGS
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('pay:paytm', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showPaytmSettings(ctx);
});

async function showPaytmSettings(ctx) {
  const pool = ctx.dbPool;
  const [enabled, upiId, merchantKey, paytmQrCode, payeeName, timeLimit, minAmount, maxAmount] = await Promise.all([
    settingsRepo.getSetting(pool, 'paytm_enabled'),
    settingsRepo.getSetting(pool, 'paytm_upi_id'),
    settingsRepo.getSetting(pool, 'paytm_merchant_key'),
    settingsRepo.getSetting(pool, 'paytm_qr_code'),
    settingsRepo.getSetting(pool, 'paytm_payee_name'),
    settingsRepo.getSetting(pool, 'paytm_time_limit'),
    settingsRepo.getSetting(pool, 'paytm_min_amount'),
    settingsRepo.getSetting(pool, 'paytm_max_amount'),
  ]);

  const text =
    `💳 <b>Paytm Settings</b>\n\n` +
    `📊 <b>Status:</b> ${enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
    `💳 <b>UPI ID:</b> ${upiId ? `<code>${escapeHtml(upiId)}</code>` : '❌ Not set'}\n` +
    `🔑 <b>MID:</b> ${merchantKey ? `<code>${escapeHtml(String(merchantKey))}</code>` : '❌ Not set'}\n` +
    `📱 <b>QR Code ID:</b> ${paytmQrCode ? `<code>${escapeHtml(String(paytmQrCode))}</code>` : '⚠️ Not set (Recommended)'}\n` +
    `👤 <b>Payee Name:</b> ${payeeName || 'Paytm Merchant'}\n` +
    `⏱ <b>Time Limit:</b> ${(!timeLimit || timeLimit === '0' || timeLimit === 0) ? '♾️ No Limit' : timeLimit + 's'}\n` +
    `💰 <b>Min Amount:</b> ₹${minAmount || 10}\n` +
    `📈 <b>Max Amount:</b> ${maxAmount ? '₹' + maxAmount : 'No Limit'}`;

  const kb = new InlineKeyboard()
    .text(enabled ? '🔴 Disable' : '🟢 Enable', 'pay:paytm:toggle').row()
    .text('📝 Set UPI ID', 'pay:paytm:edit:paytm_upi_id');
  if (upiId) kb.text('🗑 Clear UPI', 'pay:paytm:clear:paytm_upi_id');
  kb.row()
    .text('🔑 Set MID', 'pay:paytm:edit:paytm_merchant_key');
  if (merchantKey) kb.text('🗑 Clear MID', 'pay:paytm:clear:paytm_merchant_key');
  kb.row()
    .text('📱 Set QR Code ID', 'pay:paytm:edit:paytm_qr_code');
  if (paytmQrCode) kb.text('🗑 Clear QR', 'pay:paytm:clear:paytm_qr_code');
  kb.row()
    .text('👤 Payee Name', 'pay:paytm:edit:paytm_payee_name');
  if (payeeName) kb.text('🗑 Clear', 'pay:paytm:clear:paytm_payee_name');
  kb.row()
    .text('⏱ Time Limit', 'pay:paytm:edit:paytm_time_limit');
  const timeLimitVal = parseInt(timeLimit) || 0;
  if (timeLimitVal > 0) kb.text('♾️ No Limit', 'pay:paytm:nolimit_time');
  kb.row()
    .text('💰 Min Amount', 'pay:paytm:edit:paytm_min_amount');
  if (minAmount) kb.text('🗑 Clear', 'pay:paytm:clear:paytm_min_amount');
  kb.row()
    .text('📈 Max Amount', 'pay:paytm:edit:paytm_max_amount');
  if (maxAmount) kb.text('🚫 No Limit', 'pay:paytm:nolimit:paytm_max_amount');
  kb.row()
    .text('‹ Back', 'admin:back');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
}

composer.callbackQuery('pay:paytm:nolimit_time', adminRequired, async (ctx) => {
  const pool = ctx.dbPool;
  await settingsRepo.setSetting(pool, 'paytm_time_limit', 0, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { key: 'paytm_time_limit', value: 'No Limit' });
  await ctx.answerCallbackQuery('✅ Time Limit set to No Limit!');
  await showPaytmSettings(ctx);
});

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
  const [enabled, merchantId, token, upiId, minAmount, maxAmount, qrFileId] = await Promise.all([
    settingsRepo.getSetting(pool, 'bharatpay_enabled'),
    settingsRepo.getSetting(pool, 'bharatpay_merchant_id'),
    settingsRepo.getSetting(pool, 'bharatpay_token'),
    settingsRepo.getSetting(pool, 'bharatpay_upi_id'),
    settingsRepo.getSetting(pool, 'bharatpay_min_amount'),
    settingsRepo.getSetting(pool, 'bharatpay_max_amount'),
    settingsRepo.getSetting(pool, 'bharatpay_qr_file_id'),
  ]);

  const text =
    `🏦 <b>Bharat Pay Settings</b>\n\n` +
    `📊 <b>Status:</b> ${enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
    `🏪 <b>Merchant ID:</b> ${merchantId ? `<code>${escapeHtml(String(merchantId))}</code>` : '❌ Not set'}\n` +
    `🔑 <b>Token:</b> ${token ? `<code>${escapeHtml(String(token))}</code>` : '❌ Not set'}\n` +
    `💳 <b>UPI ID:</b> ${upiId ? `<code>${escapeHtml(upiId)}</code>` : '❌ Not set'}\n` +
    `💰 <b>Min Amount:</b> ₹${minAmount || 10}\n` +
    `📈 <b>Max Amount:</b> ${maxAmount ? '₹' + maxAmount : 'No Limit'}\n` +
    `🖼 <b>QR Image:</b> ${qrFileId ? '✅ Uploaded' : '❌ Not uploaded'}`;

  const kb = new InlineKeyboard()
    .text(enabled ? '🔴 Disable' : '🟢 Enable', 'pay:bharatpay:toggle').row()
    .text('🏪 Set Merchant ID', 'pay:bharatpay:edit:bharatpay_merchant_id');
  if (merchantId) kb.text('🗑 Clear', 'pay:bharatpay:clear:bharatpay_merchant_id');
  kb.row()
    .text('🔑 Set Token', 'pay:bharatpay:edit:bharatpay_token');
  if (token) kb.text('🗑 Clear', 'pay:bharatpay:clear:bharatpay_token');
  kb.row()
    .text('💳 Set UPI ID', 'pay:bharatpay:edit:bharatpay_upi_id');
  if (upiId) kb.text('🗑 Clear', 'pay:bharatpay:clear:bharatpay_upi_id');
  kb.row()
    .text('💰 Min Amount', 'pay:bharatpay:edit:bharatpay_min_amount');
  if (minAmount) kb.text('🗑 Clear', 'pay:bharatpay:clear:bharatpay_min_amount');
  kb.row()
    .text('📈 Max Amount', 'pay:bharatpay:edit:bharatpay_max_amount');
  if (maxAmount) kb.text('🚫 No Limit', 'pay:bharatpay:nolimit:bharatpay_max_amount');
  kb.row()
    .text('🖼 Upload QR Image', 'pay:bharatpay:upload_qr').row();

  // Only show remove button if QR exists
  if (qrFileId) kb.text('🗑 Remove QR Image', 'pay:bharatpay:remove_qr').row();
  kb.text('‹ Back', 'admin:back');

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

// ── Upload QR — uses inline cancel button ───────────────────────
composer.callbackQuery('pay:bharatpay:upload_qr', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  editStates.set(ctx.chat.id, { step: 'upload_qr', gateway: 'bharatpay' });
  const kb = new InlineKeyboard().text('❌ Cancel', 'pay:cancel_edit:bharatpay');
  await ctx.editMessageText(
    '🖼 <b>Upload QR Image</b>\n\nSend the BharatPay QR code as a <b>photo</b>.',
    { parse_mode: 'HTML', reply_markup: kb }
  );
});

// ── Remove QR ───────────────────────────────────────────────────
composer.callbackQuery('pay:bharatpay:remove_qr', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery('✅ QR Removed');
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
  const [enabled, apiKey, merchantId, minAmount, maxAmount, selectedCurrenciesRaw] = await Promise.all([
    settingsRepo.getSetting(pool, 'cryptomus_enabled'),
    settingsRepo.getSetting(pool, 'cryptomus_api_key'),
    settingsRepo.getSetting(pool, 'cryptomus_merchant_id'),
    settingsRepo.getSetting(pool, 'cryptomus_min_amount'),
    settingsRepo.getSetting(pool, 'cryptomus_max_amount'),
    settingsRepo.getSetting(pool, 'cryptomus_currencies'),
  ]);

  let selectedList = [];
  try { selectedList = JSON.parse(selectedCurrenciesRaw || '[]'); } catch { selectedList = []; }
  const currDisplay = selectedList.length > 0 ? selectedList.map(c => `${c.currency} (${c.network})`).join(', ') : 'None selected';

  const text =
    `🪙 <b>Cryptomus Settings</b>\n\n` +
    `📊 <b>Status:</b> ${enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
    `🔑 <b>API Key:</b> ${apiKey ? '✅ Set' : '❌ Not set'}\n` +
    `🏪 <b>Merchant ID:</b> ${merchantId ? '✅ Set' : '❌ Not set'}\n` +
    `🪙 <b>Currencies:</b> ${currDisplay}\n` +
    `💰 <b>Min Amount:</b> ₹${minAmount || 10}\n` +
    `📈 <b>Max Amount:</b> ₹${maxAmount || 10000}`;

  const kb = new InlineKeyboard()
    .text(enabled ? '🔴 Disable' : '🟢 Enable', 'pay:cryptomus:toggle').row()
    .text('🔑 Set API Key', 'pay:cryptomus:edit:cryptomus_api_key');
  if (apiKey) kb.text('🗑 Clear', 'pay:cryptomus:clear:cryptomus_api_key');
  kb.row()
    .text('🏪 Set Merchant ID', 'pay:cryptomus:edit:cryptomus_merchant_id');
  if (merchantId) kb.text('🗑 Clear', 'pay:cryptomus:clear:cryptomus_merchant_id');
  kb.row();
  if (apiKey && merchantId) kb.text('🪙 Select Currencies', 'pay:cryptomus:currencies').row();
  kb.text('💰 Min Amount', 'pay:cryptomus:edit:cryptomus_min_amount');
  if (minAmount) kb.text('🗑 Clear', 'pay:cryptomus:clear:cryptomus_min_amount');
  kb.row()
    .text('📈 Max Amount', 'pay:cryptomus:edit:cryptomus_max_amount');
  if (maxAmount) kb.text('🗑 Clear', 'pay:cryptomus:clear:cryptomus_max_amount');
  kb.row()
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

// ── Cryptomus: Select Currencies ─────────────────────────────
composer.callbackQuery('pay:cryptomus:currencies', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery('🔄 Fetching currencies...');
  const pool = ctx.dbPool;
  const apiKey = await settingsRepo.getSetting(pool, 'cryptomus_api_key');
  const merchantId = await settingsRepo.getSetting(pool, 'cryptomus_merchant_id');

  const services = await cryptomusService.listServices(apiKey, merchantId);
  if (services.length === 0) {
    await ctx.editMessageText('⚠️ Could not fetch currencies from Cryptomus. Check API Key & Merchant ID.', {
      reply_markup: new InlineKeyboard().text('‹ Back', 'pay:cryptomus'),
    });
    return;
  }

  let selectedList = [];
  try {
    const raw = await settingsRepo.getSetting(pool, 'cryptomus_currencies');
    selectedList = JSON.parse(raw || '[]');
  } catch { selectedList = []; }

  const isSelected = (currency, network) => selectedList.some(s => s.currency === currency && s.network === network);

  const kb = new InlineKeyboard();
  const seen = new Set();
  for (const svc of services) {
    const key = `${svc.currency}_${svc.network}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const selected = isSelected(svc.currency, svc.network);
    const label = `${selected ? '✅' : '⬜'} ${svc.currency} (${svc.network})`;
    kb.text(label, `pay:cryptomus:toggle_cur:${svc.currency}:${svc.network}`).row();
  }
  kb.text('💾 Save & Back', 'pay:cryptomus');

  await ctx.editMessageText('🪙 <b>Select Currencies</b>\n\nToggle which currencies users can pay with:', {
    parse_mode: 'HTML', reply_markup: kb,
  });
});

// ── Cryptomus: Toggle a currency on/off ─────────────────────
composer.callbackQuery(/^pay:cryptomus:toggle_cur:/, adminRequired, async (ctx) => {
  const parts = ctx.callbackQuery.data.split(':');
  const currency = parts[3];
  const network = parts[4];
  const pool = ctx.dbPool;

  let selectedList = [];
  try {
    const raw = await settingsRepo.getSetting(pool, 'cryptomus_currencies');
    selectedList = JSON.parse(raw || '[]');
  } catch { selectedList = []; }

  const idx = selectedList.findIndex(s => s.currency === currency && s.network === network);
  if (idx >= 0) {
    selectedList.splice(idx, 1);
  } else {
    selectedList.push({ currency, network });
  }

  await settingsRepo.setSetting(pool, 'cryptomus_currencies', JSON.stringify(selectedList), ctx.from.id);
  await ctx.answerCallbackQuery(`${idx >= 0 ? '❌ Removed' : '✅ Added'} ${currency} (${network})`);

  // Re-show currency list
  const apiKey = await settingsRepo.getSetting(pool, 'cryptomus_api_key');
  const merchantId = await settingsRepo.getSetting(pool, 'cryptomus_merchant_id');
  const services = await cryptomusService.listServices(apiKey, merchantId);

  const isSelected = (c, n) => selectedList.some(s => s.currency === c && s.network === n);
  const kb = new InlineKeyboard();
  const seen = new Set();
  for (const svc of services) {
    const key = `${svc.currency}_${svc.network}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const selected = isSelected(svc.currency, svc.network);
    const label = `${selected ? '✅' : '⬜'} ${svc.currency} (${svc.network})`;
    kb.text(label, `pay:cryptomus:toggle_cur:${svc.currency}:${svc.network}`).row();
  }
  kb.text('💾 Save & Back', 'pay:cryptomus');

  await ctx.editMessageText('🪙 <b>Select Currencies</b>\n\nToggle which currencies users can pay with:', {
    parse_mode: 'HTML', reply_markup: kb,
  });
});

// ═══════════════════════════════════════════════════════════════════
//  GENERIC EDIT HANDLER — inline cancel button, no /cancel needed
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery(/^pay:(paytm|bharatpay|cryptomus):edit:.+$/, adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const parts = ctx.callbackQuery.data.split(':');
  const gateway = parts[1];
  const key = parts.slice(3).join(':');
  editStates.set(ctx.chat.id, { step: 'edit_value', key, gateway });

  const labels = {
    paytm_upi_id: 'Paytm UPI ID',
    paytm_merchant_key: 'Paytm MID (Merchant ID)',
    paytm_payee_name: 'Payee Name (shown in UPI app)',
    paytm_qr_code: 'Paytm QR Code ID (paytmqr param)',
    paytm_time_limit: 'Time Limit (seconds)',
    paytm_min_amount: 'Minimum Amount (₹)',
    paytm_max_amount: 'Maximum Amount (₹)',
    paytm_display_name: 'Paytm Button Name (shown to user in deposit menu)',
    bharatpay_merchant_id: 'BharatPe Merchant ID',
    bharatpay_token: 'BharatPe API Token',
    bharatpay_upi_id: 'BharatPe UPI ID',
    bharatpay_min_amount: 'Minimum Amount (₹)',
    bharatpay_max_amount: 'Maximum Amount (₹)',
    bharatpay_display_name: 'BharatPe Button Name (shown to user in deposit menu)',
    cryptomus_api_key: 'Cryptomus API Key',
    cryptomus_merchant_id: 'Cryptomus Merchant ID',
    cryptomus_min_amount: 'Minimum Amount ($)',
    cryptomus_max_amount: 'Maximum Amount ($)',
  };

  const kb = new InlineKeyboard().text('❌ Cancel', `pay:cancel_edit:${gateway}`);
  await ctx.editMessageText(
    `📝 <b>Edit ${labels[key] || key}</b>\n\nSend the new value:`,
    { parse_mode: 'HTML', reply_markup: kb }
  );
});

// ═══════════════════════════════════════════════════════════════════
//  CANCEL EDIT — goes back to gateway settings (no /cancel needed!)
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery(/^pay:cancel_edit:(paytm|bharatpay|cryptomus)$/, adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery('Cancelled');
  const gateway = ctx.callbackQuery.data.split(':')[2];
  editStates.delete(ctx.chat.id);

  // Go back to the correct gateway settings page
  switch (gateway) {
    case 'paytm': return showPaytmSettings(ctx);
    case 'bharatpay': return showBharatpaySettings(ctx);
    case 'cryptomus': return showCryptomusSettings(ctx);
  }
});

// ═══════════════════════════════════════════════════════════════════
//  CLEAR SETTING — reset a key to empty
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery(/^pay:(paytm|bharatpay|cryptomus):clear:.+$/, adminRequired, async (ctx) => {
  const parts = ctx.callbackQuery.data.split(':');
  const gateway = parts[1];
  const key = parts.slice(3).join(':');
  const pool = ctx.dbPool;

  await settingsRepo.setSetting(pool, key, '', ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { key, value: '(cleared)' });
  await ctx.answerCallbackQuery(`✅ ${key} cleared!`);

  switch (gateway) {
    case 'paytm': return showPaytmSettings(ctx);
    case 'bharatpay': return showBharatpaySettings(ctx);
    case 'cryptomus': return showCryptomusSettings(ctx);
  }
});

// ═══════════════════════════════════════════════════════════════════
//  NO LIMIT — remove max amount cap
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery(/^pay:(paytm|bharatpay|cryptomus):nolimit:.+$/, adminRequired, async (ctx) => {
  const parts = ctx.callbackQuery.data.split(':');
  const gateway = parts[1];
  const key = parts.slice(3).join(':');
  const pool = ctx.dbPool;

  await settingsRepo.setSetting(pool, key, 0, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { key, value: 'No Limit' });
  await ctx.answerCallbackQuery('✅ Max Amount set to No Limit!');

  switch (gateway) {
    case 'paytm': return showPaytmSettings(ctx);
    case 'bharatpay': return showBharatpaySettings(ctx);
    case 'cryptomus': return showCryptomusSettings(ctx);
  }
});

// ═══════════════════════════════════════════════════════════════════
//  TEXT INPUT HANDLER — processes edit values
// ═══════════════════════════════════════════════════════════════════
composer.on('message:text', async (ctx, next) => {
  const state = editStates.get(ctx.chat.id);
  if (!state) return next();

  if (state.step === 'edit_value') {
    editStates.delete(ctx.chat.id);
    let value = ctx.message.text.trim();

    // Convert numeric fields
    const numericKeys = ['paytm_time_limit', 'paytm_min_amount', 'paytm_max_amount', 'bharatpay_min_amount', 'bharatpay_max_amount', 'cryptomus_min_amount', 'cryptomus_max_amount'];
    if (numericKeys.includes(state.key)) {
      const num = parseFloat(value);
      if (isNaN(num) || num <= 0) {
        await ctx.reply('⚠️ Invalid number.', {
          reply_markup: new InlineKeyboard().text('🔄 Try Again', `pay:${state.gateway}:edit:${state.key}`).text('‹ Back', `pay:${state.gateway}`)
        });
        return;
      }
      value = num;
    }

    // Validate MID — must be alphanumeric only (e.g. MgjdFH15397320634096)
    if (state.key === 'paytm_merchant_key') {
      if (!/^[A-Za-z0-9]+$/.test(value)) {
        await ctx.reply(
          `⚠️ <b>Invalid Merchant ID!</b>\n\nMID must be alphanumeric (letters + numbers only).\nYou entered: <code>${escapeHtml(value)}</code>\n\nExample: <code>MgjdFH15397320634096</code>`,
          { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔄 Try Again', `pay:${state.gateway}:edit:${state.key}`).text('‹ Back', `pay:${state.gateway}`) }
        );
        return;
      }
    }

    // Validate UPI ID — must contain @
    if (state.key === 'paytm_upi_id' || state.key === 'bharatpay_upi_id') {
      if (!value.includes('@')) {
        await ctx.reply(
          `⚠️ <b>Invalid UPI ID!</b>\n\nUPI ID must contain @.\nYou entered: <code>${escapeHtml(value)}</code>\n\nExample: <code>merchant@paytm</code>`,
          { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔄 Try Again', `pay:${state.gateway}:edit:${state.key}`).text('‹ Back', `pay:${state.gateway}`) }
        );
        return;
      }
    }

    await settingsRepo.setSetting(ctx.dbPool, state.key, value, ctx.from.id);
    ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { key: state.key });
    await ctx.reply(`✅ <b>${escapeHtml(state.key)}</b> updated successfully!`, {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('‹ Back to Settings', `pay:${state.gateway}`)
    });
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
  const fileId = photo[photo.length - 1].file_id;

  await settingsRepo.setSetting(ctx.dbPool, 'bharatpay_qr_file_id', fileId, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'upload_bharatpay_qr' });
  await ctx.reply('✅ BharatPay QR image uploaded!', {
    reply_markup: new InlineKeyboard().text('‹ Back to Bharat Pay', 'pay:bharatpay')
  });
});

export default composer;
