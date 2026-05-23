/**
 * Referral Commission Service
 *
 * Core function: processReferralReward()
 * Called after every successful deposit to check and credit referral commission.
 *
 * Anti-fraud checks:
 * - System must be enabled
 * - Referrer must exist and not be banned
 * - Referrer wallet must not be frozen
 * - No self-referral (enforced at signup, but double-checked)
 * - No circular referral (A→B and B→A)
 * - No duplicate reward per order (unique index)
 */

import * as referralRepo from '../database/repositories/referralRepo.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import * as userRepo from '../database/repositories/userRepo.js';
import { formatNumber } from '../utils/formatters.js';
import logger from '../utils/logger.js';

/**
 * Process referral reward for a successful deposit.
 * Safe to call multiple times — idempotent via unique index.
 *
 * @param {Pool} pool - PostgreSQL pool
 * @param {Api} botApi - Grammy bot.api instance for sending notifications
 * @param {number} userId - The user who made the deposit
 * @param {number} depositAmount - Amount deposited (INR)
 * @param {string} orderId - Unique order ID
 */
export async function processReferralReward(pool, botApi, userId, depositAmount, orderId) {
  try {
    // 1. Check if referral system is enabled
    const enabled = await settingsRepo.getSetting(pool, 'referral_enabled');
    if (!enabled) return;

    // 2. Look up the referrer
    const user = await userRepo.getUser(pool, userId);
    if (!user || !user.referred_by) return;

    const referrerId = user.referred_by;

    // 3. Self-referral guard (should never happen, but be safe)
    if (referrerId === userId) {
      logger.warn(`[Referral] Self-referral detected: ${userId}`);
      await referralRepo.addFraudFlag(pool, userId, 'self_referral', {
        message: 'Self-referral detected during reward processing',
      });
      return;
    }

    // 4. Check referrer exists and is not banned
    const referrer = await userRepo.getUser(pool, referrerId);
    if (!referrer || referrer.is_banned) return;

    // 5. Check circular referral (A→B and B→A)
    if (referrer.referred_by === userId) {
      logger.warn(`[Referral] Circular referral: ${userId} ↔ ${referrerId}`);
      await referralRepo.addFraudFlag(pool, userId, 'circular_referral', {
        message: `Circular referral detected: ${userId} ↔ ${referrerId}`,
        partner: referrerId,
      });
      return;
    }

    // 6. Check referrer wallet is not frozen
    const refWallet = await referralRepo.getReferralWallet(pool, referrerId);
    if (refWallet?.is_frozen) {
      logger.debug(`[Referral] Referrer ${referrerId} wallet is frozen, skipping reward`);
      return;
    }

    // 7. Check duplicate (belt-and-suspenders — unique index also prevents this)
    const alreadyRewarded = await referralRepo.hasRewardForOrder(pool, referrerId, orderId);
    if (alreadyRewarded) {
      logger.debug(`[Referral] Duplicate reward attempt for order ${orderId}`);
      return;
    }

    // 8. Calculate commission
    const commissionPct = parseFloat(await settingsRepo.getSetting(pool, 'referral_commission_pct')) || 10;
    const rewardAmount = Math.round(depositAmount * commissionPct / 100 * 100) / 100; // round to 2 decimal
    if (rewardAmount <= 0) return;

    // 9. Credit reward atomically
    const reward = await referralRepo.addReward(pool, {
      referrerId,
      referredId: userId,
      orderId,
      depositAmount,
      commissionPct,
      rewardAmount,
    });

    if (!reward) {
      logger.debug(`[Referral] Reward not credited (likely duplicate) for order ${orderId}`);
      return;
    }

    logger.info(`[Referral] ✅ Reward ₹${rewardAmount} → user ${referrerId} (from deposit by ${userId}, order ${orderId})`);

    // 10. Send notification to referrer
    try {
      const newBalance = await referralRepo.getReferralBalance(pool, referrerId);
      const notifText =
        `\u2728\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2728\n` +
        `   🎉 <b>Referral Reward Received</b>\n` +
        `\u2728\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2728\n\n` +
        `Your referred user completed a successful deposit.\n\n` +
        `<blockquote>` +
        `✅ <b>Reward:</b> ₹${formatNumber(rewardAmount)}\n` +
        `💳 <b>Referral Wallet:</b> ₹${formatNumber(newBalance)}` +
        `</blockquote>\n\n` +
        `🔥 <i>Keep sharing and earning!</i>`;

      await botApi.sendMessage(referrerId, notifText, { parse_mode: 'HTML' });
    } catch (err) {
      // Notification failure is not critical — reward is already credited
      logger.debug(`[Referral] Notification to ${referrerId} failed: ${err.message}`);
    }

  } catch (err) {
    // NEVER let referral processing block deposit success
    logger.error(`[Referral] processReferralReward error: ${err.message}`);
  }
}
