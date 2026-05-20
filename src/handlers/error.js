import { GrammyError, HttpError } from 'grammy';
import { ActionType } from '../utils/constants.js';
import logger from '../utils/logger.js';

export function setupErrorHandler(bot) {
  bot.catch(async (err) => {
    const ctx = err.ctx;
    const e = err.error;

    // ── Network / timeout errors → silent log ─────────────────────
    if (e instanceof HttpError) {
      logger.warn(`HTTP error: ${e.message}`);
      return;
    }

    if (e instanceof GrammyError) {
      if (e.description?.includes('Forbidden') || e.description?.includes('blocked')) {
        logger.warn(`Forbidden (user blocked bot): ${e.description}`);
        return;
      }
      if (e.description?.includes('Too Many Requests')) {
        logger.warn(`Rate limited by Telegram API: ${e.description}`);
        return;
      }
    }

    // ── Full error logging ────────────────────────────────────────
    logger.error(`Unhandled error: ${e?.message || e}`, { stack: e?.stack });

    // ── Track error ───────────────────────────────────────────────
    try {
      if (ctx?.from && ctx?.tracker) {
        ctx.tracker.trackFireAndForget(
          ctx.from.id,
          ActionType.ERROR_OCCURRED,
          { error_type: e?.constructor?.name, error_message: String(e?.message || e).slice(0, 500) },
        );
      }
    } catch { /* swallow */ }

    // ── Notify user ───────────────────────────────────────────────
    try {
      if (ctx) {
        if (ctx.callbackQuery) {
          await ctx.answerCallbackQuery({ text: '⚠️ An error occurred.', show_alert: true });
        } else {
          await ctx.reply('⚠️ An unexpected error occurred. Please try again later.');
        }
      }
    } catch { /* swallow */ }
  });
}
