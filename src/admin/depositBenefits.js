// ═══════════════════════════════════════════════════════════════════
//  💎 DEPOSIT BENEFITS ADMIN — Premium Rule Engine Management
//
//  Screens:
//    1. Dashboard        (admin:benefits)
//    2. Rules List       (benefits:rules)
//    3. Add Rule Wizard  (benefits:add → benefitswiz:*)
//    4. Edit Rule        (benefits:edit:ID)
//    5. Simulate         (benefits:simulate)
//    6. Analytics        (benefits:analytics)
//    7. User Preview     (benefits:preview)
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
const wizStates = new Map(); // chatId → wizard state
registerAdminState(wizStates);

const RULE_TYPES = [
  { key: 'tax', label: '💸 Tax', desc: 'Deducts % from deposit' },
  { key: 'bonus', label: '🎁 Bonus', desc: 'Adds % bonus on deposit amount' },
  { key: 'loyalty_bonus', label: '🏆 Loyalty Bonus', desc: 'Bonus based on 30-day deposits' },
];

const TYPE_BADGE = { tax: '🔴 TAX', bonus: '🟢 BONUS', loyalty_bonus: '🏆 LOYALTY' };
const TYPE_EMOJI = { tax: '💸', bonus: '🎁', loyalty_bonus: '🏆' };

// ═══════════════════════════════════════════════════════════════════
//  1. DASHBOARD
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery('admin:benefits', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await showDashboard(ctx);
});

async function showDashboard(ctx) {
  const pool = ctx.dbPool;
  const enabled = await settingsRepo.getSetting(pool, 'deposit_benefits_enabled');
  const counts = await depositRulesRepo.countRules(pool);
  const stats = await depositRulesRepo.getStats(pool);

  const statusEmoji = enabled ? '🟢' : '🔴';
  const toggleLabel = enabled ? '🔴 Disable System' : '🟢 Enable System';

  let text =
    `╔══════════════════════════╗\n` +
    `   💎 <b>Dᴇᴘᴏsɪᴛ Bᴇɴᴇғɪᴛs Sʏsᴛᴇᴍ</b>\n` +
    `╚══════════════════════════╝\n\n` +
    `System: ${statusEmoji} <b>${enabled ? 'Active' : 'Inactive'}</b>\n\n`;

  text += `<blockquote>`;
  text += `📊 <b>Overview</b>\n`;
  text += `▸ Total Rules:        <b>${counts.total}</b>\n`;
  text += `▸ Active Tax:         <b>${counts.active_tax}</b>\n`;
  text += `▸ Active Bonus:       <b>${counts.active_bonus}</b>\n`;
  text += `▸ Loyalty Tiers:      <b>${counts.active_loyalty}</b>\n`;
  text += `▸ Bonus Distributed:  <b>₹${formatNumber(stats.totalBonus)}</b>\n`;
  text += `▸ Tax Collected:      <b>₹${formatNumber(stats.totalTax)}</b>`;
  text += `</blockquote>`;

  const kb = new InlineKeyboard()
    .text(toggleLabel, 'benefits:toggle').row()
    .text('📋 View Rules', 'benefits:rules').text('➕ Add Rule', 'benefits:add').row()
    .text('📊 Analytics', 'benefits:analytics').text('🔮 Simulate', 'benefits:simulate').row()
    .text('👁 User Preview', 'benefits:preview').row()
    .text('◀ Back', 'admin:back');

  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  } catch {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

// ── Toggle system ───────────────────────────────────────────────
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
//  2. RULES LIST
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery('benefits:rules', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await showRulesList(ctx);
});

async function showRulesList(ctx, page = 0) {
  const pool = ctx.dbPool;
  const rules = await depositRulesRepo.getAllRules(pool);

  if (rules.length === 0) {
    const kb = new InlineKeyboard()
      .text('➕ Add First Rule', 'benefits:add').row()
      .text('◀ Back', 'admin:benefits');
    await ctx.editMessageText(
      `📋 <b>Deposit Rules</b>\n\n<i>No rules configured yet. Add your first rule!</i>`,
      { parse_mode: 'HTML', reply_markup: kb }
    );
    return;
  }

  const PAGE_SIZE = 5;
  const totalPages = Math.ceil(rules.length / PAGE_SIZE);
  const pageRules = rules.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  let text =
    `📋 <b>Dᴇᴘᴏsɪᴛ Rᴜʟᴇs</b>  (${rules.length} total)\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  for (const rule of pageRules) {
    const status = rule.is_enabled ? '🟢' : '⚫';
    const badge = TYPE_BADGE[rule.rule_type] || rule.rule_type;
    const emoji = rule.emoji || TYPE_EMOJI[rule.rule_type] || '📌';
    const pct = parseFloat(rule.percentage);
    const min = parseFloat(rule.min_deposit);
    const max = parseFloat(rule.max_deposit);
    const rolling = parseFloat(rule.rolling_30d_min);

    text += `${status} ${emoji} <b>${escapeHtml(rule.title)}</b>\n`;
    text += `   <code>${badge}</code>  •  <b>${pct}%</b>  •  P${rule.priority}\n`;

    if (rule.rule_type === 'tax') {
      text += `   Range: ${min > 0 ? `₹${formatNumber(min)}` : '₹0'}${max > 0 ? ` – ₹${formatNumber(max)}` : '+'}\n`;
    } else if (rolling > 0) {
      text += `   30-day min: ₹${formatNumber(rolling)}\n`;
    } else if (min > 0) {
      text += `   Min deposit: ₹${formatNumber(min)}\n`;
    }

    if (rule.vip_only) text += `   👑 VIP Only\n`;
    if (rule.expires_at) {
      const exp = new Date(rule.expires_at);
      text += `   ⏰ Expires: ${exp.toLocaleDateString()}\n`;
    }
    text += `\n`;
  }

  const kb = new InlineKeyboard();

  // Rule action buttons (2 per row: edit + toggle)
  for (const rule of pageRules) {
    const toggleIcon = rule.is_enabled ? '⚫' : '🟢';
    kb.text(`✏️ #${rule.id}`, `benefits:edit:${rule.id}`)
      .text(`${toggleIcon} #${rule.id}`, `benefits:rule_toggle:${rule.id}`)
      .row();
  }

  // Pagination
  if (totalPages > 1) {
    if (page > 0) kb.text('◀ Prev', `benefits:rules_page:${page - 1}`);
    kb.text(`${page + 1}/${totalPages}`, 'noop');
    if (page < totalPages - 1) kb.text('Next ▶', `benefits:rules_page:${page + 1}`);
    kb.row();
  }

  kb.text('➕ Add Rule', 'benefits:add').row();
  kb.text('◀ Back', 'admin:benefits');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
}

// Pagination handler
composer.callbackQuery(/^benefits:rules_page:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const page = parseInt(ctx.callbackQuery.data.split(':')[2]);
  await showRulesList(ctx, page);
});

// Toggle individual rule
composer.callbackQuery(/^benefits:rule_toggle:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  await depositRulesRepo.toggleRule(ctx.dbPool, id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED,
    { action: 'toggle_rule', rule_id: id });
  await showRulesList(ctx);
});

// ═══════════════════════════════════════════════════════════════════
//  3. ADD RULE WIZARD
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery('benefits:add', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  wizStates.delete(ctx.chat.id);

  const kb = new InlineKeyboard();
  for (const t of RULE_TYPES) {
    kb.text(`${t.label}`, `benefitswiz:type:${t.key}`).row();
  }
  kb.text('❌ Cancel', 'benefits:cancel_wiz');

  await ctx.editMessageText(
    `➕ <b>Add New Rule</b>\n\n` +
    `Select the rule type:\n\n` +
    `<blockquote>` +
    `💸 <b>Tax</b> — Deducts % from deposits in a range\n` +
    `🎁 <b>Bonus</b> — Adds % bonus for deposit amounts\n` +
    `🏆 <b>Loyalty</b> — Bonus based on 30-day deposit total` +
    `</blockquote>`,
    { parse_mode: 'HTML', reply_markup: kb }
  );
});

// Step 1: Type selected → ask for title
composer.callbackQuery(/^benefitswiz:type:/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const ruleType = ctx.callbackQuery.data.split(':')[2];

  wizStates.set(ctx.chat.id, { step: 'title', rule: { rule_type: ruleType } });

  const typeLabel = RULE_TYPES.find(t => t.key === ruleType)?.label || ruleType;
  await ctx.editMessageText(
    `➕ <b>New ${typeLabel} Rule</b>\n\n` +
    `📝 Enter the <b>rule title</b>:\n\n` +
    `<i>Example: "Small Deposit Tax" or "Whale Bonus"</i>`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'benefits:cancel_wiz') }
  );
});

// Step 2: Title received → ask for emoji
composer.on('message:text', async (ctx, next) => {
  const state = wizStates.get(ctx.chat?.id);
  if (!state) return next();

  const pool = ctx.dbPool;
  const text = ctx.message.text.trim();

  switch (state.step) {
    case 'title': {
      if (text.length > 100) {
        await ctx.reply('⚠️ Title too long. Max 100 chars. Try again.');
        return;
      }
      state.rule.title = text;
      state.step = 'emoji';
      wizStates.set(ctx.chat.id, state);
      await ctx.reply(
        `📌 Now send an <b>emoji/icon</b> for this rule:\n\n` +
        `<i>Example: 😮‍💨 🤑 🎁 💎 🔥</i>`,
        { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('⏭ Skip (use default)', 'benefitswiz:skip_emoji').text('❌ Cancel', 'benefits:cancel_wiz') }
      );
      return;
    }

    case 'emoji': {
      state.rule.emoji = text.slice(0, 4);
      state.step = 'percentage';
      wizStates.set(ctx.chat.id, state);
      await askPercentage(ctx, state);
      return;
    }

    case 'percentage': {
      const pct = parseFloat(text);
      if (isNaN(pct) || pct <= 0 || pct > 100) {
        await ctx.reply('⚠️ Enter a valid percentage (0.1 – 100):');
        return;
      }
      state.rule.percentage = pct;
      state.step = 'min_deposit';
      wizStates.set(ctx.chat.id, state);
      await askMinDeposit(ctx, state);
      return;
    }

    case 'min_deposit': {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount < 0) {
        await ctx.reply('⚠️ Enter a valid amount (0 or more):');
        return;
      }
      state.rule.min_deposit = amount;
      state.step = 'max_deposit';
      wizStates.set(ctx.chat.id, state);
      await askMaxDeposit(ctx, state);
      return;
    }

    case 'max_deposit': {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount < 0) {
        await ctx.reply('⚠️ Enter a valid amount (0 = no limit):');
        return;
      }
      state.rule.max_deposit = amount;

      if (state.rule.rule_type === 'loyalty_bonus') {
        state.step = 'rolling_30d';
        wizStates.set(ctx.chat.id, state);
        await askRolling30d(ctx, state);
      } else {
        state.step = 'priority';
        wizStates.set(ctx.chat.id, state);
        await askPriority(ctx, state);
      }
      return;
    }

    case 'rolling_30d': {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount < 0) {
        await ctx.reply('⚠️ Enter a valid 30-day minimum (0 = no requirement):');
        return;
      }
      state.rule.rolling_30d_min = amount;
      state.step = 'priority';
      wizStates.set(ctx.chat.id, state);
      await askPriority(ctx, state);
      return;
    }

    case 'priority': {
      const pri = parseInt(text);
      if (isNaN(pri) || pri < 1 || pri > 999) {
        await ctx.reply('⚠️ Enter a priority number (1–999, lower = higher priority):');
        return;
      }
      state.rule.priority = pri;
      state.step = 'confirm';
      wizStates.set(ctx.chat.id, state);
      await showConfirmation(ctx, state);
      return;
    }

    case 'simulate_user': {
      const userId = parseInt(text);
      if (isNaN(userId)) {
        await ctx.reply('⚠️ Enter a valid user ID (number):');
        return;
      }
      state.simulateUserId = userId;
      state.step = 'simulate_amount';
      wizStates.set(ctx.chat.id, state);
      await ctx.reply(
        `💰 Now enter the <b>deposit amount</b> to simulate:\n\n<i>Example: 100, 500, 1000</i>`,
        { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'benefits:cancel_wiz') }
      );
      return;
    }

    case 'simulate_amount': {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('⚠️ Enter a valid positive amount:');
        return;
      }
      wizStates.delete(ctx.chat.id);
      await runSimulation(ctx, state.simulateUserId, amount);
      return;
    }

    // Edit states
    case 'edit_title': {
      if (text.length > 100) { await ctx.reply('⚠️ Max 100 chars.'); return; }
      await depositRulesRepo.updateRule(pool, state.ruleId, { title: text });
      wizStates.delete(ctx.chat.id);
      await ctx.reply('✅ Title updated!', { reply_markup: new InlineKeyboard().text('◀ Back to Rule', `benefits:edit:${state.ruleId}`) });
      return;
    }
    case 'edit_emoji': {
      await depositRulesRepo.updateRule(pool, state.ruleId, { emoji: text.slice(0, 4) });
      wizStates.delete(ctx.chat.id);
      await ctx.reply('✅ Emoji updated!', { reply_markup: new InlineKeyboard().text('◀ Back to Rule', `benefits:edit:${state.ruleId}`) });
      return;
    }
    case 'edit_percentage': {
      const pct = parseFloat(text);
      if (isNaN(pct) || pct <= 0 || pct > 100) { await ctx.reply('⚠️ Enter 0.1 – 100:'); return; }
      await depositRulesRepo.updateRule(pool, state.ruleId, { percentage: pct });
      wizStates.delete(ctx.chat.id);
      await ctx.reply('✅ Percentage updated!', { reply_markup: new InlineKeyboard().text('◀ Back to Rule', `benefits:edit:${state.ruleId}`) });
      return;
    }
    case 'edit_min_deposit': {
      const val = parseFloat(text);
      if (isNaN(val) || val < 0) { await ctx.reply('⚠️ Enter a valid amount:'); return; }
      await depositRulesRepo.updateRule(pool, state.ruleId, { min_deposit: val });
      wizStates.delete(ctx.chat.id);
      await ctx.reply('✅ Min deposit updated!', { reply_markup: new InlineKeyboard().text('◀ Back to Rule', `benefits:edit:${state.ruleId}`) });
      return;
    }
    case 'edit_max_deposit': {
      const val = parseFloat(text);
      if (isNaN(val) || val < 0) { await ctx.reply('⚠️ Enter a valid amount:'); return; }
      await depositRulesRepo.updateRule(pool, state.ruleId, { max_deposit: val });
      wizStates.delete(ctx.chat.id);
      await ctx.reply('✅ Max deposit updated!', { reply_markup: new InlineKeyboard().text('◀ Back to Rule', `benefits:edit:${state.ruleId}`) });
      return;
    }
    case 'edit_rolling_30d': {
      const val = parseFloat(text);
      if (isNaN(val) || val < 0) { await ctx.reply('⚠️ Enter a valid amount:'); return; }
      await depositRulesRepo.updateRule(pool, state.ruleId, { rolling_30d_min: val });
      wizStates.delete(ctx.chat.id);
      await ctx.reply('✅ 30-day minimum updated!', { reply_markup: new InlineKeyboard().text('◀ Back to Rule', `benefits:edit:${state.ruleId}`) });
      return;
    }
    case 'edit_priority': {
      const val = parseInt(text);
      if (isNaN(val) || val < 1 || val > 999) { await ctx.reply('⚠️ Enter 1–999:'); return; }
      await depositRulesRepo.updateRule(pool, state.ruleId, { priority: val });
      wizStates.delete(ctx.chat.id);
      await ctx.reply('✅ Priority updated!', { reply_markup: new InlineKeyboard().text('◀ Back to Rule', `benefits:edit:${state.ruleId}`) });
      return;
    }
    case 'edit_message': {
      await depositRulesRepo.updateRule(pool, state.ruleId, { custom_message: text });
      wizStates.delete(ctx.chat.id);
      await ctx.reply('✅ Custom message updated!', { reply_markup: new InlineKeyboard().text('◀ Back to Rule', `benefits:edit:${state.ruleId}`) });
      return;
    }

    default:
      return next();
  }
});

// Skip emoji
composer.callbackQuery('benefitswiz:skip_emoji', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const state = wizStates.get(ctx.chat.id);
  if (!state) return;
  state.rule.emoji = TYPE_EMOJI[state.rule.rule_type] || '🎁';
  state.step = 'percentage';
  wizStates.set(ctx.chat.id, state);
  await askPercentage(ctx, state);
});

async function askPercentage(ctx, state) {
  const label = state.rule.rule_type === 'tax' ? 'tax' : 'bonus';
  await ctx.reply(
    `📊 Enter the <b>${label} percentage</b>:\n\n<i>Example: 2, 5, 10, 12.5</i>`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'benefits:cancel_wiz') }
  );
}

async function askMinDeposit(ctx, state) {
  const hint = state.rule.rule_type === 'tax'
    ? 'Deposits BELOW this amount will be taxed'
    : 'Minimum deposit to qualify for this bonus';
  await ctx.reply(
    `💰 Enter <b>minimum deposit amount</b>:\n\n<i>${hint}</i>\n\n<i>Example: 0, 100, 500</i>`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('⏭ Skip (₹0)', 'benefitswiz:skip_min').text('❌ Cancel', 'benefits:cancel_wiz') }
  );
}

async function askMaxDeposit(ctx, state) {
  await ctx.reply(
    `💰 Enter <b>maximum deposit amount</b>:\n\n<i>0 = no upper limit</i>\n\n<i>Example: 0, 100, 5000</i>`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('⏭ Skip (No limit)', 'benefitswiz:skip_max').text('❌ Cancel', 'benefits:cancel_wiz') }
  );
}

async function askRolling30d(ctx, state) {
  await ctx.reply(
    `🏦 Enter <b>30-day rolling deposit minimum</b>:\n\n` +
    `<i>User must have deposited at least this much in the last 30 days to qualify.</i>\n\n` +
    `<i>Example: 500, 1000, 5000</i>`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('⏭ Skip (₹0)', 'benefitswiz:skip_rolling').text('❌ Cancel', 'benefits:cancel_wiz') }
  );
}

async function askPriority(ctx, state) {
  await ctx.reply(
    `🔢 Enter <b>priority</b> (1–999):\n\n` +
    `<blockquote>` +
    `Lower number = higher priority.\n` +
    `When multiple rules match, the one with lowest priority number wins.\n\n` +
    `Tip: Use 10, 20, 30... to leave gaps.` +
    `</blockquote>`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('⏭ Use default (100)', 'benefitswiz:skip_priority').text('❌ Cancel', 'benefits:cancel_wiz') }
  );
}

// Skip handlers
composer.callbackQuery('benefitswiz:skip_min', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const state = wizStates.get(ctx.chat.id);
  if (!state) return;
  state.rule.min_deposit = 0;
  state.step = 'max_deposit';
  wizStates.set(ctx.chat.id, state);
  await askMaxDeposit(ctx, state);
});

composer.callbackQuery('benefitswiz:skip_max', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const state = wizStates.get(ctx.chat.id);
  if (!state) return;
  state.rule.max_deposit = 0;
  if (state.rule.rule_type === 'loyalty_bonus') {
    state.step = 'rolling_30d';
    wizStates.set(ctx.chat.id, state);
    await askRolling30d(ctx, state);
  } else {
    state.step = 'priority';
    wizStates.set(ctx.chat.id, state);
    await askPriority(ctx, state);
  }
});

composer.callbackQuery('benefitswiz:skip_rolling', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const state = wizStates.get(ctx.chat.id);
  if (!state) return;
  state.rule.rolling_30d_min = 0;
  state.step = 'priority';
  wizStates.set(ctx.chat.id, state);
  await askPriority(ctx, state);
});

composer.callbackQuery('benefitswiz:skip_priority', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const state = wizStates.get(ctx.chat.id);
  if (!state) return;
  state.rule.priority = 100;
  state.step = 'confirm';
  wizStates.set(ctx.chat.id, state);
  await showConfirmation(ctx, state);
});

// Confirmation screen
async function showConfirmation(ctx, state) {
  const r = state.rule;
  const badge = TYPE_BADGE[r.rule_type] || r.rule_type;
  const min = r.min_deposit || 0;
  const max = r.max_deposit || 0;
  const rolling = r.rolling_30d_min || 0;

  let text =
    `✅ <b>Confirm New Rule</b>\n\n` +
    `<blockquote>` +
    `${r.emoji || '📌'} <b>${escapeHtml(r.title)}</b>\n` +
    `Type: ${badge}\n` +
    `Percentage: <b>${r.percentage}%</b>\n` +
    `Min Deposit: ₹${formatNumber(min)}\n` +
    `Max Deposit: ${max > 0 ? `₹${formatNumber(max)}` : 'No limit'}\n`;

  if (r.rule_type === 'loyalty_bonus') {
    text += `30-day Min: ₹${formatNumber(rolling)}\n`;
  }
  text += `Priority: ${r.priority}\n`;
  text += `</blockquote>\n\n`;
  text += `<i>Save this rule?</i>`;

  const kb = new InlineKeyboard()
    .text('✅ Save Rule', 'benefitswiz:confirm_save').row()
    .text('❌ Cancel', 'benefits:cancel_wiz');

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

composer.callbackQuery('benefitswiz:confirm_save', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const state = wizStates.get(ctx.chat.id);
  if (!state?.rule) {
    await ctx.reply('⚠️ Session expired. Try again.', {
      reply_markup: new InlineKeyboard().text('◀ Back', 'admin:benefits')
    });
    return;
  }

  const rule = state.rule;
  rule.created_by = ctx.from.id;
  const saved = await depositRulesRepo.createRule(ctx.dbPool, rule);
  wizStates.delete(ctx.chat.id);

  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED,
    { action: 'add_deposit_rule', rule_id: saved.id, title: saved.title });

  await ctx.reply(
    `✅ Rule <b>${escapeHtml(saved.title)}</b> created! (ID: ${saved.id})`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('📋 View Rules', 'benefits:rules').text('◀ Dashboard', 'admin:benefits') }
  );
});

// Cancel wizard
composer.callbackQuery('benefits:cancel_wiz', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  wizStates.delete(ctx.chat.id);
  await showDashboard(ctx);
});

// ═══════════════════════════════════════════════════════════════════
//  4. EDIT RULE
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery(/^benefits:edit:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  await showEditRule(ctx, id);
});

async function showEditRule(ctx, id) {
  const rule = await depositRulesRepo.getRule(ctx.dbPool, id);
  if (!rule) {
    await ctx.editMessageText('⚠️ Rule not found.', {
      reply_markup: new InlineKeyboard().text('◀ Back', 'benefits:rules')
    });
    return;
  }

  const badge = TYPE_BADGE[rule.rule_type] || rule.rule_type;
  const status = rule.is_enabled ? '🟢 Active' : '⚫ Disabled';
  const min = parseFloat(rule.min_deposit);
  const max = parseFloat(rule.max_deposit);
  const rolling = parseFloat(rule.rolling_30d_min);

  let text =
    `✏️ <b>Edit Rule #${rule.id}</b>\n\n` +
    `<blockquote>` +
    `${rule.emoji} <b>${escapeHtml(rule.title)}</b>\n` +
    `Type:        ${badge}\n` +
    `Status:      ${status}\n` +
    `Percentage:  <b>${parseFloat(rule.percentage)}%</b>\n` +
    `Min Deposit: ₹${formatNumber(min)}\n` +
    `Max Deposit: ${max > 0 ? `₹${formatNumber(max)}` : 'No limit'}\n`;

  if (rule.rule_type === 'loyalty_bonus') {
    text += `30-day Min:  ₹${formatNumber(rolling)}\n`;
  }
  text += `Priority:    ${rule.priority}\n`;
  text += `VIP Only:    ${rule.vip_only ? '👑 Yes' : 'No'}\n`;
  if (rule.custom_message) text += `Message:     "${escapeHtml(rule.custom_message)}"\n`;
  text += `</blockquote>`;

  const toggleLabel = rule.is_enabled ? '⚫ Disable' : '🟢 Enable';
  const vipLabel = rule.vip_only ? '👤 Remove VIP' : '👑 VIP Only';

  const kb = new InlineKeyboard()
    .text('📝 Title', `benefits:field:${id}:edit_title`).text('🎨 Emoji', `benefits:field:${id}:edit_emoji`).row()
    .text('📊 Percentage', `benefits:field:${id}:edit_percentage`).text('🔢 Priority', `benefits:field:${id}:edit_priority`).row()
    .text('⬇ Min Deposit', `benefits:field:${id}:edit_min_deposit`).text('⬆ Max Deposit', `benefits:field:${id}:edit_max_deposit`).row();

  if (rule.rule_type === 'loyalty_bonus') {
    kb.text('🏦 30-day Min', `benefits:field:${id}:edit_rolling_30d`).row();
  }

  kb.text('💬 Message', `benefits:field:${id}:edit_message`).row()
    .text(toggleLabel, `benefits:rule_toggle:${id}`).text(vipLabel, `benefits:toggle_vip:${id}`).row()
    .text('🗑 Delete', `benefits:delete:${id}`).row()
    .text('◀ Back to Rules', 'benefits:rules');

  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  } catch {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

// Field edit entry point
composer.callbackQuery(/^benefits:field:\d+:edit_/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const parts = ctx.callbackQuery.data.split(':');
  const id = parseInt(parts[2]);
  const field = parts[3]; // edit_title, edit_emoji, etc.

  const prompts = {
    edit_title: '📝 Enter new <b>title</b>:',
    edit_emoji: '🎨 Send new <b>emoji</b>:',
    edit_percentage: '📊 Enter new <b>percentage</b> (0.1–100):',
    edit_min_deposit: '⬇ Enter new <b>min deposit</b> amount:',
    edit_max_deposit: '⬆ Enter new <b>max deposit</b> (0 = no limit):',
    edit_rolling_30d: '🏦 Enter new <b>30-day rolling minimum</b>:',
    edit_priority: '🔢 Enter new <b>priority</b> (1–999):',
    edit_message: '💬 Enter a <b>custom message</b> shown to user:',
  };

  wizStates.set(ctx.chat.id, { step: field, ruleId: id });

  await ctx.reply(
    prompts[field] || `Enter new value for ${field}:`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', `benefits:edit:${id}`) }
  );
});

// Toggle VIP
composer.callbackQuery(/^benefits:toggle_vip:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  const rule = await depositRulesRepo.getRule(ctx.dbPool, id);
  if (rule) {
    await depositRulesRepo.updateRule(ctx.dbPool, id, { vip_only: !rule.vip_only });
  }
  await showEditRule(ctx, id);
});

// Delete rule
composer.callbackQuery(/^benefits:delete:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  const kb = new InlineKeyboard()
    .text('✅ Yes, Delete', `benefits:confirm_delete:${id}`)
    .text('❌ No', `benefits:edit:${id}`);

  await ctx.editMessageText(
    `🗑 <b>Delete Rule #${id}?</b>\n\n<i>This action cannot be undone.</i>`,
    { parse_mode: 'HTML', reply_markup: kb }
  );
});

composer.callbackQuery(/^benefits:confirm_delete:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const id = parseInt(ctx.callbackQuery.data.split(':')[2]);
  await depositRulesRepo.deleteRule(ctx.dbPool, id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED,
    { action: 'delete_deposit_rule', rule_id: id });
  await ctx.editMessageText(
    `✅ Rule #${id} deleted.`,
    { reply_markup: new InlineKeyboard().text('◀ Back to Rules', 'benefits:rules') }
  );
});

// ═══════════════════════════════════════════════════════════════════
//  5. SIMULATE
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery('benefits:simulate', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  wizStates.set(ctx.chat.id, { step: 'simulate_user' });

  await ctx.editMessageText(
    `🔮 <b>Deposit Simulator</b>\n\n` +
    `Enter a <b>user ID</b> to simulate for:\n\n` +
    `<i>This will test the rule engine without crediting anything.</i>`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'benefits:cancel_wiz') }
  );
});

async function runSimulation(ctx, userId, amount) {
  const pool = ctx.dbPool;
  const benefits = await depositBenefitsService.calculateBenefits(pool, userId, amount, null, true);

  let text =
    `🔮 <b>Simulation Result</b>\n\n` +
    `<blockquote>` +
    `👤 User ID: <code>${userId}</code>\n` +
    `💰 Deposit: ₹${amount.toFixed(2)}\n` +
    `🏦 30-day Total: ₹${formatNumber(benefits.rolling30d)}\n` +
    `━━━━━━━━━━━━━━━━━━\n`;

  if (!benefits.active) {
    text += `⚠️ System is <b>disabled</b>\n`;
    text += `Net Credit: ₹${amount.toFixed(2)} (no rules applied)`;
  } else {
    if (benefits.taxRule) {
      text += `🔴 Tax: <b>${parseFloat(benefits.taxRule.percentage)}%</b> → -₹${benefits.taxAmount.toFixed(2)}\n`;
      text += `   Rule: "${escapeHtml(benefits.taxRule.title)}"\n`;
    } else {
      text += `🔴 Tax: None matched\n`;
    }

    if (benefits.bonusRule) {
      text += `🟢 Bonus: <b>+${parseFloat(benefits.bonusRule.percentage)}%</b> → +₹${benefits.bonusAmount.toFixed(2)}\n`;
      text += `   Rule: "${escapeHtml(benefits.bonusRule.title)}"\n`;
    } else {
      text += `🟢 Bonus: None matched\n`;
    }

    text += `━━━━━━━━━━━━━━━━━━\n`;
    text += `💎 <b>Net Credit: ₹${benefits.creditAmount.toFixed(2)}</b>\n`;
    text += `   (${benefits.netAdjustment >= 0 ? '+' : ''}₹${benefits.netAdjustment.toFixed(2)} adjustment)`;
  }
  text += `</blockquote>`;

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('🔮 Simulate Again', 'benefits:simulate').text('◀ Dashboard', 'admin:benefits')
  });
}

// ═══════════════════════════════════════════════════════════════════
//  6. ANALYTICS
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

  let text =
    `📊 <b>Bᴏɴᴜs Aɴᴀʟʏᴛɪᴄs</b>\n\n`;

  text += `<blockquote>`;
  text += `━━━ Last 24 Hours ━━━\n`;
  text += `▸ Bonuses Given:  <b>${daily.bonusCount}</b>\n`;
  text += `▸ Total Bonus:    <b>₹${formatNumber(daily.totalBonus)}</b>\n`;
  text += `▸ Tax Collected:  <b>₹${formatNumber(daily.totalTax)}</b>\n`;
  text += `▸ Avg Bonus:      <b>₹${daily.avgBonus.toFixed(2)}</b>\n`;
  text += `\n`;
  text += `━━━ Last 7 Days ━━━\n`;
  text += `▸ Bonuses Given:  <b>${weekly.bonusCount}</b>\n`;
  text += `▸ Total Bonus:    <b>₹${formatNumber(weekly.totalBonus)}</b>\n`;
  text += `▸ Tax Collected:  <b>₹${formatNumber(weekly.totalTax)}</b>\n`;
  text += `\n`;
  text += `━━━ All Time ━━━\n`;
  text += `▸ Total Records:  <b>${allTime.totalRecords}</b>\n`;
  text += `▸ Total Bonus:    <b>₹${formatNumber(allTime.totalBonus)}</b>\n`;
  text += `▸ Total Tax:      <b>₹${formatNumber(allTime.totalTax)}</b>\n`;
  text += `</blockquote>\n\n`;

  if (topRules.length > 0) {
    text += `🏆 <b>Top Rules by Volume</b>\n\n`;
    topRules.forEach((r, i) => {
      const icon = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i] || `${i + 1}.`;
      text += `${icon} ${escapeHtml(r.rule_title || 'Unknown')}\n`;
      text += `   ${r.times_applied}× applied • ₹${formatNumber(r.total_amount)}\n`;
    });
  }

  const kb = new InlineKeyboard()
    .text('🔄 Refresh', 'benefits:analytics').row()
    .text('◀ Dashboard', 'admin:benefits');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
});

// ═══════════════════════════════════════════════════════════════════
//  7. USER PREVIEW
// ═══════════════════════════════════════════════════════════════════

composer.callbackQuery('benefits:preview', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;

  const infoMsg = await depositBenefitsService.getDepositInfoMessage(pool, ctx.from.id);

  if (!infoMsg) {
    await ctx.editMessageText(
      `👁 <b>User Preview</b>\n\n<i>System is disabled or no rules configured.</i>`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('◀ Back', 'admin:benefits') }
    );
    return;
  }

  await ctx.editMessageText(
    `👁 <b>User Preview</b>\n<i>This is what users see:</i>\n\n` + infoMsg,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('◀ Back', 'admin:benefits') }
  );
});

export default composer;
