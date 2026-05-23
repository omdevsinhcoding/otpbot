/**
 * Winston logger with Telegram admin transport.
 *
 * All error logs are sent to the admin's Telegram chat.
 * The bot instance must be connected via `logger.setBotApi(bot.api)`
 * after the bot is created (called in index.js).
 */

import winston from 'winston';
import Transport from 'winston-transport';
import path from 'path';
import fs from 'fs';
import settings from '../config/settings.js';

const logLevel = settings.LOG_LEVEL;
const logPath = settings.LOG_PATH;

if (!fs.existsSync(logPath)) {
  fs.mkdirSync(logPath, { recursive: true });
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return stack
      ? `${timestamp} [${level.toUpperCase()}] ${message}\n${stack}`
      : `${timestamp} [${level.toUpperCase()}] ${message}`;
  })
);

// ── Telegram Transport — sends logs to admin chat ────────────────
class TelegramTransport extends Transport {
  constructor(opts = {}) {
    super(opts);
    this.botApi = null;
    this.adminId = settings.FIRST_ADMIN_ID;
    this.queue = [];
    this.sending = false;
    // Rate limit: max 1 message per 2 seconds to avoid Telegram flood
    this.lastSent = 0;
    this.MIN_INTERVAL = 2000;
  }

  setBotApi(api) {
    this.botApi = api;
    // Flush any queued messages
    this._flush();
  }

  log(info, callback) {
    const { level, message, timestamp, stack } = info;

    // Only send error and warn to Telegram
    if (level !== 'error' && level !== 'warn') {
      callback();
      return;
    }

    const icon = level === 'error' ? '🔴' : '🟡';
    let text = `${icon} <b>[${level.toUpperCase()}]</b>\n`;
    text += `<code>${this._escape(message)}</code>`;
    if (stack) {
      // Show first 2 lines of stack only
      const shortStack = stack.split('\n').slice(0, 3).join('\n');
      text += `\n<pre>${this._escape(shortStack)}</pre>`;
    }
    text += `\n<i>${timestamp}</i>`;

    // Truncate to Telegram limit
    if (text.length > 4000) text = text.substring(0, 4000) + '…';

    this.queue.push(text);
    this._flush();
    callback();
  }

  _escape(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async _flush() {
    if (this.sending || !this.botApi || this.queue.length === 0) return;
    this.sending = true;

    while (this.queue.length > 0) {
      // Rate limit
      const now = Date.now();
      const wait = this.MIN_INTERVAL - (now - this.lastSent);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));

      const text = this.queue.shift();
      try {
        await this.botApi.sendMessage(this.adminId, text, { parse_mode: 'HTML' });
        this.lastSent = Date.now();
      } catch {
        // If sending fails, don't re-queue (avoid infinite loop)
      }
    }

    this.sending = false;
  }
}

const telegramTransport = new TelegramTransport({ level: 'warn' });

const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      ),
    }),
    new winston.transports.File({
      filename: path.join(logPath, 'error.log'),
      level: 'error',
    }),
    new winston.transports.File({
      filename: path.join(logPath, 'bot.log'),
    }),
    telegramTransport,
  ],
});

/**
 * Connect the bot API to the logger so errors can be sent to admin.
 * Call this after creating the bot: `logger.setBotApi(bot.api)`
 */
logger.setBotApi = (api) => {
  telegramTransport.setBotApi(api);
};

export default logger;
