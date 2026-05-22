import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as userRepo from '../database/repositories/userRepo.js';
import { ActionType } from '../utils/constants.js';
import { escapeHtml, formatNumber, formatTimestamp, formatUserCard } from '../utils/formatters.js';
import logger from '../utils/logger.js';
import { registerAdminState } from '../utils/adminStates.js';

const composer = new Composer();
const searchStates = new Map(); // chatId → 'searching'
registerAdminState(searchStates);

// ── User management menu ────────────────────────────────────────
composer.callbackQuery('admin:users', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const kb = new InlineKeyboard()
    .text('📋 All Users', 'usrmgmt:all:1').text('🔍 Search User', 'usrmgmt:search').row()
    .text('📊 User Stats', 'usrmgmt:stats').row()
    .text('‹ Back', 'admin:back');
  await ctx.editMessageText('👥 <b>User Management</b>\n\nChoose an option:', { parse_mode: 'HTML', reply_markup: kb });
});

// ── All users (paginated) ───────────────────────────────────────
composer.callbackQuery(/^usrmgmt:all:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const page = Number(ctx.callbackQuery.data.split(':')[2]);
  const { users, total } = await userRepo.getUsersPaginated(ctx.dbPool, page, 10);

  if (!users.length) {
    await ctx.editMessageText('📋 No users found.', { reply_markup: new InlineKeyboard().text('‹ Back', 'admin:users') });
    return;
  }

  let text = `📋 <b>All Users</b> (${formatNumber(total)} total)\n\n`;
  const kb = new InlineKeyboard();
  for (const u of users) {
    const name = escapeHtml(u.full_name || 'N/A');
    text += `┃ <code>${u.user_id}</code> | ${name} ${u.username ? '| @' + escapeHtml(u.username) : ''}\n`;
    kb.text(`👁 ${u.user_id}`, `usrmgmt:view:${u.user_id}`).row();
  }

  const totalPages = Math.max(1, Math.ceil(total / 10));
  if (page > 1) kb.text('◀️ Prev', `usrmgmt:all:${page - 1}`);
  kb.text(`${page}/${totalPages}`, 'noop');
  if (page < totalPages) kb.text('Next ▶️', `usrmgmt:all:${page + 1}`);
  kb.row().text('‹ Back', 'admin:users');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
});

// ── Search user entry ───────────────────────────────────────────
composer.callbackQuery('usrmgmt:search', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  searchStates.set(ctx.chat.id, 'searching');
  await ctx.editMessageText(
    '🔍 <b>Search User</b>\n\nSend a <b>user ID</b> or <b>username</b> to search.',
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'usrmgmt:cancel_search') }
  );
});

// ── View user ───────────────────────────────────────────────────
composer.callbackQuery(/^usrmgmt:view:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const userId = Number(ctx.callbackQuery.data.split(':')[2]);
  const user = await userRepo.getUser(ctx.dbPool, userId);
  if (!user) {
    await ctx.editMessageText('⚠️ User not found.', {
      reply_markup: new InlineKeyboard().text('🔍 Search Again', 'usrmgmt:search').text('‹ Back', 'admin:users')
    });
    return;
  }

  const text = formatUserCard(user);
  const kb = new InlineKeyboard();
  if (user.is_banned) kb.text('✅ Unban', `usrmgmt:unban:${userId}`);
  else kb.text('🚫 Ban', `usrmgmt:ban:${userId}`);
  kb.row().text('‹ Back', 'usrmgmt:all:1');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
});

// ── Ban user ────────────────────────────────────────────────────
composer.callbackQuery(/^usrmgmt:ban:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const userId = Number(ctx.callbackQuery.data.split(':')[2]);
  const kb = new InlineKeyboard()
    .text('✅ Confirm Ban', `usrmgmt:confirm_ban:${userId}`)
    .text('❌ Cancel', `usrmgmt:view:${userId}`);
  await ctx.editMessageText(`⚠️ Ban user <code>${userId}</code>?`, { parse_mode: 'HTML', reply_markup: kb });
});

composer.callbackQuery(/^usrmgmt:confirm_ban:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const userId = Number(ctx.callbackQuery.data.split(':')[2]);
  await userRepo.banUser(ctx.dbPool, userId);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.USER_BANNED, { target: userId });
  await ctx.editMessageText(`✅ User <code>${userId}</code> has been banned.`, {
    parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('‹ Back', 'usrmgmt:all:1')
  });
});

// ── Unban user ──────────────────────────────────────────────────
composer.callbackQuery(/^usrmgmt:unban:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const userId = Number(ctx.callbackQuery.data.split(':')[2]);
  await userRepo.unbanUser(ctx.dbPool, userId);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.USER_UNBANNED, { target: userId });
  await ctx.editMessageText(`✅ User <code>${userId}</code> has been unbanned.`, {
    parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('‹ Back', 'usrmgmt:all:1')
  });
});

// ── User stats ──────────────────────────────────────────────────
composer.callbackQuery('usrmgmt:stats', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const [total, active, banned, today] = await Promise.all([
    userRepo.countUsers(pool), userRepo.countActiveUsers(pool),
    userRepo.countBannedUsers(pool), userRepo.countUsersToday(pool),
  ]);

  const text =
    `📊 <b>User Stats</b>\n\n` +
    `👥 Total Users: <b>${formatNumber(total)}</b>\n` +
    `✅ Active Users: <b>${formatNumber(active)}</b>\n` +
    `🚫 Banned Users: <b>${formatNumber(banned)}</b>\n` +
    `📅 New Today: <b>${formatNumber(today)}</b>`;

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('‹ Back', 'admin:users') });
});

// ── Search handler (text) ───────────────────────────────────────
composer.on('message:text', async (ctx, next) => {
  if (searchStates.get(ctx.chat.id) !== 'searching') return next();

  if (ctx.message.text === '/cancel') {
    searchStates.delete(ctx.chat.id);
    await ctx.reply('❌ Cancelled.', { reply_markup: new InlineKeyboard().text('‹ Back', 'admin:users') });
    return;
  }

  searchStates.delete(ctx.chat.id);
  const query = ctx.message.text.trim();
  const pool = ctx.dbPool;
  let users = [];

  if (/^\d+$/.test(query)) {
    const user = await userRepo.searchUserById(pool, Number(query));
    if (user) users = [user];
  } else {
    users = await userRepo.searchUsersByUsername(pool, query.replace('@', ''));
  }

  if (!users.length) {
    await ctx.reply('🔍 No users found.', {
      reply_markup: new InlineKeyboard().text('🔍 Search Again', 'usrmgmt:search').text('‹ Back', 'admin:users')
    });
    return;
  }

  let text = '🔍 <b>Search Results</b>\n\n';
  const kb = new InlineKeyboard();
  for (const u of users) {
    text += `┃ <code>${u.user_id}</code> | ${escapeHtml(u.full_name || 'N/A')}\n`;
    kb.text(`👁 ${u.user_id}`, `usrmgmt:view:${u.user_id}`).row();
  }

  kb.row().text('🔍 Search Again', 'usrmgmt:search').text('‹ Back', 'admin:users');
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
});

// ── Cancel search ──────────────────────────────────────────────
composer.callbackQuery('usrmgmt:cancel_search', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  searchStates.delete(ctx.chat.id);
  const kb = new InlineKeyboard()
    .text('📋 All Users', 'usrmgmt:all:1').text('🔍 Search User', 'usrmgmt:search').row()
    .text('📊 User Stats', 'usrmgmt:stats').row()
    .text('‹ Back', 'admin:back');
  await ctx.editMessageText('👥 <b>User Management</b>\n\nChoose an option:', { parse_mode: 'HTML', reply_markup: kb });
});

export default composer;
