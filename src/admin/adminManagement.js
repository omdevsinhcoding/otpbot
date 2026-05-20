import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired, superAdminRequired, clearAdminCache } from '../middleware/auth.js';
import * as adminRepo from '../database/repositories/adminRepo.js';
import { ActionType } from '../utils/constants.js';
import { escapeHtml, formatTimestamp } from '../utils/formatters.js';
import logger from '../utils/logger.js';

const composer = new Composer();
const addStates = new Map(); // chatId → 'waiting_id'

// ── Admin list ──────────────────────────────────────────────────
composer.callbackQuery('admin:admins', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const admins = await adminRepo.listAdmins(ctx.dbPool);

  let text = '👑 <b>Admin Management</b>\n\n';
  const kb = new InlineKeyboard();
  for (const a of admins) {
    const role = a.role === 'super_admin' ? '👑 Super' : '🛡️ Admin';
    const name = a.username ? `@${escapeHtml(a.username)}` : String(a.admin_id);
    text += `┃ ${role} — <code>${a.admin_id}</code> (${name})\n`;
    kb.text(`👁 ${name}`, `admgmt:view:${a.admin_id}`).text('🗑 Remove', `admgmt:remove:${a.admin_id}`).row();
  }
  if (!admins.length) text += 'No admins found.\n';

  kb.text('➕ Add Admin', 'admgmt:add').row().text('‹ Back', 'admin:back');
  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
});

// ── View admin ──────────────────────────────────────────────────
composer.callbackQuery(/^admgmt:view:\d+$/, adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const targetId = Number(ctx.callbackQuery.data.split(':')[2]);
  const adm = await adminRepo.getAdmin(ctx.dbPool, targetId);
  if (!adm) { await ctx.editMessageText('⚠️ Admin not found.'); return; }

  const role = adm.role === 'super_admin' ? 'Super Admin' : 'Admin';
  const text =
    `👑 <b>Admin Details</b>\n\n` +
    `🆔 <b>User ID:</b> <code>${targetId}</code>\n` +
    `📛 <b>Username:</b> ${adm.username ? '@' + escapeHtml(adm.username) : 'N/A'}\n` +
    `🏷️ <b>Role:</b> ${role}\n` +
    `📅 <b>Added:</b> ${formatTimestamp(adm.added_at)}`;

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('‹ Back', 'admin:admins') });
});

// ── Remove admin ────────────────────────────────────────────────
composer.callbackQuery(/^admgmt:remove:\d+$/, superAdminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const targetId = Number(ctx.callbackQuery.data.split(':')[2]);

  if (await adminRepo.isSuperAdmin(ctx.dbPool, targetId)) {
    await ctx.editMessageText('⚠️ Cannot remove the super admin.', {
      reply_markup: new InlineKeyboard().text('‹ Back', 'admin:admins')
    });
    return;
  }

  const kb = new InlineKeyboard()
    .text('✅ Confirm', `admgmt:confirm_remove:${targetId}`)
    .text('❌ Cancel', 'admin:admins');
  await ctx.editMessageText(`⚠️ Remove admin <code>${targetId}</code>?`, { parse_mode: 'HTML', reply_markup: kb });
});

composer.callbackQuery(/^admgmt:confirm_remove:\d+$/, superAdminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const targetId = Number(ctx.callbackQuery.data.split(':')[2]);

  if (await adminRepo.isSuperAdmin(ctx.dbPool, targetId)) {
    await ctx.editMessageText('⚠️ Cannot remove the super admin.');
    return;
  }

  await adminRepo.removeAdmin(ctx.dbPool, targetId);
  clearAdminCache(targetId);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.ADMIN_REMOVED, { target: targetId });

  await ctx.editMessageText(`✅ Admin <code>${targetId}</code> removed.`, {
    parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('‹ Back', 'admin:admins')
  });
});

// ── Add admin entry ─────────────────────────────────────────────
composer.callbackQuery('admgmt:add', superAdminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  addStates.set(ctx.chat.id, 'waiting_id');
  await ctx.editMessageText(
    '👑 <b>Add Admin</b>\n\nSend me the <b>user ID</b> of the person you want to make an admin.\n\nSend /cancel to abort.',
    { parse_mode: 'HTML' }
  );
});

// ── Receive admin ID ────────────────────────────────────────────
composer.on('message:text', async (ctx, next) => {
  if (addStates.get(ctx.chat.id) !== 'waiting_id') return next();

  if (ctx.message.text === '/cancel') {
    addStates.delete(ctx.chat.id);
    await ctx.reply('❌ Admin addition cancelled.');
    return;
  }

  const text = ctx.message.text.trim();
  if (!/^\d+$/.test(text)) {
    await ctx.reply('⚠️ Please send a valid numeric user ID.\n\nSend /cancel to abort.');
    return;
  }

  addStates.delete(ctx.chat.id);
  const targetId = Number(text);
  const pool = ctx.dbPool;

  const existing = await adminRepo.getAdmin(pool, targetId);
  if (existing) {
    await ctx.reply(`ℹ️ User <code>${targetId}</code> is already an admin.`, { parse_mode: 'HTML' });
    return;
  }

  await adminRepo.createAdmin(pool, targetId, 'admin', {}, ctx.from.id);
  clearAdminCache(targetId);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.ADMIN_ADDED, { target: targetId });
  await ctx.reply(`✅ User <code>${targetId}</code> has been added as an admin.`, { parse_mode: 'HTML' });
});

export default composer;
