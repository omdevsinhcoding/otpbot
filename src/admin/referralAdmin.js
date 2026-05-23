/**
 * 🎁 REFERRAL ADMIN PANEL — Clean, minimal.
 *
 * Only 4 sections:
 * 1. Dashboard (toggle + summary)
 * 2. Edit Commission %
 * 3. Manage Referrals (user lookup + full profile + remove)
 * 4. Analytics
 */
import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import * as referralRepo from '../database/repositories/referralRepo.js';
import * as userRepo from '../database/repositories/userRepo.js';
import { escapeHtml, formatNumber } from '../utils/formatters.js';
import { registerAdminState } from '../utils/adminStates.js';
import { ActionType } from '../utils/constants.js';

const composer = new Composer();
const states = new Map();
registerAdminState(states);

// ═══════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('admin:referral', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.delete(ctx.chat.id);
  await showDashboard(ctx);
});

async function showDashboard(ctx) {
  const pool = ctx.dbPool;
  const enabled = await settingsRepo.getSetting(pool, 'referral_enabled');
  const commPct = parseFloat(await settingsRepo.getSetting(pool, 'referral_commission_pct')) || 10;
  const prefix = await settingsRepo.getSetting(pool, 'referral_code_prefix') || 'ERRORRO';

  // Quick stats
  const stats = await referralRepo.getAnalytics(pool);

  const onoff = enabled ? '🟢 ON' : '🔴 OFF';
  const toggleBtn = enabled ? '🔴 Disable Referral' : '🟢 Enable Referral';

  const text =
    `🎁 <b>Referral System</b>  ${onoff}\n\n` +
    `💰 <b>Commission:</b> ${commPct}%\n` +
    `🔑 <b>Code Prefix:</b> ${escapeHtml(prefix)}\n` +
    `👥 <b>Total Referrals:</b> ${formatNumber(stats.totalReferrals)}\n` +
    `💰 <b>Total Distributed:</b> ₹${formatNumber(stats.totalRewardsDistributed)}`;

  const kb = new InlineKeyboard()
    .text(toggleBtn, 'refadm:toggle').text(`💰 Edit Commission`, 'refadm:commission').row()
    .text('👥 Manage Referrals', 'refadm:manage').text('📊 Analytics', 'refadm:analytics').row()
    .text('◀ Back', 'admin:back');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
}

// ═══════════════════════════════════════════════════════════════════
//  TOGGLE
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('refadm:toggle', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const cur = await settingsRepo.getSetting(pool, 'referral_enabled');
  await settingsRepo.setSetting(pool, 'referral_enabled', !cur, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED,
    { action: 'referral_toggle', enabled: !cur });
  await showDashboard(ctx);
});

// ═══════════════════════════════════════════════════════════════════
//  EDIT COMMISSION
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('refadm:commission', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.delete(ctx.chat.id);
  const cur = parseFloat(await settingsRepo.getSetting(ctx.dbPool, 'referral_commission_pct')) || 10;

  const text =
    `💰 <b>Edit Commission</b>\n\n` +
    `Current: <b>${cur}%</b>\n\n` +
    `Select a percentage or enter custom:`;

  const kb = new InlineKeyboard()
    .text('1%', 'refadm:setpct:1').text('2%', 'refadm:setpct:2').text('3%', 'refadm:setpct:3').row()
    .text('5%', 'refadm:setpct:5').text('7%', 'refadm:setpct:7').text('10%', 'refadm:setpct:10').row()
    .text('15%', 'refadm:setpct:15').text('20%', 'refadm:setpct:20').text('✏️ Custom', 'refadm:custompct').row()
    .text('◀ Back', 'admin:referral');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

composer.callbackQuery(/^refadm:setpct:(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pct = parseInt(ctx.match[1]);
  await settingsRepo.setSetting(ctx.dbPool, 'referral_commission_pct', pct, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED,
    { action: 'referral_commission', pct });
  await showDashboard(ctx);
});

composer.callbackQuery('refadm:custompct', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.set(ctx.chat.id, { step: 'custom_commission' });
  const kb = new InlineKeyboard().text('❌ Cancel', 'admin:referral');
  try { await ctx.editMessageText('✏️ Type the commission percentage (1–100):', { parse_mode: 'HTML', reply_markup: kb }); } catch {}
});

// ═══════════════════════════════════════════════════════════════════
//  MANAGE REFERRALS — User lookup + full profile
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('refadm:manage', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.set(ctx.chat.id, { step: 'manage_lookup' });

  const text =
    `👥 <b>Manage Referrals</b>\n\n` +
    `Enter a User ID to look up their referral details:`;
  const kb = new InlineKeyboard().text('◀ Back', 'admin:referral');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

async function showUserReferralProfile(ctx, userId) {
  const pool = ctx.dbPool;
  const user = await userRepo.getUser(pool, userId);
  if (!user) {
    await ctx.reply('⚠️ User not found.', {
      reply_markup: new InlineKeyboard().text('🔍 Search Another', 'refadm:manage').text('◀ Back', 'admin:referral')
    });
    return;
  }

  const stats = await referralRepo.getUserReferralStats(pool, userId);
  const refCode = user.referral_code || 'N/A';

  // Get referrer name
  let referrerText = 'None';
  if (user.referred_by) {
    const referrer = await userRepo.getUser(pool, user.referred_by);
    referrerText = referrer ? `${escapeHtml(referrer.full_name || 'Unknown')} [${user.referred_by}]` : `[${user.referred_by}]`;
  }

  // Get invited users list (first 15)
  const referrals = await referralRepo.getReferralsByUser(pool, userId, 15, 0);
  const walletBalance = stats.wallet ? parseFloat(stats.wallet.balance) : 0;
  const isFrozen = stats.wallet?.is_frozen || false;

  let text =
    `🔍 <b>Referral Details</b>\n\n` +
    `👤 <b>Name:</b> ${escapeHtml(user.full_name || 'N/A')}\n` +
    `🆔 <b>User ID:</b> <code>${userId}</code>\n` +
    `🔑 <b>Code:</b> <code>${refCode}</code>\n` +
    `👥 <b>Referred By:</b> ${referrerText}\n\n` +
    `━━━ <b>Referral Stats</b> ━━━\n\n` +
    `👥 <b>Total Referrals:</b> ${formatNumber(stats.totalReferrals)}\n` +
    `✅ <b>Successful:</b> ${formatNumber(stats.successfulReferrals)}\n` +
    `🤑 <b>Total Earned:</b> ₹${formatNumber(stats.totalEarned)}\n` +
    `💰 <b>Wallet Balance:</b> ₹${formatNumber(walletBalance)}\n` +
    `🧊 <b>Frozen:</b> ${isFrozen ? '🔴 YES' : '🟢 No'}\n`;

  if (referrals.length > 0) {
    text += `\n━━━ <b>Invited Users</b> ━━━\n\n`;
    for (let i = 0; i < referrals.length; i++) {
      const r = referrals[i];
      const name = escapeHtml(r.full_name || r.username || 'Unknown');
      const status = parseInt(r.deposits) > 0 ? '✅ Active' : '⏳ Pending';
      const earned = parseFloat(r.earned) > 0 ? ` — ₹${formatNumber(r.earned)}` : '';
      const date = new Date(r.first_seen).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      text += `#${i + 1} ${name} — ${status}${earned}\n`;
      text += `     <i>${date}</i>\n`;
    }
    if (stats.totalReferrals > 15) {
      text += `\n<i>... and ${stats.totalReferrals - 15} more</i>\n`;
    }
  }

  const kb = new InlineKeyboard();
  if (stats.totalReferrals > 0) {
    kb.text('❌ Remove All Referrals', `refadm:remove_confirm:${userId}`).row();
  }
  if (isFrozen) {
    kb.text('🔓 Unfreeze Wallet', `refadm:unfreeze:${userId}`).row();
  } else {
    kb.text('🧊 Freeze Wallet', `refadm:freeze:${userId}`).row();
  }
  kb.text('🔍 Search Another', 'refadm:manage').text('◀ Back', 'admin:referral');

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

// ── Remove All Referrals ────────────────────────────────────────
composer.callbackQuery(/^refadm:remove_confirm:(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const userId = parseInt(ctx.match[1]);
  const user = await userRepo.getUser(ctx.dbPool, userId);
  const name = user ? escapeHtml(user.full_name || 'Unknown') : 'Unknown';
  const refCount = await referralRepo.getTotalReferralCount(ctx.dbPool, userId);

  const text =
    `⚠️ <b>Confirm Remove All Referrals</b>\n\n` +
    `👤 <b>${name}</b> [<code>${userId}</code>]\n` +
    `👥 <b>Referrals:</b> ${refCount}\n\n` +
    `This will unlink ALL users referred by this user.\n` +
    `<i>This action cannot be undone!</i>`;

  const kb = new InlineKeyboard()
    .text('✅ Yes, Remove All', `refadm:remove_exec:${userId}`).row()
    .text('❌ Cancel', 'admin:referral');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

composer.callbackQuery(/^refadm:remove_exec:(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const userId = parseInt(ctx.match[1]);
  const pool = ctx.dbPool;

  const { rowCount } = await pool.query('UPDATE users SET referred_by = NULL WHERE referred_by = $1', [userId]);

  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.REFERRAL_REVERSED,
    { action: 'remove_all_referrals', target_user_id: userId, removed_count: rowCount });

  const text = `✅ Removed <b>${rowCount}</b> referral(s) from user ${userId}.`;
  const kb = new InlineKeyboard().text('🔍 Search Another', 'refadm:manage').text('◀ Back', 'admin:referral');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

// ── Freeze / Unfreeze ───────────────────────────────────────────
composer.callbackQuery(/^refadm:freeze:(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const userId = parseInt(ctx.match[1]);
  await referralRepo.freezeWallet(ctx.dbPool, userId);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.REFERRAL_FRAUD,
    { action: 'freeze_wallet', target_user_id: userId });
  try { await ctx.answerCallbackQuery({ text: `🧊 Wallet frozen for ${userId}`, show_alert: true }); } catch {}
  await showUserReferralProfile(ctx, userId);
});

composer.callbackQuery(/^refadm:unfreeze:(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const userId = parseInt(ctx.match[1]);
  await referralRepo.unfreezeWallet(ctx.dbPool, userId);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.REFERRAL_FRAUD,
    { action: 'unfreeze_wallet', target_user_id: userId });
  try { await ctx.answerCallbackQuery({ text: `✅ Wallet unfrozen for ${userId}`, show_alert: true }); } catch {}
  await showUserReferralProfile(ctx, userId);
});

// ═══════════════════════════════════════════════════════════════════
//  ANALYTICS
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('refadm:analytics', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.delete(ctx.chat.id);
  const pool = ctx.dbPool;
  const stats = await referralRepo.getAnalytics(pool);

  const text =
    `📊 <b>Referral Analytics</b>\n\n` +
    `👥 <b>Total Referrals:</b> ${formatNumber(stats.totalReferrals)}\n` +
    `🔥 <b>Active Referrers:</b> ${formatNumber(stats.activeReferrers)}\n` +
    `💰 <b>Total Rewards:</b> ₹${formatNumber(stats.totalRewardsDistributed)}\n` +
    `💳 <b>Total Transfers:</b> ₹${formatNumber(stats.totalTransfers)}\n\n` +
    `━━━ <b>Activity</b> ━━━\n\n` +
    `📅 <b>Today:</b> ${formatNumber(stats.rewardsToday)} rewards\n` +
    `📆 <b>This Week:</b> ${formatNumber(stats.rewardsThisWeek)} rewards\n` +
    `📆 <b>This Month:</b> ${formatNumber(stats.rewardsThisMonth)} rewards\n\n` +
    `🚨 <b>Fraud Flags:</b> ${formatNumber(stats.unresolvedFraudFlags)}`;

  const kb = new InlineKeyboard()
    .text('🔄 Refresh', 'refadm:analytics').row()
    .text('◀ Back', 'admin:referral');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

// ═══════════════════════════════════════════════════════════════════
//  TEXT INPUT HANDLER
// ═══════════════════════════════════════════════════════════════════
composer.on('message:text', async (ctx, next) => {
  const state = states.get(ctx.chat?.id);
  if (!state) return next();
  const pool = ctx.dbPool;
  const input = ctx.message.text.trim();

  // ── Custom commission ──
  if (state.step === 'custom_commission') {
    const num = parseFloat(input);
    if (isNaN(num) || num <= 0 || num > 100) {
      await ctx.reply('⚠️ Enter a valid percentage (1–100):');
      return;
    }
    await settingsRepo.setSetting(pool, 'referral_commission_pct', num, ctx.from.id);
    ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED,
      { action: 'referral_commission', pct: num });
    states.delete(ctx.chat.id);
    await ctx.reply(`✅ Commission set to ${num}%`, {
      reply_markup: new InlineKeyboard().text('◀ Back', 'admin:referral')
    });
    return;
  }

  // ── Manage: User lookup ──
  if (state.step === 'manage_lookup') {
    const userId = parseInt(input);
    if (isNaN(userId)) {
      await ctx.reply('⚠️ Enter a valid user ID:');
      return;
    }
    states.delete(ctx.chat.id);
    await showUserReferralProfile(ctx, userId);
    return;
  }

  return next();
});

export default composer;
