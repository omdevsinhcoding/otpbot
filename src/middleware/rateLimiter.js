import logger from '../utils/logger.js';
import settings from '../config/settings.js';

const userTimestamps = new Map(); // userId → number[]
const CLEANUP_INTERVAL = 5 * 60_000; // 5 minutes

// Periodic cleanup of old entries
setInterval(() => {
  const now = Date.now();
  const windowMs = settings.RATE_LIMIT_WINDOW * 1000;
  for (const [uid, stamps] of userTimestamps) {
    const recent = stamps.filter(t => now - t < windowMs);
    if (recent.length === 0) userTimestamps.delete(uid);
    else userTimestamps.set(uid, recent);
  }
}, CLEANUP_INTERVAL);

export async function rateLimiter(ctx, next) {
  if (!ctx.from) return next();

  // Check if rate limiting is enabled (use setting if possible, else default)
  try {
    const { isAdmin } = await import('../database/repositories/adminRepo.js');
    if (await isAdmin(ctx.dbPool, ctx.from.id)) return next(); // Admins bypass
  } catch { /* fall through */ }

  const userId = ctx.from.id;
  const now = Date.now();
  const windowMs = settings.RATE_LIMIT_WINDOW * 1000;
  const maxMessages = settings.RATE_LIMIT_MESSAGES;

  const stamps = userTimestamps.get(userId) || [];
  const recent = stamps.filter(t => now - t < windowMs);
  recent.push(now);
  userTimestamps.set(userId, recent);

  if (recent.length > maxMessages) {
    logger.debug(`Rate limited user ${userId} (${recent.length}/${maxMessages})`);
    await ctx.reply('⏱ Too many requests. Please wait a moment.');
    return;
  }

  return next();
}
