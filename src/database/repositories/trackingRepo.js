export async function logActivity(pool, { userId, actionType, actionData, chatId, chatType }) {
  await pool.query(
    `INSERT INTO activity_logs (user_id, action_type, action_data, chat_id, chat_type)
     VALUES ($1, $2, $3::jsonb, $4, $5)`,
    [userId || null, actionType, JSON.stringify(actionData || {}), chatId || null, chatType || null]
  );
}

export async function logAdminAction(pool, { adminId, adminUsername, actionType, actionData, targetUserId }) {
  await pool.query(
    `INSERT INTO admin_logs (admin_id, admin_username, action_type, action_data, target_user_id)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [adminId, adminUsername || null, actionType, JSON.stringify(actionData || {}), targetUserId || null]
  );
}

export async function logFinancial(pool, { userId, transactionType, amount, currency = 'INR', referenceId, metadata, status = 'pending' }) {
  await pool.query(
    `INSERT INTO financial_logs (user_id, transaction_type, amount, currency, reference_id, metadata, status)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [userId, transactionType, amount, currency, referenceId || null, JSON.stringify(metadata || {}), status]
  );
}

export async function getRecentActivities(pool, limit = 50, actionType = null) {
  if (actionType) {
    const { rows } = await pool.query(
      'SELECT * FROM activity_logs WHERE action_type = $1 ORDER BY created_at DESC LIMIT $2',
      [actionType, limit]
    );
    return rows;
  }
  const { rows } = await pool.query(
    'SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT $1', [limit]
  );
  return rows;
}

export async function getUserActivities(pool, userId, limit = 50) {
  const { rows } = await pool.query(
    'SELECT * FROM activity_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit]
  );
  return rows;
}

export async function getRecentAdminLogs(pool, limit = 50) {
  const { rows } = await pool.query(
    'SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT $1', [limit]
  );
  return rows;
}

export async function getActivityStats(pool, days = 7) {
  const { rows } = await pool.query(
    `SELECT action_type, COUNT(*)::int AS count
     FROM activity_logs
     WHERE created_at >= NOW() - INTERVAL '1 day' * $1
     GROUP BY action_type`,
    [days]
  );
  const stats = {};
  for (const row of rows) stats[row.action_type] = row.count;
  return stats;
}

export async function getDailyUserGrowth(pool, days = 30) {
  const { rows } = await pool.query(
    `SELECT first_seen::date AS date, COUNT(*)::int AS count
     FROM users
     WHERE first_seen >= NOW() - INTERVAL '1 day' * $1
     GROUP BY first_seen::date
     ORDER BY date`,
    [days]
  );
  return rows;
}

export async function countActivitiesToday(pool) {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS count FROM activity_logs WHERE created_at >= CURRENT_DATE"
  );
  return rows[0].count;
}
