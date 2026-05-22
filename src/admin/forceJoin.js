import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as forceJoinRepo from '../database/repositories/forceJoinRepo.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import { ActionType } from '../utils/constants.js';
import { escapeHtml } from '../utils/formatters.js';
import logger from '../utils/logger.js';

const composer = new Composer();
const addStates = new Map(); // chatId → 'waiting_channel'

// ── Force join panel (shows channel count + list inline) ────────
async function showForceJoinPanel(ctx) {
  const pool = ctx.dbPool;
  const enabled = await settingsRepo.getSetting(pool, 'force_join_enabled');
  const channels = await forceJoinRepo.getActiveChannels(pool);
  const count = channels.length;

  const statusEmoji = enabled ? '🟢' : '🔴';
  const toggleLabel = enabled ? '🔴 Disable' : '🟢 Enable';

  let text = `🔗 <b>FORCE JOIN</b>\n\n`;
  text += `<blockquote>`;
  text += `${statusEmoji} <b>Status:</b> ${enabled ? 'Active' : 'Inactive'}\n`;
  text += `📢 <b>Channels:</b> ${count} configured`;
  text += `</blockquote>\n\n`;

  if (count > 0) {
    text += `<blockquote>`;
    text += `📋 <b>CHANNELS</b>\n\n`;
    for (let i = 0; i < channels.length; i++) {
      const ch = channels[i];
      const display = ch.channel_username ? `@${escapeHtml(ch.channel_username)}` : String(ch.channel_id);
      text += `${i + 1}. ${display} — ${escapeHtml(ch.channel_title || 'N/A')}\n`;
    }
    text += `</blockquote>`;
  } else {
    text += `<blockquote>⚠️ No channels added yet\n\nAdd channels that users must join before using the bot.</blockquote>`;
  }

  const kb = new InlineKeyboard()
    .text(toggleLabel, 'forcejoin:toggle').row()
    .text('➕ Add Channel', 'forcejoin:add').row();

  // Remove buttons for each channel
  if (count > 0) {
    for (const ch of channels) {
      const display = ch.channel_username ? `@${ch.channel_username}` : String(ch.channel_id);
      kb.text(`🗑 ${display}`, `forcejoin:remove:${ch.channel_id}`).row();
    }
  }

  kb.text('◀ Back', 'admin:back');
  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
}

composer.callbackQuery('admin:forcejoin', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await showForceJoinPanel(ctx);
});

// ── Toggle ──────────────────────────────────────────────────────
composer.callbackQuery('forcejoin:toggle', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const current = await settingsRepo.getSetting(pool, 'force_join_enabled');
  const newState = !current;
  await settingsRepo.setSetting(pool, 'force_join_enabled', newState, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'toggle_force_join', new_state: newState });
  await showForceJoinPanel(ctx);
});

// ── List channels (redirects to main panel which now shows them) ─
composer.callbackQuery('forcejoin:list', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await showForceJoinPanel(ctx);
});

// ── Remove channel ──────────────────────────────────────────────
composer.callbackQuery(/^forcejoin:remove:-?\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const channelId = ctx.callbackQuery.data.split(':')[2];
  const kb = new InlineKeyboard()
    .text('✅ Confirm Remove', `forcejoin:confirm_remove:${channelId}`)
    .text('❌ Cancel', 'admin:forcejoin');
  await ctx.editMessageText(`⚠️ Remove channel <code>${channelId}</code> from force join?`, { parse_mode: 'HTML', reply_markup: kb });
});

composer.callbackQuery(/^forcejoin:confirm_remove:-?\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const channelId = Number(ctx.callbackQuery.data.split(':')[2]);
  await forceJoinRepo.removeChannel(ctx.dbPool, channelId);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'remove_channel', channel_id: channelId });
  await showForceJoinPanel(ctx);
});

// ── Add channel entry ───────────────────────────────────────────
composer.callbackQuery('forcejoin:add', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  addStates.set(ctx.chat.id, 'waiting_channel');
  await ctx.editMessageText(
    '➕ <b>Add Force Join Channel</b>\n\n' +
    '<blockquote>' +
    'Send channel ID or username:\n\n' +
    '• ID: <code>-1001234567890</code>\n' +
    '• Username: <code>@mychannel</code>\n\n' +
    '⚠️ Bot must be <b>admin</b> in the channel.' +
    '</blockquote>',
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'forcejoin:cancel_add') }
  );
});

// ── Receive channel input ───────────────────────────────────────
composer.on('message:text', async (ctx, next) => {
  if (addStates.get(ctx.chat.id) !== 'waiting_channel') return next();

  if (ctx.message.text === '/cancel') {
    addStates.delete(ctx.chat.id);
    await ctx.reply('❌ Cancelled.', { reply_markup: new InlineKeyboard().text('◀ Back', 'admin:forcejoin') });
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

    // Check if channel already exists
    const existing = await forceJoinRepo.getChannel(ctx.dbPool, chat.id);
    if (existing && existing.is_active) {
      await ctx.reply('⚠️ This channel is already in the force join list.', {
        reply_markup: new InlineKeyboard().text('◀ Back', 'admin:forcejoin')
      });
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
    const count = await forceJoinRepo.countChannels(ctx.dbPool);
    await ctx.reply(
      `✅ Channel ${display} (<b>${escapeHtml(chat.title)}</b>) added!\n\n` +
      `📢 Total force join channels: <b>${count}</b>`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('◀ Back', 'admin:forcejoin') }
    );
  } catch (err) {
    logger.warn(`Cannot access channel ${chatIdentifier}: ${err.message}`);
    await ctx.reply('⚠️ Could not access that channel. Ensure the channel exists and the bot is a member.');
  }
});

// ── Cancel add channel ──────────────────────────────────────────
composer.callbackQuery('forcejoin:cancel_add', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  addStates.delete(ctx.chat.id);
  await showForceJoinPanel(ctx);
});

export default composer;
