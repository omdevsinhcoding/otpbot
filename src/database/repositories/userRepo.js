export async function upsertUser(pool, { userId, username, fullName, languageCode, isPremium, referralCode, referredBy }) {
  const { rows } = await pool.query(
    `INSERT INTO users (user_id, username, full_name, language_code, is_premium, referral_code, referred_by, last_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       username = COALESCE(EXCLUDED.username, users.username),
       full_name = COALESCE(EXCLUDED.full_name, users.full_name),
       language_code = COALESCE(EXCLUDED.language_code, users.language_code),
       is_premium = EXCLUDED.is_premium,
       referral_code = COALESCE(users.referral_code, EXCLUDED.referral_code),
       referred_by = COALESCE(users.referred_by, EXCLUDED.referred_by),
       last_active = NOW(),
       is_active = TRUE
     RETURNING *`,
    [userId, username || null, fullName || null, languageCode || null, isPremium || false, referralCode || null, referredBy || null]
  );
  return rows[0];
}

export async function getUser(pool, userId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
  return rows[0] || null;
}

export async function updateLastActive(pool, userId) {
  await pool.query('UPDATE users SET last_active = NOW() WHERE user_id = $1', [userId]);
}

export async function banUser(pool, userId) {
  await pool.query('UPDATE users SET is_banned = TRUE WHERE user_id = $1', [userId]);
}

export async function unbanUser(pool, userId) {
  await pool.query('UPDATE users SET is_banned = FALSE WHERE user_id = $1', [userId]);
}

export async function searchUsersByUsername(pool, query, limit = 10) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE username ILIKE $1 LIMIT $2',
    [`%${query}%`, limit]
  );
  return rows;
}

export async function searchUserById(pool, userId) {
  return getUser(pool, userId);
}

export async function getUsersPaginated(pool, page, pageSize = 10) {
  const offset = (page - 1) * pageSize;
  const [dataRes, countRes] = await Promise.all([
    pool.query('SELECT * FROM users ORDER BY first_seen DESC LIMIT $1 OFFSET $2', [pageSize, offset]),
    pool.query('SELECT COUNT(*)::int AS total FROM users'),
  ]);
  return { users: dataRes.rows, total: countRes.rows[0].total };
}

export async function countUsers(pool) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM users');
  return rows[0].count;
}

export async function countActiveUsers(pool) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM users WHERE is_active = TRUE AND is_banned = FALSE');
  return rows[0].count;
}

export async function countBannedUsers(pool) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM users WHERE is_banned = TRUE');
  return rows[0].count;
}

export async function countUsersToday(pool) {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS count FROM users WHERE first_seen >= CURRENT_DATE"
  );
  return rows[0].count;
}

export async function getAllActiveUserIds(pool) {
  const { rows } = await pool.query(
    'SELECT user_id FROM users WHERE is_active = TRUE AND is_banned = FALSE'
  );
  return rows.map(r => r.user_id);
}

export async function deactivateUser(pool, userId) {
  await pool.query('UPDATE users SET is_active = FALSE WHERE user_id = $1', [userId]);
}

export async function getUserStats(pool, userId) {
  const { rows } = await pool.query(
    `SELECT u.*, (SELECT COUNT(*)::int FROM activity_logs WHERE user_id = $1) AS action_count
     FROM users u WHERE u.user_id = $1`,
    [userId]
  );
  return rows[0] || null;
}
