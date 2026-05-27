/**
 * Telegram Web App Authentication — initData HMAC-SHA256 Validation
 *
 * Validates that requests come from Telegram (not spoofed).
 * Checks that the user is an admin in the database.
 *
 * Algorithm (per Telegram docs):
 *   secret_key = HMAC-SHA256("WebAppData", BOT_TOKEN)
 *   data_check_string = sorted key=value pairs from initData
 *   hash = HMAC-SHA256(secret_key, data_check_string)
 *   valid = (hash === received_hash) AND (auth_date is recent)
 */

import crypto from 'crypto';
import settings from '../config/settings.js';
import logger from '../utils/logger.js';

const MAX_AUTH_AGE_SEC = 86400; // 24 hours

/**
 * Parse and validate Telegram initData string.
 * Returns the parsed user object if valid, null if invalid.
 */
export function validateInitData(initDataStr) {
  if (!initDataStr) return null;

  try {
    const params = new URLSearchParams(initDataStr);
    const hash = params.get('hash');
    if (!hash) return null;

    // Build data-check-string: sorted key=value pairs (excluding hash)
    const entries = [];
    for (const [key, value] of params.entries()) {
      if (key !== 'hash') entries.push([key, value]);
    }
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

    // HMAC validation
    const secretKey = crypto.createHmac('sha256', 'WebAppData')
      .update(settings.BOT_TOKEN)
      .digest();

    const computedHash = crypto.createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (computedHash !== hash) {
      logger.debug('[WebApp] HMAC mismatch');
      return null;
    }

    // Check auth_date freshness
    const authDate = parseInt(params.get('auth_date') || '0');
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > MAX_AUTH_AGE_SEC) {
      logger.debug('[WebApp] Auth expired');
      return null;
    }

    // Parse user object
    const userStr = params.get('user');
    if (!userStr) return null;
    return JSON.parse(userStr);
  } catch (err) {
    logger.debug(`[WebApp] Parse error: ${err.message}`);
    return null;
  }
}

/**
 * Express middleware: Validate Telegram initData + check admin status.
 * Sets req.telegramUser if valid admin.
 */
export function webAppAdminAuth(pool) {
  return async (req, res, next) => {
    const initData = req.headers['x-telegram-init-data'] || req.query.initData;
    const user = validateInitData(initData);

    if (!user || !user.id) {
      return res.status(403).json({ error: 'unauthorized', message: 'Invalid Telegram authentication' });
    }

    // Check if user is admin in DB
    try {
      const { isAdmin } = await import('../database/repositories/adminRepo.js');
      const admin = await isAdmin(pool, user.id);
      if (!admin) {
        return res.status(403).json({ error: 'forbidden', message: 'Admin access required' });
      }
      req.telegramUser = user;
      next();
    } catch (err) {
      logger.error(`[WebApp] DB auth error: ${err.message}`);
      return res.status(500).json({ error: 'internal', message: 'Auth check failed' });
    }
  };
}
