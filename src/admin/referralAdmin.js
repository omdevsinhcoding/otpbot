/**
 * 🎁 REFERRAL ADMIN PANEL
 *
 * 4 sections:
 * 1. Dashboard (toggle + summary)
 * 2. Edit Commission %
 * 3. Manage Referrals (search by name/username/ID → suggested results → profile)
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
    .text(toggleBtn, 'refadm:toggle').text('💰 Edit Commission', 'refadm:commission').row()
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
//  MANAGE REFERRALS — Search by name/username/ID
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('refadm:manage', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.set(ctx.chat.id, { step: 'manage_search' });

  const text =
    `📋 <b>Manage Referrals</b>\n\n` +
    `Search by <b>Name</b>, <b>Username</b>, or <b>User ID</b>:\n\n` +
    `<i>Type to search — matching results will be shown.</i>`;
  const kb = new InlineKeyboard()
    .text('◀ Back', 'admin:referral').text('❌ Cancel', 'admin:referral');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

/** Search users by name, username, or user ID */
async function searchUsers(pool, query, limit = 8) {
  // If numeric, search by user_id directly
  const numericId = parseInt(query);
  if (!isNaN(numericId) && String(numericId) === query) {
    const { rows } = await pool.query(
      `SELECT user_id, full_name, username FROM users WHERE user_id = $1 LIMIT 1`,
      [numericId]
    );
    return rows;
  }

  // Text search — match name or username (partial)
  const pattern = `%${query}%`;
  const { rows } = await pool.query(
    `SELECT user_id, full_name, username FROM users
     WHERE LOWER(full_name) LIKE LOWER($1)
        OR LOWER(username) LIKE LOWER($1)
     ORDER BY full_name ASC
     LIMIT $2`,
    [pattern, limit]
  );
  return rows;
}

/** Show search results as inline buttons */
async function showSearchResults(ctx, results, query) {
  if (results.length === 0) {
    const text = `🔍 No users found for "<b>${escapeHtml(query)}</b>"`;
    const kb = new InlineKeyboard()
      .text('🔍 Search Again', 'refadm:manage')
      .text('◀ Back', 'admin:referral');
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
    return;
  }

  let text = `🔍 <b>Search Results</b> for "${escapeHtml(query)}":\n\n`;
  const kb = new InlineKeyboard();

  for (const r of results) {
    const name = escapeHtml(r.full_name || 'Unknown');
    const uname = r.username ? ` @${escapeHtml(r.username)}` : '';
    text += `👤 ${name}${uname} — <code>${r.user_id}</code>\n`;
    kb.text(`${name} (${r.user_id})`, `refadm:profile:${r.user_id}`).row();
  }

  kb.text('🔍 Search Again', 'refadm:manage').text('◀ Back', 'admin:referral');
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

/** Select from search results */
composer.callbackQuery(/^refadm:profile:(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.delete(ctx.chat.id);
  await showUserReferralProfile(ctx, parseInt(ctx.match[1]));
});

/**
 * Show full referral profile with individual remove buttons.
 * Matches lootpaglubot style.
 */
async function showUserReferralProfile(ctx, userId) {
  const pool = ctx.dbPool;
  const user = await userRepo.getUser(pool, userId);
  if (!user) {
    await ctx.reply('⚠️ User not found.', {
      reply_markup: new InlineKeyboard().text('🔍 Search Again', 'refadm:manage').text('◀ Back', 'admin:referral')
    });
    return;
  }

  const userName = escapeHtml(user.full_name || 'Unknown');
  const stats = await referralRepo.getUserReferralStats(pool, userId);
  const referrals = await referralRepo.getReferralsByUser(pool, userId, 20, 0);

  // Build text
  let text = `👤 <b>Referrals for</b> <code>${userId}</code> (${userName})\n\n`;

  // Show referrer info
  if (user.referred_by) {
    const referrer = await userRepo.getUser(pool, user.referred_by);
    const refName = referrer ? escapeHtml(referrer.full_name || 'Unknown') : 'Unknown';
    text += `🔗 <b>Referred by:</b> ${user.referred_by} (${refName})\n\n`;
  } else {
    text += `🔗 <b>Referred by:</b> None\n\n`;
  }

  // Show referred users
  text += `👥 <b>Referred ${referrals.length} user(s):</b>\n`;
  if (referrals.length > 0) {
    for (const r of referrals) {
      const name = escapeHtml(r.full_name || r.username || 'Unknown');
      const status = parseInt(r.deposits) > 0 ? 'active' : 'joined';
      const earned = parseFloat(r.earned) > 0 ? `, comm=₹${formatNumber(r.earned)}` : ', comm=₹0';
      text += `  • <code>${r.user_id}</code> ${name} — ${status}${earned}\n`;
    }
  } else {
    text += `  <i>No referred users.</i>\n`;
  }

  text += `\n<i>Removing a referral reverses wallet credit and lets the user re-refer.</i>`;

  // Build buttons — lootpaglubot style
  const kb = new InlineKeyboard();

  // Remove referrer button
  if (user.referred_by) {
    kb.text(`🗑 Remove referrer (${user.referred_by}) — let user re-refer`, `refadm:rmref:${userId}:${user.referred_by}`).row();
  }

  // Individual remove buttons for each referred user
  for (const r of referrals) {
    const name = escapeHtml(r.full_name || r.username || 'Unknown');
    kb.text(`🗑 Remove ${name} (${r.user_id})`, `refadm:rmone:${userId}:${r.user_id}`).row();
  }

  // Remove ALL outgoing referrals
  if (referrals.length > 0) {
    kb.text('❌ Remove ALL outgoing referrals (reset)', `refadm:rmall_confirm:${userId}`).row();
  }

  kb.text('◀ Back', 'admin:referral');

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

// ── Remove referrer (let user be re-referred) ───────────────────
composer.callbackQuery(/^refadm:rmref:(\d+):(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const userId = parseInt(ctx.match[1]);
  const referrerId = parseInt(ctx.match[2]);
  const pool = ctx.dbPool;

  await pool.query('UPDATE users SET referred_by = NULL WHERE user_id = $1', [userId]);

  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.REFERRAL_REVERSED,
    { action: 'remove_referrer', user_id: userId, referrer_id: referrerId });

  try { await ctx.answerCallbackQuery({ text: `✅ Referrer removed. User ${userId} can be re-referred.`, show_alert: true }); } catch {}
  await showUserReferralProfile(ctx, userId);
});

// ── Remove individual referred user ─────────────────────────────
composer.callbackQuery(/^refadm:rmone:(\d+):(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const referrerId = parseInt(ctx.match[1]);
  const referredId = parseInt(ctx.match[2]);
  const pool = ctx.dbPool;

  await pool.query('UPDATE users SET referred_by = NULL WHERE user_id = $1 AND referred_by = $2', [referredId, referrerId]);

  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.REFERRAL_REVERSED,
    { action: 'remove_single_referral', referrer_id: referrerId, referred_id: referredId });

  try { await ctx.answerCallbackQuery({ text: `✅ Removed referral for ${referredId}`, show_alert: true }); } catch {}
  await showUserReferralProfile(ctx, referrerId);
});

// ── Remove ALL outgoing referrals (confirmation) ────────────────
composer.callbackQuery(/^refadm:rmall_confirm:(\d+)$/, adminRequired, async (ctx) => {
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
    .text('✅ Yes, Remove All', `refadm:rmall_exec:${userId}`).row()
    .text('❌ Cancel', 'admin:referral');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

composer.callbackQuery(/^refadm:rmall_exec:(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const userId = parseInt(ctx.match[1]);
  const pool = ctx.dbPool;

  const { rowCount } = await pool.query('UPDATE users SET referred_by = NULL WHERE referred_by = $1', [userId]);

  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.REFERRAL_REVERSED,
    { action: 'remove_all_referrals', target_user_id: userId, removed_count: rowCount });

  const text = `✅ Removed <b>${rowCount}</b> referral(s) from user ${userId}.`;
  const kb = new InlineKeyboard().text('🔍 Search Again', 'refadm:manage').text('◀ Back', 'admin:referral');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
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

  // ── Manage: Search users ──
  if (state.step === 'manage_search') {
    if (input.length < 1) {
      await ctx.reply('⚠️ Please enter at least 1 character to search:');
      return;
    }

    // Search by name, username, or ID
    const results = await searchUsers(pool, input);

    // If exact numeric match → go directly to profile
    const numId = parseInt(input);
    if (!isNaN(numId) && String(numId) === input && results.length === 1) {
      states.delete(ctx.chat.id);
      await showUserReferralProfile(ctx, numId);
      return;
    }

    states.delete(ctx.chat.id);
    await showSearchResults(ctx, results, input);
    return;
  }

  return next();
});

export default composer;
