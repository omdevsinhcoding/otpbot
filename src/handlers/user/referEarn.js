/**
 * 🎁 REFER & EARN — User-facing referral handler.
 *
 * Layout matching swift_otp style.
 * Buttons: Condition (Telegraph URL — English / Hinglish / Both), Enter Referral Code, My Referrals, Back
 */
import { Composer, InlineKeyboard } from 'grammy';
import { checkForceJoin } from '../../middleware/forceJoinCheck.js';
import { escRe, menuFor } from './index.js';
import { BTN_REFER_EARN } from '../../utils/constants.js';
import { formatNumber, escapeHtml } from '../../utils/formatters.js';
import * as userRepo from '../../database/repositories/userRepo.js';
import * as referralRepo from '../../database/repositories/referralRepo.js';
import * as settingsRepo from '../../database/repositories/settingsRepo.js';
import { ensureTelegraphPages } from '../../utils/telegraph.js';

const composer = new Composer();
const _states = new Map();

// ═══════════════════════════════════════════════════════════════════
//  MAIN CARD — 🎁 Refer & Earn button
// ═══════════════════════════════════════════════════════════════════
composer.hears(new RegExp(`^${escRe(BTN_REFER_EARN)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;
  _states.delete(ctx.chat.id);
  await showReferralCard(ctx);
});

composer.callbackQuery('ref:home', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  _states.delete(ctx.chat.id);
  await showReferralCard(ctx, true);
});

async function showReferralCard(ctx, edit = false) {
  const pool = ctx.dbPool;
  const userId = ctx.from.id;

  // Check if referral system is enabled
  const enabled = await settingsRepo.getSetting(pool, 'referral_enabled');
  if (!enabled) {
    const text = `🏆 <b>REFER & EARN</b>\n\n<i>Referral system is currently disabled. Check back later!</i>`;
    const kb = new InlineKeyboard().text('◀ Back', 'ref:back');
    if (edit) {
      try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
    } else {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
    }
    return;
  }

  const user = await userRepo.getUser(pool, userId);
  const refCode = user?.referral_code || 'N/A';
  const commPct = parseFloat(await settingsRepo.getSetting(pool, 'referral_commission_pct')) || 10;

  // Stats
  const totalRefs = await referralRepo.getTotalReferralCount(pool, userId);
  const wallet = await referralRepo.getReferralWallet(pool, userId);
  const walletBalance = wallet ? parseFloat(wallet.balance) : 0;

  const botInfo = await ctx.api.getMe();
  const refLink = `https://t.me/${botInfo.username}?start=${refCode}`;

  // Get Telegraph URLs based on language setting
  const pages = await ensureTelegraphPages(pool);
  const langMode = await settingsRepo.getSetting(pool, 'telegraph_language') || 'english';

  const text =
    `🎁 <b>REFER & EARN</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🔑 <b>Your Referral Code:</b> <code>${refCode}</code>\n` +
    `🔗 <b>Your Referral Link:</b>\n` +
    `<code>${refLink}</code>\n\n` +
    `💰 <b>Referral Balance (${commPct}% On Deposits):</b> ₹${formatNumber(walletBalance)}\n` +
    `👥 <b>Total Referrals:</b> ${formatNumber(totalRefs)}`;

  const kb = new InlineKeyboard();

  // Condition buttons based on language setting
  if (langMode === 'both') {
    if (pages.en) kb.url('📜 Condition (English)', pages.en);
    if (pages.hi) kb.url('📜 Condition (Hindi)', pages.hi);
    kb.row();
  } else if (langMode === 'hinglish' && pages.hi) {
    kb.url('📜 Condition', pages.hi).row();
  } else if (pages.en) {
    kb.url('📜 Condition', pages.en).row();
  }

  kb.text('🔗 Enter Referral Code', 'ref:enter_code').row();
  kb.text('👥 My Referrals', 'ref:history:1').row();
  kb.text('◀ Back', 'ref:back');

  if (edit) {
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
    catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

// ═══════════════════════════════════════════════════════════════════
//  ENTER REFERRAL CODE
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('ref:enter_code', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const user = await userRepo.getUser(pool, ctx.from.id);

  if (user?.referred_by) {
    const text = `⚠️ You already have a referrer! You can't change your referral code.`;
    const kb = new InlineKeyboard().text('◀ Back', 'ref:home');
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
    return;
  }

  _states.set(ctx.chat.id, { step: 'enter_referral_code' });
  const text =
    `🔗 <b>Enter Referral Code</b>\n\n` +
    `Type the referral code you received from a friend:`;
  const kb = new InlineKeyboard().text('❌ Cancel', 'ref:home');
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

// ═══════════════════════════════════════════════════════════════════
//  MY REFERRALS — Paginated
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery(/^ref:history:(\d+)$/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  _states.delete(ctx.chat.id);
  const pool = ctx.dbPool;
  const page = parseInt(ctx.match[1]) || 1;
  const perPage = 10;
  const offset = (page - 1) * perPage;

  const totalRefs = await referralRepo.getTotalReferralCount(pool, ctx.from.id);
  const referrals = await referralRepo.getReferralsByUser(pool, ctx.from.id, perPage, offset);
  const totalPages = Math.max(1, Math.ceil(totalRefs / perPage));

  if (totalRefs === 0) {
    const text =
      `👥 <b>My Referrals</b>\n\n` +
      `<i>No referrals yet. Share your link to start earning!</i>`;
    const kb = new InlineKeyboard().text('◀ Back', 'ref:home');
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
    catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
    return;
  }

  let text = `👥 <b>My Referrals</b>  (${formatNumber(totalRefs)} total)\n\n`;

  for (let i = 0; i < referrals.length; i++) {
    const r = referrals[i];
    const num = offset + i + 1;
    const name = escapeHtml(r.full_name || r.username || 'Unknown');
    const date = new Date(r.first_seen).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const status = parseInt(r.deposits) > 0 ? '✅ Active' : '⏳ Pending';
    const earned = parseFloat(r.earned) > 0 ? ` — ₹${formatNumber(r.earned)}` : '';
    text += `#${num} ${name} — ${status}${earned}\n`;
    text += `     <i>${date}</i>\n\n`;
  }

  text += `📄 Page ${page}/${totalPages}`;

  const kb = new InlineKeyboard();
  if (page > 1) kb.text('◀ Prev', `ref:history:${page - 1}`);
  kb.text(`${page}/${totalPages}`, 'noop');
  if (page < totalPages) kb.text('Next ▶', `ref:history:${page + 1}`);
  kb.row().text('◀ Back', 'ref:home');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

// ═══════════════════════════════════════════════════════════════════
//  BACK — Return to main menu
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('ref:back', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  _states.delete(ctx.chat.id);
  try { await ctx.deleteMessage(); } catch {}
  await ctx.reply('Select an option below:', { reply_markup: await menuFor(ctx) });
});

// ═══════════════════════════════════════════════════════════════════
//  TEXT INPUT — Enter Referral Code
// ═══════════════════════════════════════════════════════════════════
composer.on('message:text', async (ctx, next) => {
  const state = _states.get(ctx.chat?.id);
  if (!state || state.step !== 'enter_referral_code') return next();

  const pool = ctx.dbPool;
  const input = ctx.message.text.trim();
  const kb = new InlineKeyboard().text('◀ Back', 'ref:home');

  try {
    const { rows } = await pool.query(
      'SELECT user_id, full_name FROM users WHERE referral_code = $1', [input]
    );

    if (rows.length === 0) {
      await ctx.reply('⚠️ Invalid referral code. Please check and try again.', { reply_markup: kb });
      return;
    }

    const referrer = rows[0];

    if (referrer.user_id === ctx.from.id) {
      await ctx.reply("⚠️ You can't use your own referral code!", { reply_markup: kb });
      return;
    }

    const user = await userRepo.getUser(pool, ctx.from.id);
    if (user?.referred_by) {
      _states.delete(ctx.chat.id);
      await ctx.reply('⚠️ You already have a referrer!', { reply_markup: kb });
      return;
    }

    // Set referrer
    await pool.query('UPDATE users SET referred_by = $1 WHERE user_id = $2', [referrer.user_id, ctx.from.id]);
    _states.delete(ctx.chat.id);

    const refName = escapeHtml(referrer.full_name || 'a user');
    await ctx.reply(
      `🔗 <b>𝗥𝗲𝗳𝗲𝗿𝗿𝗮𝗹 𝗔𝗰𝘁𝗶𝘃𝗮𝘁𝗲𝗱!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👤 You've been referred by <b>${refName}</b>!\n` +
      `🎁 Your friend will earn rewards on your deposits\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `🛍 <i>Start shopping and enjoy the deals!</i> ✨`,
      { parse_mode: 'HTML', reply_markup: kb }
    );

    // Notify the referrer
    try {
      const refEnabled = await settingsRepo.getSetting(pool, 'referral_enabled');
      if (refEnabled) {
        const commPct = parseFloat(await settingsRepo.getSetting(pool, 'referral_commission_pct')) || 10;
        const joinerName = escapeHtml([ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || 'Someone');
        const notifText =
          `🎊 <b>𝗡𝗲𝘄 𝗥𝗲𝗳𝗲𝗿𝗿𝗮𝗹 𝗔𝗹𝗲𝗿𝘁!</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `👤 <b>${joinerName}</b> used your referral code!\n` +
          `💰 You'll earn <b>${commPct}%</b> commission on their every deposit\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━\n` +
          `🔥 <i>Keep sharing to earn more!</i> 💸`;
        await ctx.api.sendMessage(referrer.user_id, notifText, { parse_mode: 'HTML' });
      }
    } catch { /* notification failure is non-critical */ }

  } catch {
    await ctx.reply('⚠️ Something went wrong. Please try again.', { reply_markup: kb });
  }
});

export default composer;
