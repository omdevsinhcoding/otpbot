export async function addChannel(pool, { channelId, channelUsername, channelTitle, inviteLink, addedBy, btnStyle, btnText }) {
  const { rows } = await pool.query(
    `INSERT INTO force_join_channels (channel_id, channel_username, channel_title, invite_link, btn_style, btn_text, added_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (channel_id) DO UPDATE SET
       channel_username = EXCLUDED.channel_username,
       channel_title = EXCLUDED.channel_title,
       invite_link = EXCLUDED.invite_link,
       is_active = TRUE
     RETURNING *`,
    [channelId, channelUsername || null, channelTitle || null, inviteLink || null, btnStyle || '', btnText || '', addedBy || null]
  );
  return rows[0];
}

export async function removeChannel(pool, channelId) {
  await pool.query('DELETE FROM force_join_channels WHERE channel_id = $1', [channelId]);
}

export async function getActiveChannels(pool) {
  const { rows } = await pool.query('SELECT * FROM force_join_channels WHERE is_active = TRUE');
  return rows;
}

export async function getChannel(pool, channelId) {
  const { rows } = await pool.query('SELECT * FROM force_join_channels WHERE channel_id = $1', [channelId]);
  return rows[0] || null;
}

export async function toggleChannel(pool, channelId, isActive) {
  await pool.query('UPDATE force_join_channels SET is_active = $2 WHERE channel_id = $1', [channelId, isActive]);
}

export async function updateChannelStyle(pool, channelId, btnStyle) {
  await pool.query('UPDATE force_join_channels SET btn_style = $2 WHERE channel_id = $1', [channelId, btnStyle || '']);
}

export async function updateChannelText(pool, channelId, btnText) {
  await pool.query('UPDATE force_join_channels SET btn_text = $2 WHERE channel_id = $1', [channelId, btnText || '']);
}

export async function updateChannelLink(pool, channelId, inviteLink) {
  await pool.query('UPDATE force_join_channels SET invite_link = $2 WHERE channel_id = $1', [channelId, inviteLink || null]);
}

export async function countChannels(pool) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM force_join_channels WHERE is_active = TRUE');
  return rows[0].count;
}
