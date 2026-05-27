/**
 * Referral Repository — All database operations for the referral system.
 *
 * Tables: referral_wallets, referral_rewards, referral_transfers, referral_fraud_flags
 * Atomic operations to prevent double-payouts, race conditions, and fraud.
 */
import logger from '../../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════
//  REFERRAL CODE GENERATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a unique PREFIX-XXXXXXXX referral code.
 * Retries on collision (up to 10 attempts).
 */
export async function generateUniqueCode(pool, prefix = 'ERRORRO') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I,O,0,1 to avoid confusion
  for (let attempt = 0; attempt < 10; attempt++) {
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    const fullCode = `${prefix}-${code}`;
    const { rows } = await pool.query(
      'SELECT 1 FROM users WHERE referral_code = $1', [fullCode]
    );
    if (rows.length === 0) return fullCode;
  }
  // Fallback: use timestamp-based suffix
  const ts = Date.now().toString(36).toUpperCase().slice(-8).padStart(8, 'X');
  return `${prefix}-${ts}`;
}

// ═══════════════════════════════════════════════════════════════════
//  REFERRAL WALLET
// ═══════════════════════════════════════════════════════════════════

export async function ensureReferralWallet(pool, userId) {
  const { rows } = await pool.query(
    `INSERT INTO referral_wallets (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING *`,
    [userId]
  );
  if (rows[0]) return rows[0];
  return getReferralWallet(pool, userId);
}

export async function getReferralWallet(pool, userId) {
  const { rows } = await pool.query(
    'SELECT * FROM referral_wallets WHERE user_id = $1', [userId]
  );
  return rows[0] || null;
}

export async function getReferralBalance(pool, userId) {
  const wallet = await getReferralWallet(pool, userId);
  return wallet ? parseFloat(wallet.balance) : 0;
}

export async function freezeWallet(pool, userId) {
  await pool.query(
    'UPDATE referral_wallets SET is_frozen = TRUE, updated_at = NOW() WHERE user_id = $1',
    [userId]
  );
}

export async function unfreezeWallet(pool, userId) {
  await pool.query(
    'UPDATE referral_wallets SET is_frozen = FALSE, updated_at = NOW() WHERE user_id = $1',
    [userId]
  );
}

// ═══════════════════════════════════════════════════════════════════
//  REWARD OPERATIONS (Atomic)
// ═══════════════════════════════════════════════════════════════════

/**
 * Credit referral reward atomically.
 * Uses INSERT ... ON CONFLICT to prevent double-payout per order.
 * Returns the reward row if credited, null if duplicate.
 */
export async function addReward(pool, { referrerId, referredId, orderId, depositAmount, commissionPct, rewardAmount, tag = 'Referral Reward' }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Insert reward — unique index prevents duplicates
    const { rows: rewardRows } = await client.query(
      `INSERT INTO referral_rewards (referrer_id, referred_id, order_id, deposit_amount, commission_pct, reward_amount, status, tag)
       VALUES ($1, $2, $3, $4, $5, $6, 'credited', $7)
       ON CONFLICT (referrer_id, order_id) WHERE status = 'credited' DO NOTHING
       RETURNING *`,
      [referrerId, referredId, orderId, depositAmount, commissionPct, rewardAmount, tag]
    );

    if (!rewardRows[0]) {
      // Duplicate — already rewarded for this order
      await client.query('ROLLBACK');
      return null;
    }

    // 2. Update referral wallet balance
    await client.query(
      `INSERT INTO referral_wallets (user_id, balance, total_earned)
       VALUES ($1, $2, $2)
       ON CONFLICT (user_id) DO UPDATE SET
         balance = referral_wallets.balance + $2,
         total_earned = referral_wallets.total_earned + $2,
         updated_at = NOW()`,
      [referrerId, rewardAmount]
    );

    await client.query('COMMIT');
    return rewardRows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Check if a reward already exists for a given referrer + order.
 */
export async function hasRewardForOrder(pool, referrerId, orderId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM referral_rewards WHERE referrer_id = $1 AND order_id = $2 AND status = 'credited'`,
    [referrerId, orderId]
  );
  return rows.length > 0;
}

/**
 * Reverse a reward (admin action).
 */
export async function reverseReward(pool, rewardId, adminId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE referral_rewards SET status = 'reversed', admin_note = 'Reversed by admin', created_by = $2
       WHERE id = $1 AND status = 'credited'
       RETURNING *`,
      [rewardId, adminId]
    );

    if (!rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    // Deduct from wallet
    await client.query(
      `UPDATE referral_wallets SET balance = GREATEST(balance - $2, 0), updated_at = NOW()
       WHERE user_id = $1`,
      [rows[0].referrer_id, rows[0].reward_amount]
    );

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Freeze a specific reward.
 */
export async function freezeReward(pool, rewardId, adminId) {
  const { rows } = await pool.query(
    `UPDATE referral_rewards SET status = 'frozen', created_by = $2
     WHERE id = $1 AND status = 'credited'
     RETURNING *`,
    [rewardId, adminId]
  );
  return rows[0] || null;
}

// ═══════════════════════════════════════════════════════════════════
//  TRANSFER: Referral Wallet → Main Wallet
// ═══════════════════════════════════════════════════════════════════

/**
 * Transfer from referral wallet to main wallet atomically.
 */
export async function transferToMainWallet(pool, userId, amount) {
  if (amount <= 0) throw new Error('Amount must be positive');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Deduct from referral wallet (with balance check)
    const { rows: walletRows } = await client.query(
      `UPDATE referral_wallets
       SET balance = balance - $2, total_transferred = total_transferred + $2, updated_at = NOW()
       WHERE user_id = $1 AND balance >= $2 AND is_frozen = FALSE
       RETURNING *`,
      [userId, amount]
    );

    if (!walletRows[0]) {
      await client.query('ROLLBACK');
      throw new Error('Insufficient balance or wallet frozen');
    }

    // 2. Add to main wallet
    await client.query(
      `INSERT INTO user_wallets (user_id, balance, total_deposit)
       VALUES ($1, $2, 0)
       ON CONFLICT (user_id) DO UPDATE SET
         balance = user_wallets.balance + $2,
         updated_at = NOW()`,
      [userId, amount]
    );

    // 3. Log transfer
    await client.query(
      `INSERT INTO referral_transfers (user_id, amount, tag) VALUES ($1, $2, 'Referral Transfer')`,
      [userId, amount]
    );

    await client.query('COMMIT');
    return walletRows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get user's daily transfer total for limit checks.
 */
export async function getDailyTransferTotal(pool, userId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(amount), 0)::numeric AS total FROM referral_transfers
     WHERE user_id = $1 AND created_at >= CURRENT_DATE`,
    [userId]
  );
  return parseFloat(rows[0].total);
}

/**
 * Get user's monthly transfer total for limit checks.
 */
export async function getMonthlyTransferTotal(pool, userId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(amount), 0)::numeric AS total FROM referral_transfers
     WHERE user_id = $1 AND created_at >= DATE_TRUNC('month', CURRENT_DATE)`,
    [userId]
  );
  return parseFloat(rows[0].total);
}

// ═══════════════════════════════════════════════════════════════════
//  QUERIES — Referrals, Rewards, Stats
// ═══════════════════════════════════════════════════════════════════

/**
 * Count all users referred by this user.
 */
export async function getTotalReferralCount(pool, userId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM users WHERE referred_by = $1', [userId]
  );
  return rows[0].count;
}

/**
 * Count referred users who made at least 1 successful deposit.
 */
export async function getSuccessfulReferralCount(pool, userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(DISTINCT u.user_id)::int AS count
     FROM users u
     JOIN transactions t ON t.user_id = u.user_id AND t.status = 'success'
     WHERE u.referred_by = $1`,
    [userId]
  );
  return rows[0].count;
}

/**
 * List referred users with their 30-day deposit and earning data.
 * Uses NET deposit amount (after tax) via gateway_data->>'credit_amount'.
 */
export async function getReferralsByUser(pool, userId, limit = 20, offset = 0) {
  const { rows } = await pool.query(
    `SELECT u.user_id, u.username, u.full_name, u.first_seen,
            (SELECT COALESCE(SUM(
              COALESCE((gateway_data->>'credit_amount')::numeric, amount)
            ), 0) FROM transactions
             WHERE user_id = u.user_id AND status = 'success'
             AND created_at >= NOW() - INTERVAL '30 days') AS deposit_30d,
            (SELECT COALESCE(SUM(reward_amount), 0) FROM referral_rewards
             WHERE referrer_id = $1 AND referred_id = u.user_id AND status = 'credited') AS earned
     FROM users u
     WHERE u.referred_by = $1
     ORDER BY u.first_seen DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return rows;
}

/**
 * Dashboard-level aggregate stats for referral page.
 * Uses NET deposit amount (after tax) for accurate 30D stats.
 */
export async function getReferralDashboardStats(pool, userId) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM users WHERE referred_by = $1) AS total_referrals,
       (SELECT COALESCE(SUM(
         COALESCE((t.gateway_data->>'credit_amount')::numeric, t.amount)
       ), 0)::numeric FROM transactions t
        JOIN users u ON u.user_id = t.user_id
        WHERE u.referred_by = $1 AND t.status = 'success'
        AND t.created_at >= NOW() - INTERVAL '30 days') AS deposit_30d,
       (SELECT COALESCE(SUM(rr.reward_amount), 0)::numeric FROM referral_rewards rr
        WHERE rr.referrer_id = $1 AND rr.status = 'credited'
        AND rr.created_at >= NOW() - INTERVAL '30 days') AS earned_30d`,
    [userId]
  );
  return {
    totalReferrals: rows[0].total_referrals,
    deposit30d: parseFloat(rows[0].deposit_30d),
    earned30d: parseFloat(rows[0].earned_30d),
  };
}

/**
 * Get reward history for a referrer (paginated).
 */
export async function getRewardsByReferrer(pool, userId, limit = 10, offset = 0) {
  const [dataRes, countRes] = await Promise.all([
    pool.query(
      `SELECT rr.*, u.full_name AS referred_name, u.username AS referred_username
       FROM referral_rewards rr
       JOIN users u ON u.user_id = rr.referred_id
       WHERE rr.referrer_id = $1
       ORDER BY rr.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    ),
    pool.query(
      'SELECT COUNT(*)::int AS total FROM referral_rewards WHERE referrer_id = $1',
      [userId]
    ),
  ]);
  return { rewards: dataRes.rows, total: countRes.rows[0].total };
}

/**
 * Leaderboard — top referrers by total earned.
 */
export async function getTopReferrers(pool, limit = 10) {
  const { rows } = await pool.query(
    `SELECT rw.user_id, rw.total_earned, rw.balance,
            u.full_name, u.username,
            (SELECT COUNT(*)::int FROM users WHERE referred_by = rw.user_id) AS referral_count
     FROM referral_wallets rw
     JOIN users u ON u.user_id = rw.user_id
     WHERE rw.total_earned > 0
     ORDER BY rw.total_earned DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

// ═══════════════════════════════════════════════════════════════════
//  ADMIN ANALYTICS
// ═══════════════════════════════════════════════════════════════════

export async function getAnalytics(pool) {
  const queries = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM users WHERE referred_by IS NOT NULL`),
    pool.query(`SELECT COUNT(DISTINCT referred_by)::int AS total FROM users WHERE referred_by IS NOT NULL`),
    pool.query(`SELECT COALESCE(SUM(reward_amount), 0)::numeric AS total FROM referral_rewards WHERE status = 'credited'`),
    pool.query(`SELECT COALESCE(SUM(amount), 0)::numeric AS total FROM referral_transfers`),
    pool.query(`SELECT COUNT(*)::int AS total FROM referral_rewards WHERE status = 'credited' AND created_at >= CURRENT_DATE`),
    pool.query(`SELECT COUNT(*)::int AS total FROM referral_rewards WHERE status = 'credited' AND created_at >= DATE_TRUNC('week', CURRENT_DATE)`),
    pool.query(`SELECT COUNT(*)::int AS total FROM referral_rewards WHERE status = 'credited' AND created_at >= DATE_TRUNC('month', CURRENT_DATE)`),
    pool.query(`SELECT COUNT(*)::int AS total FROM referral_fraud_flags WHERE is_resolved = FALSE`),
    pool.query(`SELECT COUNT(*)::int AS total FROM referral_rewards WHERE status = 'frozen'`),
  ]);

  return {
    totalReferrals: queries[0].rows[0].total,
    activeReferrers: queries[1].rows[0].total,
    totalRewardsDistributed: parseFloat(queries[2].rows[0].total),
    totalTransfers: parseFloat(queries[3].rows[0].total),
    rewardsToday: queries[4].rows[0].total,
    rewardsThisWeek: queries[5].rows[0].total,
    rewardsThisMonth: queries[6].rows[0].total,
    unresolvedFraudFlags: queries[7].rows[0].total,
    frozenRewards: queries[8].rows[0].total,
  };
}

// ═══════════════════════════════════════════════════════════════════
//  ADMIN REWARD LOGS (Paginated)
// ═══════════════════════════════════════════════════════════════════

export async function getRewardLogs(pool, page = 1, perPage = 10) {
  const offset = (page - 1) * perPage;
  const [dataRes, countRes] = await Promise.all([
    pool.query(
      `SELECT rr.*,
              u1.full_name AS referrer_name, u1.username AS referrer_username,
              u2.full_name AS referred_name, u2.username AS referred_username
       FROM referral_rewards rr
       JOIN users u1 ON u1.user_id = rr.referrer_id
       JOIN users u2 ON u2.user_id = rr.referred_id
       ORDER BY rr.created_at DESC
       LIMIT $1 OFFSET $2`,
      [perPage, offset]
    ),
    pool.query('SELECT COUNT(*)::int AS total FROM referral_rewards'),
  ]);
  return { logs: dataRes.rows, total: countRes.rows[0].total, page, perPage };
}

// ═══════════════════════════════════════════════════════════════════
//  FRAUD FLAGS
// ═══════════════════════════════════════════════════════════════════

export async function addFraudFlag(pool, userId, flagType, details = {}) {
  const { rows } = await pool.query(
    `INSERT INTO referral_fraud_flags (user_id, flag_type, details)
     VALUES ($1, $2, $3::jsonb)
     RETURNING *`,
    [userId, flagType, JSON.stringify(details)]
  );
  return rows[0];
}

export async function getSuspiciousUsers(pool) {
  const { rows } = await pool.query(
    `SELECT ff.*, u.full_name, u.username
     FROM referral_fraud_flags ff
     JOIN users u ON u.user_id = ff.user_id
     WHERE ff.is_resolved = FALSE
     ORDER BY ff.created_at DESC
     LIMIT 50`
  );
  return rows;
}

export async function resolveFraudFlag(pool, flagId, adminId) {
  const { rows } = await pool.query(
    `UPDATE referral_fraud_flags SET is_resolved = TRUE, resolved_by = $2, resolved_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [flagId, adminId]
  );
  return rows[0] || null;
}

export async function getUserFraudFlags(pool, userId) {
  const { rows } = await pool.query(
    'SELECT * FROM referral_fraud_flags WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return rows;
}

// ═══════════════════════════════════════════════════════════════════
//  ADMIN MANUAL REWARD ACTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Admin manually adds reward to a user's referral wallet.
 */
export async function adminAddReward(pool, userId, amount, tag = 'Commission Bonus', note = '', adminId = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO referral_wallets (user_id, balance, total_earned)
       VALUES ($1, $2, $2)
       ON CONFLICT (user_id) DO UPDATE SET
         balance = referral_wallets.balance + $2,
         total_earned = referral_wallets.total_earned + $2,
         updated_at = NOW()`,
      [userId, amount]
    );

    await client.query(
      `INSERT INTO referral_rewards (referrer_id, referred_id, order_id, deposit_amount, commission_pct, reward_amount, status, tag, admin_note, created_by)
       VALUES ($1, $1, $2, 0, 0, $3, 'credited', $4, $5, $6)`,
      [userId, `ADMIN_${Date.now()}`, amount, tag, note, adminId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Admin manually deducts from a user's referral wallet.
 */
export async function adminDeductReward(pool, userId, amount, tag = 'Reward Reversal', note = '', adminId = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE referral_wallets SET balance = GREATEST(balance - $2, 0), updated_at = NOW()
       WHERE user_id = $1
       RETURNING *`,
      [userId, amount]
    );

    if (!rows[0]) {
      await client.query('ROLLBACK');
      throw new Error('User has no referral wallet');
    }

    await client.query(
      `INSERT INTO referral_rewards (referrer_id, referred_id, order_id, deposit_amount, commission_pct, reward_amount, status, tag, admin_note, created_by)
       VALUES ($1, $1, $2, 0, 0, -$3, 'credited', $4, $5, $6)`,
      [userId, `DEDUCT_${Date.now()}`, amount, tag, note, adminId]
    );

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get a single reward by ID.
 */
export async function getRewardById(pool, rewardId) {
  const { rows } = await pool.query(
    `SELECT rr.*, u1.full_name AS referrer_name, u2.full_name AS referred_name
     FROM referral_rewards rr
     JOIN users u1 ON u1.user_id = rr.referrer_id
     JOIN users u2 ON u2.user_id = rr.referred_id
     WHERE rr.id = $1`,
    [rewardId]
  );
  return rows[0] || null;
}

/**
 * Get referral wallet stats for a specific user (admin lookup).
 */
export async function getUserReferralStats(pool, userId) {
  const [wallet, totalRef, successRef, rewardSum] = await Promise.all([
    getReferralWallet(pool, userId),
    getTotalReferralCount(pool, userId),
    getSuccessfulReferralCount(pool, userId),
    pool.query(
      `SELECT COALESCE(SUM(reward_amount), 0)::numeric AS total FROM referral_rewards WHERE referrer_id = $1 AND status = 'credited'`,
      [userId]
    ),
  ]);
  return {
    wallet,
    totalReferrals: totalRef,
    successfulReferrals: successRef,
    totalEarned: parseFloat(rewardSum.rows[0].total),
  };
}
