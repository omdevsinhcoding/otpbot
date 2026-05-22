export async function createTransaction(pool, { userId, gateway, orderId, amount, gatewayData = {}, expiresAt = null }) {
  const { rows } = await pool.query(
    `INSERT INTO transactions (user_id, gateway, order_id, amount, status, gateway_data, expires_at)
     VALUES ($1, $2, $3, $4, 'pending', $5::jsonb, $6)
     RETURNING *`,
    [userId, gateway, orderId, amount, JSON.stringify(gatewayData), expiresAt]
  );
  return rows[0];
}

export async function getByOrderId(pool, orderId) {
  const { rows } = await pool.query(
    'SELECT * FROM transactions WHERE order_id = $1',
    [orderId]
  );
  return rows[0] || null;
}

export async function updateStatus(pool, orderId, status, gatewayTxnId = null, gatewayData = {}) {
  const verifiedAt = ['success', 'completed', 'paid'].includes(status) ? 'NOW()' : null;
  // Atomic guard: when setting 'success', only update if NOT already 'success' (prevents double-credit)
  const statusGuard = status === 'success' ? `AND status != 'success'` : '';
  const { rows } = await pool.query(
    `UPDATE transactions
     SET status = $2,
         gateway_txn_id = COALESCE($3, gateway_txn_id),
         gateway_data = gateway_data || $4::jsonb,
         verified_at = ${verifiedAt ? 'NOW()' : 'verified_at'}
     WHERE order_id = $1 ${statusGuard}
     RETURNING *`,
    [orderId, status, gatewayTxnId, JSON.stringify(gatewayData)]
  );
  return rows[0] || null;
}

export async function getUserTransactions(pool, userId, limit = 20) {
  const { rows } = await pool.query(
    'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit]
  );
  return rows;
}

export async function getPendingByUser(pool, userId, gateway) {
  const { rows } = await pool.query(
    `SELECT * FROM transactions
     WHERE user_id = $1 AND gateway = $2 AND status = 'pending'
     ORDER BY created_at DESC`,
    [userId, gateway]
  );
  return rows;
}

export async function expireOldTransactions(pool, gateway, maxAgeSeconds) {
  const { rows } = await pool.query(
    `UPDATE transactions
     SET status = 'expired'
     WHERE gateway = $1
       AND status = 'pending'
       AND created_at < NOW() - INTERVAL '1 second' * $2
     RETURNING *`,
    [gateway, maxAgeSeconds]
  );
  return rows;
}

export async function getByGatewayTxnId(pool, gatewayTxnId) {
  const { rows } = await pool.query(
    'SELECT * FROM transactions WHERE gateway_txn_id = $1',
    [gatewayTxnId]
  );
  return rows[0] || null;
}

export async function updateGatewayData(pool, orderId, newData) {
  await pool.query(
    `UPDATE transactions
     SET gateway_data = gateway_data || $2::jsonb
     WHERE order_id = $1`,
    [orderId, JSON.stringify(newData)]
  );
}
