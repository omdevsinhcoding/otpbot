export async function getWallet(pool, userId) {
  const { rows } = await pool.query(
    'SELECT * FROM user_wallets WHERE user_id = $1',
    [userId]
  );
  return rows[0] || null;
}

export async function ensureWallet(pool, userId) {
  const { rows } = await pool.query(
    `INSERT INTO user_wallets (user_id, balance, total_deposit)
     VALUES ($1, 0.00, 0.00)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING *`,
    [userId]
  );
  if (rows[0]) return rows[0];
  return getWallet(pool, userId);
}

export async function addBalance(pool, userId, amount) {
  if (amount <= 0) throw new Error('Amount must be positive');
  await ensureWallet(pool, userId);
  const { rows } = await pool.query(
    `UPDATE user_wallets
     SET balance = balance + $2,
         total_deposit = total_deposit + $2,
         updated_at = NOW()
     WHERE user_id = $1
     RETURNING *`,
    [userId, amount]
  );
  return rows[0];
}

export async function getBalance(pool, userId) {
  const wallet = await getWallet(pool, userId);
  return wallet ? parseFloat(wallet.balance) : 0;
}

export async function deductBalance(pool, userId, amount) {
  if (amount <= 0) throw new Error('Amount must be positive');
  const wallet = await getWallet(pool, userId);
  if (!wallet || parseFloat(wallet.balance) < amount) {
    throw new Error('Insufficient balance');
  }
  const { rows } = await pool.query(
    `UPDATE user_wallets
     SET balance = balance - $2,
         updated_at = NOW()
     WHERE user_id = $1 AND balance >= $2
     RETURNING *`,
    [userId, amount]
  );
  if (!rows[0]) throw new Error('Insufficient balance');
  return rows[0];
}

/**
 * Adjust balance for benefits (bonus/tax) WITHOUT touching total_deposit.
 * Positive amount = bonus credit, negative amount = tax deduction.
 * This prevents bonuses from inflating loyalty tier calculations.
 */
export async function adjustBalance(pool, userId, amount) {
  if (amount === 0) return await getWallet(pool, userId);
  await ensureWallet(pool, userId);

  if (amount > 0) {
    // Bonus — add to balance only (bonus is NOT a deposit)
    const { rows } = await pool.query(
      `UPDATE user_wallets
       SET balance = balance + $2,
           updated_at = NOW()
       WHERE user_id = $1
       RETURNING *`,
      [userId, amount]
    );
    return rows[0];
  } else {
    // Tax — deduct from balance AND total_deposit
    // (user didn't actually receive this amount, so it's not a real deposit)
    const absAmount = Math.abs(amount);
    const { rows } = await pool.query(
      `UPDATE user_wallets
       SET balance = GREATEST(balance - $2, 0),
           total_deposit = GREATEST(total_deposit - $2, 0),
           updated_at = NOW()
       WHERE user_id = $1
       RETURNING *`,
      [userId, absAmount]
    );
    return rows[0];
  }
}
