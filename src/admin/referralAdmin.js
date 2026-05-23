/**
 * 🎁 REFERRAL ADMIN PANEL
 *
 * 5 sections:
 * 1. Dashboard (toggle + summary)
 * 2. Edit Commission %
 * 3. Manage Referrals (search by name/username/ID → suggested results → profile)
 * 4. Analytics
 * 5. Condition Settings (Telegraph language, author name, regenerate)
 */
import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import * as referralRepo from '../database/repositories/referralRepo.js';
import * as userRepo from '../database/repositories/userRepo.js';
import { escapeHtml, formatNumber } from '../utils/formatters.js';
import { registerAdminState } from '../utils/adminStates.js';
import { ActionType } from '../utils/constants.js';
import { regeneratePages } from '../utils/telegraph.js';

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
    .text('🗑 Manage / Remove Referrals', 'refadm:manage').text('📊 Analytics', 'refadm:analytics').row()
    .text('📜 Condition Settings', 'refadm:condition').row()
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
//  CONDITION SETTINGS — Telegraph language, author name, regenerate
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('refadm:condition', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.delete(ctx.chat.id);
  await showConditionSettings(ctx);
});

async function showConditionSettings(ctx) {
  const pool = ctx.dbPool;
  const authorName = await settingsRepo.getSetting(pool, 'telegraph_author_name') || 'Refer & Earn Bot';
  const langMode = await settingsRepo.getSetting(pool, 'telegraph_language') || 'english';
  const urlEn = await settingsRepo.getSetting(pool, 'referral_terms_url_en');
  const urlHi = await settingsRepo.getSetting(pool, 'referral_terms_url_hi');

  const langLabel = langMode === 'both' ? '🌐 Both' : langMode === 'hinglish' ? '🇮🇳 Hinglish' : '🇬🇧 English';

  let text =
    `📜 <b>Condition Settings</b>\n\n` +
    `📝 <b>Author Name:</b> ${escapeHtml(authorName)}\n` +
    `🌐 <b>Language:</b> ${langLabel}\n\n`;

  if (langMode === 'english' || langMode === 'both') {
    text += `🇬🇧 <b>English:</b> ${urlEn ? '✅ Created' : '❌ Not created'}\n`;
  }
  if (langMode === 'hinglish' || langMode === 'both') {
    text += `🇮🇳 <b>Hinglish:</b> ${urlHi ? '✅ Created' : '❌ Not created'}\n`;
  }

  // Language buttons — show which is selected
  const kb = new InlineKeyboard()
    .text('✏️ Edit Author Name', 'refadm:editname').row()
    .text(
      langMode === 'english' ? '🇬🇧 English ✓' : '🇬🇧 English',
      'refadm:setlang:english'
    )
    .text(
      langMode === 'hinglish' ? '🇮🇳 Hinglish ✓' : '🇮🇳 Hinglish',
      'refadm:setlang:hinglish'
    )
    .text(
      langMode === 'both' ? '🌐 Both ✓' : '🌐 Both',
      'refadm:setlang:both'
    ).row()
    .text('🔄 Regenerate Pages', 'refadm:regen').row()
    .text('◀ Back', 'admin:referral');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
}

// ── Set Language ────────────────────────────────────────────────
composer.callbackQuery(/^refadm:setlang:(english|hinglish|both)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const lang = ctx.match[1];
  const pool = ctx.dbPool;

  await settingsRepo.setSetting(pool, 'telegraph_language', lang, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED,
    { action: 'telegraph_language', language: lang });

  // Auto-regenerate pages for new language
  try {
    await regeneratePages(pool);
    try { await ctx.answerCallbackQuery({ text: `✅ Language set to ${lang}. Pages regenerated!`, show_alert: true }); } catch {}
  } catch (err) {
    try { await ctx.answerCallbackQuery({ text: `⚠️ Language set but page creation failed: ${err.message}`, show_alert: true }); } catch {}
  }

  await showConditionSettings(ctx);
});

// ── Edit Author Name ────────────────────────────────────────────
composer.callbackQuery('refadm:editname', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.set(ctx.chat.id, { step: 'edit_telegraph_name' });
  const cur = await settingsRepo.getSetting(ctx.dbPool, 'telegraph_author_name') || 'Refer & Earn Bot';
  const text =
    `✏️ <b>Edit Author Name</b>\n\n` +
    `Current: <b>${escapeHtml(cur)}</b>\n\n` +
    `Type the new name that will be shown on the Telegraph page:`;
  const kb = new InlineKeyboard().text('❌ Cancel', 'refadm:condition');
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

// ── Regenerate Pages ────────────────────────────────────────────
composer.callbackQuery('refadm:regen', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;

  try {
    await regeneratePages(pool);
    try { await ctx.answerCallbackQuery({ text: '✅ Telegraph pages regenerated!', show_alert: true }); } catch {}
  } catch (err) {
    try { await ctx.answerCallbackQuery({ text: `⚠️ Failed: ${err.message}`, show_alert: true }); } catch {}
  }

  await showConditionSettings(ctx);
});

// ═══════════════════════════════════════════════════════════════════
//  🗑 MANAGE / REMOVE REFERRALS — Search + Browse All Users
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('refadm:manage', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.delete(ctx.chat.id);

  const text =
    `🗑 <b>Manage / Remove Referrals</b>\n\n` +
    `Choose how to find a user:`;
  const kb = new InlineKeyboard()
    .text('🔍 Search User', 'refadm:search_prompt').row()
    .text('📋 Browse All Users', 'refadm:browse:1').row()
    .text('◀ Back', 'admin:referral');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

// ── Search prompt ───────────────────────────────────────────────
composer.callbackQuery('refadm:search_prompt', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.set(ctx.chat.id, { step: 'manage_search' });

  const text =
    `🔍 <b>Search User</b>\n\n` +
    `Type a <b>Name</b>, <b>@username</b>, or <b>User ID</b>:\n\n` +
    `<i>Matching results will be shown as buttons.</i>`;
  const kb = new InlineKeyboard()
    .text('📋 Browse All', 'refadm:browse:1').row()
    .text('◀ Back', 'refadm:manage');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

// ── Browse all users (paginated) ────────────────────────────────
composer.callbackQuery(/^refadm:browse:(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.delete(ctx.chat.id);
  const pool = ctx.dbPool;
  const page = parseInt(ctx.match[1]) || 1;
  const perPage = 10;
  const offset = (page - 1) * perPage;

  const [dataRes, countRes] = await Promise.all([
    pool.query('SELECT user_id, full_name, username FROM users ORDER BY first_seen DESC LIMIT $1 OFFSET $2', [perPage, offset]),
    pool.query('SELECT COUNT(*)::int AS total FROM users'),
  ]);
  const users = dataRes.rows;
  const total = countRes.rows[0].total;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  if (!users.length) {
    const kb = new InlineKeyboard().text('◀ Back', 'refadm:manage');
    try { await ctx.editMessageText('📋 No users found.', { reply_markup: kb }); } catch {}
    return;
  }

  let text = `📋 <b>All Users</b> (${formatNumber(total)} total)\n`;
  text += `<i>Page ${page} of ${totalPages} — Tap to view referral details</i>\n\n`;

  const kb = new InlineKeyboard();
  for (const u of users) {
    const name = escapeHtml(u.full_name || 'N/A');
    const uname = u.username ? ` @${escapeHtml(u.username)}` : '';
    text += `┃ <code>${u.user_id}</code> | ${name}${uname}\n`;
    const shortName = (u.full_name || 'N/A').slice(0, 20);
    kb.text(`👁 ${shortName} (${u.user_id})`, `refadm:profile:${u.user_id}`).row();
  }

  // Pagination
  if (page > 1) kb.text('◀ Prev', `refadm:browse:${page - 1}`);
  kb.text(`${page}/${totalPages}`, 'noop');
  if (page < totalPages) kb.text('Next ▶', `refadm:browse:${page + 1}`);
  kb.row().text('🔍 Search', 'refadm:search_prompt').text('◀ Back', 'refadm:manage');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

/** Search users by name, username, or user ID */
async function searchUsers(pool, query, limit = 8) {
  const numericId = parseInt(query);
  if (!isNaN(numericId) && String(numericId) === query) {
    const { rows } = await pool.query(
      'SELECT user_id, full_name, username FROM users WHERE user_id = $1 LIMIT 1',
      [numericId]
    );
    return rows;
  }

  const cleanQuery = query.replace('@', '');
  const pattern = `%${cleanQuery}%`;
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
      .text('🔍 Search Again', 'refadm:search_prompt')
      .text('📋 Browse All', 'refadm:browse:1').row()
      .text('◀ Back', 'refadm:manage');
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
    return;
  }

  let text = `🔍 <b>Search Results</b> for "${escapeHtml(query)}":\n\n`;
  const kb = new InlineKeyboard();

  for (const r of results) {
    const name = escapeHtml(r.full_name || 'Unknown');
    const uname = r.username ? ` @${escapeHtml(r.username)}` : '';
    text += `👤 ${name}${uname} — <code>${r.user_id}</code>\n`;
    const shortName = (r.full_name || 'Unknown').slice(0, 20);
    kb.text(`👁 ${shortName} (${r.user_id})`, `refadm:profile:${r.user_id}`).row();
  }

  kb.text('🔍 Search Again', 'refadm:search_prompt').text('◀ Back', 'refadm:manage');
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
 */
async function showUserReferralProfile(ctx, userId) {
  const pool = ctx.dbPool;
  const user = await userRepo.getUser(pool, userId);
  if (!user) {
    await ctx.reply('⚠️ User not found.', {
      reply_markup: new InlineKeyboard().text('🔍 Search Again', 'refadm:search_prompt').text('◀ Back', 'refadm:manage')
    });
    return;
  }

  const userName = escapeHtml(user.full_name || 'Unknown');
  const stats = await referralRepo.getUserReferralStats(pool, userId);
  const referrals = await referralRepo.getReferralsByUser(pool, userId, 20, 0);

  let text = `👤 <b>Referrals for</b> <code>${userId}</code> (${userName})\n\n`;

  if (user.referred_by) {
    const referrer = await userRepo.getUser(pool, user.referred_by);
    const refName = referrer ? escapeHtml(referrer.full_name || 'Unknown') : 'Unknown';
    text += `🔗 <b>Referred by:</b> ${user.referred_by} (${refName})\n\n`;
  } else {
    text += `🔗 <b>Referred by:</b> None\n\n`;
  }

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

  const kb = new InlineKeyboard();

  if (user.referred_by) {
    kb.text(`🗑 Remove referrer (${user.referred_by}) — let user re-refer`, `refadm:rmref:${userId}:${user.referred_by}`).row();
  }

  for (const r of referrals) {
    const name = escapeHtml(r.full_name || r.username || 'Unknown');
    kb.text(`🗑 Remove ${name} (${r.user_id})`, `refadm:rmone:${userId}:${r.user_id}`).row();
  }

  if (referrals.length > 0) {
    kb.text('❌ Remove ALL outgoing referrals (reset)', `refadm:rmall_confirm:${userId}`).row();
  }

  kb.text('◀ Back', 'refadm:manage');
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

// ── Remove referrer ─────────────────────────────────────────────
composer.callbackQuery(/^refadm:rmref:(\d+):(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const userId = parseInt(ctx.match[1]);
  const referrerId = parseInt(ctx.match[2]);
  await ctx.dbPool.query('UPDATE users SET referred_by = NULL WHERE user_id = $1', [userId]);
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
  await ctx.dbPool.query('UPDATE users SET referred_by = NULL WHERE user_id = $1 AND referred_by = $2', [referredId, referrerId]);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.REFERRAL_REVERSED,
    { action: 'remove_single_referral', referrer_id: referrerId, referred_id: referredId });
  try { await ctx.answerCallbackQuery({ text: `✅ Removed referral for ${referredId}`, show_alert: true }); } catch {}
  await showUserReferralProfile(ctx, referrerId);
});

// ── Remove ALL outgoing referrals ───────────────────────────────
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
    .text('❌ Cancel', 'refadm:manage');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

composer.callbackQuery(/^refadm:rmall_exec:(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const userId = parseInt(ctx.match[1]);
  const { rowCount } = await ctx.dbPool.query('UPDATE users SET referred_by = NULL WHERE referred_by = $1', [userId]);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.REFERRAL_REVERSED,
    { action: 'remove_all_referrals', target_user_id: userId, removed_count: rowCount });
  const text = `✅ Removed <b>${rowCount}</b> referral(s) from user ${userId}.`;
  const kb = new InlineKeyboard().text('🔍 Search Again', 'refadm:search_prompt').text('◀ Back', 'refadm:manage');
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

// ═══════════════════════════════════════════════════════════════════
//  ANALYTICS
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('refadm:analytics', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.delete(ctx.chat.id);
  const stats = await referralRepo.getAnalytics(ctx.dbPool);

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

  // ── Edit Telegraph author name ──
  if (state.step === 'edit_telegraph_name') {
    if (input.length < 1 || input.length > 100) {
      await ctx.reply('⚠️ Name must be between 1 and 100 characters:');
      return;
    }
    await settingsRepo.setSetting(pool, 'telegraph_author_name', input, ctx.from.id);
    ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED,
      { action: 'telegraph_author_name', name: input });
    states.delete(ctx.chat.id);

    // Auto-regenerate pages with new author name
    try {
      await regeneratePages(pool);
      await ctx.reply(`✅ Author name set to "${escapeHtml(input)}"\n📜 Telegraph pages regenerated!`, {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('◀ Back', 'refadm:condition')
      });
    } catch {
      await ctx.reply(`✅ Author name set to "${escapeHtml(input)}"\n⚠️ Page regeneration failed — try "Regenerate" manually.`, {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('◀ Back', 'refadm:condition')
      });
    }
    return;
  }

  // ── Manage: Search users ──
  if (state.step === 'manage_search') {
    if (input.length < 1) {
      await ctx.reply('⚠️ Please enter at least 1 character to search:');
      return;
    }

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
