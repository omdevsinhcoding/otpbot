import { Composer } from 'grammy';
import { checkForceJoin } from '../middleware/forceJoinCheck.js';
import * as userRepo from '../database/repositories/userRepo.js';
import * as adminRepo from '../database/repositories/adminRepo.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import { getMainMenu, MORE_MENU_KEYBOARD, ADMIN_PANEL_KEYBOARD } from '../utils/keyboard.js';
import {
  BTN_GET_OTP, BTN_DEPOSIT, BTN_PROFILE, BTN_MORE,
  BTN_SMS_CHECKER, BTN_SUPPORT, BTN_REFER_EARN, BTN_READYMADE,
  BTN_GET_EMAIL, BTN_FAVORITE, BTN_PROMO_CODE, BTN_RETURN,
  BTN_TOP_SERVICES, BTN_API, BTN_RESELLER, BTN_ADMIN_PANEL,
  ActionType,
} from '../utils/constants.js';
import { escapeHtml, formatTimestamp, formatNumber } from '../utils/formatters.js';
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
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'get_otp' });
  await ctx.reply(
    '🔑 <b>OTP Service</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: await menuFor(ctx) }
  );
});

// ── 💰 DEPOSIT → opens deposit menu with payment options ────────
composer.hears(new RegExp(`^${escRe(BTN_DEPOSIT)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'deposit' });

  // Import dynamically to avoid circular deps
  const walletRepo = await import('../database/repositories/walletRepo.js');
  const settingsRepo = await import('../database/repositories/settingsRepo.js');
  const { InlineKeyboard } = await import('grammy');
  const { formatNumber } = await import('../utils/formatters.js');

  const pool = ctx.dbPool;
  const balance = await walletRepo.getBalance(pool, ctx.from.id);
  const [paytmOn, bharatpayOn, cryptomusOn] = await Promise.all([
    settingsRepo.getSetting(pool, 'paytm_enabled'),
    settingsRepo.getSetting(pool, 'bharatpay_enabled'),
    settingsRepo.getSetting(pool, 'cryptomus_enabled'),
  ]);

  let text = `💰 <b>Deposit Funds</b>\n\n💳 <b>Your Balance:</b> ₹${formatNumber(balance)}\n\nChoose a payment method:`;
  const kb = new InlineKeyboard();
  if (paytmOn) kb.text('💳 Paytm UPI', 'deposit:paytm').row();
  if (bharatpayOn) kb.text('🏦 Bharat Pay', 'deposit:bharatpay').row();
  if (cryptomusOn) kb.text('₿ Cryptomus', 'deposit:cryptomus').row();
  if (!paytmOn && !bharatpayOn && !cryptomusOn) text += '\n\n⚠️ No payment methods available.';
  kb.text('❌ Close', 'deposit:close');

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
});

// ── 👤 PROFILE ──────────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_PROFILE)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'profile' });
  const pool = ctx.dbPool;
  const user = await userRepo.getUser(pool, ctx.from.id);
  if (!user) {
    await ctx.reply('⚠️ User not found. Please send /start first.', { reply_markup: await menuFor(ctx) });
    return;
  }

  const { rows: refRows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM users WHERE referred_by = $1', [ctx.from.id]
  );
  const referralCount = refRows[0].count;

  const text =
    `╔══════════════════════╗\n` +
    `      👤 <b>YOUR PROFILE</b>\n` +
    `╠══════════════════════╣\n` +
    `┃ 🆔 <b>ID:</b> <code>${user.user_id}</code>\n` +
    `┃ 📛 <b>Name:</b> ${escapeHtml(user.full_name || 'N/A')}\n` +
    `┃ 👤 <b>Username:</b> ${user.username ? '@' + escapeHtml(user.username) : 'N/A'}\n` +
    `┃ 📅 <b>Joined:</b> ${formatTimestamp(user.first_seen)}\n` +
    `┃ ⏰ <b>Last Active:</b> ${formatTimestamp(user.last_active)}\n` +
    `┃ 🔗 <b>Referral Code:</b> <code>${user.referral_code || 'N/A'}</code>\n` +
    `┃ 👥 <b>Referrals:</b> ${formatNumber(referralCount)}\n` +
    `┃ ⭐ <b>Status:</b> ${user.is_banned ? '🚫 Banned' : '✅ Active'}\n` +
    `╚══════════════════════╝`;

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: await menuFor(ctx) });
});

// ── 🔥 MORE → shows sub-menu reply keyboard ────────────────────
composer.hears(new RegExp(`^${escRe(BTN_MORE)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'more' });
  await ctx.reply('🔥 <b>More Options</b>', { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD });
});

// ── 📮 SMS CHECKER ──────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_SMS_CHECKER)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'sms_checker' });
  await ctx.reply(
    '📮 <b>SMS Checker</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: await menuFor(ctx) }
  );
});

// ── 🛡 SUPPORT ──────────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_SUPPORT)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'support' });
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
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'refer_earn' });
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
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'readymade' });
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
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'return' });
  await ctx.reply('🏠 <b>Main Menu</b>', { parse_mode: 'HTML', reply_markup: await menuFor(ctx) });
});

// ── 📧 GET EMAIL ────────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_GET_EMAIL)}$`), async (ctx) => {
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'get_email' });
  await ctx.reply(
    '📧 <b>Get Email</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD }
  );
});

// ── 😊 Favorite ─────────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_FAVORITE)}$`), async (ctx) => {
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'favorite' });
  await ctx.reply(
    '😊 <b>Favorites</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD }
  );
});

// ── Promo Code 👾 ───────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_PROMO_CODE)}$`), async (ctx) => {
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'promo_code' });
  await ctx.reply(
    '👾 <b>Promo Code</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD }
  );
});

// ── 📊 TOP SERVICES ────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_TOP_SERVICES)}$`), async (ctx) => {
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'top_services' });
  await ctx.reply(
    '📊 <b>Top Services</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD }
  );
});

// ── ⚙️ API ──────────────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_API)}$`), async (ctx) => {
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'api' });
  await ctx.reply(
    '⚙️ <b>API</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD }
  );
});

// ── 🔮 Reseller Account ────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_RESELLER)}$`), async (ctx) => {
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'reseller' });
  await ctx.reply(
    '🔮 <b>Reseller Account</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD }
  );
});

// ═══════════════════════════════════════════════════════════════════
//  🔧 ADMIN PANEL BUTTON (reply keyboard)
// ═══════════════════════════════════════════════════════════════════
composer.hears(new RegExp(`^${escRe(BTN_ADMIN_PANEL)}$`), async (ctx) => {
  const isAdmin = await adminRepo.isAdmin(ctx.dbPool, ctx.from.id);
  if (!isAdmin) {
    await ctx.reply('⛔ You are not authorized.', { reply_markup: getMainMenu(false) });
    return;
  }
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'admin_panel' });
  await ctx.reply('🔧 <b>Admin Panel</b>\n\nSelect an option:', {
    parse_mode: 'HTML',
    reply_markup: ADMIN_PANEL_KEYBOARD,
  });
});

export default composer;
