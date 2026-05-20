export async function getSetting(pool, key) {
  const { rows } = await pool.query('SELECT value FROM bot_settings WHERE key = $1', [key]);
  return rows[0] ? rows[0].value : null;
}

export async function setSetting(pool, key, value, updatedBy = null) {
  await pool.query(
    `INSERT INTO bot_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [key, JSON.stringify(value), updatedBy]
  );
}

export async function getAllSettings(pool) {
  const { rows } = await pool.query('SELECT key, value FROM bot_settings');
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

export async function deleteSetting(pool, key) {
  await pool.query('DELETE FROM bot_settings WHERE key = $1', [key]);
}
