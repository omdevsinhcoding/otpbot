import { Composer } from 'grammy';
import { checkForceJoin } from '../middleware/forceJoinCheck.js';
import * as userRepo from '../database/repositories/userRepo.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import { USER_MAIN_MENU } from '../utils/keyboard.js';
import {
  BTN_GET_OTP, BTN_DEPOSIT, BTN_PROFILE, BTN_MORE,
  BTN_SMS_CHECKER, BTN_SUPPORT, BTN_REFER_EARN, BTN_READYMADE,
  ActionType,
} from '../utils/constants.js';
import { escapeHtml, formatTimestamp, formatNumber } from '../utils/formatters.js';
import logger from '../utils/logger.js';

const composer = new Composer();

// Helper: escape button text for regex
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ── 📠 GET OTP ──────────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_GET_OTP)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'get_otp' });
  await ctx.reply(
    '🔑 <b>OTP Service</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: USER_MAIN_MENU }
  );
});

// ── 💰 DEPOSIT ──────────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_DEPOSIT)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'deposit' });
  await ctx.reply(
    '💰 <b>Deposit</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: USER_MAIN_MENU }
  );
});

// ── 👤 PROFILE ──────────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_PROFILE)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'profile' });
  const pool = ctx.dbPool;
  const user = await userRepo.getUser(pool, ctx.from.id);
  if (!user) {
    await ctx.reply('⚠️ User not found. Please send /start first.', { reply_markup: USER_MAIN_MENU });
    return;
  }

  // Count referrals
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

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: USER_MAIN_MENU });
});

// ── 🔥 MORE ─────────────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_MORE)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'more' });
  const { InlineKeyboard } = await import('grammy');
  const kb = new InlineKeyboard()
    .text('📜 Terms & Conditions', 'menu:terms').text('ℹ️ About', 'menu:about').row()
    .text('📢 Updates', 'menu:updates').text('🔔 Notifications', 'menu:notifications');

  await ctx.reply('🔥 <b>More Options</b>', { parse_mode: 'HTML', reply_markup: kb });
});

// ── 📮 SMS CHECKER ──────────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_SMS_CHECKER)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'sms_checker' });
  await ctx.reply(
    '📮 <b>SMS Checker</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: USER_MAIN_MENU }
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

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: USER_MAIN_MENU });
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

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: USER_MAIN_MENU });
});

// ── 💎 READYMADE ACCOUNT ────────────────────────────────────────
composer.hears(new RegExp(`^${escRe(BTN_READYMADE)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;
  ctx.tracker?.trackFireAndForget(ctx.from.id, ActionType.BUTTON_CLICK, { button: 'readymade' });
  await ctx.reply(
    '💎 <b>Readymade Account</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: USER_MAIN_MENU }
  );
});

// ── Menu inline callbacks ───────────────────────────────────────
composer.callbackQuery(/^menu:/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const action = ctx.callbackQuery.data.replace('menu:', '');
  const msgs = {
    terms: '📜 <b>Terms & Conditions</b>\n\nTerms will be available soon.',
    about: 'ℹ️ <b>About</b>\n\nPremium OTP & SMS verification bot.',
    updates: '📢 <b>Updates</b>\n\nNo new updates at this time.',
    notifications: '🔔 <b>Notifications</b>\n\nNotification settings coming soon.',
  };
  await ctx.editMessageText(msgs[action] || 'Unknown option.', { parse_mode: 'HTML' });
});

export default composer;
