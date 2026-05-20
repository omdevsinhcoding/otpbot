import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as forceJoinRepo from '../database/repositories/forceJoinRepo.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import { ActionType } from '../utils/constants.js';
import { escapeHtml } from '../utils/formatters.js';
import logger from '../utils/logger.js';

const composer = new Composer();
const addStates = new Map(); // chatId → 'waiting_channel'

// ── Force join panel ────────────────────────────────────────────
composer.callbackQuery('admin:forcejoin', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const enabled = await settingsRepo.getSetting(ctx.dbPool, 'force_join_enabled');
  const statusEmoji = enabled ? '✅ Enabled' : '❌ Disabled';
  const toggleLabel = enabled ? '🔴 Disable' : '🟢 Enable';

  const kb = new InlineKeyboard()
    .text(toggleLabel, 'forcejoin:toggle').row()
    .text('➕ Add Channel', 'forcejoin:add').text('📋 List Channels', 'forcejoin:list').row()
    .text('‹ Back', 'admin:back');

  await ctx.editMessageText(`🔗 <b>Force Join Management</b>\n\nStatus: <b>${statusEmoji}</b>`, { parse_mode: 'HTML', reply_markup: kb });
});

// ── Toggle ──────────────────────────────────────────────────────
composer.callbackQuery('forcejoin:toggle', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const pool = ctx.dbPool;
  const current = await settingsRepo.getSetting(pool, 'force_join_enabled');
  const newState = !current;
  await settingsRepo.setSetting(pool, 'force_join_enabled', newState, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'toggle_force_join', new_state: newState });

  const statusEmoji = newState ? '✅ Enabled' : '❌ Disabled';
  const toggleLabel = newState ? '🔴 Disable' : '🟢 Enable';
  const kb = new InlineKeyboard()
    .text(toggleLabel, 'forcejoin:toggle').row()
    .text('➕ Add Channel', 'forcejoin:add').text('📋 List Channels', 'forcejoin:list').row()
    .text('‹ Back', 'admin:back');

  await ctx.editMessageText(`🔗 <b>Force Join Management</b>\n\nStatus: <b>${statusEmoji}</b>\n\n✅ Force join has been <b>${newState ? 'enabled' : 'disabled'}</b>.`, { parse_mode: 'HTML', reply_markup: kb });
});

// ── List channels ───────────────────────────────────────────────
composer.callbackQuery('forcejoin:list', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const channels = await forceJoinRepo.getActiveChannels(ctx.dbPool);

  if (!channels.length) {
    await ctx.editMessageText('📋 <b>Force Join Channels</b>\n\nNo channels configured.', {
      parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('‹ Back', 'admin:forcejoin')
    });
    return;
  }

  let text = '📋 <b>Force Join Channels</b>\n\n';
  const kb = new InlineKeyboard();
  for (const ch of channels) {
    const display = ch.channel_username ? `@${escapeHtml(ch.channel_username)}` : String(ch.channel_id);
    text += `┃ ${display} — ${escapeHtml(ch.channel_title || 'N/A')}\n`;
    kb.text(`🗑 Remove ${display}`, `forcejoin:remove:${ch.channel_id}`).row();
  }
  kb.text('‹ Back', 'admin:forcejoin');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
});

// ── Remove channel ──────────────────────────────────────────────
composer.callbackQuery(/^forcejoin:remove:-?\d+$/, adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const channelId = ctx.callbackQuery.data.split(':')[2];
  const kb = new InlineKeyboard()
    .text('✅ Confirm', `forcejoin:confirm_remove:${channelId}`)
    .text('❌ Cancel', 'forcejoin:list');
  await ctx.editMessageText(`⚠️ Remove channel <code>${channelId}</code> from force join?`, { parse_mode: 'HTML', reply_markup: kb });
});

composer.callbackQuery(/^forcejoin:confirm_remove:-?\d+$/, adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  const channelId = Number(ctx.callbackQuery.data.split(':')[2]);
  await forceJoinRepo.removeChannel(ctx.dbPool, channelId);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'remove_channel', channel_id: channelId });
  await ctx.editMessageText(`✅ Channel removed.`, { reply_markup: new InlineKeyboard().text('‹ Back', 'forcejoin:list') });
});

// ── Add channel entry ───────────────────────────────────────────
composer.callbackQuery('forcejoin:add', adminRequired, async (ctx) => {
  await ctx.answerCallbackQuery();
  addStates.set(ctx.chat.id, 'waiting_channel');
  await ctx.editMessageText(
    '➕ <b>Add Force Join Channel</b>\n\nSend channel ID (e.g. <code>-1001234567890</code>) or username (e.g. <code>@mychannel</code>).\n\n⚠️ Bot must be <b>admin</b> in the channel.\n\nSend /cancel to abort.',
    { parse_mode: 'HTML' }
  );
});

// ── Receive channel input ───────────────────────────────────────
composer.on('message:text', async (ctx, next) => {
  if (addStates.get(ctx.chat.id) !== 'waiting_channel') return next();

  if (ctx.message.text === '/cancel') {
    addStates.delete(ctx.chat.id);
    await ctx.reply('❌ Channel addition cancelled.');
    return;
  }

  addStates.delete(ctx.chat.id);
  const raw = ctx.message.text.trim();
  let chatIdentifier = raw.startsWith('@') ? raw : (raw.match(/^-?\d+$/) ? Number(raw) : null);

  if (chatIdentifier === null) {
    await ctx.reply('⚠️ Invalid format. Send a channel ID or @username.');
    return;
  }

  try {
    const chat = await ctx.api.getChat(chatIdentifier);
    const botMember = await ctx.api.getChatMember(chat.id, ctx.me.id);
    if (!['administrator', 'creator'].includes(botMember.status)) {
      await ctx.reply('⚠️ The bot is <b>not an admin</b> in that channel. Please add it first.', { parse_mode: 'HTML' });
      return;
    }

    let inviteLink = null;
    try { inviteLink = (await ctx.api.createChatInviteLink(chat.id)).invite_link; } catch { /* ignore */ }

    await forceJoinRepo.addChannel(ctx.dbPool, {
      channelId: chat.id,
      channelUsername: chat.username || '',
      channelTitle: chat.title || '',
      inviteLink,
      addedBy: ctx.from.id,
    });

    ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'add_channel', channel_id: chat.id });
    const display = chat.username ? `@${chat.username}` : String(chat.id);
    await ctx.reply(`✅ Channel ${display} (<b>${escapeHtml(chat.title)}</b>) added to force join.`, { parse_mode: 'HTML' });
  } catch (err) {
    logger.warn(`Cannot access channel ${chatIdentifier}: ${err.message}`);
    await ctx.reply('⚠️ Could not access that channel. Ensure the channel exists and the bot is a member.');
  }
});

export default composer;
