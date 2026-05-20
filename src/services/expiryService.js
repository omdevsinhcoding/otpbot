/**
 * Payment Expiry Service — Production-grade background job.
 *
 * Instead of per-user setTimeout (memory bomb), runs a single setInterval
 * every 30 seconds that:
 *   1. Queries DB for ALL pending transactions past their time limit
 *   2. Batch marks them as 'expired'
 *   3. Sends expiry notification to each user
 *   4. Deletes old QR messages
 *
 * Why this is better:
 *   ✅ Zero per-user memory — single 30s interval regardless of user count
 *   ✅ Restart-safe — DB is source of truth, no timers lost
 *   ✅ Multi-instance safe — uses DB timestamps, not in-process state
 *   ✅ 10K users? Same single interval. 100K users? Same single interval.
 *   ✅ Self-healing — catches any missed expirations on restart
 */

import * as settingsRepo from '../database/repositories/settingsRepo.js';
import * as transactionRepo from '../database/repositories/transactionRepo.js';
import { escapeHtml } from '../utils/formatters.js';
import { InlineKeyboard } from 'grammy';
import logger from '../utils/logger.js';

let intervalRef = null;
const POLL_INTERVAL_MS = 30_000; // 30 seconds

/**
 * Start the expiry background job.
 * @param {import('grammy').Bot} bot — the bot instance (for sending messages)
 * @param {import('pg').Pool} pool — database pool
 */
export function startExpiryService(bot, pool) {
  if (intervalRef) {
    logger.warn('Expiry service already running, skipping duplicate start.');
    return;
  }

  logger.info(`Expiry service started (polling every ${POLL_INTERVAL_MS / 1000}s).`);

  intervalRef = setInterval(async () => {
    try {
      await processExpiredTransactions(bot, pool);
    } catch (err) {
      logger.error(`Expiry service error: ${err.message}`);
    }
  }, POLL_INTERVAL_MS);

  // Also run immediately on start to catch any missed expirations
  processExpiredTransactions(bot, pool).catch((err) => {
    logger.error(`Expiry service initial run error: ${err.message}`);
  });
}

/**
 * Stop the expiry service.
 */
export function stopExpiryService() {
  if (intervalRef) {
    clearInterval(intervalRef);
    intervalRef = null;
    logger.info('Expiry service stopped.');
  }
}

/**
 * Core logic: find and expire all pending transactions past their time limit.
 *
 * Single SQL query fetches all candidates. No per-user state needed.
 */
async function processExpiredTransactions(bot, pool) {
  // Fetch time limits for each gateway (cached per cycle)
  const [paytmLimit, bharatpayLimit, cryptomusLimit] = await Promise.all([
    settingsRepo.getSetting(pool, 'paytm_time_limit').then(v => v || 600),
    settingsRepo.getSetting(pool, 'bharatpay_time_limit').then(v => v || 600),
    settingsRepo.getSetting(pool, 'cryptomus_time_limit').then(v => v || 3600),
  ]);

  // Build gateway → time limit map
  const limits = {
    paytm: paytmLimit,
    bharatpay: bharatpayLimit,
    cryptomus: cryptomusLimit,
  };

  // Single query: find all pending transactions that have exceeded their gateway's time limit
  // Uses CASE to apply different limits per gateway
  const result = await pool.query(`
    SELECT id, user_id, order_id, gateway, amount, gateway_data, created_at
    FROM transactions
    WHERE status = 'pending'
      AND (
        (gateway = 'paytm'     AND created_at < NOW() - INTERVAL '1 second' * $1)
        OR (gateway = 'bharatpay' AND created_at < NOW() - INTERVAL '1 second' * $2)
        OR (gateway = 'cryptomus' AND created_at < NOW() - INTERVAL '1 second' * $3)
      )
    LIMIT 100
  `, [paytmLimit, bharatpayLimit, cryptomusLimit]);

  if (result.rows.length === 0) return;

  logger.debug(`Expiry service: processing ${result.rows.length} expired transaction(s).`);

  // Fetch support username once for all messages
  const supportUser = await settingsRepo.getSetting(pool, 'support_username');

  // Process each expired transaction
  for (const txn of result.rows) {
    try {
      // Mark as expired (atomic — if already changed, this is a no-op)
      const updated = await pool.query(
        `UPDATE transactions SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING id`,
        [txn.id]
      );

      // If another process/cycle already handled it, skip
      if (updated.rowCount === 0) continue;

      const chatId = txn.user_id;
      const orderId = txn.order_id;

      // Try to delete the QR photo message
      const qrMsgId = txn.gateway_data?.qrMsgId;
      if (qrMsgId) {
        try { await bot.api.deleteMessage(chatId, qrMsgId); } catch { /* message may be old/deleted */ }
      }

      // Send expiry notification to user
      let expiredText =
        `💀 <b>Payment Expired</b>\n\n` +
        `Order <code>${escapeHtml(orderId)}</code> has expired.\n` +
        `Please create a new order.\n\n` +
        `<i>If you already made the payment, please contact support with your UTR/transaction ID and we will resolve it.</i>`;

      if (supportUser) {
        expiredText += `\n\n🛡 <b>Support:</b> @${escapeHtml(supportUser)}`;
      }

      await bot.api.sendMessage(chatId, expiredText, {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text('💰 Pay Again', 'deposit:paytm')
          .text('‹ Back', 'deposit:menu'),
      });

      logger.debug(`Expired order ${orderId} for user ${chatId}.`);
    } catch (err) {
      // Don't crash the loop — log and continue to next transaction
      logger.error(`Failed to expire txn ${txn.order_id}: ${err.message}`);
    }
  }
}
