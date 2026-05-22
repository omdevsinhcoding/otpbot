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

    // Get user's rolling 30-day deposit total
    result.rolling30d = await depositRulesRepo.getUserRolling30d(pool, userId);



    // ── Tax pass: find highest-priority matching tax rule ──────
    const taxRules = rules.filter(r => r.rule_type === 'tax');
    for (const rule of taxRules) {
      if (ruleMatches(rule, depositAmount, result.rolling30d)) {
        const pct = parseFloat(rule.percentage);
        result.taxAmount = Math.round(depositAmount * pct / 100 * 100) / 100;
        result.taxRule = rule;
        break; // First match wins (highest priority)
      }
    }

    // ── Bonus pass: find highest-priority matching bonus/loyalty rule
    const bonusRules = rules.filter(r => r.rule_type === 'bonus' || r.rule_type === 'loyalty_bonus');
    for (const rule of bonusRules) {
      if (ruleMatches(rule, depositAmount, result.rolling30d)) {
        const pct = parseFloat(rule.percentage);
        result.bonusAmount = Math.round(depositAmount * pct / 100 * 100) / 100;
        result.bonusRule = rule;
        break; // First match wins (highest priority)
      }
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



    const lines = [];
    lines.push(`━━━━━━━━━━━━━━━━`);
    lines.push(`💎 <b>EXTRA DEPOSIT BENEFITS</b>`);
    lines.push(`━━━━━━━━━━━━━━━━`);
    lines.push('');

    // Tax rules
    const taxRules = rules.filter(r => r.rule_type === 'tax');
    for (const r of taxRules) {

      const emoji = r.emoji || '😮‍💨';
      const max = parseFloat(r.max_deposit);
      const rangeStr = max > 0
        ? `₹${formatNumber(parseFloat(r.min_deposit))} – ₹${formatNumber(max)}`
        : `Below ₹${formatNumber(parseFloat(r.min_deposit) || 100)}`;
      lines.push(`${emoji} Deposit ${rangeStr}`);
      lines.push(`   → ${parseFloat(r.percentage)}% Tax`);
      lines.push('');
    }

    // Bonus rules
    const bonusRules = rules.filter(r => r.rule_type === 'bonus' || r.rule_type === 'loyalty_bonus');
    if (bonusRules.length > 0) {
      lines.push(`🥰 Deposit ₹${formatNumber(parseFloat(bonusRules[0].min_deposit) || 100)}+`);
      lines.push(`   → Bonus unlocked`);
      lines.push('');

      for (const r of bonusRules) {

        const emoji = r.emoji || '🤑';
        const threshold = parseFloat(r.rolling_30d_min) || parseFloat(r.min_deposit) || 0;
        const isActive = rolling30d >= threshold;
        const marker = isActive ? '  ✅' : '';
        lines.push(`${emoji} 30 Days Deposit ₹${formatNumber(threshold)}+`);
        lines.push(`   → ${parseFloat(r.percentage)}% Extra Bonus${marker}`);
        lines.push('');
      }
    }

    lines.push(`━━━━━━━━━━━━━━━━`);
    lines.push(`🎉 <b>YOUR 30 DAYS DEPOSIT</b>`);
    lines.push(`   ↳ ₹${formatNumber(rolling30d)}`);
    lines.push(`━━━━━━━━━━━━━━━━`);

    // Current eligible reward
    let currentReward = null;
    for (const rule of bonusRules) {

      const threshold = parseFloat(rule.rolling_30d_min) || parseFloat(rule.min_deposit) || 0;
      if (rolling30d >= threshold) {
        currentReward = rule;
      }
    }

    lines.push('');
    if (currentReward) {
      lines.push(`😻 <b>Current Eligible Reward:</b>`);
      lines.push(`   → +${parseFloat(currentReward.percentage)}% EXTRA BONUS`);
    } else {
      lines.push(`💡 <i>Deposit more to unlock bonus rewards!</i>`);
    }

    return lines.join('\n');
  } catch (err) {
    logger.error(`[Benefits] Info message error: ${err.message}`);
    return null;
  }
}
