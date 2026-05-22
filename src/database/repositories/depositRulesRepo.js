// ═══════════════════════════════════════════════════════════════════
//  DEPOSIT RULES REPOSITORY — CRUD + Analytics + Rolling 30-day
// ═══════════════════════════════════════════════════════════════════

// ── CRUD ────────────────────────────────────────────────────────

export async function createRule(pool, data) {
  const { rows } = await pool.query(
    `INSERT INTO deposit_rules 
     (title, emoji, rule_type, min_deposit, max_deposit, rolling_30d_min,
      percentage, priority, is_enabled, vip_only, custom_message, expires_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      data.title, data.emoji || '🎁', data.rule_type,
      data.min_deposit || 0, data.max_deposit || 0, data.rolling_30d_min || 0,
      data.percentage, data.priority || 100, data.is_enabled !== false,
      data.vip_only || false, data.custom_message || '', data.expires_at || null,
      data.created_by || null,
    ]
  );
  return rows[0];
}

export async function updateRule(pool, id, data) {
  const fields = [];
  const values = [];
  let idx = 1;

  for (const [key, val] of Object.entries(data)) {
    if (['id', 'created_at', 'created_by'].includes(key)) continue;
    fields.push(`${key} = $${idx}`);
    values.push(val);
    idx++;
  }
  if (fields.length === 0) return null;

  fields.push(`updated_at = NOW()`);
  values.push(id);

  const { rows } = await pool.query(
    `UPDATE deposit_rules SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return rows[0] || null;
}

export async function deleteRule(pool, id) {
  const { rowCount } = await pool.query('DELETE FROM deposit_rules WHERE id = $1', [id]);
  return rowCount > 0;
}

export async function getRule(pool, id) {
  const { rows } = await pool.query('SELECT * FROM deposit_rules WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function getAllRules(pool) {
  const { rows } = await pool.query(
    'SELECT * FROM deposit_rules ORDER BY rule_type, priority ASC, id ASC'
  );
  return rows;
}

export async function getActiveRules(pool) {
  const { rows } = await pool.query(
    `SELECT * FROM deposit_rules 
     WHERE is_enabled = TRUE 
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY priority ASC, id ASC`
  );
  return rows;
}

export async function toggleRule(pool, id) {
  const { rows } = await pool.query(
    `UPDATE deposit_rules SET is_enabled = NOT is_enabled, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

export async function swapPriority(pool, id1, id2) {
  const r1 = await getRule(pool, id1);
  const r2 = await getRule(pool, id2);
  if (!r1 || !r2) return false;

  await pool.query('UPDATE deposit_rules SET priority = $1, updated_at = NOW() WHERE id = $2', [r2.priority, id1]);
  await pool.query('UPDATE deposit_rules SET priority = $1, updated_at = NOW() WHERE id = $2', [r1.priority, id2]);
  return true;
}

export async function countRules(pool) {
  const { rows } = await pool.query(
    `SELECT 
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE rule_type = 'tax' AND is_enabled)::int AS active_tax,
       COUNT(*) FILTER (WHERE rule_type = 'bonus' AND is_enabled)::int AS active_bonus,
       COUNT(*) FILTER (WHERE rule_type = 'loyalty_bonus' AND is_enabled)::int AS active_loyalty
     FROM deposit_rules`
  );
  return rows[0];
}

// ── Rolling 30-day deposit ──────────────────────────────────────

export async function getUserRolling30d(pool, userId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(amount), 0)::numeric AS total
     FROM transactions
     WHERE user_id = $1 AND status = 'success'
       AND created_at >= NOW() - INTERVAL '30 days'`,
    [userId]
  );
  return parseFloat(rows[0].total) || 0;
}

// ── Bonus History ───────────────────────────────────────────────

export async function recordBonus(pool, data) {
  const { rows } = await pool.query(
    `INSERT INTO bonus_history 
     (user_id, order_id, rule_id, rule_title, rule_type, deposit_amount, applied_pct, bonus_amount, rolling_30d)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      data.user_id, data.order_id, data.rule_id, data.rule_title,
      data.rule_type, data.deposit_amount, data.applied_pct,
      data.bonus_amount, data.rolling_30d || 0,
    ]
  );
  return rows[0];
}

export async function checkDuplicateBonus(pool, orderId) {
  if (!orderId) return false;
  const { rows } = await pool.query(
    'SELECT id FROM bonus_history WHERE order_id = $1 LIMIT 1',
    [orderId]
  );
  return rows.length > 0;
}

export async function getBonusHistory(pool, { limit = 20, offset = 0, userId = null } = {}) {
  let query = 'SELECT * FROM bonus_history';
  const params = [];
  if (userId) {
    query += ' WHERE user_id = $1';
    params.push(userId);
  }
  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);
  const { rows } = await pool.query(query, params);
  return rows;
}

// ── Analytics ───────────────────────────────────────────────────

export async function getStats(pool, periodDays = null) {
  const whereClause = periodDays
    ? `WHERE created_at >= NOW() - INTERVAL '${parseInt(periodDays)} days'`
    : '';

  const { rows } = await pool.query(`
    SELECT
      COUNT(*)::int AS total_records,
      COUNT(*) FILTER (WHERE rule_type IN ('bonus','loyalty_bonus'))::int AS bonus_count,
      COUNT(*) FILTER (WHERE rule_type = 'tax')::int AS tax_count,
      COALESCE(SUM(bonus_amount) FILTER (WHERE bonus_amount > 0), 0)::numeric AS total_bonus,
      COALESCE(SUM(ABS(bonus_amount)) FILTER (WHERE bonus_amount < 0), 0)::numeric AS total_tax,
      COALESCE(AVG(bonus_amount) FILTER (WHERE bonus_amount > 0), 0)::numeric AS avg_bonus
    FROM bonus_history ${whereClause}
  `);
  return {
    totalRecords: rows[0].total_records,
    bonusCount: rows[0].bonus_count,
    taxCount: rows[0].tax_count,
    totalBonus: parseFloat(rows[0].total_bonus),
    totalTax: parseFloat(rows[0].total_tax),
    avgBonus: parseFloat(rows[0].avg_bonus),
  };
}

export async function getTopRules(pool, limit = 5) {
  const { rows } = await pool.query(
    `SELECT rule_id, rule_title, rule_type,
       COUNT(*)::int AS times_applied,
       SUM(ABS(bonus_amount))::numeric AS total_amount
     FROM bonus_history
     WHERE rule_id IS NOT NULL
     GROUP BY rule_id, rule_title, rule_type
     ORDER BY total_amount DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map(r => ({
    ...r,
    total_amount: parseFloat(r.total_amount),
  }));
}
