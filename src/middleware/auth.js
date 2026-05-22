import logger from '../utils/logger.js';

const adminCache = new Map(); // userId → { isAdmin, isSuper, ts }
const CACHE_TTL = 60_000;

async function checkAdmin(userId, pool) {
  const cached = adminCache.get(userId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.isAdmin;
  const { isAdmin } = await import('../database/repositories/adminRepo.js');
  const result = await isAdmin(pool, userId);
  const entry = adminCache.get(userId) || {};
  adminCache.set(userId, { ...entry, isAdmin: result, ts: Date.now() });
  return result;
}

async function checkSuperAdmin(userId, pool) {
  const cached = adminCache.get(userId);
  if (cached && cached.isSuper !== undefined && Date.now() - cached.ts < CACHE_TTL) return cached.isSuper;
  const { isSuperAdmin } = await import('../database/repositories/adminRepo.js');
  const result = await isSuperAdmin(pool, userId);
  const entry = adminCache.get(userId) || {};
  adminCache.set(userId, { ...entry, isSuper: result, ts: Date.now() });
  return result;
}

export async function adminRequired(ctx, next) {
  if (!ctx.from) return;
  try {
    const isAdm = await checkAdmin(ctx.from.id, ctx.dbPool);
    if (!isAdm) {
      if (ctx.callbackQuery) {
        try { await ctx.answerCallbackQuery({ text: '⛔ Unauthorized', show_alert: true }); } catch {}
      } else {
        await ctx.reply('⛔ You are not authorized.');
      }
      return;
    }
    return next();
  } catch (err) {
    logger.error(`Admin auth check failed: ${err.message}`);
    await ctx.reply('⚠️ An error occurred during authorization.');
  }
}

export async function superAdminRequired(ctx, next) {
  if (!ctx.from) return;
  try {
    const isSuper = await checkSuperAdmin(ctx.from.id, ctx.dbPool);
    if (!isSuper) {
      if (ctx.callbackQuery) {
        try { await ctx.answerCallbackQuery({ text: '⛔ Super admin access required', show_alert: true }); } catch {}
      } else {
        await ctx.reply('⛔ Super admin access required.');
      }
      return;
    }
    return next();
  } catch (err) {
    logger.error(`Super admin auth check failed: ${err.message}`);
    await ctx.reply('⚠️ An error occurred during authorization.');
  }
}

export function clearAdminCache(userId = null) {
  if (userId) adminCache.delete(userId);
  else adminCache.clear();
}
