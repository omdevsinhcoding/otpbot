export async function createBroadcast(pool, { messageText, buttons, mediaType, mediaFileId, parseMode = 'HTML', createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO broadcasts (message_text, buttons, media_type, media_file_id, parse_mode, created_by, status, created_at)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6, 'sending', NOW()) RETURNING *`,
    [messageText, JSON.stringify(buttons || []), mediaType || null, mediaFileId || null, parseMode, createdBy]
  );
  return rows[0];
}

export async function getBroadcast(pool, broadcastId) {
  const { rows } = await pool.query('SELECT * FROM broadcasts WHERE id = $1', [broadcastId]);
  return rows[0] || null;
}

export async function updateBroadcastStatus(pool, broadcastId, status, kwargs = {}) {
  const sets = ['status = $2'];
  const params = [broadcastId, status];
  let idx = 3;
  if (kwargs.sentCount != null) { sets.push(`sent_count = $${idx}`); params.push(kwargs.sentCount); idx++; }
  if (kwargs.failedCount != null) { sets.push(`failed_count = $${idx}`); params.push(kwargs.failedCount); idx++; }
  if (status === 'completed') { sets.push('completed_at = NOW()'); }
  if (status === 'sending') { sets.push('started_at = NOW()'); }
  await pool.query(`UPDATE broadcasts SET ${sets.join(', ')} WHERE id = $1`, params);
}

export async function incrementBroadcastSent(pool, broadcastId) {
  await pool.query('UPDATE broadcasts SET sent_count = sent_count + 1 WHERE id = $1', [broadcastId]);
}

export async function incrementBroadcastFailed(pool, broadcastId) {
  await pool.query('UPDATE broadcasts SET failed_count = failed_count + 1 WHERE id = $1', [broadcastId]);
}

export async function addBroadcastFailure(pool, broadcastId, userId, errorMessage) {
  await pool.query(
    'INSERT INTO broadcast_failures (broadcast_id, user_id, error_message) VALUES ($1, $2, $3)',
    [broadcastId, userId, errorMessage]
  );
}

export async function listBroadcasts(pool, page = 1, pageSize = 10) {
  const offset = (page - 1) * pageSize;
  const [dataRes, countRes] = await Promise.all([
    pool.query('SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT $1 OFFSET $2', [pageSize, offset]),
    pool.query('SELECT COUNT(*)::int AS total FROM broadcasts'),
  ]);
  return { items: dataRes.rows, total: countRes.rows[0].total };
}

export async function getBroadcastFailures(pool, broadcastId, limit = 50) {
  const { rows } = await pool.query(
    'SELECT * FROM broadcast_failures WHERE broadcast_id = $1 ORDER BY created_at DESC LIMIT $2',
    [broadcastId, limit]
  );
  return rows;
}
