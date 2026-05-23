// ═══════════════════════════════════════════════════════════════════
//  🎁 REFERRAL ADMIN PANEL — Full button-based management
//
//  Dashboard, commission control, transfer rules, analytics,
//  leaderboard, reward logs, fraud control, manual actions, user lookup.
// ═══════════════════════════════════════════════════════════════════

import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import * as referralRepo from '../database/repositories/referralRepo.js';
import * as userRepo from '../database/repositories/userRepo.js';
import { escapeHtml, formatNumber } from '../utils/formatters.js';
import { registerAdminState } from '../utils/adminStates.js';
import { ActionType } from '../utils/constants.js';
import logger from '../utils/logger.js';

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
  const minTransfer = parseFloat(await settingsRepo.getSetting(pool, 'referral_min_transfer')) || 50;
  const transferEnabled = await settingsRepo.getSetting(pool, 'referral_transfer_enabled');
  const dailyLimit = parseFloat(await settingsRepo.getSetting(pool, 'referral_daily_transfer_limit')) || 5000;
  const monthlyLimit = parseFloat(await settingsRepo.getSetting(pool, 'referral_monthly_transfer_limit')) || 50000;

  const onoff = enabled ? '🟢 ON' : '🔴 OFF';
  const toggleBtn = enabled ? '🔴 Turn OFF' : '🟢 Turn ON';
  const transferStatus = transferEnabled ? '🟢 Enabled' : '🔴 Disabled';

  let text =
    `🎁 <b>Referral System</b>  ${onoff}\n\n` +
    `<blockquote>` +
    `💰 <b>Commission:</b> ${commPct}%\n` +
    `🔑 <b>Code Prefix:</b> ${escapeHtml(prefix)}\n` +
    `💳 <b>Transfer:</b> ${transferStatus}\n` +
    `📌 <b>Min Transfer:</b> ₹${formatNumber(minTransfer)}\n` +
    `📅 <b>Daily Limit:</b> ₹${formatNumber(dailyLimit)}\n` +
    `📆 <b>Monthly Limit:</b> ₹${formatNumber(monthlyLimit)}` +
    `</blockquote>`;

  const kb = new InlineKeyboard()
    .text(toggleBtn, 'refadm:toggle').text(`💰 Commission: ${commPct}%`, 'refadm:commission').row()
    .text('🔑 Code Prefix', 'refadm:prefix').text('📜 Terms', 'refadm:terms').row()
    .text('💳 Transfer Rules', 'refadm:transfer').text('📊 Analytics', 'refadm:analytics').row()
    .text('🏆 Top Referrers', 'refadm:top').text('📋 Reward Logs', 'refadm:logs:1').row()
    .text('🚨 Fraud Control', 'refadm:fraud').text('🔧 Manual Actions', 'refadm:manual').row()
    .text('🔍 User Lookup', 'refadm:lookup').row()
    .text('◀ Back', 'admin:back');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
}

// ═══════════════════════════════════════════════════════════════════
//  TOGGLE
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('refadm:toggle', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const cur = await settingsRepo.getSetting(ctx.dbPool, 'referral_enabled');
  await settingsRepo.setSetting(ctx.dbPool, 'referral_enabled', !cur, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED,
    { action: 'referral_toggle', enabled: !cur });
  await showDashboard(ctx);
});

// ═══════════════════════════════════════════════════════════════════
//  COMMISSION
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('refadm:commission', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const cur = parseFloat(await settingsRepo.getSetting(ctx.dbPool, 'referral_commission_pct')) || 10;

  const text =
    `💰 <b>Set Commission Percentage</b>\n\n` +
    `Current: <b>${cur}%</b>\n\n` +
    `<i>Tap a percentage or enter custom:</i>`;

  const kb = new InlineKeyboard()
    .text('1%', 'refadm:setpct:1').text('2%', 'refadm:setpct:2').text('3%', 'refadm:setpct:3').row()
    .text('5%', 'refadm:setpct:5').text('7%', 'refadm:setpct:7').text('10%', 'refadm:setpct:10').row()
    .text('12%', 'refadm:setpct:12').text('15%', 'refadm:setpct:15').text('20%', 'refadm:setpct:20').row()
    .text('✏️ Custom %', 'refadm:custompct').row()
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
//  CODE PREFIX
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('refadm:prefix', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const cur = await settingsRepo.getSetting(ctx.dbPool, 'referral_code_prefix') || 'ERRORRO';
  const text =
    `🔑 <b>Set Code Prefix</b>\n\n` +
    `Current: <b>${escapeHtml(cur)}</b>\n` +
    `Example: <code>${escapeHtml(cur)}-A1B2C3D4</code>\n\n` +
    `<i>Type the new prefix (letters/numbers only, max 15 chars):</i>`;
  states.set(ctx.chat.id, { step: 'set_prefix' });
  const kb = new InlineKeyboard().text('❌ Cancel', 'admin:referral');
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
});

// ═══════════════════════════════════════════════════════════════════
//  TERMS EDITOR
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('refadm:terms', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const cur = await settingsRepo.getSetting(ctx.dbPool, 'referral_terms') || '';
  const text =
    `📜 <b>Edit Referral Terms</b>\n\n` +
    `<b>Current Terms:</b>\n${cur || '<i>(not set)</i>'}\n\n` +
    `<i>Type the new terms text below (HTML supported):</i>`;
  states.set(ctx.chat.id, { step: 'set_terms' });
  const kb = new InlineKeyboard().text('❌ Cancel', 'admin:referral');
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
});

// ═══════════════════════════════════════════════════════════════════
//  TRANSFER RULES
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('refadm:transfer', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await showTransferRules(ctx);
});

async function showTransferRules(ctx) {
  const pool = ctx.dbPool;
  const transferEnabled = await settingsRepo.getSetting(pool, 'referral_transfer_enabled');
  const minTransfer = parseFloat(await settingsRepo.getSetting(pool, 'referral_min_transfer')) || 50;
  const dailyLimit = parseFloat(await settingsRepo.getSetting(pool, 'referral_daily_transfer_limit')) || 5000;
  const monthlyLimit = parseFloat(await settingsRepo.getSetting(pool, 'referral_monthly_transfer_limit')) || 50000;

  const toggleBtn = transferEnabled ? '🔴 Disable Transfers' : '🟢 Enable Transfers';

  const text =
    `💳 <b>Transfer Rules</b>\n\n` +
    `<blockquote>` +
    `📌 <b>Status:</b> ${transferEnabled ? '🟢 Enabled' : '🔴 Disabled'}\n` +
    `💰 <b>Min Transfer:</b> ₹${formatNumber(minTransfer)}\n` +
    `📅 <b>Daily Limit:</b> ₹${formatNumber(dailyLimit)}\n` +
    `📆 <b>Monthly Limit:</b> ₹${formatNumber(monthlyLimit)}` +
    `</blockquote>`;

  const kb = new InlineKeyboard()
    .text(toggleBtn, 'refadm:transfer_toggle').row()
    .text(`📌 Min: ₹${formatNumber(minTransfer)}`, 'refadm:set_min').row()
    .text(`📅 Daily: ₹${formatNumber(dailyLimit)}`, 'refadm:set_daily').row()
    .text(`📆 Monthly: ₹${formatNumber(monthlyLimit)}`, 'refadm:set_monthly').row()
    .text('◀ Back', 'admin:referral');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
}

composer.callbackQuery('refadm:transfer_toggle', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const cur = await settingsRepo.getSetting(ctx.dbPool, 'referral_transfer_enabled');
  await settingsRepo.setSetting(ctx.dbPool, 'referral_transfer_enabled', !cur, ctx.from.id);
  await showTransferRules(ctx);
});

// ── Min transfer presets ──
composer.callbackQuery('refadm:set_min', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const cur = parseFloat(await settingsRepo.getSetting(ctx.dbPool, 'referral_min_transfer')) || 50;
  const text = `📌 <b>Set Minimum Transfer</b>\n\nCurrent: ₹${formatNumber(cur)}\n\n<i>Tap an amount or enter custom:</i>`;
  const kb = new InlineKeyboard()
    .text('₹10', 'refadm:minval:10').text('₹25', 'refadm:minval:25').text('₹50', 'refadm:minval:50').row()
    .text('₹100', 'refadm:minval:100').text('₹200', 'refadm:minval:200').text('₹500', 'refadm:minval:500').row()
    .text('✏️ Custom', 'refadm:custommin').row()
    .text('◀ Back', 'refadm:transfer');
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
});

composer.callbackQuery(/^refadm:minval:(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await settingsRepo.setSetting(ctx.dbPool, 'referral_min_transfer', parseInt(ctx.match[1]), ctx.from.id);
  await showTransferRules(ctx);
});

composer.callbackQuery('refadm:custommin', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.set(ctx.chat.id, { step: 'custom_min_transfer' });
  const kb = new InlineKeyboard().text('❌ Cancel', 'refadm:transfer');
  try { await ctx.editMessageText('✏️ Type the minimum transfer amount (₹):', { reply_markup: kb }); } catch {}
});

// ── Daily limit presets ──
composer.callbackQuery('refadm:set_daily', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const cur = parseFloat(await settingsRepo.getSetting(ctx.dbPool, 'referral_daily_transfer_limit')) || 5000;
  const text = `📅 <b>Set Daily Transfer Limit</b>\n\nCurrent: ₹${formatNumber(cur)}\n\n<i>Tap an amount or enter custom:</i>`;
  const kb = new InlineKeyboard()
    .text('₹1,000', 'refadm:dailyval:1000').text('₹2,000', 'refadm:dailyval:2000').row()
    .text('₹5,000', 'refadm:dailyval:5000').text('₹10,000', 'refadm:dailyval:10000').row()
    .text('₹25,000', 'refadm:dailyval:25000').text('₹50,000', 'refadm:dailyval:50000').row()
    .text('✏️ Custom', 'refadm:customdaily').row()
    .text('◀ Back', 'refadm:transfer');
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
});

composer.callbackQuery(/^refadm:dailyval:(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await settingsRepo.setSetting(ctx.dbPool, 'referral_daily_transfer_limit', parseInt(ctx.match[1]), ctx.from.id);
  await showTransferRules(ctx);
});

composer.callbackQuery('refadm:customdaily', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.set(ctx.chat.id, { step: 'custom_daily_limit' });
  const kb = new InlineKeyboard().text('❌ Cancel', 'refadm:transfer');
  try { await ctx.editMessageText('✏️ Type the daily transfer limit (₹):', { reply_markup: kb }); } catch {}
});

// ── Monthly limit presets ──
composer.callbackQuery('refadm:set_monthly', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const cur = parseFloat(await settingsRepo.getSetting(ctx.dbPool, 'referral_monthly_transfer_limit')) || 50000;
  const text = `📆 <b>Set Monthly Transfer Limit</b>\n\nCurrent: ₹${formatNumber(cur)}\n\n<i>Tap an amount or enter custom:</i>`;
  const kb = new InlineKeyboard()
    .text('₹10,000', 'refadm:monthval:10000').text('₹25,000', 'refadm:monthval:25000').row()
    .text('₹50,000', 'refadm:monthval:50000').text('₹1,00,000', 'refadm:monthval:100000').row()
    .text('₹2,50,000', 'refadm:monthval:250000').text('₹5,00,000', 'refadm:monthval:500000').row()
    .text('✏️ Custom', 'refadm:custommonth').row()
    .text('◀ Back', 'refadm:transfer');
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
});

composer.callbackQuery(/^refadm:monthval:(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await settingsRepo.setSetting(ctx.dbPool, 'referral_monthly_transfer_limit', parseInt(ctx.match[1]), ctx.from.id);
  await showTransferRules(ctx);
});

composer.callbackQuery('refadm:custommonth', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.set(ctx.chat.id, { step: 'custom_monthly_limit' });
  const kb = new InlineKeyboard().text('❌ Cancel', 'refadm:transfer');
  try { await ctx.editMessageText('✏️ Type the monthly transfer limit (₹):', { reply_markup: kb }); } catch {}
});

// ═══════════════════════════════════════════════════════════════════
//  ANALYTICS
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('refadm:analytics', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const stats = await referralRepo.getAnalytics(pool);

  const text =
    `📊 <b>Referral Analytics</b>\n\n` +
    `<blockquote>` +
    `👥 <b>Total Referrals:</b> ${formatNumber(stats.totalReferrals)}\n` +
    `🔥 <b>Active Referrers:</b> ${formatNumber(stats.activeReferrers)}\n` +
    `💰 <b>Total Rewards:</b> ₹${formatNumber(stats.totalRewardsDistributed)}\n` +
    `💳 <b>Total Transfers:</b> ₹${formatNumber(stats.totalTransfers)}` +
    `</blockquote>\n\n` +
    `━━━ <b>Reward Activity</b> ━━━\n\n` +
    `📅 <b>Today:</b> ${formatNumber(stats.rewardsToday)} rewards\n` +
    `📆 <b>This Week:</b> ${formatNumber(stats.rewardsThisWeek)} rewards\n` +
    `📆 <b>This Month:</b> ${formatNumber(stats.rewardsThisMonth)} rewards\n\n` +
    `━━━ <b>Alerts</b> ━━━\n\n` +
    `⏸ <b>Frozen Rewards:</b> ${formatNumber(stats.frozenRewards)}\n` +
    `🚨 <b>Fraud Flags:</b> ${formatNumber(stats.unresolvedFraudFlags)}`;

  const kb = new InlineKeyboard()
    .text('🔄 Refresh', 'refadm:analytics').row()
    .text('◀ Back', 'admin:referral');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

// ═══════════════════════════════════════════════════════════════════
//  TOP REFERRERS
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('refadm:top', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const topRefs = await referralRepo.getTopReferrers(pool, 15);

  if (topRefs.length === 0) {
    const text = `🏆 <b>Top Referrers</b>\n\n<i>No referrers yet.</i>`;
    const kb = new InlineKeyboard().text('◀ Back', 'admin:referral');
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  let text = `🏆 <b>Top Referrers</b>\n\n`;

  for (let i = 0; i < topRefs.length; i++) {
    const r = topRefs[i];
    const rank = i < 3 ? medals[i] : `#${i + 1}`;
    const name = escapeHtml(r.full_name || r.username || 'Unknown');
    text += `${rank}  <b>${name}</b> [<code>${r.user_id}</code>]\n`;
    text += `    👥 ${r.referral_count}  •  ₹${formatNumber(r.total_earned)} earned  •  ₹${formatNumber(r.balance)} balance\n\n`;
  }

  const kb = new InlineKeyboard()
    .text('🔄 Refresh', 'refadm:top').row()
    .text('◀ Back', 'admin:referral');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

// ═══════════════════════════════════════════════════════════════════
//  REWARD LOGS (Paginated)
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery(/^refadm:logs:(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const page = parseInt(ctx.match[1]) || 1;
  const { logs, total, perPage } = await referralRepo.getRewardLogs(pool, page, 8);
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  if (total === 0) {
    const text = `📋 <b>Reward Logs</b>\n\n<i>No rewards recorded yet.</i>`;
    const kb = new InlineKeyboard().text('◀ Back', 'admin:referral');
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
    return;
  }

  let text = `📋 <b>Reward Logs</b>  (${formatNumber(total)} total)\n\n`;

  for (const r of logs) {
    const status = r.status === 'credited' ? '✅' : r.status === 'reversed' ? '❌' : r.status === 'frozen' ? '⏸' : '⏳';
    const date = new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    text += `${status} ₹${formatNumber(r.reward_amount)}  ${escapeHtml(r.referrer_name || 'Unknown')} ← ${escapeHtml(r.referred_name || 'Unknown')}\n`;
    text += `   <i>${r.tag} • ${date}</i>\n`;
    text += `   ID: <code>${r.id}</code>  Order: <code>${r.order_id}</code>\n\n`;
  }

  text += `📄 Page ${page}/${totalPages}`;

  const kb = new InlineKeyboard();
  if (page > 1) kb.text('◀ Prev', `refadm:logs:${page - 1}`);
  kb.text(`${page}/${totalPages}`, 'noop');
  if (page < totalPages) kb.text('Next ▶', `refadm:logs:${page + 1}`);
  kb.row().text('🔄 Refresh', `refadm:logs:${page}`);
  kb.row().text('◀ Back', 'admin:referral');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

// ── Reward detail + reverse/freeze ──
composer.callbackQuery(/^refadm:reward:(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.match[1]);
  const reward = await referralRepo.getRewardById(ctx.dbPool, id);
  if (!reward) {
    try { await ctx.editMessageText('⚠️ Reward not found.', { reply_markup: new InlineKeyboard().text('◀ Back', 'refadm:logs:1') }); } catch {}
    return;
  }

  const date = new Date(reward.created_at).toLocaleString('en-IN');
  const text =
    `📋 <b>Reward Detail</b>\n\n` +
    `<blockquote>` +
    `🆔 <b>ID:</b> ${reward.id}\n` +
    `📊 <b>Status:</b> ${reward.status}\n` +
    `💰 <b>Amount:</b> ₹${formatNumber(reward.reward_amount)}\n` +
    `📈 <b>Commission:</b> ${reward.commission_pct}%\n` +
    `💵 <b>Deposit:</b> ₹${formatNumber(reward.deposit_amount)}\n` +
    `👤 <b>Referrer:</b> ${escapeHtml(reward.referrer_name || '')} [${reward.referrer_id}]\n` +
    `👥 <b>Referred:</b> ${escapeHtml(reward.referred_name || '')} [${reward.referred_id}]\n` +
    `📋 <b>Order:</b> <code>${reward.order_id}</code>\n` +
    `🏷 <b>Tag:</b> ${escapeHtml(reward.tag)}\n` +
    `📅 <b>Date:</b> ${date}` +
    `</blockquote>`;

  const kb = new InlineKeyboard();
  if (reward.status === 'credited') {
    kb.text('❌ Reverse Reward', `refadm:reverse:${id}`).row();
    kb.text('⏸ Freeze Reward', `refadm:freeze_reward:${id}`).row();
  }
  kb.text('◀ Back', 'refadm:logs:1');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

composer.callbackQuery(/^refadm:reverse:(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.match[1]);
  const result = await referralRepo.reverseReward(ctx.dbPool, id, ctx.from.id);
  if (result) {
    ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.REFERRAL_REVERSED,
      { reward_id: id, amount: result.reward_amount, referrer_id: result.referrer_id });
    try { await ctx.editMessageText(`✅ Reward #${id} reversed. ₹${formatNumber(result.reward_amount)} deducted.`, {
      parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('◀ Back', 'refadm:logs:1')
    }); } catch {}
  } else {
    try { await ctx.editMessageText('⚠️ Could not reverse (already reversed or not found).', {
      reply_markup: new InlineKeyboard().text('◀ Back', 'refadm:logs:1')
    }); } catch {}
  }
});

composer.callbackQuery(/^refadm:freeze_reward:(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.match[1]);
  const result = await referralRepo.freezeReward(ctx.dbPool, id, ctx.from.id);
  if (result) {
    try { await ctx.editMessageText(`⏸ Reward #${id} frozen.`, {
      reply_markup: new InlineKeyboard().text('◀ Back', 'refadm:logs:1')
    }); } catch {}
  } else {
    try { await ctx.editMessageText('⚠️ Could not freeze.', {
      reply_markup: new InlineKeyboard().text('◀ Back', 'refadm:logs:1')
    }); } catch {}
  }
});

// ═══════════════════════════════════════════════════════════════════
//  FRAUD CONTROL
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('refadm:fraud', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const flags = await referralRepo.getSuspiciousUsers(pool);

  if (flags.length === 0) {
    const text = `🚨 <b>Fraud Control</b>\n\n✅ <i>No suspicious activity detected.</i>`;
    const kb = new InlineKeyboard().text('🔄 Refresh', 'refadm:fraud').text('◀ Back', 'admin:referral');
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
    return;
  }

  let text = `🚨 <b>Fraud Control</b>  (${flags.length} unresolved)\n\n`;
  const kb = new InlineKeyboard();
  for (const f of flags.slice(0, 10)) {
    const name = escapeHtml(f.full_name || f.username || 'Unknown');
    text += `⚠️ <b>${name}</b> [<code>${f.user_id}</code>]\n`;
    text += `   ${f.flag_type} — ${new Date(f.created_at).toLocaleDateString('en-IN')}\n\n`;
    kb.text(`✅ Resolve #${f.id}`, `refadm:resolve_flag:${f.id}`).text(`🧊 Freeze`, `refadm:freeze_wallet:${f.user_id}`).row();
  }
  kb.text('🔄 Refresh', 'refadm:fraud').text('◀ Back', 'admin:referral');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

composer.callbackQuery(/^refadm:resolve_flag:(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await referralRepo.resolveFraudFlag(ctx.dbPool, parseInt(ctx.match[1]), ctx.from.id);
  // Re-render fraud panel by dispatching
  const flags = await referralRepo.getSuspiciousUsers(ctx.dbPool);
  if (flags.length === 0) {
    try { await ctx.editMessageText('🚨 <b>Fraud Control</b>\n\n✅ All flags resolved!', {
      parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('◀ Back', 'admin:referral')
    }); } catch {}
  } else {
    let text = `🚨 <b>Fraud Control</b>  (${flags.length} unresolved)\n\n`;
    const kb = new InlineKeyboard();
    for (const f of flags.slice(0, 10)) {
      text += `⚠️ <b>${escapeHtml(f.full_name || 'Unknown')}</b> [<code>${f.user_id}</code>]\n   ${f.flag_type}\n\n`;
      kb.text(`✅ #${f.id}`, `refadm:resolve_flag:${f.id}`).text(`🧊`, `refadm:freeze_wallet:${f.user_id}`).row();
    }
    kb.text('◀ Back', 'admin:referral');
    try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
  }
});

composer.callbackQuery(/^refadm:freeze_wallet:(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const userId = parseInt(ctx.match[1]);
  await referralRepo.freezeWallet(ctx.dbPool, userId);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.REFERRAL_FRAUD,
    { action: 'freeze_wallet', target_user_id: userId });
  try { await ctx.answerCallbackQuery({ text: `🧊 Wallet frozen for ${userId}`, show_alert: true }); } catch {}
});

composer.callbackQuery(/^refadm:unfreeze_wallet:(\d+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const userId = parseInt(ctx.match[1]);
  await referralRepo.unfreezeWallet(ctx.dbPool, userId);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.REFERRAL_FRAUD,
    { action: 'unfreeze_wallet', target_user_id: userId });
  try { await ctx.answerCallbackQuery({ text: `✅ Wallet unfrozen for ${userId}`, show_alert: true }); } catch {}
});

// ═══════════════════════════════════════════════════════════════════
//  MANUAL ACTIONS
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('refadm:manual', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const text =
    `🔧 <b>Manual Actions</b>\n\n` +
    `<blockquote>` +
    `➕ <b>Add Reward</b> — Manually credit a user's referral wallet\n` +
    `➖ <b>Deduct Reward</b> — Manually deduct from referral wallet` +
    `</blockquote>`;

  const kb = new InlineKeyboard()
    .text('➕ Add Reward', 'refadm:manual_add').row()
    .text('➖ Deduct Reward', 'refadm:manual_deduct').row()
    .text('◀ Back', 'admin:referral');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

composer.callbackQuery('refadm:manual_add', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.set(ctx.chat.id, { step: 'manual_add_userid' });
  const kb = new InlineKeyboard().text('❌ Cancel', 'refadm:manual');
  try { await ctx.editMessageText('➕ <b>Add Reward</b>\n\nType the user ID:', { parse_mode: 'HTML', reply_markup: kb }); } catch {}
});

composer.callbackQuery('refadm:manual_deduct', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.set(ctx.chat.id, { step: 'manual_deduct_userid' });
  const kb = new InlineKeyboard().text('❌ Cancel', 'refadm:manual');
  try { await ctx.editMessageText('➖ <b>Deduct Reward</b>\n\nType the user ID:', { parse_mode: 'HTML', reply_markup: kb }); } catch {}
});

// Confirm manual add/deduct
composer.callbackQuery(/^refadm:confirm_add:(\d+):(.+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const userId = parseInt(ctx.match[1]);
  const amount = parseFloat(ctx.match[2]);
  try {
    await referralRepo.adminAddReward(ctx.dbPool, userId, amount, 'Admin Bonus', `Added by admin ${ctx.from.id}`, ctx.from.id);
    ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.REFERRAL_REWARD,
      { action: 'manual_add', target_user_id: userId, amount });
    try { await ctx.editMessageText(`✅ ₹${formatNumber(amount)} added to user ${userId}'s referral wallet.`, {
      parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('◀ Back', 'refadm:manual')
    }); } catch {}
  } catch (err) {
    try { await ctx.editMessageText(`❌ Failed: ${err.message}`, {
      reply_markup: new InlineKeyboard().text('◀ Back', 'refadm:manual')
    }); } catch {}
  }
  states.delete(ctx.chat.id);
});

composer.callbackQuery(/^refadm:confirm_deduct:(\d+):(.+)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const userId = parseInt(ctx.match[1]);
  const amount = parseFloat(ctx.match[2]);
  try {
    await referralRepo.adminDeductReward(ctx.dbPool, userId, amount, 'Admin Deduction', `Deducted by admin ${ctx.from.id}`, ctx.from.id);
    ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.REFERRAL_REVERSED,
      { action: 'manual_deduct', target_user_id: userId, amount });
    try { await ctx.editMessageText(`✅ ₹${formatNumber(amount)} deducted from user ${userId}'s referral wallet.`, {
      parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('◀ Back', 'refadm:manual')
    }); } catch {}
  } catch (err) {
    try { await ctx.editMessageText(`❌ Failed: ${err.message}`, {
      reply_markup: new InlineKeyboard().text('◀ Back', 'refadm:manual')
    }); } catch {}
  }
  states.delete(ctx.chat.id);
});

// ═══════════════════════════════════════════════════════════════════
//  USER LOOKUP
// ═══════════════════════════════════════════════════════════════════
composer.callbackQuery('refadm:lookup', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.set(ctx.chat.id, { step: 'user_lookup' });
  const kb = new InlineKeyboard().text('❌ Cancel', 'admin:referral');
  try { await ctx.editMessageText('🔍 <b>User Lookup</b>\n\nType the user ID to look up:', { parse_mode: 'HTML', reply_markup: kb }); } catch {}
});

async function showUserLookup(ctx, userId) {
  const pool = ctx.dbPool;
  const user = await userRepo.getUser(pool, userId);
  if (!user) {
    await ctx.reply('⚠️ User not found.', {
      reply_markup: new InlineKeyboard().text('◀ Back', 'admin:referral')
    });
    return;
  }

  const stats = await referralRepo.getUserReferralStats(pool, userId);
  const refCode = user.referral_code || 'N/A';
  const referrerName = user.referred_by ? (await userRepo.getUser(pool, user.referred_by))?.full_name || 'Unknown' : 'None';

  const text =
    `🔍 <b>User Referral Lookup</b>\n\n` +
    `<blockquote>` +
    `👤 <b>Name:</b> ${escapeHtml(user.full_name || 'N/A')}\n` +
    `🆔 <b>User ID:</b> <code>${userId}</code>\n` +
    `🔑 <b>Code:</b> <code>${refCode}</code>\n` +
    `👥 <b>Referred By:</b> ${escapeHtml(referrerName)}${user.referred_by ? ` [${user.referred_by}]` : ''}` +
    `</blockquote>\n\n` +
    `━━━ <b>Stats</b> ━━━\n\n` +
    `  👥  <b>Total Referrals:</b> ${formatNumber(stats.totalReferrals)}\n` +
    `  ✅  <b>Successful:</b> ${formatNumber(stats.successfulReferrals)}\n` +
    `  💰  <b>Total Earned:</b> ₹${formatNumber(stats.totalEarned)}\n` +
    `  💳  <b>Balance:</b> ₹${formatNumber(stats.wallet?.balance || 0)}\n` +
    `  💸  <b>Transferred:</b> ₹${formatNumber(stats.wallet?.total_transferred || 0)}\n` +
    `  🧊  <b>Frozen:</b> ${stats.wallet?.is_frozen ? '🔴 YES' : '🟢 No'}`;

  const kb = new InlineKeyboard();
  if (stats.wallet?.is_frozen) {
    kb.text('🔓 Unfreeze Wallet', `refadm:unfreeze_wallet:${userId}`).row();
  } else {
    kb.text('🧊 Freeze Wallet', `refadm:freeze_wallet:${userId}`).row();
  }
  kb.text('🔍 Search Another', 'refadm:lookup').text('◀ Back', 'admin:referral');

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

// ═══════════════════════════════════════════════════════════════════
//  TEXT INPUT HANDLER — All custom values
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

  // ── Code prefix ──
  if (state.step === 'set_prefix') {
    const cleaned = input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!cleaned || cleaned.length > 15) {
      await ctx.reply('⚠️ Prefix must be 1–15 alphanumeric characters:');
      return;
    }
    await settingsRepo.setSetting(pool, 'referral_code_prefix', cleaned, ctx.from.id);
    states.delete(ctx.chat.id);
    await ctx.reply(`✅ Prefix set to <b>${escapeHtml(cleaned)}</b>\n\n<i>New users will get codes like: ${escapeHtml(cleaned)}-A1B2C3D4</i>`, {
      parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('◀ Back', 'admin:referral')
    });
    return;
  }

  // ── Terms ──
  if (state.step === 'set_terms') {
    if (!input || input.length > 2000) {
      await ctx.reply('⚠️ Terms must be 1–2000 characters:');
      return;
    }
    await settingsRepo.setSetting(pool, 'referral_terms', input, ctx.from.id);
    states.delete(ctx.chat.id);
    await ctx.reply('✅ Referral terms updated!', {
      reply_markup: new InlineKeyboard().text('◀ Back', 'admin:referral')
    });
    return;
  }

  // ── Min transfer ──
  if (state.step === 'custom_min_transfer') {
    const num = parseFloat(input);
    if (isNaN(num) || num < 1) { await ctx.reply('⚠️ Enter a valid amount:'); return; }
    await settingsRepo.setSetting(pool, 'referral_min_transfer', num, ctx.from.id);
    states.delete(ctx.chat.id);
    await ctx.reply(`✅ Min transfer set to ₹${formatNumber(num)}`, {
      reply_markup: new InlineKeyboard().text('◀ Back', 'refadm:transfer')
    });
    return;
  }

  // ── Daily limit ──
  if (state.step === 'custom_daily_limit') {
    const num = parseFloat(input);
    if (isNaN(num) || num < 1) { await ctx.reply('⚠️ Enter a valid amount:'); return; }
    await settingsRepo.setSetting(pool, 'referral_daily_transfer_limit', num, ctx.from.id);
    states.delete(ctx.chat.id);
    await ctx.reply(`✅ Daily limit set to ₹${formatNumber(num)}`, {
      reply_markup: new InlineKeyboard().text('◀ Back', 'refadm:transfer')
    });
    return;
  }

  // ── Monthly limit ──
  if (state.step === 'custom_monthly_limit') {
    const num = parseFloat(input);
    if (isNaN(num) || num < 1) { await ctx.reply('⚠️ Enter a valid amount:'); return; }
    await settingsRepo.setSetting(pool, 'referral_monthly_transfer_limit', num, ctx.from.id);
    states.delete(ctx.chat.id);
    await ctx.reply(`✅ Monthly limit set to ₹${formatNumber(num)}`, {
      reply_markup: new InlineKeyboard().text('◀ Back', 'refadm:transfer')
    });
    return;
  }

  // ── Manual Add: User ID ──
  if (state.step === 'manual_add_userid') {
    const userId = parseInt(input);
    if (isNaN(userId)) { await ctx.reply('⚠️ Enter a valid user ID:'); return; }
    const user = await userRepo.getUser(pool, userId);
    if (!user) { await ctx.reply('⚠️ User not found. Try again:'); return; }
    state.step = 'manual_add_amount';
    state.targetUserId = userId;
    state.targetUserName = user.full_name;
    states.set(ctx.chat.id, state);
    await ctx.reply(`👤 User: <b>${escapeHtml(user.full_name || 'N/A')}</b> [${userId}]\n\nType the amount to add (₹):`, {
      parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'refadm:manual')
    });
    return;
  }

  if (state.step === 'manual_add_amount') {
    const amount = parseFloat(input);
    if (isNaN(amount) || amount <= 0) { await ctx.reply('⚠️ Enter a valid positive amount:'); return; }
    const text =
      `➕ <b>Confirm Add Reward</b>\n\n` +
      `<blockquote>` +
      `👤 <b>User:</b> ${escapeHtml(state.targetUserName || 'N/A')} [${state.targetUserId}]\n` +
      `💰 <b>Amount:</b> ₹${formatNumber(amount)}` +
      `</blockquote>\n\n` +
      `<i>Confirm?</i>`;
    const kb = new InlineKeyboard()
      .text('✅ Confirm', `refadm:confirm_add:${state.targetUserId}:${amount}`).row()
      .text('❌ Cancel', 'refadm:manual');
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
    return;
  }

  // ── Manual Deduct: User ID ──
  if (state.step === 'manual_deduct_userid') {
    const userId = parseInt(input);
    if (isNaN(userId)) { await ctx.reply('⚠️ Enter a valid user ID:'); return; }
    const user = await userRepo.getUser(pool, userId);
    if (!user) { await ctx.reply('⚠️ User not found. Try again:'); return; }
    state.step = 'manual_deduct_amount';
    state.targetUserId = userId;
    state.targetUserName = user.full_name;
    states.set(ctx.chat.id, state);
    const wallet = await referralRepo.getReferralWallet(pool, userId);
    const bal = wallet ? parseFloat(wallet.balance) : 0;
    await ctx.reply(`👤 User: <b>${escapeHtml(user.full_name || 'N/A')}</b> [${userId}]\n💳 Referral Balance: ₹${formatNumber(bal)}\n\nType the amount to deduct (₹):`, {
      parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'refadm:manual')
    });
    return;
  }

  if (state.step === 'manual_deduct_amount') {
    const amount = parseFloat(input);
    if (isNaN(amount) || amount <= 0) { await ctx.reply('⚠️ Enter a valid positive amount:'); return; }
    const text =
      `➖ <b>Confirm Deduction</b>\n\n` +
      `<blockquote>` +
      `👤 <b>User:</b> ${escapeHtml(state.targetUserName || 'N/A')} [${state.targetUserId}]\n` +
      `💰 <b>Amount:</b> ₹${formatNumber(amount)}` +
      `</blockquote>\n\n` +
      `<i>Confirm?</i>`;
    const kb = new InlineKeyboard()
      .text('✅ Confirm', `refadm:confirm_deduct:${state.targetUserId}:${amount}`).row()
      .text('❌ Cancel', 'refadm:manual');
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
    return;
  }

  // ── User Lookup ──
  if (state.step === 'user_lookup') {
    const userId = parseInt(input);
    if (isNaN(userId)) { await ctx.reply('⚠️ Enter a valid user ID:'); return; }
    states.delete(ctx.chat.id);
    await showUserLookup(ctx, userId);
    return;
  }

  return next();
});

export default composer;
