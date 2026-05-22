import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as forceJoinRepo from '../database/repositories/forceJoinRepo.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import { ActionType } from '../utils/constants.js';
import { escapeHtml } from '../utils/formatters.js';
import logger from '../utils/logger.js';
import { registerAdminState } from '../utils/adminStates.js';

const composer = new Composer();
const addStates = new Map(); // chatId → 'waiting_channel'
registerAdminState(addStates);

const COLOR_OPTIONS = [
  { style: 'success', label: '🟢 Green', emoji: '🟢' },
  { style: 'primary', label: '🔵 Blue',  emoji: '🔵' },
  { style: 'danger',  label: '🔴 Red',   emoji: '🔴' },
  { style: '',        label: '⬜ Default', emoji: '⬜' },
];

// ── Force join panel (shows channel count + list inline) ────────
async function showForceJoinPanel(ctx) {
  const pool = ctx.dbPool;
  const enabled = await settingsRepo.getSetting(pool, 'force_join_enabled');
  const channels = await forceJoinRepo.getActiveChannels(pool);
  const count = channels.length;
  const customMsg = await settingsRepo.getSetting(pool, 'fj_message');

  const statusEmoji = enabled ? '🟢' : '🔴';
  const toggleLabel = enabled ? '🔴 Disable' : '🟢 Enable';

  let text = `🔗 <b>FORCE JOIN</b>\n\n`;
  text += `<blockquote>`;
  text += `${statusEmoji} <b>Status:</b> ${enabled ? 'Active' : 'Inactive'}\n`;
  text += `📢 <b>Channels:</b> ${count} configured\n`;
  text += `💬 <b>Message:</b> ${customMsg ? '✅ Custom' : '✅ Default'}`;
  text += `</blockquote>\n\n`;

  if (count > 0) {
    text += `<blockquote>`;
    text += `📋 <b>CHANNELS</b>\n\n`;
    for (let i = 0; i < channels.length; i++) {
      const ch = channels[i];
      const display = ch.channel_username ? `@${escapeHtml(ch.channel_username)}` : String(ch.channel_id);
      const chColor = COLOR_OPTIONS.find(c => c.style === (ch.btn_style || '')) || COLOR_OPTIONS[3];
      text += `${i + 1}. ${chColor.emoji} ${display} — ${escapeHtml(ch.channel_title || 'N/A')}\n`;
    }
    text += `</blockquote>`;
  } else {
    text += `<blockquote>⚠️ No channels added yet\n\nAdd channels that users must join before using the bot.</blockquote>`;
  }

  const kb = new InlineKeyboard()
    .text(toggleLabel, 'forcejoin:toggle').row()
    .text('➕ Add Channel', 'forcejoin:add').text('💬 Set Message', 'forcejoin:set_msg').row();

  // Channel remove buttons
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

// ── Receive text input (channel or message) ─────────────────────
composer.on('message:text', async (ctx, next) => {
  const state = addStates.get(ctx.chat.id);
  if (!state) return next();

  if (ctx.message.text === '/cancel') {
    addStates.delete(ctx.chat.id);
    await ctx.reply('❌ Cancelled.', { reply_markup: new InlineKeyboard().text('◀ Back', 'admin:forcejoin') });
    return;
  }

  // ── Handle message input ────────────────────────────────────
  if (state === 'waiting_msg') {
    addStates.delete(ctx.chat.id);
    await settingsRepo.setSetting(ctx.dbPool, 'fj_message', ctx.message.text, ctx.from.id);
    ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'set_fj_message' });
    await ctx.reply('✅ Force join message updated!', {
      reply_markup: new InlineKeyboard().text('◀ Back', 'admin:forcejoin')
    });
    return;
  }

  // ── Handle channel input ────────────────────────────────────
  if (state !== 'waiting_channel') return next();

  const raw = ctx.message.text.trim();

  // Support multiple channels: split by comma, space, or newline
  const inputs = raw.split(/[\s,]+/).filter(Boolean);

  if (inputs.length === 0) {
    // Keep state — let user retry
    await ctx.reply('⚠️ Send a channel ID or @username.\nExample: <code>-1001234567890</code> or <code>@mychannel</code>', {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('◀ Back', 'admin:forcejoin')
    });
    return;
  }

  // Process each channel
  let added = 0;
  let failed = 0;
  const results = [];

  for (const input of inputs) {
    const chatIdentifier = input.startsWith('@') ? input : (input.match(/^-?\d+$/) ? Number(input) : null);

    if (chatIdentifier === null) {
      results.push(`❌ <code>${escapeHtml(input)}</code> — invalid format`);
      failed++;
      continue;
    }

    try {
      const chat = await ctx.api.getChat(chatIdentifier);
      const botMember = await ctx.api.getChatMember(chat.id, ctx.me.id);
      if (!['administrator', 'creator'].includes(botMember.status)) {
        results.push(`❌ ${escapeHtml(chat.title || input)} — bot is not admin`);
        failed++;
        continue;
      }

      // Check if channel already exists
      const existing = await forceJoinRepo.getChannel(ctx.dbPool, chat.id);
      if (existing && existing.is_active) {
        results.push(`⚠️ ${escapeHtml(chat.title || input)} — already added`);
        continue;
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
      results.push(`✅ ${display} — <b>${escapeHtml(chat.title)}</b>`);
      added++;
    } catch (err) {
      logger.warn(`Cannot access channel ${input}: ${err.message}`);
      results.push(`❌ <code>${escapeHtml(input)}</code> — not accessible`);
      failed++;
    }
  }

  // Clear state after processing
  addStates.delete(ctx.chat.id);

  const count = await forceJoinRepo.countChannels(ctx.dbPool);

  // If exactly 1 channel added → show color picker immediately
  if (added === 1 && failed === 0 && results.length === 1) {
    // Find the just-added channel
    const channels = await forceJoinRepo.getActiveChannels(ctx.dbPool);
    const lastCh = channels[channels.length - 1];
    if (lastCh) {
      const display = lastCh.channel_username ? `@${lastCh.channel_username}` : String(lastCh.channel_id);
      const colorKb = new InlineKeyboard();
      for (const c of COLOR_OPTIONS) {
        colorKb.text(c.label, `forcejoin:set_ch_color:${lastCh.channel_id}:${c.style || 'none'}`);
        if (c.style) colorKb.style(c.style);
        colorKb.row();
      }
      colorKb.text('⏭ Skip', 'admin:forcejoin');

      await ctx.reply(
        `✅ Channel <b>${escapeHtml(lastCh.channel_title || display)}</b> added!\n\n` +
        `🎨 <b>Pick a button color for this channel:</b>`,
        { parse_mode: 'HTML', reply_markup: colorKb }
      );
      return;
    }
  }

  // Multiple channels or some failed — show summary
  let reply = '';
  if (added > 0) reply += `✅ <b>${added}</b> channel${added > 1 ? 's' : ''} added\n`;
  if (failed > 0) reply += `❌ <b>${failed}</b> failed\n`;
  reply += `\n${results.join('\n')}\n\n📢 Total channels: <b>${count}</b>`;

  await ctx.reply(reply, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('➕ Add More', 'forcejoin:add').text('◀ Back', 'admin:forcejoin')
  });
});

// ── Cancel add channel ──────────────────────────────────────────
composer.callbackQuery('forcejoin:cancel_add', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  addStates.delete(ctx.chat.id);
  await showForceJoinPanel(ctx);
});

// ── Per-channel color picker ────────────────────────────────────
composer.callbackQuery(/^forcejoin:ch_color:-?\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const channelId = ctx.callbackQuery.data.split(':').slice(2).join(':');
  const ch = await forceJoinRepo.getChannel(ctx.dbPool, Number(channelId));
  if (!ch) {
    await ctx.editMessageText('⚠️ Channel not found.', {
      reply_markup: new InlineKeyboard().text('◀ Back', 'admin:forcejoin')
    });
    return;
  }

  const current = ch.btn_style || '';
  const display = ch.channel_username ? `@${ch.channel_username}` : String(ch.channel_id);

  const kb = new InlineKeyboard();
  for (const c of COLOR_OPTIONS) {
    const active = (c.style || '') === current ? ' ✓' : '';
    kb.text(`${c.label}${active}`, `forcejoin:set_ch_color:${ch.channel_id}:${c.style || 'none'}`);
    if (c.style) kb.style(c.style);
    kb.row();
  }
  kb.text('◀ Back', 'admin:forcejoin');

  await ctx.editMessageText(
    `🎨 <b>Channel Button Color</b>\n\n` +
    `Channel: <b>${escapeHtml(display)}</b>\n` +
    `Title: <b>${escapeHtml(ch.channel_title || 'N/A')}</b>\n` +
    `Current: <b>${(COLOR_OPTIONS.find(c => c.style === current) || COLOR_OPTIONS[3]).label}</b>\n\n` +
    `Select a color for this channel's button:`,
    { parse_mode: 'HTML', reply_markup: kb }
  );
});

// ── Set per-channel color ───────────────────────────────────────
composer.callbackQuery(/^forcejoin:set_ch_color:-?\d+:.+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const parts = ctx.callbackQuery.data.split(':');
  // forcejoin:set_ch_color:<channelId>:<style>
  const channelId = Number(parts[2]);
  const style = parts[3] === 'none' ? '' : parts[3];
  await forceJoinRepo.updateChannelStyle(ctx.dbPool, channelId, style);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'fj_channel_style', channel_id: channelId, value: style || 'default' });
  await showForceJoinPanel(ctx);
});

// ── Set Message ─────────────────────────────────────────────────
composer.callbackQuery('forcejoin:set_msg', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  addStates.set(ctx.chat.id, 'waiting_msg');
  const pool = ctx.dbPool;
  const current = await settingsRepo.getSetting(pool, 'fj_message');

  let text = `💬 <b>Set Force Join Message</b>\n\n`;
  text += `Send the message text shown to users.\nYou can use HTML formatting.\n\n`;
  text += `<b>Available Placeholders:</b>\n`;
  text += `<blockquote>{user} — Clickable mention link\n{first_name} — First name\n{channel_count} — Number of channels</blockquote>\n\n`;
  if (current) {
    text += `<i>Current message is set. Send new text or press Reset.</i>`;
  }

  const kb = new InlineKeyboard().text('❌ Cancel', 'forcejoin:cancel_add');
  if (current) kb.text('🔄 Reset Default', 'forcejoin:reset_msg');
  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
});

// ── Reset message to default ────────────────────────────────────
composer.callbackQuery('forcejoin:reset_msg', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await settingsRepo.deleteSetting(ctx.dbPool, 'fj_message');
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'reset_fj_message' });
  await showForceJoinPanel(ctx);
});

export default composer;
