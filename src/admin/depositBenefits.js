// ═══════════════════════════════════════════════════════════════════
//  💎 DEPOSIT BENEFITS — Dead Simple Admin Panel
//
//  Rules explained in plain language:
//  • Tax:     "Deposits below ₹100 → 10% tax deducted"
//  • Bonus:   "Deposits ₹500 or more → 5% extra bonus"
//  • Loyalty: "30-day total ₹5000+ → 7% loyalty bonus"
//
//  Add a rule in 2 taps. No jargon. No VIP. No priority.
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

// ── Plain-language helpers ──────────────────────────────────────

function describeTax(r) {
  const max = parseFloat(r.max_deposit) || 0;
  const pct = parseFloat(r.percentage);
  if (max > 0) return `Deposits below ₹${formatNumber(max)} → ${pct}% tax deducted`;
  return `All deposits → ${pct}% tax deducted`;
}

function describeBonus(r) {
  const min = parseFloat(r.min_deposit) || 0;
  const pct = parseFloat(r.percentage);
  return `Deposits ₹${formatNumber(min)} or more → ${pct}% extra bonus`;
}

function describeLoyalty(r) {
  const rolling = parseFloat(r.rolling_30d_min) || 0;
  const pct = parseFloat(r.percentage);
  return `30-day total ₹${formatNumber(rolling)}+ → ${pct}% loyalty bonus`;
}

function describeRule(r) {
  if (r.rule_type === 'tax') return describeTax(r);
  if (r.rule_type === 'bonus') return describeBonus(r);
  return describeLoyalty(r);
}

function exampleCalc(r) {
  const pct = parseFloat(r.percentage);
  if (r.rule_type === 'tax') {
    const max = parseFloat(r.max_deposit) || 100;
    const sample = Math.min(50, max);
    const taxAmt = (sample * pct / 100).toFixed(0);
    return `User deposits ₹${sample} → ₹${taxAmt} tax → Gets ₹${(sample - taxAmt).toFixed(0)}`;
  }
  if (r.rule_type === 'bonus') {
    const min = parseFloat(r.min_deposit) || 500;
    const sample = min > 0 ? min : 500;
    const bonusAmt = (sample * pct / 100).toFixed(0);
    return `User deposits ₹${sample} → ₹${bonusAmt} bonus → Gets ₹${(+sample + +bonusAmt).toFixed(0)}`;
  }
  const sample = 1000;
  const bonusAmt = (sample * pct / 100).toFixed(0);
  return `User deposits ₹${sample} → ₹${bonusAmt} extra bonus`;
}

const ICONS = { tax: '💸', bonus: '🎁', loyalty_bonus: '🏆' };

// ═══════════════════════════════════════════════════════════════════
//  DASHBOARD — Everything visible at a glance
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery('admin:benefits', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await showDashboard(ctx);
});

async function showDashboard(ctx) {
  const pool = ctx.dbPool;
  const enabled = await settingsRepo.getSetting(pool, 'deposit_benefits_enabled');
  const rules = await depositRulesRepo.getAllRules(pool);

  const onoff = enabled ? '🟢 ON' : '🔴 OFF';
  const toggleBtn = enabled ? '🔴 Turn OFF' : '🟢 Turn ON';

  let text = `💎 <b>Deposit Benefits</b>: ${onoff}\n`;

  if (rules.length === 0) {
    text += `\n<i>No rules yet.</i>\n\n`;
    text += `<blockquote>` +
      `<b>What is this?</b>\n\n` +
      `You can set rules to automatically:\n` +
      `• Charge tax on small deposits\n` +
      `• Give bonus on big deposits\n` +
      `• Reward users who deposit regularly\n\n` +
      `Tap "➕ Add Rule" to get started.` +
      `</blockquote>`;
  } else {
    text += `\n<b>Your Rules:</b>\n\n`;
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      const icon = ICONS[r.rule_type] || '📌';
      const status = r.is_enabled ? '🟢' : '⚫';
      text += `${status} ${icon} ${describeRule(r)}\n`;
      text += `<i>   → ${exampleCalc(r)}</i>\n\n`;
    }
  }

  const kb = new InlineKeyboard()
    .text(toggleBtn, 'benefits:toggle').row()
    .text('➕ Add Rule', 'benefits:add').row();

  if (rules.length > 0) {
    kb.text('📋 Edit / Remove Rules', 'benefits:manage').row();
    kb.text('🔮 Test Rules', 'benefits:test').text('📊 Stats', 'benefits:stats').row();
  }
  kb.text('◀ Back', 'admin:back');

  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  } catch {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

// Toggle
composer.callbackQuery('benefits:toggle', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const cur = await settingsRepo.getSetting(pool, 'deposit_benefits_enabled');
  await settingsRepo.setSetting(pool, 'deposit_benefits_enabled', !cur, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED,
    { action: 'toggle_benefits', enabled: !cur });
  await showDashboard(ctx);
});

// ═══════════════════════════════════════════════════════════════════
//  ADD RULE — 2 taps, plain language
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery('benefits:add', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.delete(ctx.chat.id);

  const text =
    `➕ <b>What do you want to do?</b>\n\n` +
    `<blockquote>` +
    `💸 <b>Charge tax on small deposits</b>\n` +
    `   Example: Deposits below ₹100 → 10% tax\n\n` +
    `🎁 <b>Give bonus on big deposits</b>\n` +
    `   Example: Deposits ₹500+ → 5% extra\n\n` +
    `🏆 <b>Reward loyal depositors</b>\n` +
    `   Example: 30-day total ₹5000+ → 7% bonus` +
    `</blockquote>`;

  const kb = new InlineKeyboard()
    .text('💸 Charge Tax', 'benefits:create:tax').row()
    .text('🎁 Give Bonus', 'benefits:create:bonus').row()
    .text('🏆 Reward Loyalty', 'benefits:create:loyalty_bonus').row()
    .text('◀ Back', 'admin:benefits');

  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  } catch {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
});

// Type selected → ask for 2 numbers
composer.callbackQuery(/^benefits:create:/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const type = ctx.callbackQuery.data.replace('benefits:create:', '');
  states.set(ctx.chat.id, { step: 'input', type });

  let text;
  if (type === 'tax') {
    text =
      `💸 <b>Tax Rule</b>\n\n` +
      `Send two numbers:\n` +
      `<b>Below what amount?</b>  and  <b>What % tax?</b>\n\n` +
      `<code>100 10</code>\n\n` +
      `<blockquote>` +
      `This means:\n` +
      `Deposits below ₹100 → 10% tax\n\n` +
      `So if user deposits ₹50:\n` +
      `₹50 - 10% tax (₹5) = User gets ₹45` +
      `</blockquote>`;
  } else if (type === 'bonus') {
    text =
      `🎁 <b>Bonus Rule</b>\n\n` +
      `Send two numbers:\n` +
      `<b>Minimum deposit?</b>  and  <b>What % bonus?</b>\n\n` +
      `<code>500 5</code>\n\n` +
      `<blockquote>` +
      `This means:\n` +
      `Deposits ₹500 or more → 5% extra bonus\n\n` +
      `So if user deposits ₹1000:\n` +
      `₹1000 + 5% bonus (₹50) = User gets ₹1050` +
      `</blockquote>`;
  } else {
    text =
      `🏆 <b>Loyalty Bonus</b>\n\n` +
      `Send two numbers:\n` +
      `<b>30-day deposit total?</b>  and  <b>What % bonus?</b>\n\n` +
      `<code>5000 7</code>\n\n` +
      `<blockquote>` +
      `This means:\n` +
      `Users who deposited ₹5000+ in last 30 days\n` +
      `→ Get 7% extra bonus on every deposit\n\n` +
      `So if user deposits ₹1000:\n` +
      `₹1000 + 7% bonus (₹70) = User gets ₹1070` +
      `</blockquote>`;
  }

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('◀ Go Back', 'benefits:add')
    });
  } catch {
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('◀ Go Back', 'benefits:add')
    });
  }
});

// Parse input → create rule
composer.on('message:text', async (ctx, next) => {
  const state = states.get(ctx.chat?.id);
  if (!state) return next();

  const pool = ctx.dbPool;
  const text = ctx.message.text.trim();

  switch (state.step) {
    case 'input': {
      const nums = text.split(/[\s,]+/).map(Number);
      if (nums.length < 2 || nums.some(isNaN)) {
        await ctx.reply('⚠️ Send 2 numbers. Example: <code>100 10</code>', { parse_mode: 'HTML' });
        return;
      }

      const [val1, pct] = nums;
      if (pct <= 0 || pct > 100) { await ctx.reply('⚠️ Percentage must be between 1 and 100.'); return; }
      if (val1 < 0) { await ctx.reply('⚠️ Amount cannot be negative.'); return; }

      let ruleData;
      if (state.type === 'tax') {
        ruleData = {
          rule_type: 'tax', emoji: '💸',
          title: `${pct}% Tax (below ₹${formatNumber(val1)})`,
          min_deposit: 0, max_deposit: val1, percentage: pct, rolling_30d_min: 0,
        };
      } else if (state.type === 'bonus') {
        ruleData = {
          rule_type: 'bonus', emoji: '🎁',
          title: `${pct}% Bonus (₹${formatNumber(val1)}+)`,
          min_deposit: val1, max_deposit: 0, percentage: pct, rolling_30d_min: 0,
        };
      } else {
        ruleData = {
          rule_type: 'loyalty_bonus', emoji: '🏆',
          title: `${pct}% Loyalty (30d ₹${formatNumber(val1)}+)`,
          min_deposit: 0, max_deposit: 0, percentage: pct, rolling_30d_min: val1,
        };
      }

      // Check if similar rule exists
      const existing = await depositRulesRepo.getAllRules(pool);
      const conflict = existing.find(e => {
        if (e.rule_type !== ruleData.rule_type) return false;
        if (state.type === 'tax') return Math.abs(parseFloat(e.max_deposit) - val1) < 10;
        if (state.type === 'bonus') return Math.abs(parseFloat(e.min_deposit) - val1) < 10;
        return Math.abs(parseFloat(e.rolling_30d_min) - val1) < 100;
      });

      if (conflict) {
        states.set(ctx.chat.id, { step: 'conflict', ruleData });
        await ctx.reply(
          `⚠️ <b>You already have a similar rule!</b>\n\n` +
          `${ICONS[conflict.rule_type]} ${describeRule(conflict)}\n\n` +
          `<i>Do you want to edit that rule, or create a new one anyway?</i>`,
          { parse_mode: 'HTML', reply_markup: new InlineKeyboard()
            .text('✏️ Edit Existing Rule', `benefits:edit:${conflict.id}`).row()
            .text('✅ Create New Anyway', 'benefits:force_create').row()
            .text('❌ Cancel', 'admin:benefits')
          }
        );
        return;
      }

      // No conflict → create
      await createRule(ctx, pool, ruleData);
      states.delete(ctx.chat.id);
      return;
    }

    case 'edit_pct': {
      const pct = parseFloat(text);
      if (isNaN(pct) || pct <= 0 || pct > 100) { await ctx.reply('⚠️ Enter a number between 1 and 100:'); return; }
      await depositRulesRepo.updateRule(pool, state.ruleId, { percentage: pct });
      // Auto-update title
      const r = await depositRulesRepo.getRule(pool, state.ruleId);
      if (r) await autoUpdateTitle(pool, r);
      states.delete(ctx.chat.id);
      await ctx.reply('✅ Percentage updated!');
      await showEditScreen(ctx, state.ruleId);
      return;
    }

    case 'edit_amount': {
      const val = parseFloat(text);
      if (isNaN(val) || val < 0) { await ctx.reply('⚠️ Enter a valid amount:'); return; }
      const r = await depositRulesRepo.getRule(pool, state.ruleId);
      if (!r) { states.delete(ctx.chat.id); return; }

      if (r.rule_type === 'tax') {
        await depositRulesRepo.updateRule(pool, state.ruleId, { max_deposit: val });
      } else if (r.rule_type === 'bonus') {
        await depositRulesRepo.updateRule(pool, state.ruleId, { min_deposit: val });
      } else {
        await depositRulesRepo.updateRule(pool, state.ruleId, { rolling_30d_min: val });
      }
      // Auto-update title
      const updated = await depositRulesRepo.getRule(pool, state.ruleId);
      if (updated) await autoUpdateTitle(pool, updated);
      states.delete(ctx.chat.id);
      await ctx.reply('✅ Amount updated!');
      await showEditScreen(ctx, state.ruleId);
      return;
    }

    case 'test_user': {
      const userId = parseInt(text);
      if (isNaN(userId)) { await ctx.reply('⚠️ Send a user ID (number):'); return; }
      state.userId = userId;
      state.step = 'test_amount';
      states.set(ctx.chat.id, state);
      await ctx.reply('💰 Now send the <b>deposit amount</b> to test:', { parse_mode: 'HTML' });
      return;
    }

    case 'test_amount': {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) { await ctx.reply('⚠️ Send a positive amount:'); return; }
      states.delete(ctx.chat.id);
      await runTest(ctx, state.userId, amount);
      return;
    }

    default:
      return next();
  }
});

// Auto-update title based on current values
async function autoUpdateTitle(pool, r) {
  let title;
  if (r.rule_type === 'tax') {
    title = `${parseFloat(r.percentage)}% Tax (below ₹${formatNumber(parseFloat(r.max_deposit))})`;
  } else if (r.rule_type === 'bonus') {
    title = `${parseFloat(r.percentage)}% Bonus (₹${formatNumber(parseFloat(r.min_deposit))}+)`;
  } else {
    title = `${parseFloat(r.percentage)}% Loyalty (30d ₹${formatNumber(parseFloat(r.rolling_30d_min))}+)`;
  }
  await depositRulesRepo.updateRule(pool, r.id, { title });
}

// Force create despite conflict
composer.callbackQuery('benefits:force_create', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const state = states.get(ctx.chat.id);
  if (!state?.ruleData) {
    await ctx.reply('⚠️ Session expired.', { reply_markup: new InlineKeyboard().text('◀ Back', 'admin:benefits') });
    return;
  }
  await createRule(ctx, ctx.dbPool, state.ruleData);
  states.delete(ctx.chat.id);
});

// Helper: create and show success
async function createRule(ctx, pool, data) {
  const existing = await depositRulesRepo.getAllRules(pool);
  const sameType = existing.filter(e => e.rule_type === data.rule_type);
  const priority = sameType.reduce((max, e) => Math.max(max, e.priority), 0) + 10;

  const saved = await depositRulesRepo.createRule(pool, {
    ...data, priority, created_by: ctx.from.id,
  });

  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED,
    { action: 'add_deposit_rule', rule_id: saved.id, title: saved.title });

  const icon = ICONS[saved.rule_type];
  const desc = describeRule(saved);
  const example = exampleCalc(saved);

  const msg =
    `✅ <b>Rule Created!</b>\n\n` +
    `${icon} ${desc}\n\n` +
    `<blockquote>${example}</blockquote>`;

  const kb = new InlineKeyboard()
    .text('➕ Add Another Rule', 'benefits:add').row()
    .text('◀ Back to Dashboard', 'admin:benefits');

  try {
    await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: kb });
  } catch {
    await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: kb });
  }
}

// ═══════════════════════════════════════════════════════════════════
//  MANAGE RULES — Simple list with edit/on-off/delete
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery('benefits:manage', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await showManage(ctx);
});

async function showManage(ctx) {
  const rules = await depositRulesRepo.getAllRules(ctx.dbPool);

  if (rules.length === 0) {
    try {
      await ctx.editMessageText('📋 No rules yet.', {
        reply_markup: new InlineKeyboard().text('➕ Add Rule', 'benefits:add').text('◀ Back', 'admin:benefits')
      });
    } catch {
      await ctx.reply('📋 No rules yet.', {
        reply_markup: new InlineKeyboard().text('➕ Add Rule', 'benefits:add').text('◀ Back', 'admin:benefits')
      });
    }
    return;
  }

  let text = `📋 <b>Your Rules</b>\n\n<i>Tap a rule to edit or remove it.</i>\n\n`;

  for (const r of rules) {
    const status = r.is_enabled ? '🟢' : '⚫';
    const icon = ICONS[r.rule_type] || '📌';
    text += `${status} ${icon} ${describeRule(r)}\n\n`;
  }

  const kb = new InlineKeyboard();
  for (const r of rules) {
    const shortDesc = r.rule_type === 'tax'
      ? `💸 ${parseFloat(r.percentage)}% Tax`
      : r.rule_type === 'bonus'
        ? `🎁 ${parseFloat(r.percentage)}% Bonus`
        : `🏆 ${parseFloat(r.percentage)}% Loyalty`;
    kb.text(shortDesc, `benefits:edit:${r.id}`).row();
  }
  kb.text('➕ Add Rule', 'benefits:add').row();
  kb.text('◀ Back', 'admin:benefits');

  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  } catch {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

// ═══════════════════════════════════════════════════════════════════
//  EDIT RULE — Only 2 things to change: amount and percentage
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery(/^benefits:edit:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.delete(ctx.chat.id);
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  await showEditScreen(ctx, id);
});

async function showEditScreen(ctx, id) {
  const r = await depositRulesRepo.getRule(ctx.dbPool, id);
  if (!r) {
    try {
      await ctx.editMessageText('⚠️ Rule not found.', { reply_markup: new InlineKeyboard().text('◀ Back', 'admin:benefits') });
    } catch {
      await ctx.reply('⚠️ Rule not found.', { reply_markup: new InlineKeyboard().text('◀ Back', 'admin:benefits') });
    }
    return;
  }

  const icon = ICONS[r.rule_type] || '📌';
  const status = r.is_enabled ? '🟢 Active' : '⚫ Off';
  const desc = describeRule(r);
  const example = exampleCalc(r);

  const amountLabel = r.rule_type === 'tax'
    ? `💰 Change Amount (now: ₹${formatNumber(parseFloat(r.max_deposit))})`
    : r.rule_type === 'bonus'
      ? `💰 Change Amount (now: ₹${formatNumber(parseFloat(r.min_deposit))})`
      : `💰 Change Amount (now: ₹${formatNumber(parseFloat(r.rolling_30d_min))})`;

  const toggleLabel = r.is_enabled ? '⚫ Turn Off' : '🟢 Turn On';

  let text =
    `✏️ <b>Edit Rule</b>\n\n` +
    `${icon} ${desc}\n` +
    `Status: ${status}\n\n` +
    `<blockquote>${example}</blockquote>`;

  const kb = new InlineKeyboard()
    .text(`📊 Change % (now: ${parseFloat(r.percentage)}%)`, `benefits:chg_pct:${id}`).row()
    .text(amountLabel, `benefits:chg_amt:${id}`).row()
    .text(toggleLabel, `benefits:onoff:${id}`).row()
    .text('🗑 Delete This Rule', `benefits:del:${id}`).row()
    .text('◀ Back', 'benefits:manage');

  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  } catch {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

// Change percentage
composer.callbackQuery(/^benefits:chg_pct:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  states.set(ctx.chat.id, { step: 'edit_pct', ruleId: id });

  try {
    await ctx.editMessageText(
      `📊 <b>Change Percentage</b>\n\nSend the new percentage (1–100):`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('◀ Cancel', `benefits:edit:${id}`) }
    );
  } catch {
    await ctx.reply(
      `📊 <b>Change Percentage</b>\n\nSend the new percentage (1–100):`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('◀ Cancel', `benefits:edit:${id}`) }
    );
  }
});

// Change amount
composer.callbackQuery(/^benefits:chg_amt:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  const r = await depositRulesRepo.getRule(ctx.dbPool, id);
  if (!r) return;

  states.set(ctx.chat.id, { step: 'edit_amount', ruleId: id });

  let hint;
  if (r.rule_type === 'tax') hint = 'Below what deposit amount should tax apply?';
  else if (r.rule_type === 'bonus') hint = 'Minimum deposit amount to give bonus?';
  else hint = 'Minimum 30-day total deposit to qualify?';

  try {
    await ctx.editMessageText(
      `💰 <b>Change Amount</b>\n\n${hint}\n\nSend the new amount:`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('◀ Cancel', `benefits:edit:${id}`) }
    );
  } catch {
    await ctx.reply(
      `💰 <b>Change Amount</b>\n\n${hint}\n\nSend the new amount:`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('◀ Cancel', `benefits:edit:${id}`) }
    );
  }
});

// Toggle on/off
composer.callbackQuery(/^benefits:onoff:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  await depositRulesRepo.toggleRule(ctx.dbPool, id);
  await showEditScreen(ctx, id);
});

// Delete
composer.callbackQuery(/^benefits:del:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  const r = await depositRulesRepo.getRule(ctx.dbPool, id);
  if (!r) { await showManage(ctx); return; }

  const text =
    `🗑 <b>Delete this rule?</b>\n\n` +
    `${ICONS[r.rule_type]} ${describeRule(r)}\n\n` +
    `<i>This cannot be undone.</i>`;

  await ctx.editMessageText(text, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard()
      .text('🗑 Yes, Delete', `benefits:confirm_del:${id}`).text('❌ No, Keep', `benefits:edit:${id}`)
  });
});

composer.callbackQuery(/^benefits:confirm_del:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  await depositRulesRepo.deleteRule(ctx.dbPool, id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED,
    { action: 'delete_rule', rule_id: id });
  await showManage(ctx);
});

// ═══════════════════════════════════════════════════════════════════
//  TEST RULES — See exactly what happens
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery('benefits:test', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.set(ctx.chat.id, { step: 'test_user' });

  try {
    await ctx.editMessageText(
      `🔮 <b>Test Rules</b>\n\n` +
      `Send a <b>User ID</b> to test with:\n\n` +
      `<i>This will show what happens when that user deposits — without actually giving money.</i>`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('◀ Cancel', 'admin:benefits') }
    );
  } catch {
    await ctx.reply(
      `🔮 <b>Test Rules</b>\n\nSend a <b>User ID</b>:`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('◀ Cancel', 'admin:benefits') }
    );
  }
});

async function runTest(ctx, userId, amount) {
  const benefits = await depositBenefitsService.calculateBenefits(ctx.dbPool, userId, amount, null, true);

  let text = `🔮 <b>Test Result</b>\n\n`;
  text += `User: <code>${userId}</code>\n`;
  text += `Deposit: ₹${amount.toFixed(2)}\n\n`;

  if (!benefits.active) {
    text += `<blockquote>System is OFF — no rules applied.\nUser gets: ₹${amount.toFixed(2)}</blockquote>`;
  } else {
    text += `<blockquote>`;
    if (benefits.taxRule) {
      text += `💸 Tax: ${parseFloat(benefits.taxRule.percentage)}% = -₹${benefits.taxAmount.toFixed(2)}\n`;
    }
    if (benefits.bonusRule) {
      text += `🎁 Bonus: +${parseFloat(benefits.bonusRule.percentage)}% = +₹${benefits.bonusAmount.toFixed(2)}\n`;
    }
    if (!benefits.taxRule && !benefits.bonusRule) {
      text += `No rules matched this deposit.\n`;
    }
    text += `\n<b>User gets: ₹${benefits.creditAmount.toFixed(2)}</b>`;
    text += `</blockquote>`;
  }

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard()
      .text('🔮 Test Again', 'benefits:test').text('◀ Dashboard', 'admin:benefits')
  });
}

// ═══════════════════════════════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery('benefits:stats', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;

  const [daily, weekly, allTime] = await Promise.all([
    depositRulesRepo.getStats(pool, 1),
    depositRulesRepo.getStats(pool, 7),
    depositRulesRepo.getStats(pool),
  ]);

  let text = `📊 <b>Bonus Stats</b>\n\n`;

  text += `<blockquote>`;
  text += `<b>Today</b>\n`;
  text += `Bonus given: ₹${formatNumber(daily.totalBonus)} (${daily.bonusCount} times)\n`;
  text += `Tax collected: ₹${formatNumber(daily.totalTax)} (${daily.taxCount} times)\n\n`;
  text += `<b>Last 7 Days</b>\n`;
  text += `Bonus: ₹${formatNumber(weekly.totalBonus)} (${weekly.bonusCount})\n`;
  text += `Tax: ₹${formatNumber(weekly.totalTax)} (${weekly.taxCount})\n\n`;
  text += `<b>All Time</b>\n`;
  text += `Bonus: ₹${formatNumber(allTime.totalBonus)}\n`;
  text += `Tax: ₹${formatNumber(allTime.totalTax)}`;
  text += `</blockquote>`;

  await ctx.editMessageText(text, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('🔄 Refresh', 'benefits:stats').text('◀ Back', 'admin:benefits')
  });
});

export default composer;
