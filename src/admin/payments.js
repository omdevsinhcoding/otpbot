import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import { ActionType } from '../utils/constants.js';
import { escapeHtml } from '../utils/formatters.js';
import logger from '../utils/logger.js';
import * as cryptomusService from '../services/cryptomusService.js';
import { registerAdminState } from '../utils/adminStates.js';

const composer = new Composer();
const editStates = new Map(); // chatId → { step, key, gateway }
registerAdminState(editStates);

// ═══════════════════════════════════════════════════════════════════
//  PAYMENTS MAIN MENU
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('admin:payments', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
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
    .text('✏️ Rename Crypto', 'pay:cryptomus:edit:cryptomus_display_name').row()
    .text('‹ Back', 'admin:back');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
}

// ═══════════════════════════════════════════════════════════════════
//  PAYTM SETTINGS
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('pay:paytm', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
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
    `👤 <b>Payee Name:</b> ${payeeName || 'Paytm Merchant'}\n` +
    `⏱ <b>Time Limit:</b> ${(!timeLimit || timeLimit === '0' || timeLimit === 0) ? '♾️ No Limit' : timeLimit + 's'}\n` +
    `💰 <b>Min Amount:</b> ${minAmount ? '₹' + minAmount : 'Not set'}\n` +
    `📈 <b>Max Amount:</b> ${maxAmount ? '₹' + maxAmount : 'No Limit'}`;

  const kb = new InlineKeyboard()
    .text(enabled ? '🔴 Disable' : '🟢 Enable', 'pay:paytm:toggle').row()
    .text('📝 Set UPI ID', 'pay:paytm:edit:paytm_upi_id');
  if (upiId) kb.text('🗑 Clear UPI', 'pay:paytm:clear:paytm_upi_id');
  kb.row()
    .text('🔑 Set MID', 'pay:paytm:edit:paytm_merchant_key');
  if (merchantKey) kb.text('🗑 Clear MID', 'pay:paytm:clear:paytm_merchant_key');
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
  try { await ctx.answerCallbackQuery(); } catch {}
  await showPaytmSettings(ctx);
});

composer.callbackQuery('pay:paytm:toggle', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
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
  try { await ctx.answerCallbackQuery(); } catch {}
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
    `💰 <b>Min Amount:</b> ${minAmount ? '₹' + minAmount : 'Not set'}\n` +
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
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const current = await settingsRepo.getSetting(pool, 'bharatpay_enabled');
  await settingsRepo.setSetting(pool, 'bharatpay_enabled', !current, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { key: 'bharatpay_enabled', value: !current });
  await showBharatpaySettings(ctx);
});

// ── Upload QR — uses inline cancel button ───────────────────────
composer.callbackQuery('pay:bharatpay:upload_qr', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  editStates.set(ctx.chat.id, { step: 'upload_qr', gateway: 'bharatpay' });
  const kb = new InlineKeyboard().text('❌ Cancel', 'pay:cancel_edit:bharatpay');
  await ctx.editMessageText(
    '🖼 <b>Upload QR Image</b>\n\nSend the BharatPay QR code as a <b>photo</b>.',
    { parse_mode: 'HTML', reply_markup: kb }
  );
});

// ── Remove QR ───────────────────────────────────────────────────
composer.callbackQuery('pay:bharatpay:remove_qr', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await settingsRepo.setSetting(ctx.dbPool, 'bharatpay_qr_file_id', '', ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'remove_bharatpay_qr' });
  await showBharatpaySettings(ctx);
});


// ═══════════════════════════════════════════════════════════════════
//  CRYPTOMUS SETTINGS — Premium Fintech UI
// ═══════════════════════════════════════════════════════════════════

// ── Services cache (prevents API spam for 400K+ users) ──────────
let _svcCache = null;
let _svcCacheKey = '';
let _svcCacheExp = 0;

async function getCachedServices(apiKey, merchantId) {
  const key = `${apiKey}:${merchantId}`;
  if (_svcCache && _svcCacheKey === key && Date.now() < _svcCacheExp) return _svcCache;
  const data = await cryptomusService.listServices(apiKey, merchantId);
  _svcCache = data;
  _svcCacheKey = key;
  _svcCacheExp = Date.now() + 5 * 60_000; // 5 min TTL
  return data;
}

// ── Coin ordering: stablecoins → major → L1 → rest ─────────────
const COIN_RANK = [
  'USDT','USDC','DAI','BUSD','FDUSD',
  'BTC','ETH','BNB','SOL','XRP',
  'TRX','TON','AVAX','ADA','DOT','POL','MATIC',
  'LTC','DOGE','DASH','SHIB',
];
function coinSortKey(c) { const i = COIN_RANK.indexOf(c); return i >= 0 ? i : 100 + c.charCodeAt(0); }

// ── Network display name ────────────────────────────────────────
function nwLabel(nw) {
  const m = {
    'tron':'TRC-20','bsc':'BEP-20','eth':'ERC-20','polygon':'Polygon',
    'arbitrum':'Arbitrum','optimism':'Optimism','avalanche':'AVAX-C',
    'btc':'Bitcoin','ltc':'Litecoin','doge':'Dogecoin','dash':'Dash',
    'sol':'Solana','ton':'TON','xrp':'XRP','ada':'Cardano',
  };
  return m[nw?.toLowerCase()] || nw?.toUpperCase() || nw;
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN SETTINGS PAGE
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('pay:cryptomus', adminRequired, async (ctx) => {
  try { try { await ctx.answerCallbackQuery(); } catch {} } catch {}
  await showCryptomusSettings(ctx);
});

async function showCryptomusSettings(ctx) {
  const pool = ctx.dbPool;
  const [enabled, apiKey, merchantId, minAmt, maxAmt, currRaw, mode] = await Promise.all([
    settingsRepo.getSetting(pool, 'cryptomus_enabled'),
    settingsRepo.getSetting(pool, 'cryptomus_api_key'),
    settingsRepo.getSetting(pool, 'cryptomus_merchant_id'),
    settingsRepo.getSetting(pool, 'cryptomus_min_amount'),
    settingsRepo.getSetting(pool, 'cryptomus_max_amount'),
    settingsRepo.getSetting(pool, 'cryptomus_currencies'),
    settingsRepo.getSetting(pool, 'cryptomus_mode'),
  ]);

  const md = mode || 'web';
  let sel = [];
  try { sel = JSON.parse(currRaw || '[]'); } catch { sel = []; }

  // Fetch live coin count from Cryptomus API (deduped by currency+network)
  let totalPairs = 0;
  let totalCoins = 0;
  if (apiKey && merchantId) {
    try {
      const services = await getCachedServices(apiKey, merchantId);
      // Deduplicate by currency+network (same logic as coin list)
      const dedupMap = new Map();
      for (const svc of services) {
        if (!dedupMap.has(svc.currency)) dedupMap.set(svc.currency, new Set());
        dedupMap.get(svc.currency).add(svc.network);
      }
      totalCoins = dedupMap.size;
      for (const [, nets] of dedupMap) totalPairs += nets.size;
    } catch { /* ignore */ }
  }

  // Build active coins summary grouped by currency
  const groups = {};
  for (const s of sel) {
    if (!groups[s.currency]) groups[s.currency] = [];
    groups[s.currency].push(nwLabel(s.network));
  }
  const activeCoinsCount = Object.keys(groups).length;
  const activePairsCount = sel.length;

  const limitStr = (minAmt || maxAmt)
    ? `₹${minAmt || '1'} — ₹${maxAmt || '∞'}`
    : '₹1 — ∞';

  // ── Premium styled text ──
  let text = `💎 <b>CRYPTO GATEWAY</b>\n\n`;

  // Status block
  text += `<blockquote>`;
  text += `${enabled ? '🟢' : '🔴'} <b>Status:</b> ${enabled ? 'Active' : 'Inactive'}\n`;
  text += `${apiKey ? '✅' : '❌'} <b>API Key:</b> ${apiKey ? 'Configured' : 'Not Set'}\n`;
  text += `${merchantId ? '✅' : '❌'} <b>Merchant:</b> ${merchantId ? 'Configured' : 'Not Set'}\n`;
  text += `⚡ <b>Mode:</b> ${md === 'inline' ? 'Inline (QR)' : 'Web Redirect'}\n`;
  text += `💰 <b>Deposit:</b> ${limitStr}`;
  text += `</blockquote>\n\n`;

  // Live stats from API
  if (totalCoins > 0) {
    text += `<blockquote>`;
    text += `📊 <b>GATEWAY STATS</b>\n\n`;
    text += `🪙 <b>Total Coins:</b> ${totalCoins}\n`;
    text += `🔗 <b>Total Pairs:</b> ${totalPairs}\n`;
    text += `✅ <b>Active:</b> ${activePairsCount} pairs (${activeCoinsCount} coins)`;
    text += `</blockquote>\n\n`;
  }

  // Active coins list (max 10 shown to stay within Telegram message limit)
  if (activeCoinsCount > 0) {
    text += `<blockquote>`;
    text += `🪙 <b>ACTIVE COINS</b>\n\n`;
    const entries = Object.entries(groups);
    const MAX_SHOW = 10;
    const shown = entries.slice(0, MAX_SHOW);
    for (const [coin, nets] of shown) {
      text += `  ${coin}  ›  ${nets.join(' · ')}\n`;
    }
    if (entries.length > MAX_SHOW) {
      text += `\n  ...and <b>${entries.length - MAX_SHOW}</b> more coins`;
    }
    text += `</blockquote>`;
  } else {
    text += `<blockquote>⚠️ No coins selected yet</blockquote>`;
  }

  if (!apiKey || !merchantId) {
    text += `\n\n⚠️ <i>Configure API credentials to get started</i>`;
  }

  const kb = new InlineKeyboard();

  // Row 1: Enable/Disable
  kb.text(enabled ? '🔴 Disable' : '🟢 Enable', 'pay:cryptomus:toggle').row();

  // Row 2: Credentials
  kb.text('🔑 API Key', 'pay:cryptomus:edit:cryptomus_api_key')
    .text('🏪 Merchant ID', 'pay:cryptomus:edit:cryptomus_merchant_id').row();

  // Row 3: Mode toggle
  kb.text(md === 'inline' ? '🌐 Switch → Web' : '⚡ Switch → Inline', 'pay:cryptomus:toggle_mode').row();

  // Row 4: Coin selection (inline mode only)
  if (apiKey && merchantId && md === 'inline') {
    kb.text(`🪙 Coins & Networks (${activePairsCount}/${totalPairs})`, 'pay:cryptomus:currencies').row();
  }

  // Row 5: Limits
  kb.text('⬇️ Min Deposit', 'pay:cryptomus:edit:cryptomus_min_amount')
    .text('⬆️ Max Deposit', 'pay:cryptomus:edit:cryptomus_max_amount').row();

  // Row 6: Clear actions (only if something to clear)
  const clearBtns = [];
  if (minAmt) clearBtns.push({ text: '✗ Clear Min', data: 'pay:cryptomus:clear:cryptomus_min_amount' });
  if (maxAmt) clearBtns.push({ text: '∞ No Max', data: 'pay:cryptomus:nolimit:cryptomus_max_amount' });
  if (apiKey) clearBtns.push({ text: '✗ API Key', data: 'pay:cryptomus:clear:cryptomus_api_key' });
  if (merchantId) clearBtns.push({ text: '✗ MID', data: 'pay:cryptomus:clear:cryptomus_merchant_id' });
  for (let i = 0; i < clearBtns.length; i += 2) {
    kb.text(clearBtns[i].text, clearBtns[i].data);
    if (clearBtns[i + 1]) kb.text(clearBtns[i + 1].text, clearBtns[i + 1].data);
    kb.row();
  }

  kb.text('◀ Back', 'admin:payments');
  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
}

// ── Toggles ─────────────────────────────────────────────────────
composer.callbackQuery('pay:cryptomus:toggle', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const cur = await settingsRepo.getSetting(pool, 'cryptomus_enabled');
  await settingsRepo.setSetting(pool, 'cryptomus_enabled', !cur, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { key: 'cryptomus_enabled', value: !cur });
  await showCryptomusSettings(ctx);
});

composer.callbackQuery('pay:cryptomus:toggle_mode', adminRequired, async (ctx) => {
  const pool = ctx.dbPool;
  const cur = await settingsRepo.getSetting(pool, 'cryptomus_mode') || 'web';
  const next = cur === 'inline' ? 'web' : 'inline';
  await settingsRepo.setSetting(pool, 'cryptomus_mode', next, ctx.from.id);
  try { await ctx.answerCallbackQuery(); } catch {}
  await showCryptomusSettings(ctx);
});

// ═══════════════════════════════════════════════════════════════════
//  STEP 1 — COIN SELECTION (search, paginated, cached)
// ═══════════════════════════════════════════════════════════════════
const COINS_PER_PAGE = 20;
const coinSearchState = new Map(); // chatId → { query, page }
registerAdminState(coinSearchState);

composer.callbackQuery('pay:cryptomus:currencies', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  coinSearchState.delete(ctx.chat.id); // Reset search on fresh entry
  await showCoinList(ctx, 0, null);
});

// ── Pagination ──────────────────────────────────────────────────
composer.callbackQuery(/^pay:cryptomus:coins_page:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const page = parseInt(ctx.callbackQuery.data.split(':')[3]);
  const search = coinSearchState.get(ctx.chat.id)?.query || null;
  await showCoinList(ctx, page, search);
});

// ── Search button → prompt for input ────────────────────────────
composer.callbackQuery('pay:cryptomus:coin_search', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  editStates.set(ctx.chat.id, { step: 'coin_search', gateway: 'cryptomus' });
  await ctx.editMessageText(
    `🔍  <b>Search Coins</b>\n\n` +
    `Type a coin name or ticker.\n` +
    `Example: <code>USDT</code>, <code>bitcoin</code>, <code>doge</code>\n\n` +
    `<i>Send the text below:</i>`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('✗  Cancel', 'pay:cryptomus:currencies') }
  );
});

// ── Clear search ────────────────────────────────────────────────
composer.callbackQuery('pay:cryptomus:coin_search_clear', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  coinSearchState.delete(ctx.chat.id);
  await showCoinList(ctx, 0, null);
});

// ── Core: render coin list (with optional search filter + pagination) ──
async function showCoinList(ctx, page, searchQuery) {
  const pool = ctx.dbPool;
  const apiKey = await settingsRepo.getSetting(pool, 'cryptomus_api_key');
  const merchantId = await settingsRepo.getSetting(pool, 'cryptomus_merchant_id');

  const services = await getCachedServices(apiKey, merchantId);
  if (!services.length) {
    await ctx.editMessageText(
      `⚠️  <b>Cannot load coins</b>\n\nVerify your API credentials and try again.`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('↻  Retry', 'pay:cryptomus:currencies').row().text('◀  Back', 'pay:cryptomus') }
    );
    return;
  }

  let sel = [];
  try { sel = JSON.parse(await settingsRepo.getSetting(pool, 'cryptomus_currencies') || '[]'); } catch { sel = []; }

  // Group by currency, dedupe networks
  const coinMap = new Map();
  for (const svc of services) {
    if (!coinMap.has(svc.currency)) coinMap.set(svc.currency, []);
    const arr = coinMap.get(svc.currency);
    if (!arr.some(e => e.network === svc.network)) arr.push(svc);
  }

  // Sort coins by rank
  let sortedCoins = [...coinMap.entries()].sort((a, b) => coinSortKey(a[0]) - coinSortKey(b[0]));

  // Apply search filter
  const q = searchQuery?.toUpperCase().trim();
  if (q) {
    sortedCoins = sortedCoins.filter(([coin]) => coin.toUpperCase().includes(q));
  }

  const totalCoins = sortedCoins.length;
  const totalPages = Math.ceil(totalCoins / COINS_PER_PAGE);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageCoins = sortedCoins.slice(safePage * COINS_PER_PAGE, (safePage + 1) * COINS_PER_PAGE);

  // Build keyboard
  const kb = new InlineKeyboard();

  // Coin buttons — 2 per row
  for (let i = 0; i < pageCoins.length; i += 2) {
    const [c1, n1] = pageCoins[i];
    const a1 = n1.filter(n => sel.some(s => s.currency === c1 && s.network === n.network)).length;
    kb.text(`${a1 > 0 ? '●' : '○'}  ${c1}  ${a1}∕${n1.length}`, `pay:cryptomus:coin_networks:${c1}`);

    if (i + 1 < pageCoins.length) {
      const [c2, n2] = pageCoins[i + 1];
      const a2 = n2.filter(n => sel.some(s => s.currency === c2 && s.network === n.network)).length;
      kb.text(`${a2 > 0 ? '●' : '○'}  ${c2}  ${a2}∕${n2.length}`, `pay:cryptomus:coin_networks:${c2}`);
    }
    kb.row();
  }

  // Pagination nav
  if (totalPages > 1) {
    if (safePage > 0) kb.text('‹ Prev', `pay:cryptomus:coins_page:${safePage - 1}`);
    kb.text(`${safePage + 1} ∕ ${totalPages}`, 'pay:cryptomus:noop');
    if (safePage < totalPages - 1) kb.text('Next ›', `pay:cryptomus:coins_page:${safePage + 1}`);
    kb.row();
  }

  // Search + Clear search
  if (q) {
    kb.text('✗  Clear Search', 'pay:cryptomus:coin_search_clear').text('🔍  New Search', 'pay:cryptomus:coin_search').row();
  } else {
    kb.text('🔍  Search Coin', 'pay:cryptomus:coin_search').row();
  }

  kb.text('◀  Back', 'pay:cryptomus');

  const totalActive = sel.length;
  const allCoinsCount = coinMap.size;
  // Count total networks (pairs) from the deduped map
  let allPairsCount = 0;
  for (const [, nets] of coinMap) allPairsCount += nets.length;

  let headerText = `🪙 <b>SELECT COINS</b>\n\n`;
  headerText += `<blockquote>`;
  headerText += `Tap a coin to configure its networks.\n\n`;
  headerText += `● Active Networks\n`;
  headerText += `○ None Selected\n\n`;

  if (q) {
    headerText += `🔍 Search: "<b>${escapeHtml(q)}</b>"  ·  ${totalCoins} result${totalCoins !== 1 ? 's' : ''}\n`;
  }
  headerText += `✅ <b>${totalActive}</b> active pairs  ·  🪙 <b>${allCoinsCount}</b> coins  ·  🔗 <b>${allPairsCount}</b> networks`;
  headerText += `</blockquote>`;

  await ctx.editMessageText(headerText, { parse_mode: 'HTML', reply_markup: kb });
}

// ── No-op for page indicator button ─────────────────────────────
composer.callbackQuery('pay:cryptomus:noop', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
});

// ═══════════════════════════════════════════════════════════════════
//  STEP 2 — NETWORK SELECTION (per coin)
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery(/^pay:cryptomus:coin_networks:/, adminRequired, async (ctx) => {
  const coin = ctx.callbackQuery.data.split(':')[3];
  try { await ctx.answerCallbackQuery(); } catch {}
  await showCoinNetworks(ctx, coin);
});

async function showCoinNetworks(ctx, coin) {
  const pool = ctx.dbPool;
  const apiKey = await settingsRepo.getSetting(pool, 'cryptomus_api_key');
  const merchantId = await settingsRepo.getSetting(pool, 'cryptomus_merchant_id');
  const services = await getCachedServices(apiKey, merchantId);

  // Get networks for this coin (dedupe)
  const nets = [];
  const seen = new Set();
  for (const svc of services) {
    if (svc.currency !== coin || seen.has(svc.network)) continue;
    seen.add(svc.network);
    nets.push(svc);
  }

  let sel = [];
  try { sel = JSON.parse(await settingsRepo.getSetting(pool, 'cryptomus_currencies') || '[]'); } catch { sel = []; }

  const active = nets.filter(n => sel.some(s => s.currency === coin && s.network === n.network)).length;
  const allOn = nets.length > 0 && active === nets.length;

  const kb = new InlineKeyboard();

  // Network buttons — 2 per row
  for (let i = 0; i < nets.length; i += 2) {
    const n1 = nets[i];
    const on1 = sel.some(s => s.currency === coin && s.network === n1.network);
    kb.text(`${on1 ? '◉' : '○'}  ${nwLabel(n1.network)}`, `pay:cryptomus:toggle_cur:${coin}:${n1.network}`);

    if (i + 1 < nets.length) {
      const n2 = nets[i + 1];
      const on2 = sel.some(s => s.currency === coin && s.network === n2.network);
      kb.text(`${on2 ? '◉' : '○'}  ${nwLabel(n2.network)}`, `pay:cryptomus:toggle_cur:${coin}:${n2.network}`);
    }
    kb.row();
  }

  // Select / Deselect all
  kb.text(allOn ? '✗  Deselect All' : '✓  Select All', allOn ? `pay:cryptomus:deselect_all:${coin}` : `pay:cryptomus:select_all:${coin}`).row();

  // Navigation
  kb.text('◀  Coins', 'pay:cryptomus:currencies').text('◀  Settings', 'pay:cryptomus');

  await ctx.editMessageText(
    `<b>${coin}</b>  ·  Networks\n\n` +
    `Select which networks to enable.\n` +
    `Users see only active networks.\n\n` +
    `  ◉  active    ○  inactive\n\n` +
    `<b>${active}</b> ∕ <b>${nets.length}</b> networks enabled`,
    { parse_mode: 'HTML', reply_markup: kb }
  );
}

// ── Toggle single network ───────────────────────────────────────
composer.callbackQuery(/^pay:cryptomus:toggle_cur:/, adminRequired, async (ctx) => {
  const [,, , currency, network] = ctx.callbackQuery.data.split(':');
  const pool = ctx.dbPool;

  let sel = [];
  try { sel = JSON.parse(await settingsRepo.getSetting(pool, 'cryptomus_currencies') || '[]'); } catch { sel = []; }

  const idx = sel.findIndex(s => s.currency === currency && s.network === network);
  if (idx >= 0) sel.splice(idx, 1);
  else sel.push({ currency, network });

  await settingsRepo.setSetting(pool, 'cryptomus_currencies', JSON.stringify(sel), ctx.from.id);
  await ctx.answerCallbackQuery(`${idx >= 0 ? '○' : '◉'}  ${currency} · ${nwLabel(network)}`);
  await showCoinNetworks(ctx, currency);
});

// ── Select all networks for a coin ──────────────────────────────
composer.callbackQuery(/^pay:cryptomus:select_all:/, adminRequired, async (ctx) => {
  const coin = ctx.callbackQuery.data.split(':')[3];
  const pool = ctx.dbPool;
  const apiKey = await settingsRepo.getSetting(pool, 'cryptomus_api_key');
  const merchantId = await settingsRepo.getSetting(pool, 'cryptomus_merchant_id');
  const services = await getCachedServices(apiKey, merchantId);

  let sel = [];
  try { sel = JSON.parse(await settingsRepo.getSetting(pool, 'cryptomus_currencies') || '[]'); } catch { sel = []; }

  const seen = new Set();
  for (const svc of services) {
    if (svc.currency !== coin || seen.has(svc.network)) continue;
    seen.add(svc.network);
    if (!sel.some(s => s.currency === coin && s.network === svc.network)) {
      sel.push({ currency: coin, network: svc.network });
    }
  }

  await settingsRepo.setSetting(pool, 'cryptomus_currencies', JSON.stringify(sel), ctx.from.id);
  try { await ctx.answerCallbackQuery(); } catch {}
  await showCoinNetworks(ctx, coin);
});

// ── Deselect all networks for a coin ────────────────────────────
composer.callbackQuery(/^pay:cryptomus:deselect_all:/, adminRequired, async (ctx) => {
  const coin = ctx.callbackQuery.data.split(':')[3];
  const pool = ctx.dbPool;

  let sel = [];
  try { sel = JSON.parse(await settingsRepo.getSetting(pool, 'cryptomus_currencies') || '[]'); } catch { sel = []; }

  sel = sel.filter(s => s.currency !== coin);
  await settingsRepo.setSetting(pool, 'cryptomus_currencies', JSON.stringify(sel), ctx.from.id);
  try { await ctx.answerCallbackQuery(); } catch {}
  await showCoinNetworks(ctx, coin);
});


// ═══════════════════════════════════════════════════════════════════
//  GENERIC EDIT HANDLER — inline cancel button, no /cancel needed
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery(/^pay:(paytm|bharatpay|cryptomus):edit:.+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
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
    cryptomus_min_amount: 'Minimum Amount (₹)',
    cryptomus_max_amount: 'Maximum Amount (₹)',
    cryptomus_display_name: 'Crypto Button Name (shown to user in deposit menu)',
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
  try { await ctx.answerCallbackQuery(); } catch {}
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

  await settingsRepo.deleteSetting(pool, key);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { key, value: '(cleared)' });
  try { await ctx.answerCallbackQuery(); } catch {}

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

  await settingsRepo.deleteSetting(pool, key);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { key, value: 'No Limit' });
  try { await ctx.answerCallbackQuery(); } catch {}

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
  // ── Coin search ─────────────────────────────────────────────────
  if (state.step === 'coin_search') {
    editStates.delete(ctx.chat.id);
    const query = ctx.message.text.trim();
    coinSearchState.set(ctx.chat.id, { query });
    // We can't editMessageText on a new user message, so we reply fresh
    // But we need a message to edit — send a placeholder then call showCoinList
    const placeholder = await ctx.reply('🔍 Searching...', { parse_mode: 'HTML' });
    // Patch ctx to edit our placeholder message
    const origEdit = ctx.editMessageText.bind(ctx);
    ctx.editMessageText = (text, opts) => ctx.api.editMessageText(ctx.chat.id, placeholder.message_id, text, opts);
    await showCoinList(ctx, 0, query);
    return;
  }

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
