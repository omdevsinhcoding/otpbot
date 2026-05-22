// ═══════════════════════════════════════════════════════════════════
//  💎 DEPOSIT BENEFITS ADMIN — Redesigned for Simplicity
//
//  Flow: Dashboard → Add (2 steps) or Templates (1 tap) → Done
//  Edit: Tap rule → Edit fields inline
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
const wizStates = new Map();
registerAdminState(wizStates);

const TYPE_ICON = { tax: '💸', bonus: '🎁', loyalty_bonus: '🏆' };
const TYPE_LABEL = { tax: 'Tax', bonus: 'Bonus', loyalty_bonus: 'Loyalty' };

// ═══════════════════════════════════════════════════════════════════
//  DASHBOARD — Clean overview + quick actions
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery('admin:benefits', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await showDashboard(ctx);
});

async function showDashboard(ctx) {
  const pool = ctx.dbPool;
  const enabled = await settingsRepo.getSetting(pool, 'deposit_benefits_enabled');
  const rules = await depositRulesRepo.getAllRules(pool);
  const stats = await depositRulesRepo.getStats(pool);

  const statusIcon = enabled ? '🟢' : '🔴';
  const toggleLabel = enabled ? '🔴 Turn OFF' : '🟢 Turn ON';

  // ── Build message ──
  let text =
    `💎 <b>Deposit Benefits</b>\n\n` +
    `System: ${statusIcon} <b>${enabled ? 'Active' : 'Inactive'}</b>\n`;

  if (stats.totalBonus > 0 || stats.totalTax > 0) {
    text += `\n<blockquote>` +
      `📊 <b>Stats</b>\n` +
      `Bonus Given: <b>₹${formatNumber(stats.totalBonus)}</b>\n` +
      `Tax Collected: <b>₹${formatNumber(stats.totalTax)}</b>` +
      `</blockquote>\n`;
  }

  // Show rules as clean list
  if (rules.length > 0) {
    text += `\n━━━ <b>Active Rules</b> (${rules.length}) ━━━\n\n`;
    for (const r of rules) {
      const icon = TYPE_ICON[r.rule_type] || '📌';
      const status = r.is_enabled ? '🟢' : '⚫';
      const pct = parseFloat(r.percentage);
      text += `${status} ${icon} <b>${escapeHtml(r.title)}</b> — ${pct}%\n`;
    }
  } else {
    text += `\n<i>No rules yet. Add your first rule below!</i>\n`;
  }

  // ── Keyboard ──
  const kb = new InlineKeyboard()
    .text(toggleLabel, 'benefits:toggle').row()
    .text('➕ Add Rule', 'benefits:add').text('⚡ Quick Templates', 'benefits:templates').row();

  if (rules.length > 0) {
    kb.text('📋 Manage Rules', 'benefits:rules').text('📊 Analytics', 'benefits:analytics').row();
    kb.text('🔮 Test Simulator', 'benefits:simulate').row();
  }

  kb.text('◀ Back', 'admin:back');

  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  } catch {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

// Toggle system
composer.callbackQuery('benefits:toggle', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const current = await settingsRepo.getSetting(pool, 'deposit_benefits_enabled');
  await settingsRepo.setSetting(pool, 'deposit_benefits_enabled', !current, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED,
    { action: 'toggle_benefits', enabled: !current });
  await showDashboard(ctx);
});

// ═══════════════════════════════════════════════════════════════════
//  QUICK TEMPLATES — One-tap rule creation
// ═══════════════════════════════════════════════════════════════════

const TEMPLATES = [
  { id: 'tax_small', title: 'Small Deposit Tax', type: 'tax', emoji: '💸', min: 0, max: 99, pct: 10, rolling: 0, desc: 'Deposits below ₹100 → 10% tax' },
  { id: 'tax_medium', title: 'Medium Deposit Tax', type: 'tax', emoji: '💸', min: 0, max: 499, pct: 5, rolling: 0, desc: 'Deposits below ₹500 → 5% tax' },
  { id: 'bonus_500', title: 'Deposit ₹500+ Bonus', type: 'bonus', emoji: '🎁', min: 500, max: 0, pct: 3, rolling: 0, desc: 'Deposits ₹500+ → 3% bonus' },
  { id: 'bonus_1000', title: 'Deposit ₹1000+ Bonus', type: 'bonus', emoji: '🤑', min: 1000, max: 0, pct: 5, rolling: 0, desc: 'Deposits ₹1000+ → 5% bonus' },
  { id: 'bonus_5000', title: 'Whale Deposit Bonus', type: 'bonus', emoji: '🐋', min: 5000, max: 0, pct: 10, rolling: 0, desc: 'Deposits ₹5000+ → 10% bonus' },
  { id: 'loyalty_3k', title: '30-Day ₹3000 Loyalty', type: 'loyalty_bonus', emoji: '🏆', min: 0, max: 0, pct: 5, rolling: 3000, desc: '30-day total ₹3000+ → 5% loyalty bonus' },
  { id: 'loyalty_10k', title: '30-Day ₹10000 VIP', type: 'loyalty_bonus', emoji: '👑', min: 0, max: 0, pct: 10, rolling: 10000, desc: '30-day total ₹10000+ → 10% loyalty bonus' },
];

composer.callbackQuery('benefits:templates', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}

  let text =
    `⚡ <b>Quick Templates</b>\n\n` +
    `<i>Tap a template to create it instantly.\nYou can edit values after creating.</i>\n\n`;

  text += `<blockquote><b>💸 Tax Rules</b>\n`;
  for (const t of TEMPLATES.filter(t => t.type === 'tax')) {
    text += `▸ ${t.desc}\n`;
  }
  text += `\n<b>🎁 Bonus Rules</b>\n`;
  for (const t of TEMPLATES.filter(t => t.type === 'bonus')) {
    text += `▸ ${t.desc}\n`;
  }
  text += `\n<b>🏆 Loyalty Rules</b>\n`;
  for (const t of TEMPLATES.filter(t => t.type === 'loyalty_bonus')) {
    text += `▸ ${t.desc}\n`;
  }
  text += `</blockquote>`;

  const kb = new InlineKeyboard();
  // Tax templates
  for (const t of TEMPLATES.filter(t => t.type === 'tax')) {
    kb.text(`💸 ${t.title}`, `benefits:tpl:${t.id}`).row();
  }
  // Bonus templates
  for (const t of TEMPLATES.filter(t => t.type === 'bonus')) {
    kb.text(`🎁 ${t.title}`, `benefits:tpl:${t.id}`).row();
  }
  // Loyalty templates
  for (const t of TEMPLATES.filter(t => t.type === 'loyalty_bonus')) {
    kb.text(`🏆 ${t.title}`, `benefits:tpl:${t.id}`).row();
  }
  kb.text('◀ Back', 'admin:benefits');

  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  } catch {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
});

// Handle template creation
composer.callbackQuery(/^benefits:tpl:/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const tplId = ctx.callbackQuery.data.replace('benefits:tpl:', '');
  const tpl = TEMPLATES.find(t => t.id === tplId);
  if (!tpl) return;

  const pool = ctx.dbPool;

  // Check for conflicts
  const existing = await depositRulesRepo.getAllRules(pool);
  const conflict = findConflict(existing, tpl.type, tpl.min, tpl.max, tpl.rolling);

  if (conflict) {
    await showConflictWarning(ctx, conflict, tpl);
    return;
  }

  // Auto-assign priority
  const sameType = existing.filter(e => e.rule_type === tpl.type);
  const priority = sameType.reduce((max, e) => Math.max(max, e.priority), 0) + 10;

  const saved = await depositRulesRepo.createRule(pool, {
    title: tpl.title, emoji: tpl.emoji, rule_type: tpl.type,
    min_deposit: tpl.min, max_deposit: tpl.max, rolling_30d_min: tpl.rolling,
    percentage: tpl.pct, priority, created_by: ctx.from.id,
  });

  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED,
    { action: 'add_deposit_rule', rule_id: saved.id, title: saved.title });

  await ctx.editMessageText(
    `✅ <b>Rule Created!</b>\n\n` +
    `${tpl.emoji} <b>${escapeHtml(saved.title)}</b>\n` +
    `${tpl.desc}\n\n` +
    `<i>You can edit the values from Manage Rules.</i>`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard()
      .text('✏️ Edit Rule', `benefits:edit:${saved.id}`).row()
      .text('📋 All Rules', 'benefits:rules').text('◀ Dashboard', 'admin:benefits')
    }
  );
});

// Conflict warning for templates
async function showConflictWarning(ctx, conflict, tpl) {
  const c = conflict;
  const badge = `${TYPE_ICON[c.rule_type]} ${TYPE_LABEL[c.rule_type]}`;

  let text =
    `⚠️ <b>Similar Rule Exists!</b>\n\n` +
    `<blockquote>` +
    `You already have a similar rule:\n\n` +
    `${c.emoji || '📌'} <b>${escapeHtml(c.title)}</b>\n` +
    `${badge} — ${parseFloat(c.percentage)}%\n` +
    `Status: ${c.is_enabled ? '🟢 Active' : '⚫ Off'}` +
    `</blockquote>\n\n` +
    `<i>Edit the existing rule or create a new one anyway.</i>`;

  // Store template in wizard state for "save anyway"
  wizStates.set(ctx.chat.id, { step: 'tpl_force', tpl });

  const kb = new InlineKeyboard()
    .text(`✏️ Edit Existing`, `benefits:edit:${c.id}`).row()
    .text('✅ Create Anyway', 'benefits:tpl_force').row()
    .text('◀ Back', 'benefits:templates');

  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  } catch {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

// Force create template despite conflict
composer.callbackQuery('benefits:tpl_force', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const state = wizStates.get(ctx.chat.id);
  if (!state?.tpl) {
    await ctx.editMessageText('⚠️ Session expired.', { reply_markup: new InlineKeyboard().text('◀ Back', 'admin:benefits') });
    return;
  }

  const pool = ctx.dbPool;
  const tpl = state.tpl;
  const existing = await depositRulesRepo.getAllRules(pool);
  const sameType = existing.filter(e => e.rule_type === tpl.type);
  const priority = sameType.reduce((max, e) => Math.max(max, e.priority), 0) + 10;

  const saved = await depositRulesRepo.createRule(pool, {
    title: tpl.title, emoji: tpl.emoji, rule_type: tpl.type,
    min_deposit: tpl.min, max_deposit: tpl.max, rolling_30d_min: tpl.rolling,
    percentage: tpl.pct, priority, created_by: ctx.from.id,
  });
  wizStates.delete(ctx.chat.id);

  await ctx.editMessageText(
    `✅ Rule <b>${escapeHtml(saved.title)}</b> created!`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard()
      .text('✏️ Edit', `benefits:edit:${saved.id}`).text('◀ Dashboard', 'admin:benefits')
    }
  );
});

// ═══════════════════════════════════════════════════════════════════
//  ADD CUSTOM RULE — Just 2 steps
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery('benefits:add', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  wizStates.delete(ctx.chat.id);

  const text =
    `➕ <b>Add Custom Rule</b>\n\n` +
    `What type of rule?\n\n` +
    `<blockquote>` +
    `💸 <b>Tax</b> — Deducts % from small deposits\n` +
    `🎁 <b>Bonus</b> — Adds % bonus for bigger deposits\n` +
    `🏆 <b>Loyalty</b> — Bonus for consistent depositors (30-day total)` +
    `</blockquote>`;

  const kb = new InlineKeyboard()
    .text('💸 Tax', 'benefits:new:tax').row()
    .text('🎁 Bonus', 'benefits:new:bonus').row()
    .text('🏆 Loyalty', 'benefits:new:loyalty_bonus').row()
    .text('◀ Back', 'admin:benefits');

  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  } catch {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
});

// Step 1: Type selected → ask for values in ONE message
composer.callbackQuery(/^benefits:new:/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const ruleType = ctx.callbackQuery.data.replace('benefits:new:', '');

  wizStates.set(ctx.chat.id, { step: 'values', ruleType });

  let prompt;
  if (ruleType === 'tax') {
    prompt =
      `💸 <b>Create Tax Rule</b>\n\n` +
      `Send values in this format:\n\n` +
      `<code>min  max  percentage</code>\n\n` +
      `<blockquote>` +
      `<b>Examples:</b>\n` +
      `<code>0 99 10</code> → Deposits ₹0–₹99 get 10% tax\n` +
      `<code>0 499 5</code> → Deposits ₹0–₹499 get 5% tax\n` +
      `<code>0 50 15</code> → Deposits ₹0–₹50 get 15% tax` +
      `</blockquote>`;
  } else if (ruleType === 'bonus') {
    prompt =
      `🎁 <b>Create Bonus Rule</b>\n\n` +
      `Send values in this format:\n\n` +
      `<code>min_deposit  percentage</code>\n\n` +
      `<blockquote>` +
      `<b>Examples:</b>\n` +
      `<code>500 5</code> → Deposits ₹500+ get 5% bonus\n` +
      `<code>1000 8</code> → Deposits ₹1000+ get 8% bonus\n` +
      `<code>5000 10</code> → Deposits ₹5000+ get 10% bonus` +
      `</blockquote>`;
  } else {
    prompt =
      `🏆 <b>Create Loyalty Rule</b>\n\n` +
      `Send values in this format:\n\n` +
      `<code>30day_total  percentage</code>\n\n` +
      `<blockquote>` +
      `<b>Examples:</b>\n` +
      `<code>3000 5</code> → 30-day deposits ₹3000+ → 5% bonus\n` +
      `<code>10000 10</code> → 30-day deposits ₹10000+ → 10% bonus\n` +
      `<code>50000 15</code> → 30-day deposits ₹50000+ → 15% bonus` +
      `</blockquote>`;
  }

  await ctx.editMessageText(prompt, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('❌ Cancel', 'admin:benefits')
  });
});

// Step 2: Parse values and create
composer.on('message:text', async (ctx, next) => {
  const state = wizStates.get(ctx.chat?.id);
  if (!state) return next();

  const pool = ctx.dbPool;
  const text = ctx.message.text.trim();

  switch (state.step) {
    case 'values': {
      const parts = text.split(/[\s,]+/).map(Number);

      let ruleData;
      if (state.ruleType === 'tax') {
        if (parts.length < 3 || parts.some(isNaN)) {
          await ctx.reply('⚠️ Send 3 numbers: <code>min max percentage</code>\nExample: <code>0 99 10</code>', { parse_mode: 'HTML' });
          return;
        }
        const [min, max, pct] = parts;
        if (pct <= 0 || pct > 100) { await ctx.reply('⚠️ Percentage must be 1–100'); return; }
        if (min < 0 || max < 0) { await ctx.reply('⚠️ Amounts cannot be negative'); return; }
        if (max > 0 && max <= min) { await ctx.reply('⚠️ Max must be greater than Min'); return; }

        ruleData = {
          title: `Tax ${pct}% (₹${min}–₹${max})`,
          emoji: '💸', rule_type: 'tax',
          min_deposit: min, max_deposit: max,
          percentage: pct, rolling_30d_min: 0,
        };
      } else if (state.ruleType === 'bonus') {
        if (parts.length < 2 || parts.some(isNaN)) {
          await ctx.reply('⚠️ Send 2 numbers: <code>min_deposit percentage</code>\nExample: <code>500 5</code>', { parse_mode: 'HTML' });
          return;
        }
        const [min, pct] = parts;
        if (pct <= 0 || pct > 100) { await ctx.reply('⚠️ Percentage must be 1–100'); return; }
        if (min < 0) { await ctx.reply('⚠️ Amount cannot be negative'); return; }

        ruleData = {
          title: `${pct}% Bonus (₹${formatNumber(min)}+)`,
          emoji: min >= 5000 ? '🐋' : min >= 1000 ? '🤑' : '🎁',
          rule_type: 'bonus',
          min_deposit: min, max_deposit: 0,
          percentage: pct, rolling_30d_min: 0,
        };
      } else {
        // loyalty_bonus
        if (parts.length < 2 || parts.some(isNaN)) {
          await ctx.reply('⚠️ Send 2 numbers: <code>30day_total percentage</code>\nExample: <code>5000 7</code>', { parse_mode: 'HTML' });
          return;
        }
        const [rolling, pct] = parts;
        if (pct <= 0 || pct > 100) { await ctx.reply('⚠️ Percentage must be 1–100'); return; }
        if (rolling < 0) { await ctx.reply('⚠️ Amount cannot be negative'); return; }

        ruleData = {
          title: `${pct}% Loyalty (30d ₹${formatNumber(rolling)}+)`,
          emoji: rolling >= 10000 ? '👑' : '🏆',
          rule_type: 'loyalty_bonus',
          min_deposit: 0, max_deposit: 0,
          percentage: pct, rolling_30d_min: rolling,
        };
      }

      // Check for conflicts
      const existing = await depositRulesRepo.getAllRules(pool);
      const conflict = findConflict(existing, ruleData.rule_type, ruleData.min_deposit, ruleData.max_deposit, ruleData.rolling_30d_min);

      if (conflict) {
        const c = conflict;
        wizStates.set(ctx.chat.id, { step: 'custom_force', ruleData });

        await ctx.reply(
          `⚠️ <b>Similar Rule Exists!</b>\n\n` +
          `<blockquote>` +
          `${c.emoji} <b>${escapeHtml(c.title)}</b> — ${parseFloat(c.percentage)}%\n` +
          `Status: ${c.is_enabled ? '🟢 Active' : '⚫ Off'}` +
          `</blockquote>\n\n` +
          `<i>Edit existing or create anyway?</i>`,
          { parse_mode: 'HTML', reply_markup: new InlineKeyboard()
            .text('✏️ Edit Existing', `benefits:edit:${c.id}`).row()
            .text('✅ Create Anyway', 'benefits:custom_force').row()
            .text('❌ Cancel', 'admin:benefits')
          }
        );
        return;
      }

      // No conflict → create directly
      await createRuleFromData(ctx, pool, ruleData);
      wizStates.delete(ctx.chat.id);
      return;
    }

    // ── Edit field handlers ──
    case 'edit_title': {
      if (text.length > 100) { await ctx.reply('⚠️ Max 100 characters.'); return; }
      await depositRulesRepo.updateRule(pool, state.ruleId, { title: text });
      wizStates.delete(ctx.chat.id);
      await ctx.reply('✅ Title updated!', { reply_markup: backToRuleKb(state.ruleId) });
      return;
    }
    case 'edit_emoji': {
      await depositRulesRepo.updateRule(pool, state.ruleId, { emoji: text.slice(0, 4) });
      wizStates.delete(ctx.chat.id);
      await ctx.reply('✅ Emoji updated!', { reply_markup: backToRuleKb(state.ruleId) });
      return;
    }
    case 'edit_percentage': {
      const pct = parseFloat(text);
      if (isNaN(pct) || pct <= 0 || pct > 100) { await ctx.reply('⚠️ Enter 0.1 – 100:'); return; }
      await depositRulesRepo.updateRule(pool, state.ruleId, { percentage: pct });
      wizStates.delete(ctx.chat.id);
      await ctx.reply('✅ Percentage updated!', { reply_markup: backToRuleKb(state.ruleId) });
      return;
    }
    case 'edit_min_deposit': {
      const val = parseFloat(text);
      if (isNaN(val) || val < 0) { await ctx.reply('⚠️ Enter a valid amount:'); return; }
      await depositRulesRepo.updateRule(pool, state.ruleId, { min_deposit: val });
      wizStates.delete(ctx.chat.id);
      await ctx.reply('✅ Min deposit updated!', { reply_markup: backToRuleKb(state.ruleId) });
      return;
    }
    case 'edit_max_deposit': {
      const val = parseFloat(text);
      if (isNaN(val) || val < 0) { await ctx.reply('⚠️ Enter a valid amount (0 = no limit):'); return; }
      await depositRulesRepo.updateRule(pool, state.ruleId, { max_deposit: val });
      wizStates.delete(ctx.chat.id);
      await ctx.reply('✅ Max deposit updated!', { reply_markup: backToRuleKb(state.ruleId) });
      return;
    }
    case 'edit_rolling_30d': {
      const val = parseFloat(text);
      if (isNaN(val) || val < 0) { await ctx.reply('⚠️ Enter a valid amount:'); return; }
      await depositRulesRepo.updateRule(pool, state.ruleId, { rolling_30d_min: val });
      wizStates.delete(ctx.chat.id);
      await ctx.reply('✅ 30-day minimum updated!', { reply_markup: backToRuleKb(state.ruleId) });
      return;
    }
    case 'edit_message': {
      await depositRulesRepo.updateRule(pool, state.ruleId, { custom_message: text });
      wizStates.delete(ctx.chat.id);
      await ctx.reply('✅ Custom message updated!', { reply_markup: backToRuleKb(state.ruleId) });
      return;
    }
    case 'simulate_user': {
      const userId = parseInt(text);
      if (isNaN(userId)) { await ctx.reply('⚠️ Enter a valid user ID:'); return; }
      state.simulateUserId = userId;
      state.step = 'simulate_amount';
      wizStates.set(ctx.chat.id, state);
      await ctx.reply('💰 Now enter the <b>deposit amount</b> to test:', { parse_mode: 'HTML' });
      return;
    }
    case 'simulate_amount': {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) { await ctx.reply('⚠️ Enter a positive amount:'); return; }
      wizStates.delete(ctx.chat.id);
      await runSimulation(ctx, state.simulateUserId, amount);
      return;
    }

    default:
      return next();
  }
});

// Force create custom rule despite conflict
composer.callbackQuery('benefits:custom_force', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const state = wizStates.get(ctx.chat.id);
  if (!state?.ruleData) {
    await ctx.editMessageText('⚠️ Session expired.', { reply_markup: new InlineKeyboard().text('◀ Back', 'admin:benefits') });
    return;
  }
  await createRuleFromData(ctx, ctx.dbPool, state.ruleData);
  wizStates.delete(ctx.chat.id);
});

// Helper: create rule from parsed data
async function createRuleFromData(ctx, pool, data) {
  const existing = await depositRulesRepo.getAllRules(pool);
  const sameType = existing.filter(e => e.rule_type === data.rule_type);
  const priority = sameType.reduce((max, e) => Math.max(max, e.priority), 0) + 10;

  const saved = await depositRulesRepo.createRule(pool, {
    ...data, priority, created_by: ctx.from.id,
  });

  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED,
    { action: 'add_deposit_rule', rule_id: saved.id, title: saved.title });

  const msg =
    `✅ <b>Rule Created!</b>\n\n` +
    `${saved.emoji} <b>${escapeHtml(saved.title)}</b>\n` +
    `${TYPE_ICON[saved.rule_type]} ${parseFloat(saved.percentage)}%\n\n` +
    `<i>Edit values anytime from Manage Rules.</i>`;

  const kb = new InlineKeyboard()
    .text('✏️ Edit Rule', `benefits:edit:${saved.id}`).row()
    .text('➕ Add Another', 'benefits:add').text('◀ Dashboard', 'admin:benefits');

  try {
    await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: kb });
  } catch {
    await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: kb });
  }
}

// Helper: back to rule keyboard
function backToRuleKb(ruleId) {
  return new InlineKeyboard().text('◀ Back to Rule', `benefits:edit:${ruleId}`);
}

// Helper: find conflicting rule
function findConflict(rules, ruleType, minDep, maxDep, rolling) {
  return rules.find(e => {
    if (e.rule_type !== ruleType) return false;
    const eMin = parseFloat(e.min_deposit) || 0;
    const eMax = parseFloat(e.max_deposit) || 0;
    const rMin = minDep || 0;
    const rMax = maxDep || 0;

    // For loyalty, compare rolling 30d thresholds
    if (ruleType === 'loyalty_bonus') {
      const eRolling = parseFloat(e.rolling_30d_min) || 0;
      const rRolling = rolling || 0;
      return Math.abs(eRolling - rRolling) < 100; // within ₹100 = same tier
    }

    // For tax/bonus, check range overlap
    const effectiveEMax = eMax > 0 ? eMax : Infinity;
    const effectiveRMax = rMax > 0 ? rMax : Infinity;
    return rMin <= effectiveEMax && effectiveRMax >= eMin;
  }) || null;
}

// ═══════════════════════════════════════════════════════════════════
//  MANAGE RULES — List + inline edit/toggle/delete
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery('benefits:rules', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await showRulesList(ctx);
});

async function showRulesList(ctx, page = 0) {
  const pool = ctx.dbPool;
  const rules = await depositRulesRepo.getAllRules(pool);

  if (rules.length === 0) {
    await ctx.editMessageText(
      `📋 <b>No Rules Yet</b>\n\n<i>Create your first rule!</i>`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('➕ Add Rule', 'benefits:add').text('⚡ Templates', 'benefits:templates').row().text('◀ Back', 'admin:benefits') }
    );
    return;
  }

  const PAGE_SIZE = 5;
  const totalPages = Math.ceil(rules.length / PAGE_SIZE);
  const pageRules = rules.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  let text = `📋 <b>All Rules</b> (${rules.length})\n\n`;

  for (const r of pageRules) {
    const icon = TYPE_ICON[r.rule_type] || '📌';
    const status = r.is_enabled ? '🟢' : '⚫';
    const pct = parseFloat(r.percentage);
    const min = parseFloat(r.min_deposit);
    const max = parseFloat(r.max_deposit);
    const rolling = parseFloat(r.rolling_30d_min);

    text += `${status} ${r.emoji || icon} <b>${escapeHtml(r.title)}</b>\n`;
    text += `   ${pct}%`;
    if (r.rule_type === 'tax') {
      text += ` • ₹${formatNumber(min)}${max > 0 ? `–₹${formatNumber(max)}` : '+'}`;
    } else if (r.rule_type === 'bonus') {
      text += ` • ₹${formatNumber(min)}+`;
    } else if (rolling > 0) {
      text += ` • 30d ₹${formatNumber(rolling)}+`;
    }
    if (r.vip_only) text += ` • 👑`;
    text += `\n\n`;
  }

  const kb = new InlineKeyboard();
  for (const r of pageRules) {
    const toggleIcon = r.is_enabled ? '⚫' : '🟢';
    kb.text(`✏️ ${r.title.slice(0, 12)}`, `benefits:edit:${r.id}`)
      .text(`${toggleIcon}`, `benefits:rule_toggle:${r.id}`)
      .text('🗑', `benefits:delete:${r.id}`)
      .row();
  }

  if (totalPages > 1) {
    if (page > 0) kb.text('◀ Prev', `benefits:pg:${page - 1}`);
    kb.text(`${page + 1}/${totalPages}`, 'noop');
    if (page < totalPages - 1) kb.text('Next ▶', `benefits:pg:${page + 1}`);
    kb.row();
  }

  kb.text('➕ Add Rule', 'benefits:add').row();
  kb.text('◀ Dashboard', 'admin:benefits');

  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  } catch {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

// Pagination
composer.callbackQuery(/^benefits:pg:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const page = parseInt(ctx.callbackQuery.data.split(':')[2]);
  await showRulesList(ctx, page);
});

// Toggle rule
composer.callbackQuery(/^benefits:rule_toggle:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  await depositRulesRepo.toggleRule(ctx.dbPool, id);
  await showRulesList(ctx);
});

// Delete rule (with confirmation)
composer.callbackQuery(/^benefits:delete:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  const rule = await depositRulesRepo.getRule(ctx.dbPool, id);
  if (!rule) { await showRulesList(ctx); return; }

  await ctx.editMessageText(
    `🗑 <b>Delete Rule?</b>\n\n${rule.emoji} <b>${escapeHtml(rule.title)}</b>\n\n<i>This cannot be undone.</i>`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard()
      .text('🗑 Yes, Delete', `benefits:confirm_del:${id}`).text('❌ No', 'benefits:rules')
    }
  );
});

composer.callbackQuery(/^benefits:confirm_del:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  await depositRulesRepo.deleteRule(ctx.dbPool, id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED,
    { action: 'delete_deposit_rule', rule_id: id });
  await showRulesList(ctx);
});

// ═══════════════════════════════════════════════════════════════════
//  EDIT RULE — Tap field to edit
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery(/^benefits:edit:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  wizStates.delete(ctx.chat.id); // clear any lingering state
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  await showEditRule(ctx, id);
});

async function showEditRule(ctx, id) {
  const rule = await depositRulesRepo.getRule(ctx.dbPool, id);
  if (!rule) {
    try {
      await ctx.editMessageText('⚠️ Rule not found.', { reply_markup: new InlineKeyboard().text('◀ Back', 'benefits:rules') });
    } catch {
      await ctx.reply('⚠️ Rule not found.', { reply_markup: new InlineKeyboard().text('◀ Back', 'benefits:rules') });
    }
    return;
  }

  const icon = TYPE_ICON[rule.rule_type] || '📌';
  const label = TYPE_LABEL[rule.rule_type] || rule.rule_type;
  const status = rule.is_enabled ? '🟢 Active' : '⚫ Disabled';
  const min = parseFloat(rule.min_deposit);
  const max = parseFloat(rule.max_deposit);
  const rolling = parseFloat(rule.rolling_30d_min);
  const pct = parseFloat(rule.percentage);

  let text =
    `✏️ <b>Edit Rule #${rule.id}</b>\n\n` +
    `<blockquote>` +
    `${rule.emoji || icon} <b>${escapeHtml(rule.title)}</b>\n\n` +
    `Type:    ${icon} ${label}\n` +
    `Status:  ${status}\n` +
    `Rate:    <b>${pct}%</b>\n`;

  if (rule.rule_type === 'tax') {
    text += `Range:   ₹${formatNumber(min)}${max > 0 ? ` – ₹${formatNumber(max)}` : '+'}\n`;
  } else if (rule.rule_type === 'bonus') {
    text += `Min:     ₹${formatNumber(min)}+\n`;
  }
  if (rule.rule_type === 'loyalty_bonus') {
    text += `30-day:  ₹${formatNumber(rolling)}+\n`;
  }
  text += `VIP:     ${rule.vip_only ? '👑 Yes' : 'No'}`;
  text += `</blockquote>`;

  const toggleLabel = rule.is_enabled ? '⚫ Disable' : '🟢 Enable';
  const vipLabel = rule.vip_only ? '👤 Remove VIP' : '👑 Set VIP Only';

  const kb = new InlineKeyboard()
    .text('📝 Title', `benefits:f:${id}:edit_title`).text('🎨 Emoji', `benefits:f:${id}:edit_emoji`).row()
    .text('📊 Rate %', `benefits:f:${id}:edit_percentage`).row();

  if (rule.rule_type === 'tax' || rule.rule_type === 'bonus') {
    kb.text('⬇ Min ₹', `benefits:f:${id}:edit_min_deposit`).text('⬆ Max ₹', `benefits:f:${id}:edit_max_deposit`).row();
  }
  if (rule.rule_type === 'loyalty_bonus') {
    kb.text('🏦 30-Day Min', `benefits:f:${id}:edit_rolling_30d`).row();
  }

  kb.text(toggleLabel, `benefits:rule_toggle2:${id}`).text(vipLabel, `benefits:vip:${id}`).row()
    .text('🗑 Delete', `benefits:delete:${id}`).row()
    .text('◀ Back to Rules', 'benefits:rules');

  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  } catch {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

// Toggle from edit screen (redirect back to edit, not list)
composer.callbackQuery(/^benefits:rule_toggle2:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  await depositRulesRepo.toggleRule(ctx.dbPool, id);
  await showEditRule(ctx, id);
});

// Toggle VIP
composer.callbackQuery(/^benefits:vip:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  const rule = await depositRulesRepo.getRule(ctx.dbPool, id);
  if (rule) await depositRulesRepo.updateRule(ctx.dbPool, id, { vip_only: !rule.vip_only });
  await showEditRule(ctx, id);
});

// Field edit entry
composer.callbackQuery(/^benefits:f:\d+:edit_/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const parts = ctx.callbackQuery.data.split(':');
  const id = parseInt(parts[2]);
  const field = parts[3];

  const prompts = {
    edit_title: '📝 Send new <b>title</b>:',
    edit_emoji: '🎨 Send new <b>emoji</b>:',
    edit_percentage: '📊 Send new <b>percentage</b> (1–100):',
    edit_min_deposit: '⬇ Send new <b>min deposit</b> amount:',
    edit_max_deposit: '⬆ Send new <b>max deposit</b> (0 = no limit):',
    edit_rolling_30d: '🏦 Send new <b>30-day minimum</b>:',
    edit_message: '💬 Send <b>custom message</b> for user:',
  };

  wizStates.set(ctx.chat.id, { step: field, ruleId: id });

  await ctx.reply(prompts[field] || 'Send new value:', {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('❌ Cancel', `benefits:edit:${id}`)
  });
});

// ═══════════════════════════════════════════════════════════════════
//  SIMULATOR — Test how rules apply
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery('benefits:simulate', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  wizStates.set(ctx.chat.id, { step: 'simulate_user' });

  await ctx.editMessageText(
    `🔮 <b>Rule Simulator</b>\n\n` +
    `Send a <b>User ID</b> to test with:\n\n` +
    `<i>Tests the rule engine without actually crediting.</i>`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'admin:benefits') }
  );
});

async function runSimulation(ctx, userId, amount) {
  const pool = ctx.dbPool;
  const benefits = await depositBenefitsService.calculateBenefits(pool, userId, amount, null, true);

  let text = `🔮 <b>Simulation</b>\n\n`;

  text += `<blockquote>`;
  text += `👤 User: <code>${userId}</code>\n`;
  text += `💰 Deposit: ₹${amount.toFixed(2)}\n`;
  text += `🏦 30-Day Total: ₹${formatNumber(benefits.rolling30d)}\n`;
  text += `━━━━━━━━━━━━━━━\n`;

  if (!benefits.active) {
    text += `⚠️ System is OFF — no rules applied\n`;
    text += `Credits: ₹${amount.toFixed(2)}`;
  } else {
    if (benefits.taxRule) {
      text += `🔴 Tax: ${parseFloat(benefits.taxRule.percentage)}% → -₹${benefits.taxAmount.toFixed(2)}\n`;
      text += `   "${escapeHtml(benefits.taxRule.title)}"\n`;
    } else {
      text += `🔴 Tax: —\n`;
    }
    if (benefits.bonusRule) {
      text += `🟢 Bonus: +${parseFloat(benefits.bonusRule.percentage)}% → +₹${benefits.bonusAmount.toFixed(2)}\n`;
      text += `   "${escapeHtml(benefits.bonusRule.title)}"\n`;
    } else {
      text += `🟢 Bonus: —\n`;
    }
    text += `━━━━━━━━━━━━━━━\n`;
    text += `💎 <b>User Gets: ₹${benefits.creditAmount.toFixed(2)}</b>`;
  }
  text += `</blockquote>`;

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('🔮 Test Again', 'benefits:simulate').text('◀ Dashboard', 'admin:benefits')
  });
}

// ═══════════════════════════════════════════════════════════════════
//  ANALYTICS
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery('benefits:analytics', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;

  const [daily, weekly, allTime, topRules] = await Promise.all([
    depositRulesRepo.getStats(pool, 1),
    depositRulesRepo.getStats(pool, 7),
    depositRulesRepo.getStats(pool),
    depositRulesRepo.getTopRules(pool, 5),
  ]);

  let text = `📊 <b>Bonus Analytics</b>\n\n`;

  text += `<blockquote>`;
  text += `<b>Last 24 Hours</b>\n`;
  text += `Bonuses: ${daily.bonusCount} (₹${formatNumber(daily.totalBonus)})\n`;
  text += `Tax: ${daily.taxCount} (₹${formatNumber(daily.totalTax)})\n\n`;
  text += `<b>Last 7 Days</b>\n`;
  text += `Bonuses: ${weekly.bonusCount} (₹${formatNumber(weekly.totalBonus)})\n`;
  text += `Tax: ${weekly.taxCount} (₹${formatNumber(weekly.totalTax)})\n\n`;
  text += `<b>All Time</b>\n`;
  text += `Total: ${allTime.totalRecords} records\n`;
  text += `Bonus: ₹${formatNumber(allTime.totalBonus)}\n`;
  text += `Tax: ₹${formatNumber(allTime.totalTax)}`;
  text += `</blockquote>\n`;

  if (topRules.length > 0) {
    text += `\n<b>Top Rules</b>\n`;
    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
    for (let i = 0; i < topRules.length; i++) {
      const r = topRules[i];
      text += `${medals[i]} ${escapeHtml(r.rule_title || '—')} (${r.times_applied}×, ₹${formatNumber(r.total_amount)})\n`;
    }
  }

  await ctx.editMessageText(text, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('🔄 Refresh', 'benefits:analytics').text('◀ Dashboard', 'admin:benefits')
  });
});

export default composer;
