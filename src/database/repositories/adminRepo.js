export async function createAdmin(pool, adminId, role = 'admin', permissions = {}, addedBy = null) {
  const { rows } = await pool.query(
    `INSERT INTO admins (admin_id, role, permissions, added_by)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (admin_id) DO UPDATE SET role = EXCLUDED.role, is_active = TRUE
     RETURNING *`,
    [adminId, role, JSON.stringify(permissions), addedBy]
  );
  return rows[0];
}

export async function removeAdmin(pool, adminId) {
  await pool.query('UPDATE admins SET is_active = FALSE WHERE admin_id = $1', [adminId]);
}

export async function getAdmin(pool, adminId) {
  const { rows } = await pool.query(
    `SELECT a.*, u.username, u.full_name FROM admins a
     LEFT JOIN users u ON u.user_id = a.admin_id
     WHERE a.admin_id = $1 AND a.is_active = TRUE`,
    [adminId]
  );
  return rows[0] || null;
}

export async function isAdmin(pool, userId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM admins WHERE admin_id = $1 AND is_active = TRUE',
    [userId]
  );
  return rows.length > 0;
}

export async function isSuperAdmin(pool, userId) {
  const { rows } = await pool.query(
    "SELECT 1 FROM admins WHERE admin_id = $1 AND role = 'super_admin' AND is_active = TRUE",
    [userId]
  );
  return rows.length > 0;
}

export async function listAdmins(pool) {
  const { rows } = await pool.query(
    `SELECT a.*, u.username, u.full_name FROM admins a
     LEFT JOIN users u ON u.user_id = a.admin_id
     WHERE a.is_active = TRUE ORDER BY a.added_at`
  );
  return rows;
}

export async function updatePermissions(pool, adminId, permissions) {
  await pool.query(
    'UPDATE admins SET permissions = $2::jsonb WHERE admin_id = $1',
    [adminId, JSON.stringify(permissions)]
  );
}

export async function countAdmins(pool) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM admins WHERE is_active = TRUE');
  return rows[0].count;
}
