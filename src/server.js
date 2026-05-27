/**
 * HTTP Server — Webhooks + Mini App Dashboard
 *
 * Routes:
 *   GET  /health              → Health check
 *   POST /crypto/webhook      → Cryptomus payment webhook
 *   GET  /webapp/admin        → Admin analytics page (Mini App)
 *   GET  /api/admin/stats     → JSON stats (authenticated)
 *   GET  /api/admin/chart     → 7-day deposit chart data
 *   GET  /*                   → Blocked page (non-Telegram visitors)
 */
import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './utils/logger.js';
import * as transactionRepo from './database/repositories/transactionRepo.js';
import * as walletRepo from './database/repositories/walletRepo.js';
import { webAppAdminAuth } from './webapp/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let _bot = null;
let _pool = null;
let _app = null;
let _server = null;

export function startWebServer(bot, pool, port = 3000) {
  _bot = bot;
  _pool = pool;
  _app = express();

  _app.use(express.json());

  // ── Static files (CSS, JS) ─────────────────────────────────────
  _app.use(express.static(path.join(__dirname, 'webapp', 'public')));

  // ── Health check ───────────────────────────────────────────────
  _app.get('/health', (req, res) => res.json({ status: 'ok', uptime: Math.floor(process.uptime()) }));

  // ── Cryptomus webhook ──────────────────────────────────────────
  _app.post('/crypto/webhook', handleCryptomusWebhook);

  // ── Mini App: Admin Analytics page ─────────────────────────────
  _app.get('/webapp/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'webapp', 'public', 'admin.html'));
  });

  // ── API: Admin Stats (authenticated) ───────────────────────────
  _app.get('/api/admin/stats', webAppAdminAuth(pool), handleAdminStats);
  _app.get('/api/admin/chart', webAppAdminAuth(pool), handleAdminChart);

  // ── Catch-all: Block page for non-Telegram visitors ────────────
  _app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'webapp', 'public', 'blocked.html'));
  });

  const host = process.env.IP || '0.0.0.0';
  _server = _app.listen(port, host, () => {
    logger.info(`[WebServer] Running on ${host}:${port}`);
  });

  return _app;
}

export function stopWebServer() {
  if (_server) _server.close();
}

// ═══════════════════════════════════════════════════════════════════
//  API: Admin Stats
// ═══════════════════════════════════════════════════════════════════
async function handleAdminStats(req, res) {
  try {
    const pool = _pool;

    // Parallel queries for speed
    const [
      totalUsersR,
      todayUsersR,
      activeUsersR,
      todayDepositsR,
      yesterdayDepositsR,
      totalRevenueR,
      totalReferralsR,
      yesterdayUsersR,
      recentDepositsR,
    ] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS c FROM users'),
      pool.query("SELECT COUNT(*)::int AS c FROM users WHERE first_seen >= CURRENT_DATE"),
      pool.query("SELECT COUNT(*)::int AS c FROM users WHERE is_active = TRUE AND is_banned = FALSE"),
      pool.query("SELECT COALESCE(SUM(amount), 0)::numeric AS s FROM transactions WHERE status = 'success' AND created_at >= CURRENT_DATE"),
      pool.query("SELECT COALESCE(SUM(amount), 0)::numeric AS s FROM transactions WHERE status = 'success' AND created_at >= CURRENT_DATE - INTERVAL '1 day' AND created_at < CURRENT_DATE"),
      pool.query("SELECT COALESCE(SUM(amount), 0)::numeric AS s FROM transactions WHERE status = 'success'"),
      pool.query("SELECT COUNT(*)::int AS c FROM users WHERE referred_by IS NOT NULL"),
      pool.query("SELECT COUNT(*)::int AS c FROM users WHERE first_seen >= CURRENT_DATE - INTERVAL '1 day' AND first_seen < CURRENT_DATE"),
      pool.query("SELECT COUNT(*)::int AS c, COALESCE(SUM(amount), 0)::numeric AS s FROM transactions WHERE status = 'success' AND created_at >= NOW() - INTERVAL '1 hour'"),
    ]);

    const todayDeposits = parseFloat(todayDepositsR.rows[0].s);
    const yesterdayDeposits = parseFloat(yesterdayDepositsR.rows[0].s);
    const todayUsers = todayUsersR.rows[0].c;
    const yesterdayUsers = yesterdayUsersR.rows[0].c;

    const todayDepositsChange = yesterdayDeposits > 0
      ? Math.round(((todayDeposits - yesterdayDeposits) / yesterdayDeposits) * 100)
      : todayDeposits > 0 ? 100 : 0;
    const todayUsersChange = yesterdayUsers > 0
      ? Math.round(((todayUsers - yesterdayUsers) / yesterdayUsers) * 100)
      : todayUsers > 0 ? 100 : 0;

    // Quick overview items
    const activity = {
      items: [
        {
          type: 'deposit', icon: '💳', color: 'green',
          title: 'Last Hour Deposits',
          subtitle: `${recentDepositsR.rows[0].c} transactions`,
          value: `₹${parseFloat(recentDepositsR.rows[0].s).toLocaleString('en-IN')}`,
        },
        {
          type: 'users', icon: '📈', color: 'blue',
          title: 'Today New Users',
          subtitle: 'Joined today',
          value: todayUsers.toLocaleString('en-IN'),
        },
        {
          type: 'referral', icon: '🎁', color: 'pink',
          title: 'Referral Network',
          subtitle: 'Users joined via referral',
          value: totalReferralsR.rows[0].c.toLocaleString('en-IN'),
        },
        {
          type: 'revenue', icon: '🏦', color: 'orange',
          title: 'Lifetime Revenue',
          subtitle: 'All-time deposits',
          value: `₹${parseFloat(totalRevenueR.rows[0].s).toLocaleString('en-IN')}`,
        },
      ],
    };

    res.json({
      totalUsers: totalUsersR.rows[0].c,
      todayUsers,
      todayDeposits: Math.round(todayDeposits),
      totalRevenue: Math.round(parseFloat(totalRevenueR.rows[0].s)),
      activeUsers: activeUsersR.rows[0].c,
      totalReferrals: totalReferralsR.rows[0].c,
      todayUsersChange,
      todayDepositsChange,
      activity,
    });
  } catch (err) {
    logger.error(`[WebApp] Stats error: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
}

// ═══════════════════════════════════════════════════════════════════
//  API: 7-Day Chart
// ═══════════════════════════════════════════════════════════════════
async function handleAdminChart(req, res) {
  try {
    const pool = _pool;
    const { rows } = await pool.query(`
      SELECT
        d.day::date AS day,
        COALESCE(SUM(t.amount), 0)::numeric AS amount
      FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day') AS d(day)
      LEFT JOIN transactions t
        ON t.created_at::date = d.day::date AND t.status = 'success'
      GROUP BY d.day
      ORDER BY d.day
    `);

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = rows.map(r => ({
      label: dayNames[new Date(r.day).getDay()],
      amount: Math.round(parseFloat(r.amount)),
    }));

    res.json({ days });
  } catch (err) {
    logger.error(`[WebApp] Chart error: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch chart' });
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Cryptomus Webhook (unchanged)
// ═══════════════════════════════════════════════════════════════════
async function handleCryptomusWebhook(req, res) {
  try {
    const body = req.body;
    if (!body || !body.order_id || !body.sign) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const orderId = body.order_id;
    const paymentStatus = body.status;

    // Get transaction
    const txn = await transactionRepo.getByOrderId(_pool, orderId);
    if (!txn) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Already processed — skip but still return 200
    if (txn.status === 'success' || txn.status === 'failed') {
      return res.json({ success: true, already_processed: true });
    }

    // Get API key for signature verification
    const { default: settingsRepo } = await import('./database/repositories/settingsRepo.js');
    const apiKey = await settingsRepo.getSetting(_pool, 'cryptomus_api_key');
    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    // Verify Cryptomus signature
    const receivedSign = body.sign;
    const dataForSign = { ...body };
    delete dataForSign.sign;
    const sorted = Object.keys(dataForSign).sort().reduce((o, k) => { o[k] = dataForSign[k]; return o; }, {});
    const base64 = Buffer.from(JSON.stringify(sorted)).toString('base64');
    const expectedSign = crypto.createHash('md5').update(base64 + apiKey).digest('hex');

    if (receivedSign !== expectedSign) {
      logger.warn(`[Webhook] Invalid signature for ${orderId}`);
      return res.status(403).json({ error: 'Invalid signature' });
    }

    // ── Process payment status ──────────────────────────────────
    const isPaid = ['paid', 'paid_over'].includes(paymentStatus);
    const isFailed = ['cancel', 'system_fail', 'fail', 'wrong_amount'].includes(paymentStatus);

    if (isPaid) {
      const creditAmount = parseFloat(txn.amount);
      const uuid = body.uuid || txn.gateway_data?.uuid;

      await transactionRepo.updateStatus(_pool, orderId, 'success', uuid, {
        cryptomus_status: paymentStatus, via: 'webhook',
      });
      await walletRepo.addBalance(_pool, txn.user_id, creditAmount);

      // Apply deposit benefits (tax/bonus)
      let netAmount = creditAmount;
      try {
        const { applyBenefits } = await import('./handlers/deposit/shared.js');
        const { netCreditAmount } = await applyBenefits(_pool, txn.user_id, creditAmount, orderId);
        netAmount = netCreditAmount;
      } catch { /* benefits failed — use gross */ }

      const newBalance = await walletRepo.getBalance(_pool, txn.user_id);

      // Process referral commission on NET amount (best-effort, non-blocking)
      try {
        const { processReferralReward } = await import('./services/referralService.js');
        await processReferralReward(_pool, _bot.api, txn.user_id, netAmount, orderId);
      } catch { /* referral processing should never block webhook */ }

      // Notify user via Telegram
      try {
        if (txn.gateway_data?.qrMsgId) {
          try { await _bot.api.deleteMessage(txn.user_id, txn.gateway_data.qrMsgId); } catch {}
        }
        await _bot.api.sendMessage(txn.user_id,
          `╔══════════════════════╗\n` +
          `   ✅ <b>Payment Received!</b>\n` +
          `╚══════════════════════╝\n\n` +
          `💰 <b>Credited:</b> ₹${creditAmount.toFixed(2)}\n` +
          `💳 <b>New Balance:</b> ₹${newBalance.toFixed(2)}\n` +
          `📋 <b>Order:</b> <code>${orderId}</code>\n\n` +
          `⚡ <i>Instant verification</i>`,
          { parse_mode: 'HTML' }
        );
      } catch (err) {
        logger.warn(`[Webhook] Notify failed for user ${txn.user_id}: ${err.message}`);
      }

      logger.info(`[Webhook] ✅ ${orderId} ₹${creditAmount} → user ${txn.user_id}`);

    } else if (isFailed) {
      await transactionRepo.updateStatus(_pool, orderId, 'failed', body.uuid, {
        cryptomus_status: paymentStatus, via: 'webhook',
      });

      try {
        await _bot.api.sendMessage(txn.user_id,
          `❌ <b>Payment Failed</b>\n\n` +
          `📋 <b>Order:</b> <code>${orderId}</code>\n` +
          `📊 <b>Status:</b> ${paymentStatus}\n\n` +
          `<i>Please try again.</i>`,
          { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '💰 Deposit', callback_data: 'deposit:menu' }]] } }
        );
      } catch {}

      logger.info(`[Webhook] ❌ ${orderId} failed (${paymentStatus})`);
    }

    // Always 200 to Cryptomus (they retry on non-200)
    res.json({ success: true });
  } catch (err) {
    logger.error(`[Webhook] Error: ${err.message}`);
    res.status(500).json({ error: 'Internal error' });
  }
}
