// ═══════════════════════════════════════════════════════════════════
//  💎 DEPOSIT BENEFITS — 100% Button-Based + Custom Fallback
//
//  Every value = button tap. Custom button → type ONE number.
//  Custom day period for loyalty (not just 30 days).
// ═══════════════════════════════════════════════════════════════════

import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import * as depositRulesRepo from '../database/repositories/depositRulesRepo.js';
import * as depositBenefitsService from '../services/depositBenefitsService.js';
import { escapeHtml, formatNumber } from '../utils/formatters.js';
import { registerAdminState } from '../utils/adminStates.js';
import { ActionType } from '../utils/constants.js';
import logger from '../utils/logger.js';

const composer = new Composer();
const states = new Map();
registerAdminState(states);

const ICONS = { tax: '💸', bonus: '🎁', loyalty_bonus: '🏆' };

// ── Plain-language helpers ──────────────────────────────────────

function describeRule(r) {
  const pct = parseFloat(r.percentage);
  const days = parseInt(r.rolling_period_days) || 30;
  if (r.rule_type === 'tax') {
    const max = parseFloat(r.max_deposit) || 0;
    return max > 0 ? `Deposits below ₹${formatNumber(max)} → ${pct}% tax` : `All deposits → ${pct}% tax`;
  }
  if (r.rule_type === 'bonus') {
    const min = parseFloat(r.min_deposit) || 0;
    return `Deposits ₹${formatNumber(min)}+ → ${pct}% bonus`;
  }
  const min = parseFloat(r.min_deposit) || 0;
  const rolling = parseFloat(r.rolling_30d_min) || 0;
  let desc = '';
  if (min > 0) desc += `Deposit ₹${formatNumber(min)}+ AND `;
  desc += `${days}-day total ₹${formatNumber(rolling)}+ → ${pct}% bonus`;
  return desc;
}

function exampleCalc(r) {
  const pct = parseFloat(r.percentage);
  if (r.rule_type === 'tax') {
    const max = parseFloat(r.max_deposit) || 100;
    const s = Math.min(50, max);
    const t = Math.round(s * pct / 100);
    return `₹${s} deposit → ₹${t} tax → Gets ₹${s - t}`;
  }
  if (r.rule_type === 'bonus') {
    const min = parseFloat(r.min_deposit) || 500;
    const s = Math.max(min, 100);
    const b = Math.round(s * pct / 100);
    return `₹${s} deposit → ₹${b} bonus → Gets ₹${s + b}`;
  }
  const min = parseFloat(r.min_deposit) || 100;
  const s = Math.max(min, 100);
  const b = Math.round(s * pct / 100);
  return `₹${s} deposit → ₹${b} bonus → Gets ₹${s + b}`;
}

// ═══════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery('admin:benefits', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.delete(ctx.chat.id);
  await showDashboard(ctx);
});

async function showDashboard(ctx) {
  const pool = ctx.dbPool;
  const enabled = await settingsRepo.getSetting(pool, 'deposit_benefits_enabled');
  const rules = await depositRulesRepo.getAllRules(pool);
  const onoff = enabled ? '🟢 ON' : '🔴 OFF';
  const toggleBtn = enabled ? '🔴 Turn OFF' : '🟢 Turn ON';
  const telegraphName = await settingsRepo.getSetting(pool, 'telegraph_author_name') || '';

  let text = `💎 <b>Deposit Benefits</b>  ${onoff}\n`;
  if (telegraphName) text += `📝 Telegraph Name: <b>${escapeHtml(telegraphName)}</b>\n`;

  if (rules.length === 0) {
    text += `\n<blockquote><b>What is this?</b>\n\n` +
      `Set automatic rules for deposits:\n` +
      `• 💸 Charge tax on small deposits\n` +
      `• 🎁 Give bonus on big deposits\n` +
      `• 🏆 Reward loyal users\n\n` +
      `Everything works with buttons!</blockquote>`;
  } else {
    text += `\n`;
    for (const r of rules) {
      const s = r.is_enabled ? '🟢' : '⚫';
      text += `${s} ${ICONS[r.rule_type]} ${describeRule(r)}\n`;
      text += `<i>   ${exampleCalc(r)}</i>\n\n`;
    }
  }

  const kb = new InlineKeyboard().text(toggleBtn, 'benefits:toggle').row()
    .text('➕ Add Rule', 'benefits:add').row();
  if (rules.length > 0) {
    kb.text('📋 Edit / Remove', 'benefits:manage').row();
    kb.text('🔮 Test', 'benefits:test').text('📊 Stats', 'benefits:stats').row();
  }
  kb.text('📝 Set Telegraph Name', 'benefits:set_author').row();
  kb.text('◀ Back', 'admin:back');
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
}

composer.callbackQuery('benefits:toggle', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const cur = await settingsRepo.getSetting(ctx.dbPool, 'deposit_benefits_enabled');
  await settingsRepo.setSetting(ctx.dbPool, 'deposit_benefits_enabled', !cur, ctx.from.id);
  await showDashboard(ctx);
});

// ── Set Telegraph Author Name ──
composer.callbackQuery('benefits:set_author', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const current = await settingsRepo.getSetting(ctx.dbPool, 'telegraph_author_name') || '';
  let text = `📝 <b>Set Telegraph Name</b>\n\n`;
  text += `<blockquote>This is <b>optional</b>. If you set a name here, it will be shown as the author on the Telegraph rules page instead of the default.\n\n`;
  text += `Current: <b>${current || '(not set — using default)'}</b></blockquote>\n\n`;
  text += `Type the name you want to show on Telegraph:`;
  states.set(ctx.chat.id, { step: 'set_telegraph_author' });
  const kb = new InlineKeyboard();
  if (current) kb.text('🗑 Remove Name', 'benefits:remove_author').row();
  kb.text('❌ Cancel', 'admin:benefits');
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

composer.callbackQuery('benefits:remove_author', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await settingsRepo.setSetting(ctx.dbPool, 'telegraph_author_name', '', ctx.from.id);
  // Regenerate Telegraph page with default name
  try {
    const { updateRulesPage } = await import('../services/telegraphService.js');
    await updateRulesPage(ctx.dbPool);
  } catch {}
  states.delete(ctx.chat.id);
  await showDashboard(ctx);
});

// ═══════════════════════════════════════════════════════════════════
//  ADD RULE WIZARD — All buttons + custom fallback
// ═══════════════════════════════════════════════════════════════════

// ── Step 1: Pick type ──

composer.callbackQuery('benefits:add', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.delete(ctx.chat.id);
  const text = `➕ <b>What do you want to do?</b>\n\n<blockquote>` +
    `💸 <b>Charge tax</b> on small deposits\n` +
    `🎁 <b>Give bonus</b> on big deposits\n` +
    `🏆 <b>Reward loyal</b> users</blockquote>`;
  const kb = new InlineKeyboard()
    .text('💸 Charge Tax', 'bwiz:type:tax').row()
    .text('🎁 Give Bonus', 'bwiz:type:bonus').row()
    .text('🏆 Reward Loyalty', 'bwiz:type:loyalty_bonus').row()
    .text('◀ Back', 'admin:benefits');
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

// ── Step 2: Pick amount ──

composer.callbackQuery(/^bwiz:type:/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const type = ctx.callbackQuery.data.replace('bwiz:type:', '');
  states.set(ctx.chat.id, { type });
  await showAmountStep(ctx, type);
});

async function showAmountStep(ctx, type) {
  let text, kb;
  if (type === 'tax') {
    text = `💸 <b>Tax deposits below which amount?</b>\n\n<i>Tap an amount or type your own:</i>`;
    kb = new InlineKeyboard()
      .text('Below ₹50', 'bwiz:amt1:50').text('Below ₹100', 'bwiz:amt1:100').row()
      .text('Below ₹200', 'bwiz:amt1:200').text('Below ₹500', 'bwiz:amt1:500').row()
      .text('Below ₹1000', 'bwiz:amt1:1000').text('Below ₹2000', 'bwiz:amt1:2000').row()
      .text('✏️ Custom Amount', 'bwiz:custom:amt1').row()
      .text('◀ Back', 'benefits:add');
  } else if (type === 'bonus') {
    text = `🎁 <b>Give bonus on deposits above?</b>\n\n<i>Minimum deposit to qualify:</i>`;
    kb = new InlineKeyboard()
      .text('₹100+', 'bwiz:amt1:100').text('₹200+', 'bwiz:amt1:200').row()
      .text('₹500+', 'bwiz:amt1:500').text('₹1000+', 'bwiz:amt1:1000').row()
      .text('₹2000+', 'bwiz:amt1:2000').text('₹5000+', 'bwiz:amt1:5000').row()
      .text('✏️ Custom Amount', 'bwiz:custom:amt1').row()
      .text('◀ Back', 'benefits:add');
  } else {
    text = `🏆 <b>Minimum single deposit to qualify?</b>\n\n<i>User must deposit at least this much:</i>`;
    kb = new InlineKeyboard()
      .text('Any Amount', 'bwiz:amt1:0').row()
      .text('₹50+', 'bwiz:amt1:50').text('₹100+', 'bwiz:amt1:100').row()
      .text('₹200+', 'bwiz:amt1:200').text('₹500+', 'bwiz:amt1:500').row()
      .text('₹1000+', 'bwiz:amt1:1000').text('₹2000+', 'bwiz:amt1:2000').row()
      .text('✏️ Custom Amount', 'bwiz:custom:amt1').row()
      .text('◀ Back', 'benefits:add');
  }
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
}

// Amount selected
composer.callbackQuery(/^bwiz:amt1:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const amt = parseInt(ctx.callbackQuery.data.replace('bwiz:amt1:', ''));
  const state = states.get(ctx.chat.id);
  if (!state) return;
  state.amount1 = amt;
  states.set(ctx.chat.id, state);

  if (state.type === 'loyalty_bonus') {
    await showDaysStep(ctx, state);
  } else {
    await showPctStep(ctx, state);
  }
});

// ── Step 3 (Loyalty): Pick day period ──

async function showDaysStep(ctx, state) {
  const minLabel = state.amount1 > 0 ? `₹${formatNumber(state.amount1)}+` : 'Any amount';
  const text =
    `🏆 <b>Check deposits in how many days?</b>\n\n` +
    `✅ Min deposit: <b>${minLabel}</b>\n\n` +
    `<i>How far back should we count deposits?</i>`;

  const kb = new InlineKeyboard()
    .text('7 Days', 'bwiz:days:7').text('15 Days', 'bwiz:days:15').row()
    .text('30 Days', 'bwiz:days:30').text('45 Days', 'bwiz:days:45').row()
    .text('60 Days', 'bwiz:days:60').text('90 Days', 'bwiz:days:90').row()
    .text('✏️ Custom Days', 'bwiz:custom:days').row()
    .text('◀ Back', `bwiz:type:loyalty_bonus`);

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
}

composer.callbackQuery(/^bwiz:days:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const days = parseInt(ctx.callbackQuery.data.replace('bwiz:days:', ''));
  const state = states.get(ctx.chat.id);
  if (!state) return;
  state.days = days;
  states.set(ctx.chat.id, state);
  await showRollingStep(ctx, state);
});

// ── Step 4 (Loyalty): Pick rolling total ──

async function showRollingStep(ctx, state) {
  const minLabel = state.amount1 > 0 ? `₹${formatNumber(state.amount1)}+` : 'Any';
  const text =
    `🏆 <b>Total deposit in ${state.days} days must be?</b>\n\n` +
    `✅ Min deposit: <b>${minLabel}</b>\n` +
    `✅ Period: <b>${state.days} days</b>\n\n` +
    `<i>User's total deposits in last ${state.days} days must be at least:</i>`;

  const kb = new InlineKeyboard()
    .text('₹500+', 'bwiz:roll:500').text('₹1000+', 'bwiz:roll:1000').row()
    .text('₹2000+', 'bwiz:roll:2000').text('₹3000+', 'bwiz:roll:3000').row()
    .text('₹5000+', 'bwiz:roll:5000').text('₹10000+', 'bwiz:roll:10000').row()
    .text('₹20000+', 'bwiz:roll:20000').text('₹50000+', 'bwiz:roll:50000').row()
    .text('✏️ Custom Amount', 'bwiz:custom:roll').row()
    .text('◀ Back', `bwiz:type:loyalty_bonus`);

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
}

composer.callbackQuery(/^bwiz:roll:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const rolling = parseInt(ctx.callbackQuery.data.replace('bwiz:roll:', ''));
  const state = states.get(ctx.chat.id);
  if (!state) return;
  state.rolling = rolling;
  states.set(ctx.chat.id, state);
  await showPctStep(ctx, state);
});

// ── Percentage step (all types) ──

async function showPctStep(ctx, state) {
  const icon = ICONS[state.type];
  let summary = '';
  if (state.type === 'tax') {
    summary = `Tax deposits below ₹${formatNumber(state.amount1)}`;
  } else if (state.type === 'bonus') {
    summary = `Bonus on deposits ₹${formatNumber(state.amount1)}+`;
  } else {
    const minLabel = state.amount1 > 0 ? `₹${formatNumber(state.amount1)}+` : 'Any';
    summary = `Min: ${minLabel} | ${state.days}-day total: ₹${formatNumber(state.rolling)}+`;
  }

  const label = state.type === 'tax' ? 'How much tax?' : 'How much bonus?';
  const text = `${icon} <b>${label}</b>\n\n✅ ${summary}\n\n<i>Tap the percentage:</i>`;

  const kb = new InlineKeyboard()
    .text('1%', 'bwiz:pct:1').text('2%', 'bwiz:pct:2').text('3%', 'bwiz:pct:3').row()
    .text('5%', 'bwiz:pct:5').text('7%', 'bwiz:pct:7').text('8%', 'bwiz:pct:8').row()
    .text('10%', 'bwiz:pct:10').text('12%', 'bwiz:pct:12').text('15%', 'bwiz:pct:15').row()
    .text('20%', 'bwiz:pct:20').text('25%', 'bwiz:pct:25').text('50%', 'bwiz:pct:50').row()
    .text('✏️ Custom %', 'bwiz:custom:pct').row()
    .text('◀ Back', `bwiz:type:${state.type}`);

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
}

composer.callbackQuery(/^bwiz:pct:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pct = parseInt(ctx.callbackQuery.data.replace('bwiz:pct:', ''));
  const state = states.get(ctx.chat.id);
  if (!state) return;
  state.pct = pct;
  states.set(ctx.chat.id, state);
  await showConfirmStep(ctx, state);
});

// ── Confirm step ──

async function showConfirmStep(ctx, state) {
  const icon = ICONS[state.type];
  let ruleDesc, example;

  if (state.type === 'tax') {
    ruleDesc = `Deposits below ₹${formatNumber(state.amount1)} → ${state.pct}% tax`;
    const s = Math.min(50, state.amount1);
    const t = Math.round(s * state.pct / 100);
    example = `User deposits ₹${s} → ₹${t} tax → Gets ₹${s - t}`;
  } else if (state.type === 'bonus') {
    ruleDesc = `Deposits ₹${formatNumber(state.amount1)}+ → ${state.pct}% bonus`;
    const s = state.amount1;
    const b = Math.round(s * state.pct / 100);
    example = `User deposits ₹${s} → ₹${b} bonus → Gets ₹${s + b}`;
  } else {
    const minLabel = state.amount1 > 0 ? `Deposit ₹${formatNumber(state.amount1)}+ AND ` : '';
    ruleDesc = `${minLabel}${state.days}-day total ₹${formatNumber(state.rolling)}+ → ${state.pct}% bonus`;
    const s = Math.max(state.amount1 || 100, 100);
    const b = Math.round(s * state.pct / 100);
    example = `User deposits ₹${s} (${state.days}-day total ₹${formatNumber(state.rolling)}+) → ₹${b} bonus → Gets ₹${s + b}`;
  }

  const text =
    `${icon} <b>Confirm Rule</b>\n\n` +
    `<blockquote>${ruleDesc}\n\n<b>Example:</b>\n${example}</blockquote>\n\n` +
    `<i>Is this correct?</i>`;

  const kb = new InlineKeyboard()
    .text('✅ Yes, Create', 'bwiz:save').row()
    .text('◀ Change', `bwiz:type:${state.type}`).text('❌ Cancel', 'admin:benefits');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
}

// ── Save ──

composer.callbackQuery('bwiz:save', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const state = states.get(ctx.chat.id);
  if (!state) { await ctx.editMessageText('⚠️ Session expired.', { reply_markup: new InlineKeyboard().text('◀ Back', 'admin:benefits') }); return; }

  const pool = ctx.dbPool;
  const days = state.days || 30;
  let ruleData;

  if (state.type === 'tax') {
    ruleData = { rule_type: 'tax', emoji: '💸',
      title: `${state.pct}% Tax (below ₹${formatNumber(state.amount1)})`,
      min_deposit: 0, max_deposit: state.amount1, percentage: state.pct, rolling_30d_min: 0, rolling_period_days: 30 };
  } else if (state.type === 'bonus') {
    ruleData = { rule_type: 'bonus', emoji: '🎁',
      title: `${state.pct}% Bonus (₹${formatNumber(state.amount1)}+)`,
      min_deposit: state.amount1, max_deposit: 0, percentage: state.pct, rolling_30d_min: 0, rolling_period_days: 30 };
  } else {
    const min = state.amount1 || 0;
    ruleData = { rule_type: 'loyalty_bonus', emoji: '🏆',
      title: min > 0
        ? `${state.pct}% Loyalty (₹${formatNumber(min)}+ & ${days}d ₹${formatNumber(state.rolling)}+)`
        : `${state.pct}% Loyalty (${days}d ₹${formatNumber(state.rolling)}+)`,
      min_deposit: min, max_deposit: 0, percentage: state.pct, rolling_30d_min: state.rolling, rolling_period_days: days };
  }

  // Conflict check
  const existing = await depositRulesRepo.getAllRules(pool);
  const conflict = existing.find(e => {
    if (e.rule_type !== ruleData.rule_type) return false;
    if (state.type === 'tax') return Math.abs(parseFloat(e.max_deposit) - state.amount1) < 10;
    if (state.type === 'bonus') return Math.abs(parseFloat(e.min_deposit) - state.amount1) < 10;
    return Math.abs(parseFloat(e.rolling_30d_min) - (state.rolling || 0)) < 100;
  });

  if (conflict) {
    states.set(ctx.chat.id, { ...state, ruleData });
    await ctx.editMessageText(
      `⚠️ <b>Similar rule exists!</b>\n\n${ICONS[conflict.rule_type]} ${describeRule(conflict)}\n\n<i>Edit existing or create new?</i>`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard()
        .text('✏️ Edit Existing', `benefits:edit:${conflict.id}`).row()
        .text('✅ Create Anyway', 'bwiz:force').row()
        .text('❌ Cancel', 'admin:benefits') }
    );
    return;
  }

  await saveRule(ctx, pool, ruleData);
  states.delete(ctx.chat.id);
});

composer.callbackQuery('bwiz:force', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const state = states.get(ctx.chat.id);
  if (!state?.ruleData) { await ctx.editMessageText('⚠️ Expired.', { reply_markup: new InlineKeyboard().text('◀ Back', 'admin:benefits') }); return; }
  await saveRule(ctx, ctx.dbPool, state.ruleData);
  states.delete(ctx.chat.id);
});

async function saveRule(ctx, pool, data) {
  const existing = await depositRulesRepo.getAllRules(pool);
  const sameType = existing.filter(e => e.rule_type === data.rule_type);
  const priority = sameType.reduce((max, e) => Math.max(max, e.priority), 0) + 10;
  const saved = await depositRulesRepo.createRule(pool, { ...data, priority, created_by: ctx.from.id });
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED,
    { action: 'add_deposit_rule', rule_id: saved.id, title: saved.title });

  // Auto-update Telegraph rules page
  try {
    const { updateRulesPage } = await import('../services/telegraphService.js');
    await updateRulesPage(pool);
  } catch {}

  const msg = `✅ <b>Rule Created!</b>\n\n${ICONS[saved.rule_type]} ${describeRule(saved)}\n<i>${exampleCalc(saved)}</i>`;
  const kb = new InlineKeyboard().text('➕ Add Another', 'benefits:add').row().text('◀ Dashboard', 'admin:benefits');
  try { await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: kb }); }
}

// ═══════════════════════════════════════════════════════════════════
//  CUSTOM INPUT HANDLERS — For when preset buttons aren't enough
// ═══════════════════════════════════════════════════════════════════

// Custom amount trigger
composer.callbackQuery('bwiz:custom:amt1', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const state = states.get(ctx.chat.id);
  if (!state) return;
  state.customStep = 'amt1';
  states.set(ctx.chat.id, state);
  const hint = state.type === 'tax' ? 'below what amount?' : 'minimum deposit?';
  await ctx.editMessageText(`✏️ Type the amount (${hint}):`, {
    parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('◀ Cancel', `bwiz:type:${state.type}`)
  });
});

// Custom days trigger
composer.callbackQuery('bwiz:custom:days', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const state = states.get(ctx.chat.id);
  if (!state) return;
  state.customStep = 'days';
  states.set(ctx.chat.id, state);
  await ctx.editMessageText(`✏️ Type number of days (e.g. 50):`, {
    parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('◀ Cancel', `bwiz:type:loyalty_bonus`)
  });
});

// Custom rolling amount trigger
composer.callbackQuery('bwiz:custom:roll', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const state = states.get(ctx.chat.id);
  if (!state) return;
  state.customStep = 'roll';
  states.set(ctx.chat.id, state);
  await ctx.editMessageText(`✏️ Type the total deposit amount needed in ${state.days} days:`, {
    parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('◀ Cancel', `bwiz:type:loyalty_bonus`)
  });
});

// Custom percentage trigger
composer.callbackQuery('bwiz:custom:pct', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const state = states.get(ctx.chat.id);
  if (!state) return;
  state.customStep = 'pct';
  states.set(ctx.chat.id, state);
  await ctx.editMessageText(`✏️ Type the percentage (1–100):`, {
    parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('◀ Cancel', `bwiz:type:${state.type}`)
  });
});

// Custom edit triggers
composer.callbackQuery(/^bedit:custom:/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const parts = ctx.callbackQuery.data.split(':');
  // bedit:custom:pct:5  or  bedit:custom:amt:5  or  bedit:custom:min:5  or  bedit:custom:days:5  or  bedit:custom:roll:5
  const field = parts[2];
  const id = parseInt(parts[3]);
  const state = states.get(ctx.chat.id) || {};
  state.editField = field;
  state.editId = id;
  states.set(ctx.chat.id, state);

  const hints = {
    pct: 'Type the new percentage (1–100):',
    amt: 'Type the new amount:',
    min: 'Type the new minimum deposit (0 = any):',
    days: 'Type the number of days:',
    roll: 'Type the total deposit needed:',
  };

  await ctx.editMessageText(`✏️ ${hints[field] || 'Type the value:'}`, {
    parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('◀ Cancel', `benefits:edit:${id}`)
  });
});

// ── Text input handler for ALL custom values ──

composer.on('message:text', async (ctx, next) => {
  const state = states.get(ctx.chat?.id);
  if (!state) return next();
  const pool = ctx.dbPool;
  const input = ctx.message.text.trim();
  const num = parseFloat(input);

  // ── Telegraph author name ──
  if (state.step === 'set_telegraph_author') {
    if (!input || input.length > 64) {
      await ctx.reply('⚠️ Name must be 1–64 characters:');
      return;
    }
    await settingsRepo.setSetting(pool, 'telegraph_author_name', input, ctx.from.id);
    // Regenerate Telegraph page with new name
    try {
      const { updateRulesPage } = await import('../services/telegraphService.js');
      await updateRulesPage(pool);
    } catch {}
    states.delete(ctx.chat.id);
    await ctx.reply(`✅ Telegraph name set to: <b>${escapeHtml(input)}</b>`, { parse_mode: 'HTML' });
    await showDashboard(ctx);
    return;
  }

  // ── Wizard custom inputs ──
  if (state.customStep) {
    if (isNaN(num) || num < 0) { await ctx.reply('⚠️ Enter a valid positive number:'); return; }

    if (state.customStep === 'amt1') {
      state.amount1 = num;
      delete state.customStep;
      states.set(ctx.chat.id, state);
      if (state.type === 'loyalty_bonus') await showDaysStep(ctx, state);
      else await showPctStep(ctx, state);
      return;
    }
    if (state.customStep === 'days') {
      if (num < 1 || num > 365) { await ctx.reply('⚠️ Days must be 1–365:'); return; }
      state.days = Math.round(num);
      delete state.customStep;
      states.set(ctx.chat.id, state);
      await showRollingStep(ctx, state);
      return;
    }
    if (state.customStep === 'roll') {
      state.rolling = num;
      delete state.customStep;
      states.set(ctx.chat.id, state);
      await showPctStep(ctx, state);
      return;
    }
    if (state.customStep === 'pct') {
      if (num <= 0 || num > 100) { await ctx.reply('⚠️ Percentage must be 1–100:'); return; }
      state.pct = num;
      delete state.customStep;
      states.set(ctx.chat.id, state);
      await showConfirmStep(ctx, state);
      return;
    }
  }

  // ── Edit custom inputs ──
  if (state.editField && state.editId) {
    if (isNaN(num) || num < 0) { await ctx.reply('⚠️ Enter a valid positive number:'); return; }
    const id = state.editId;
    const field = state.editField;
    const r = await depositRulesRepo.getRule(pool, id);
    if (!r) { states.delete(ctx.chat.id); return; }

    if (field === 'pct') {
      if (num <= 0 || num > 100) { await ctx.reply('⚠️ Percentage must be 1–100:'); return; }
      await depositRulesRepo.updateRule(pool, id, { percentage: num });
    } else if (field === 'amt') {
      if (r.rule_type === 'tax') await depositRulesRepo.updateRule(pool, id, { max_deposit: num });
      else if (r.rule_type === 'bonus') await depositRulesRepo.updateRule(pool, id, { min_deposit: num });
      else await depositRulesRepo.updateRule(pool, id, { rolling_30d_min: num });
    } else if (field === 'min') {
      await depositRulesRepo.updateRule(pool, id, { min_deposit: num });
    } else if (field === 'days') {
      if (num < 1 || num > 365) { await ctx.reply('⚠️ Days must be 1–365:'); return; }
      await depositRulesRepo.updateRule(pool, id, { rolling_period_days: Math.round(num) });
    } else if (field === 'roll') {
      await depositRulesRepo.updateRule(pool, id, { rolling_30d_min: num });
    }

    const updated = await depositRulesRepo.getRule(pool, id);
    if (updated) await autoTitle(pool, updated);
    states.delete(ctx.chat.id);
    await ctx.reply('✅ Updated!');
    await showEdit(ctx, id);
    return;
  }

  // ── Test simulator ──
  if (state.step === 'test_user') {
    const userId = parseInt(input);
    if (isNaN(userId)) { await ctx.reply('⚠️ Send a user ID (number):'); return; }
    state.userId = userId;
    state.step = 'test_amount';
    states.set(ctx.chat.id, state);
    await ctx.reply('💰 Now send the <b>deposit amount</b>:', { parse_mode: 'HTML' });
    return;
  }
  if (state.step === 'test_amount') {
    const amount = parseFloat(input);
    if (isNaN(amount) || amount <= 0) { await ctx.reply('⚠️ Send a positive amount:'); return; }
    states.delete(ctx.chat.id);
    const benefits = await depositBenefitsService.calculateBenefits(pool, state.userId, amount, null, true);
    let text = `🔮 <b>Test Result</b>\n\n👤 User: <code>${state.userId}</code>\n💰 Deposit: ₹${amount.toFixed(2)}\n\n<blockquote>`;
    if (!benefits.active) { text += `System is OFF\nUser gets: ₹${amount.toFixed(2)}`; }
    else {
      if (benefits.taxRule) text += `💸 Tax: ${parseFloat(benefits.taxRule.percentage)}% = -₹${benefits.taxAmount.toFixed(2)}\n`;
      if (benefits.bonusRule) text += `🎁 Bonus: +${parseFloat(benefits.bonusRule.percentage)}% = +₹${benefits.bonusAmount.toFixed(2)}\n`;
      if (!benefits.taxRule && !benefits.bonusRule) text += `No rules matched.\n`;
      text += `\n<b>User gets: ₹${benefits.creditAmount.toFixed(2)}</b>`;
    }
    text += `</blockquote>`;
    await ctx.reply(text, { parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('🔮 Test Again', 'benefits:test').text('◀ Dashboard', 'admin:benefits') });
    return;
  }

  return next();
});

// ═══════════════════════════════════════════════════════════════════
//  MANAGE RULES
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery('benefits:manage', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await showManage(ctx);
});

async function showManage(ctx) {
  const rules = await depositRulesRepo.getAllRules(ctx.dbPool);
  if (rules.length === 0) {
    try { await ctx.editMessageText('📋 No rules yet.', {
      reply_markup: new InlineKeyboard().text('➕ Add Rule', 'benefits:add').text('◀ Back', 'admin:benefits')
    }); } catch {} return;
  }
  let text = `📋 <b>Your Rules</b>\n\n<i>Tap a rule to edit:</i>\n\n`;
  for (const r of rules) {
    text += `${r.is_enabled ? '🟢' : '⚫'} ${ICONS[r.rule_type]} ${describeRule(r)}\n\n`;
  }
  const kb = new InlineKeyboard();
  for (const r of rules) {
    const l = r.rule_type === 'tax' ? `💸 ${parseFloat(r.percentage)}% Tax`
      : r.rule_type === 'bonus' ? `🎁 ${parseFloat(r.percentage)}% Bonus`
        : `🏆 ${parseFloat(r.percentage)}% Loyalty`;
    kb.text(l, `benefits:edit:${r.id}`).row();
  }
  kb.text('➕ Add Rule', 'benefits:add').row().text('◀ Dashboard', 'admin:benefits');
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
}

// ═══════════════════════════════════════════════════════════════════
//  EDIT RULE — Buttons + custom fallback
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery(/^benefits:edit:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.delete(ctx.chat.id);
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  await showEdit(ctx, id);
});

async function showEdit(ctx, id) {
  const r = await depositRulesRepo.getRule(ctx.dbPool, id);
  if (!r) {
    try { await ctx.editMessageText('⚠️ Not found.', { reply_markup: new InlineKeyboard().text('◀ Back', 'benefits:manage') }); } catch {}
    return;
  }

  const icon = ICONS[r.rule_type];
  const status = r.is_enabled ? '🟢 Active' : '⚫ Off';
  const toggleLabel = r.is_enabled ? '⚫ Turn Off' : '🟢 Turn On';
  const days = parseInt(r.rolling_period_days) || 30;

  let text = `✏️ <b>Edit Rule</b>\n\n${icon} ${describeRule(r)}\nStatus: ${status}\n\n<blockquote>${exampleCalc(r)}</blockquote>\n\n<i>What to change?</i>`;

  const kb = new InlineKeyboard()
    .text(`📊 Change % (now ${parseFloat(r.percentage)}%)`, `bedit:pct:${id}`).row();

  if (r.rule_type === 'tax') {
    kb.text(`💰 Tax Limit (now below ₹${formatNumber(parseFloat(r.max_deposit))})`, `bedit:amt:${id}`).row();
  } else if (r.rule_type === 'bonus') {
    kb.text(`💰 Min Deposit (now ₹${formatNumber(parseFloat(r.min_deposit))}+)`, `bedit:amt:${id}`).row();
  } else {
    kb.text(`💰 Min Deposit (now ₹${formatNumber(parseFloat(r.min_deposit))}+)`, `bedit:min:${id}`).row();
    kb.text(`📅 Period (now ${days} days)`, `bedit:days:${id}`).row();
    kb.text(`🏦 ${days}-Day Total (now ₹${formatNumber(parseFloat(r.rolling_30d_min))}+)`, `bedit:roll:${id}`).row();
  }

  kb.text(toggleLabel, `bedit:toggle:${id}`).row()
    .text('🗑 Delete', `bedit:del:${id}`).row()
    .text('◀ Back', 'benefits:manage');

  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
}

// ── Edit % with buttons ──
composer.callbackQuery(/^bedit:pct:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  const kb = new InlineKeyboard()
    .text('1%', `bset:pct:${id}:1`).text('2%', `bset:pct:${id}:2`).text('3%', `bset:pct:${id}:3`).row()
    .text('5%', `bset:pct:${id}:5`).text('7%', `bset:pct:${id}:7`).text('8%', `bset:pct:${id}:8`).row()
    .text('10%', `bset:pct:${id}:10`).text('12%', `bset:pct:${id}:12`).text('15%', `bset:pct:${id}:15`).row()
    .text('20%', `bset:pct:${id}:20`).text('25%', `bset:pct:${id}:25`).text('50%', `bset:pct:${id}:50`).row()
    .text('✏️ Custom %', `bedit:custom:pct:${id}`).row()
    .text('◀ Cancel', `benefits:edit:${id}`);
  try { await ctx.editMessageText(`📊 <b>New percentage?</b>`, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(`📊 <b>New percentage?</b>`, { parse_mode: 'HTML', reply_markup: kb }); }
});

composer.callbackQuery(/^bset:pct:\d+:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const p = ctx.callbackQuery.data.split(':');
  const id = parseInt(p[2]), pct = parseInt(p[3]);
  await depositRulesRepo.updateRule(ctx.dbPool, id, { percentage: pct });
  const r = await depositRulesRepo.getRule(ctx.dbPool, id);
  if (r) await autoTitle(ctx.dbPool, r);
  await showEdit(ctx, id);
});

// ── Edit amount with buttons ──
composer.callbackQuery(/^bedit:amt:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  const r = await depositRulesRepo.getRule(ctx.dbPool, id);
  if (!r) return;
  let amounts, label;
  if (r.rule_type === 'tax') {
    label = 'Tax deposits below?'; amounts = [50, 100, 200, 500, 1000, 2000, 5000];
  } else if (r.rule_type === 'bonus') {
    label = 'Min deposit for bonus?'; amounts = [100, 200, 500, 1000, 2000, 5000, 10000];
  } else {
    return; // loyalty uses bedit:roll instead
  }
  const kb = new InlineKeyboard();
  for (let i = 0; i < amounts.length; i += 3) {
    for (const a of amounts.slice(i, i + 3)) kb.text(`₹${formatNumber(a)}`, `bset:amt:${id}:${a}`);
    kb.row();
  }
  kb.text('✏️ Custom', `bedit:custom:amt:${id}`).row().text('◀ Cancel', `benefits:edit:${id}`);
  try { await ctx.editMessageText(`💰 <b>${label}</b>`, { parse_mode: 'HTML', reply_markup: kb }); }
  catch {}
});

composer.callbackQuery(/^bset:amt:\d+:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const p = ctx.callbackQuery.data.split(':');
  const id = parseInt(p[2]), amt = parseInt(p[3]);
  const r = await depositRulesRepo.getRule(ctx.dbPool, id);
  if (!r) return;
  if (r.rule_type === 'tax') await depositRulesRepo.updateRule(ctx.dbPool, id, { max_deposit: amt });
  else await depositRulesRepo.updateRule(ctx.dbPool, id, { min_deposit: amt });
  const updated = await depositRulesRepo.getRule(ctx.dbPool, id);
  if (updated) await autoTitle(ctx.dbPool, updated);
  await showEdit(ctx, id);
});

// ── Edit min deposit (loyalty) with buttons ──
composer.callbackQuery(/^bedit:min:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  const kb = new InlineKeyboard()
    .text('Any', `bset:min:${id}:0`).row()
    .text('₹50+', `bset:min:${id}:50`).text('₹100+', `bset:min:${id}:100`).text('₹200+', `bset:min:${id}:200`).row()
    .text('₹500+', `bset:min:${id}:500`).text('₹1000+', `bset:min:${id}:1000`).text('₹2000+', `bset:min:${id}:2000`).row()
    .text('✏️ Custom', `bedit:custom:min:${id}`).row().text('◀ Cancel', `benefits:edit:${id}`);
  try { await ctx.editMessageText(`💰 <b>Min single deposit?</b>`, { parse_mode: 'HTML', reply_markup: kb }); }
  catch {}
});

composer.callbackQuery(/^bset:min:\d+:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const p = ctx.callbackQuery.data.split(':');
  const id = parseInt(p[2]), amt = parseInt(p[3]);
  await depositRulesRepo.updateRule(ctx.dbPool, id, { min_deposit: amt });
  const r = await depositRulesRepo.getRule(ctx.dbPool, id);
  if (r) await autoTitle(ctx.dbPool, r);
  await showEdit(ctx, id);
});

// ── Edit days (loyalty) with buttons ──
composer.callbackQuery(/^bedit:days:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  const kb = new InlineKeyboard()
    .text('7 Days', `bset:days:${id}:7`).text('15 Days', `bset:days:${id}:15`).row()
    .text('30 Days', `bset:days:${id}:30`).text('45 Days', `bset:days:${id}:45`).row()
    .text('60 Days', `bset:days:${id}:60`).text('90 Days', `bset:days:${id}:90`).row()
    .text('✏️ Custom', `bedit:custom:days:${id}`).row().text('◀ Cancel', `benefits:edit:${id}`);
  try { await ctx.editMessageText(`📅 <b>Check deposits in how many days?</b>`, { parse_mode: 'HTML', reply_markup: kb }); }
  catch {}
});

composer.callbackQuery(/^bset:days:\d+:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const p = ctx.callbackQuery.data.split(':');
  const id = parseInt(p[2]), days = parseInt(p[3]);
  await depositRulesRepo.updateRule(ctx.dbPool, id, { rolling_period_days: days });
  const r = await depositRulesRepo.getRule(ctx.dbPool, id);
  if (r) await autoTitle(ctx.dbPool, r);
  await showEdit(ctx, id);
});

// ── Edit rolling total (loyalty) with buttons ──
composer.callbackQuery(/^bedit:roll:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  const r = await depositRulesRepo.getRule(ctx.dbPool, id);
  const days = r ? parseInt(r.rolling_period_days) || 30 : 30;
  const kb = new InlineKeyboard()
    .text('₹500+', `bset:roll:${id}:500`).text('₹1000+', `bset:roll:${id}:1000`).row()
    .text('₹2000+', `bset:roll:${id}:2000`).text('₹3000+', `bset:roll:${id}:3000`).row()
    .text('₹5000+', `bset:roll:${id}:5000`).text('₹10000+', `bset:roll:${id}:10000`).row()
    .text('₹20000+', `bset:roll:${id}:20000`).text('₹50000+', `bset:roll:${id}:50000`).row()
    .text('✏️ Custom', `bedit:custom:roll:${id}`).row().text('◀ Cancel', `benefits:edit:${id}`);
  try { await ctx.editMessageText(`🏦 <b>Total deposit needed in ${days} days?</b>`, { parse_mode: 'HTML', reply_markup: kb }); }
  catch {}
});

composer.callbackQuery(/^bset:roll:\d+:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const p = ctx.callbackQuery.data.split(':');
  const id = parseInt(p[2]), amt = parseInt(p[3]);
  await depositRulesRepo.updateRule(ctx.dbPool, id, { rolling_30d_min: amt });
  const r = await depositRulesRepo.getRule(ctx.dbPool, id);
  if (r) await autoTitle(ctx.dbPool, r);
  await showEdit(ctx, id);
});

// ── Toggle / Delete ──

composer.callbackQuery(/^bedit:toggle:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  await depositRulesRepo.toggleRule(ctx.dbPool, id);
  try { const { updateRulesPage } = await import('../services/telegraphService.js'); await updateRulesPage(ctx.dbPool); } catch {}
  await showEdit(ctx, id);
});

composer.callbackQuery(/^bedit:del:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  const r = await depositRulesRepo.getRule(ctx.dbPool, id);
  if (!r) { await showManage(ctx); return; }
  await ctx.editMessageText(
    `🗑 <b>Delete?</b>\n\n${ICONS[r.rule_type]} ${describeRule(r)}\n\n<i>Cannot be undone.</i>`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard()
      .text('🗑 Yes', `bedit:confirm_del:${id}`).text('❌ No', `benefits:edit:${id}`) }
  );
});

composer.callbackQuery(/^bedit:confirm_del:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  await depositRulesRepo.deleteRule(ctx.dbPool, id);
  try { const { updateRulesPage } = await import('../services/telegraphService.js'); await updateRulesPage(ctx.dbPool); } catch {}
  await showManage(ctx);
});

// ── Auto title ──

async function autoTitle(pool, r) {
  const pct = parseFloat(r.percentage);
  const days = parseInt(r.rolling_period_days) || 30;
  let title;
  if (r.rule_type === 'tax') {
    title = `${pct}% Tax (below ₹${formatNumber(parseFloat(r.max_deposit))})`;
  } else if (r.rule_type === 'bonus') {
    title = `${pct}% Bonus (₹${formatNumber(parseFloat(r.min_deposit))}+)`;
  } else {
    const min = parseFloat(r.min_deposit) || 0;
    const rolling = parseFloat(r.rolling_30d_min) || 0;
    title = min > 0
      ? `${pct}% Loyalty (₹${formatNumber(min)}+ & ${days}d ₹${formatNumber(rolling)}+)`
      : `${pct}% Loyalty (${days}d ₹${formatNumber(rolling)}+)`;
  }
  await depositRulesRepo.updateRule(pool, r.id, { title });
}

// ═══════════════════════════════════════════════════════════════════
//  TEST + STATS
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery('benefits:test', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.set(ctx.chat.id, { step: 'test_user' });
  try { await ctx.editMessageText(
    `🔮 <b>Test Rules</b>\n\nSend a <b>User ID</b>:\n\n<i>Tests without giving real money.</i>`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('◀ Cancel', 'admin:benefits') }
  ); } catch {}
});

composer.callbackQuery('benefits:stats', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const [daily, weekly, allTime] = await Promise.all([
    depositRulesRepo.getStats(ctx.dbPool, 1),
    depositRulesRepo.getStats(ctx.dbPool, 7),
    depositRulesRepo.getStats(ctx.dbPool),
  ]);
  let text = `📊 <b>Stats</b>\n\n<blockquote>`;
  text += `<b>Today</b>  Bonus: ₹${formatNumber(daily.totalBonus)} (${daily.bonusCount}×)  Tax: ₹${formatNumber(daily.totalTax)} (${daily.taxCount}×)\n\n`;
  text += `<b>7 Days</b>  Bonus: ₹${formatNumber(weekly.totalBonus)} (${weekly.bonusCount}×)  Tax: ₹${formatNumber(weekly.totalTax)} (${weekly.taxCount}×)\n\n`;
  text += `<b>All Time</b>  Bonus: ₹${formatNumber(allTime.totalBonus)}  Tax: ₹${formatNumber(allTime.totalTax)}</blockquote>`;
  try { await ctx.editMessageText(text, { parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('🔄 Refresh', 'benefits:stats').text('◀ Back', 'admin:benefits')
  }); } catch {}
});

export default composer;
