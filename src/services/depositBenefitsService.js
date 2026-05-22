// ═══════════════════════════════════════════════════════════════════
//  DEPOSIT BENEFITS SERVICE — Smart Rule Engine
//
//  Calculates tax, bonus, and loyalty rewards for each deposit.
//  Algorithm:
//    1. Fetch active rules sorted by priority
//    2. Get user's rolling 30-day deposit total
//    3. Tax pass: find highest-priority matching tax rule
//    4. Bonus pass: find highest-priority matching bonus rule
//    5. Calculate final credit = deposit - tax + bonus
//    6. Build premium user message
// ═══════════════════════════════════════════════════════════════════

import * as settingsRepo from '../database/repositories/settingsRepo.js';
import * as depositRulesRepo from '../database/repositories/depositRulesRepo.js';
import { formatNumber } from '../utils/formatters.js';
import logger from '../utils/logger.js';

/**
 * Check if a rule matches the deposit criteria.
 */
function ruleMatches(rule, depositAmount, rolling30d) {

  // Expiry gate
  if (rule.expires_at && new Date(rule.expires_at) < new Date()) return false;

  // Deposit range gate
  const min = parseFloat(rule.min_deposit) || 0;
  const max = parseFloat(rule.max_deposit) || 0;
  if (depositAmount < min) return false;
  if (max > 0 && depositAmount > max) return false;

  // Rolling 30-day gate (for loyalty_bonus)
  const rolling30dMin = parseFloat(rule.rolling_30d_min) || 0;
  if (rolling30dMin > 0 && rolling30d < rolling30dMin) return false;

  return true;
}

/**
 * Calculate deposit benefits for a given deposit.
 *
 * @param {Pool} pool - Database pool
 * @param {number} userId - User ID
 * @param {number} depositAmount - Raw deposit amount
 * @param {string} orderId - Order ID (for duplicate protection)
 * @param {boolean} dryRun - If true, don't record bonus history (for simulation)
 * @returns {Object} Benefits calculation result
 */
export async function calculateBenefits(pool, userId, depositAmount, orderId = null, dryRun = false) {
  const result = {
    active: false,
    creditAmount: depositAmount,
    taxAmount: 0,
    bonusAmount: 0,
    taxRule: null,
    bonusRule: null,
    rolling30d: 0,
    netAdjustment: 0,
    userMessage: '',
  };

  try {
    // Check if system is enabled
    const enabled = await settingsRepo.getSetting(pool, 'deposit_benefits_enabled');
    if (!enabled) return result;

    result.active = true;

    // Anti-duplicate: check if bonus already applied for this order
    if (orderId && !dryRun) {
      const duplicate = await depositRulesRepo.checkDuplicateBonus(pool, orderId);
      if (duplicate) {
        logger.warn(`[Benefits] Duplicate bonus attempt for order ${orderId}`);
        result.active = false;
        return result;
      }
    }

    // Fetch active rules
    const rules = await depositRulesRepo.getActiveRules(pool);
    if (rules.length === 0) return result;

    // Cache rolling deposit totals per period (avoid duplicate queries)
    const rollingCache = {};
    async function getRolling(days) {
      if (!rollingCache[days]) {
        rollingCache[days] = await depositRulesRepo.getUserRolling30d(pool, userId, days);
      }
      return rollingCache[days];
    }

    // Get default 30-day for result display
    result.rolling30d = await getRolling(30);

    // ── Tax pass: find highest-priority matching tax rule ──────
    const taxRules = rules.filter(r => r.rule_type === 'tax');
    for (const rule of taxRules) {
      if (ruleMatches(rule, depositAmount, result.rolling30d)) {
        const pct = parseFloat(rule.percentage);
        result.taxAmount = Math.round(depositAmount * pct / 100 * 100) / 100;
        result.taxRule = rule;
        break;
      }
    }

    // ── Bonus pass: find BEST (highest %) matching bonus/loyalty rule ──
    // Check ALL matching rules and pick the one with highest percentage
    const bonusRules = rules.filter(r => r.rule_type === 'bonus' || r.rule_type === 'loyalty_bonus');
    let bestBonus = null;
    let bestPct = 0;

    for (const rule of bonusRules) {
      const period = parseInt(rule.rolling_period_days) || 30;
      const rollingTotal = await getRolling(period);
      if (ruleMatches(rule, depositAmount, rollingTotal)) {
        const pct = parseFloat(rule.percentage);
        if (pct > bestPct) {
          bestPct = pct;
          bestBonus = rule;
        }
      }
    }

    if (bestBonus) {
      result.bonusAmount = Math.round(depositAmount * bestPct / 100 * 100) / 100;
      result.bonusRule = bestBonus;
    }

    // ── Calculate net ──────────────────────────────────────────
    result.netAdjustment = result.bonusAmount - result.taxAmount;
    result.creditAmount = Math.round((depositAmount + result.netAdjustment) * 100) / 100;
    if (result.creditAmount < 0) result.creditAmount = 0;

    // ── Record bonus history (atomic, server-side) ────────────
    if (!dryRun) {
      if (result.taxRule) {
        await depositRulesRepo.recordBonus(pool, {
          user_id: userId,
          order_id: orderId,
          rule_id: result.taxRule.id,
          rule_title: result.taxRule.title,
          rule_type: 'tax',
          deposit_amount: depositAmount,
          applied_pct: parseFloat(result.taxRule.percentage),
          bonus_amount: -result.taxAmount,
          rolling_30d: result.rolling30d,
        });
      }
      if (result.bonusRule) {
        await depositRulesRepo.recordBonus(pool, {
          user_id: userId,
          order_id: orderId,
          rule_id: result.bonusRule.id,
          rule_title: result.bonusRule.title,
          rule_type: result.bonusRule.rule_type,
          deposit_amount: depositAmount,
          applied_pct: parseFloat(result.bonusRule.percentage),
          bonus_amount: result.bonusAmount,
          rolling_30d: result.rolling30d,
        });
      }
    }

    // ── Build user message ────────────────────────────────────
    result.userMessage = buildUserMessage(result, rules, depositAmount);

  } catch (err) {
    logger.error(`[Benefits] Calculation error: ${err.message}`);
    result.active = false;
  }

  return result;
}

/**
 * Build the premium user-facing benefit message.
 */
function buildUserMessage(result, allRules, depositAmount) {
  const lines = [];

  lines.push(`━━━━━ 💎 Exᴛʀᴀ Bᴇɴᴇғɪᴛs ━━━━━`);
  lines.push('');

  // Show applicable rules summary
  if (result.taxRule) {
    const emoji = result.taxRule.emoji || '😮‍💨';
    lines.push(`${emoji} <b>${result.taxRule.title}</b>`);
    lines.push(`   ↳ ${parseFloat(result.taxRule.percentage)}% Tax  •  -₹${result.taxAmount.toFixed(2)}`);
    lines.push('');
  }

  if (result.bonusRule) {
    const emoji = result.bonusRule.emoji || '🎁';
    lines.push(`${emoji} <b>${result.bonusRule.title}</b>`);
    lines.push(`   ↳ +${parseFloat(result.bonusRule.percentage)}% Bonus  •  +₹${result.bonusAmount.toFixed(2)}`);
    lines.push('');
  }

  // 30-day deposit info
  lines.push(`━━━ 🏦 30-Dᴀʏ Dᴇᴘᴏsɪᴛs ━━━`);
  lines.push(`   ↳ ₹${formatNumber(result.rolling30d)}`);

  // Show next tier hint
  const loyaltyRules = allRules
    .filter(r => (r.rule_type === 'loyalty_bonus' || r.rule_type === 'bonus') && r.is_enabled)
    .sort((a, b) => parseFloat(a.rolling_30d_min || a.min_deposit) - parseFloat(b.rolling_30d_min || b.min_deposit));

  const currentPct = result.bonusRule ? parseFloat(result.bonusRule.percentage) : 0;
  const nextTier = loyaltyRules.find(r => parseFloat(r.percentage) > currentPct);
  if (nextTier) {
    const needed = parseFloat(nextTier.rolling_30d_min || nextTier.min_deposit);
    const remaining = Math.max(0, needed - result.rolling30d);
    if (remaining > 0) {
      lines.push(`   💡 ₹${formatNumber(remaining)} more for ${parseFloat(nextTier.percentage)}% bonus`);
    }
  }

  return lines.join('\n');
}

/**
 * Get the deposit info message to show users BEFORE they deposit.
 * Shows all active rules as a tier table.
 */
export async function getDepositInfoMessage(pool, userId) {
  try {
    const enabled = await settingsRepo.getSetting(pool, 'deposit_benefits_enabled');
    if (!enabled) return null;

    const rules = await depositRulesRepo.getActiveRules(pool);
    if (rules.length === 0) return null;

    const rolling30d = userId ? await depositRulesRepo.getUserRolling30d(pool, userId) : 0;

    const simpleBonusRules = rules.filter(r => r.rule_type === 'bonus');
    const loyaltyRules = rules.filter(r => r.rule_type === 'loyalty_bonus')
      .sort((a, b) => parseFloat(a.rolling_30d_min) - parseFloat(b.rolling_30d_min));

    // Find user's current best bonus
    let currentPct = 0;
    let currentMinDeposit = 0;
    for (const rule of simpleBonusRules) {
      const pct = parseFloat(rule.percentage);
      if (pct > currentPct) {
        currentPct = pct;
        currentMinDeposit = parseFloat(rule.min_deposit) || 0;
      }
    }
    for (const rule of loyaltyRules) {
      const rolling = parseFloat(rule.rolling_30d_min) || 0;
      const pct = parseFloat(rule.percentage);
      if (rolling30d >= rolling && pct > currentPct) {
        currentPct = pct;
        currentMinDeposit = parseFloat(rule.min_deposit) || 0;
      }
    }

    // Get telegraph URL
    let telegraphUrl = await settingsRepo.getSetting(pool, 'telegraph_rules_url');

    // Auto-generate Telegraph page if it doesn't exist yet
    if (!telegraphUrl) {
      try {
        const { updateRulesPage } = await import('./telegraphService.js');
        telegraphUrl = await updateRulesPage(pool);
      } catch {}
    }

    // Build short, clean message
    let msg = `💎 <b>Extra deposit benefits</b> <i>(FREE)</i>\n\n`;

    msg += `<blockquote>`;
    msg += `🏦 <b>YOUR LAST 30 DAYS DEPOSIT</b>\n`;
    msg += `➜ ₹${formatNumber(rolling30d)}\n\n`;

    if (currentPct > 0) {
      msg += `🎁 You will get <b>${currentPct}% extra</b> on your current deposit amount\n`;
      if (currentMinDeposit > 0) msg += `<i>(if deposited more then ${formatNumber(currentMinDeposit)} rs)</i>\n`;
    }

    const nextTier = loyaltyRules.find(r => parseFloat(r.rolling_30d_min) > rolling30d);
    if (nextTier) {
      const needed = parseFloat(nextTier.rolling_30d_min) - rolling30d;
      const nextPct = parseFloat(nextTier.percentage);
      msg += `\n💡 <i>deposit ₹${formatNumber(needed)} more to unlock ${nextPct}%!</i>`;
    }
    msg += `</blockquote>`;

    return { text: msg, telegraphUrl };
  } catch (err) {
    logger.error(`[Benefits] Info message error: ${err.message}`);
    return null;
  }
}


