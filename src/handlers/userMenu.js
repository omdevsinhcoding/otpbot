import { Composer } from 'grammy';
import { checkForceJoin } from '../middleware/forceJoinCheck.js';
import * as userRepo from '../database/repositories/userRepo.js';
import * as adminRepo from '../database/repositories/adminRepo.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import * as walletRepo from '../database/repositories/walletRepo.js';
import { getMainMenu, MORE_MENU_KEYBOARD, ADMIN_PANEL_KEYBOARD, ADMIN_MENU_KEYBOARD, PAYMENTS_MENU_KEYBOARD } from '../utils/keyboard.js';
import {
  BTN_GET_OTP, BTN_DEPOSIT, BTN_PROFILE, BTN_MORE,
  BTN_SMS_CHECKER, BTN_SUPPORT, BTN_REFER_EARN, BTN_READYMADE,
  BTN_GET_EMAIL, BTN_FAVORITE, BTN_PROMO_CODE, BTN_RETURN,
  BTN_TOP_SERVICES, BTN_API, BTN_RESELLER, BTN_ADMIN_PANEL,
  BTN_ADM_BROADCAST, BTN_ADM_USERS, BTN_ADM_FORCEJOIN, BTN_ADM_ADMINS,
  BTN_ADM_WELCOME, BTN_ADM_SETTINGS, BTN_ADM_PAYMENTS, BTN_ADM_BOTSTATS,
  BTN_ADM_LOGS, BTN_ADM_BACK,
  BTN_PAY_PAYTM, BTN_PAY_BHARATPAY, BTN_PAY_CRYPTO, BTN_PAY_BACK,
} from '../utils/constants.js';
import { escapeHtml, formatTimestamp, formatNumber } from '../utils/formatters.js';
import { InlineKeyboard } from 'grammy';
import logger from '../utils/logger.js';

const composer = new Composer();

// Helper: escape button text for regex
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Helper: get menu for user (checks admin status)
async function menuFor(ctx) {
  const isAdmin = await adminRepo.isAdmin(ctx.dbPool, ctx.from.id);
  return getMainMenu(isAdmin);
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN MENU BUTTONS
// ═══════════════════════════════════════════════════════════════════

// ── 📠 GET OTP ──────────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_GET_OTP)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;

  await ctx.reply(
    '🔑 <b>OTP Service</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: await menuFor(ctx) }
  );
});

// ── 💰 DEPOSIT → opens deposit menu with payment options ────────
composer.hears(new RegExp(`^${escRe(BTN_DEPOSIT)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;


  // Import dynamically to avoid circular deps
  const walletRepo = await import('../database/repositories/walletRepo.js');
  const settingsRepo = await import('../database/repositories/settingsRepo.js');
  const { InlineKeyboard } = await import('grammy');
  const { formatNumber } = await import('../utils/formatters.js');

  const pool = ctx.dbPool;
  const balance = await walletRepo.getBalance(pool, ctx.from.id);
  const [paytmOn, bharatpayOn, cryptomusOn, paytmName, bharatpayName] = await Promise.all([
    settingsRepo.getSetting(pool, 'paytm_enabled'),
    settingsRepo.getSetting(pool, 'bharatpay_enabled'),
    settingsRepo.getSetting(pool, 'cryptomus_enabled'),
    settingsRepo.getSetting(pool, 'paytm_display_name'),
    settingsRepo.getSetting(pool, 'bharatpay_display_name'),
  ]);

  let text = `💰 <b>Deposit Funds</b>\n\n💳 <b>Your Balance:</b> ₹${formatNumber(balance)}\n\nChoose a payment method:`;

  const kb = new InlineKeyboard();
  if (paytmOn) kb.text(`💳 ${paytmName || 'Pay via Automatic Gateway'}`, 'deposit:paytm').row();
  if (bharatpayOn) kb.text(`🏦 ${bharatpayName || 'Pay via UTR / Transaction ID'}`, 'deposit:bharatpay').row();
  if (cryptomusOn) kb.text('₿ Cryptomus', 'deposit:cryptomus').row();
  if (!paytmOn && !bharatpayOn && !cryptomusOn) text += '\n\n⚠️ No payment methods available.';
  kb.text('❌ Close', 'deposit:close');

  // Send benefits as separate premium card FIRST
  try {
    const depositBenefitsService = await import('../services/depositBenefitsService.js');
    const benefitsInfo = await depositBenefitsService.getDepositInfoMessage(pool, ctx.from.id);
    if (benefitsInfo) await ctx.reply(benefitsInfo, { parse_mode: 'HTML' });
  } catch {}

  // Then send deposit menu with buttons
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
});

// ── 👤 PROFILE — Premium card style ─────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_PROFILE)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;

  const pool = ctx.dbPool;
  const user = await userRepo.getUser(pool, ctx.from.id);
  if (!user) {
    await ctx.reply('⚠️ User not found. Please send /start first.', { reply_markup: await menuFor(ctx) });
    return;
  }

  // Fetch wallet data
  const walletMod = await import('../database/repositories/walletRepo.js');
  const wallet = await walletMod.getWallet(pool, ctx.from.id);
  const balance = wallet ? parseFloat(wallet.balance) : 0;
  const totalDeposit = wallet ? parseFloat(wallet.total_deposit) : 0;

  // Count deposits
  const { rows: depRows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM transactions WHERE user_id = $1 AND status = 'success'`, [ctx.from.id]
  );
  const depositCount = depRows[0].count;

  // Count referrals
  const { rows: refRows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM users WHERE referred_by = $1', [ctx.from.id]
  );
  const referralCount = refRows[0].count;

  // Count OTP/numbers bought (future-proof: 0 for now)
  const totalBought = 0;

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  const { InlineKeyboard } = await import('grammy');

  const text =
    `👤 <b>Name :</b> ${escapeHtml(user.full_name || 'N/A')}\n` +
    `🆔 <b>User ID :</b> <code>${user.user_id}</code>\n\n` +
    `💰 <b>Balance :</b> ₹${formatNumber(balance)}\n` +
    `💵 <b>Total Deposit :</b> ${depositCount} Times\n\n` +
    `🕐 <b>Last Updated :</b> ${timeStr}\n` +
    `📅 <b>Date :</b> ${dateStr}\n\n` +
    `📦 <b>Total Number Buyed :</b> ${totalBought}`;

  const kb = new InlineKeyboard()
    .text('📠 OTP History', 'profile:otp_history').text('💵 Deposit History', 'profile:deposit_history').row()
    .text('📧 Email History', 'profile:email_history').text('💸 Transfer Balance', 'profile:transfer').row()
    .text('📜 Read Full Terms And Conditions', 'profile:terms');

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
});

// ── 🔥 MORE → shows sub-menu reply keyboard ────────────────────
composer.hears(new RegExp(`^${escRe(BTN_MORE)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;

  await ctx.reply('🔥 <b>More Options</b>', { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD });
});

// ── 📮 SMS CHECKER ──────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_SMS_CHECKER)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;

  await ctx.reply(
    '📮 <b>SMS Checker</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: await menuFor(ctx) }
  );
});

// ── 🛡 SUPPORT ──────────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_SUPPORT)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;

  let supportUsername = '';
  try {
    supportUsername = await settingsRepo.getSetting(ctx.dbPool, 'support_username');
  } catch { /* ignore */ }

  const text = supportUsername
    ? `🛡 <b>Support</b>\n\nContact our support: @${escapeHtml(supportUsername)}`
    : '🛡 <b>Support</b>\n\nPlease contact the bot administrator for support.';

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: await menuFor(ctx) });
});

// ── 🎁 REFER & EARN ────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_REFER_EARN)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;

  const pool = ctx.dbPool;
  const user = await userRepo.getUser(pool, ctx.from.id);
  const refCode = user?.referral_code || 'N/A';

  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM users WHERE referred_by = $1', [ctx.from.id]
  );
  const count = rows[0].count;

  const botInfo = await ctx.api.getMe();
  const text =
    `🎁 <b>REFER & EARN</b>\n\n` +
    `🔗 <b>Your Referral Link:</b>\n` +
    `https://t.me/${botInfo.username}?start=ref_${refCode}\n\n` +
    `👥 <b>Total Referrals:</b> ${formatNumber(count)}\n` +
    `💰 <b>Earnings:</b> Coming Soon\n\n` +
    `Share your link to earn rewards!`;

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: await menuFor(ctx) });
});

// ── 💎 READYMADE ACCOUNT ────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_READYMADE)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;

  await ctx.reply(
    '💎 <b>Readymade Account</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: await menuFor(ctx) }
  );
});

// ═══════════════════════════════════════════════════════════════════
//  MORE SUB-MENU BUTTONS
// ═══════════════════════════════════════════════════════════════════

// ── ◀️ RETURN → back to main menu ──────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_RETURN)}$`), async (ctx) => {

  await ctx.reply('🏠 <b>Main Menu</b>', { parse_mode: 'HTML', reply_markup: await menuFor(ctx) });
});

// ── 📧 GET EMAIL ────────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_GET_EMAIL)}$`), async (ctx) => {

  await ctx.reply(
    '📧 <b>Get Email</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD }
  );
});

// ── 😊 Favorite ─────────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_FAVORITE)}$`), async (ctx) => {

  await ctx.reply(
    '😊 <b>Favorites</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD }
  );
});

// ── Promo Code 👾 ───────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_PROMO_CODE)}$`), async (ctx) => {

  await ctx.reply(
    '👾 <b>Promo Code</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD }
  );
});

// ── 📊 TOP SERVICES ────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_TOP_SERVICES)}$`), async (ctx) => {

  await ctx.reply(
    '📊 <b>Top Services</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD }
  );
});

// ── ⚙️ API ──────────────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_API)}$`), async (ctx) => {

  await ctx.reply(
    '⚙️ <b>API</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD }
  );
});

// ── 🔮 Reseller Account ────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_RESELLER)}$`), async (ctx) => {

  await ctx.reply(
    '🔮 <b>Reseller Account</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD }
  );
});

// ═══════════════════════════════════════════════════════════════════
//  🔧 ADMIN PANEL BUTTON — Inline buttons only
// ═══════════════════════════════════════════════════════════════════
composer.hears(new RegExp(`^${escRe(BTN_ADMIN_PANEL)}$`), async (ctx) => {
  const pool = ctx.dbPool;
  const isAdmin = await adminRepo.isAdmin(pool, ctx.from.id);
  if (!isAdmin) {
    await ctx.reply('⛔ You are not authorized.', { reply_markup: getMainMenu(false) });
    return;
  }

  const [usersRes, ordersRes, revenueRes, paidRes, pendingRes, expiredRes] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS c FROM users'),
    pool.query('SELECT COUNT(*)::int AS c FROM transactions'),
    pool.query(`SELECT COALESCE(SUM(amount), 0)::numeric AS s FROM transactions WHERE status = 'success'`),
    pool.query(`SELECT COUNT(*)::int AS c FROM transactions WHERE status = 'success'`),
    pool.query(`SELECT COUNT(*)::int AS c FROM transactions WHERE status = 'pending'`),
    pool.query(`SELECT COUNT(*)::int AS c FROM transactions WHERE status = 'expired'`),
  ]);

  const text =
    `╔══════════════════════╗\n` +
    `   👑 <b>Admin Panel</b>\n` +
    `╚══════════════════════╝\n\n` +
    `👥 <b>Total Users:</b> ${usersRes.rows[0].c}\n` +
    `🛒 <b>Total Orders:</b> ${ordersRes.rows[0].c}\n` +
    `💵 <b>Revenue:</b> ₹${formatNumber(parseFloat(revenueRes.rows[0].s))}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🟢 Paid: ${paidRes.rows[0].c}  |  🟡 Pending: ${pendingRes.rows[0].c}  |  🔴 Expired: ${expiredRes.rows[0].c}`;

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: ADMIN_PANEL_KEYBOARD,
  });
});

// ═══════════════════════════════════════════════════════════════════
//  PROFILE CALLBACK HANDLERS
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('profile:deposit_history', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const { rows } = await pool.query(
    `SELECT order_id, gateway, amount, status, gateway_data, created_at FROM transactions
     WHERE user_id = $1 AND status = 'success' ORDER BY created_at DESC LIMIT 10`, [ctx.from.id]
  );

  // Get total stats
  const { rows: statsRows } = await pool.query(
    `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE user_id = $1 AND status = 'success'`, [ctx.from.id]
  );
  const totalCount = parseInt(statsRows[0]?.count || 0);
  const totalAmount = parseFloat(statsRows[0]?.total || 0);

  if (rows.length === 0) {
    await ctx.reply(
      `┌─────────────────────────┐\n` +
      `│   📭  <b>No Deposits Yet</b>       │\n` +
      `└─────────────────────────┘\n\n` +
      `You haven't made any deposits.\n` +
      `Tap 💰 <b>DEPOSIT</b> to get started!`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // Fetch gateway display names
  const [paytmName, bharatpayName] = await Promise.all([
    settingsRepo.getSetting(pool, 'paytm_display_name'),
    settingsRepo.getSetting(pool, 'bharatpay_display_name'),
  ]);

  const gwName = (g) => {
    if (g === 'paytm') return paytmName || 'Automatic Gateway';
    if (g === 'bharatpay') return bharatpayName || 'Manual Gateway';
    if (g === 'cryptomus') return 'Crypto';
    return g;
  };
  const gwIcon = (g) => g === 'paytm' ? '⚡' : g === 'bharatpay' ? '🏦' : g === 'cryptomus' ? '🪙' : '💳';

  const formatDate = (d) => {
    const dt = new Date(d);
    const day = String(dt.getDate()).padStart(2, '0');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mon = months[dt.getMonth()];
    const yr = dt.getFullYear();
    let hr = dt.getHours();
    const min = String(dt.getMinutes()).padStart(2, '0');
    const ampm = hr >= 12 ? 'PM' : 'AM';
    hr = hr % 12 || 12;
    return `${day} ${mon} ${yr}, ${hr}:${min} ${ampm}`;
  };

  let text = '';
  text += `╔═══════════════════════╗\n`;
  text += `║  💎 <b>DEPOSIT HISTORY</b>         ║\n`;
  text += `╚═══════════════════════╝\n\n`;

  text += `┌─── 📊 <b>Summary</b> ─────────┐\n`;
  text += `│  💰 Total: <b>₹${totalAmount.toFixed(2)}</b>\n`;
  text += `│  📦 Transactions: <b>${totalCount}</b>\n`;
  text += `│  📄 Showing: <b>${rows.length}</b> latest\n`;
  text += `└───────────────────────┘\n`;

  rows.forEach((r, i) => {
    const ref = r.gateway_data?.txnRef || r.gateway_data?.paytm_utr || '—';
    const utr = r.gateway_data?.paytm_utr || r.gateway_data?.utr || '';

    text += `\n┌─ <b>#${i + 1}</b> ─────────────────┐\n`;
    text += `│  ✅ <b>₹${parseFloat(r.amount).toFixed(2)}</b>\n`;
    text += `│\n`;
    text += `│  ${gwIcon(r.gateway)} <b>Via:</b> ${gwName(r.gateway)}\n`;
    text += `│  📋 <b>ID:</b>  <code>${r.order_id}</code>\n`;
    text += `│  🔢 <b>Ref:</b> <code>${ref}</code>\n`;
    if (utr && utr !== ref) {
      text += `│  🏦 <b>UTR:</b> <code>${utr}</code>\n`;
    }
    text += `│  📅 ${formatDate(r.created_at)}\n`;
    text += `└───────────────────────┘`;
  });

  text += `\n\n<i>💡 Tap any code to copy it</i>`;

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('✖ Close', 'profile:close_history')
  });
});

composer.callbackQuery('profile:otp_history', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await ctx.reply('📠 <b>OTP History</b>\n\nNo OTP orders yet.', { parse_mode: 'HTML' });
});

composer.callbackQuery('profile:close_history', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  try { await ctx.deleteMessage(); } catch { /* ignore */ }
});

composer.callbackQuery('profile:email_history', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await ctx.reply('📧 <b>Email History</b>\n\nNo email orders yet.', { parse_mode: 'HTML' });
});

composer.callbackQuery('profile:transfer', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await ctx.reply('💸 <b>Transfer Balance</b>\n\nThis feature is coming soon.', { parse_mode: 'HTML' });
});

composer.callbackQuery('profile:terms', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await ctx.reply(
    '📜 <b>Terms And Conditions</b>\n\n' +
    '1. All payments are non-refundable.\n' +
    '2. Misuse of services will result in permanent ban.\n' +
    '3. Contact support for any issues.\n' +
    '4. We reserve the right to modify services.\n' +
    '5. By using this bot, you agree to these terms.',
    { parse_mode: 'HTML' }
  );
});

export default composer;
