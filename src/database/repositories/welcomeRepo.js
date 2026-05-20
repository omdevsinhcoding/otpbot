export async function getWelcomeMessage(pool) {
  const { rows } = await pool.query(
    'SELECT * FROM welcome_messages WHERE is_enabled = TRUE ORDER BY updated_at DESC LIMIT 1'
  );
  return rows[0] || null;
}

export async function setWelcomeMessage(pool, { messageText, buttons, mediaType, mediaFileId, parseMode = 'HTML', updatedBy }) {
  // Upsert: disable old ones, insert new
  await pool.query('UPDATE welcome_messages SET is_enabled = FALSE');
  const { rows } = await pool.query(
    `INSERT INTO welcome_messages (message_text, buttons, media_type, media_file_id, parse_mode, updated_by)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6) RETURNING *`,
    [messageText, JSON.stringify(buttons || []), mediaType || null, mediaFileId || null, parseMode, updatedBy || null]
  );
  return rows[0];
}

export async function updateWelcomeButtons(pool, welcomeId, buttons) {
  await pool.query(
    'UPDATE welcome_messages SET buttons = $2::jsonb, updated_at = NOW() WHERE id = $1',
    [welcomeId, JSON.stringify(buttons)]
  );
}

export async function toggleWelcome(pool, welcomeId, isEnabled) {
  await pool.query(
    'UPDATE welcome_messages SET is_enabled = $2, updated_at = NOW() WHERE id = $1',
    [welcomeId, isEnabled]
  );
}

export async function getWelcomeById(pool, welcomeId) {
  const { rows } = await pool.query('SELECT * FROM welcome_messages WHERE id = $1', [welcomeId]);
  return rows[0] || null;
}
