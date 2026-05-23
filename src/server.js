/**
 * HTTP Server — Webhooks + Future Mini App Dashboard
 * Runs alongside the Telegram bot on WEBHOOK_PORT
 */
import express from 'express';
import crypto from 'crypto';
import logger from './utils/logger.js';
import * as transactionRepo from './database/repositories/transactionRepo.js';
import * as walletRepo from './database/repositories/walletRepo.js';

let _bot = null;
let _pool = null;
let _app = null;
let _server = null;

export function startWebServer(bot, pool, port = 3000) {
  _bot = bot;
  _pool = pool;
  _app = express();

  _app.use(express.json());

  // Health check
  _app.get('/health', (req, res) => res.json({ status: 'ok', uptime: Math.floor(process.uptime()) }));

  // Cryptomus webhook — INSTANT payment notification
  _app.post('/crypto/webhook', handleCryptomusWebhook);

  // Future: Mini App dashboard routes will go here
  // _app.use('/app', express.static('public'));

  const host = process.env.IP || '0.0.0.0';
  _server = _app.listen(port, host, () => {
    logger.info(`[WebServer] Running on ${host}:${port}`);
  });

  return _app;
}

export function stopWebServer() {
  if (_server) _server.close();
}

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
      const newBalance = await walletRepo.getBalance(_pool, txn.user_id);

      // Process referral commission (best-effort, non-blocking)
      try {
        const { processReferralReward } = await import('./services/referralService.js');
        await processReferralReward(_pool, _bot.api, txn.user_id, creditAmount, orderId);
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
