import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as broadcastRepo from '../database/repositories/broadcastRepo.js';
import * as userRepo from '../database/repositories/userRepo.js';
import { ActionType } from '../utils/constants.js';
import { formatNumber, truncateText, formatTimestamp } from '../utils/formatters.js';
import { buildBackButton } from '../utils/keyboard.js';
import logger from '../utils/logger.js';

const composer = new Composer();
const drafts = new Map(); // chatId → { step, text, mediaType, mediaFileId, buttons }

// ── Broadcast menu ──────────────────────────────────────────────
composer.callbackQuery('admin:broadcast', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const kb = new InlineKeyboard()
    .text('📝 New Broadcast', 'bcast:new').row()
    .text('📋 History', 'bcast:history:1').row()
    .text('‹ Back', 'admin:back');
  await ctx.editMessageText('📢 <b>Broadcast Manager</b>\n\nChoose an option:', { parse_mode: 'HTML', reply_markup: kb });
});

// ── New broadcast entry ─────────────────────────────────────────
composer.callbackQuery('bcast:new', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  drafts.set(ctx.chat.id, { step: 'text', text: '', mediaType: null, mediaFileId: null, buttons: [] });
  await ctx.editMessageText(
    '📢 <b>New Broadcast</b>\n\nSend me the <b>message text</b> for the broadcast.',
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'bcast:cancel') }
  );
});

// ── Skip media ──────────────────────────────────────────────────
composer.callbackQuery('bcast:skip_media', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const draft = drafts.get(ctx.chat.id);
  if (!draft) return;
  draft.step = 'buttons';
  const kb = new InlineKeyboard().text('⏭️ Skip Buttons', 'bcast:skip_buttons');
  await ctx.editMessageText(
    '🔘 Send <b>inline buttons</b> (one per line):\n<code>Button Text | https://url</code>\n\nOr press <b>Skip</b>.',
    { parse_mode: 'HTML', reply_markup: kb }
  );
});

// ── Skip buttons ────────────────────────────────────────────────
composer.callbackQuery('bcast:skip_buttons', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const draft = drafts.get(ctx.chat.id);
  if (!draft) return;
  draft.buttons = [];
  draft.step = 'confirm';
  await showPreview(ctx, draft);
});

// ── Confirm send ────────────────────────────────────────────────
composer.callbackQuery('bcast:confirm_send', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery('Sending broadcast…'); } catch {}
  const draft = drafts.get(ctx.chat.id);
  if (!draft) return;
  drafts.delete(ctx.chat.id);
  const pool = ctx.dbPool;

  // Create broadcast record
  const bcast = await broadcastRepo.createBroadcast(pool, {
    messageText: draft.text,
    buttons: draft.buttons,
    mediaType: draft.mediaType,
    mediaFileId: draft.mediaFileId,
    createdBy: ctx.from.id,
  });
  const broadcastId = bcast.id;

  await ctx.editMessageText(`📢 Broadcast <b>#${broadcastId}</b> — sending…`, { parse_mode: 'HTML' });

  // Get recipients
  const userIds = await userRepo.getAllActiveUserIds(pool);
  let sent = 0, failed = 0;
  const total = userIds.length;

  // Build inline buttons if any
  let replyMarkup;
  if (draft.buttons.length > 0) {
    const kb = new InlineKeyboard();
    for (const btn of draft.buttons) {
      kb.url(btn.text, btn.url).row();
    }
    replyMarkup = kb;
  }

  for (const uid of userIds) {
    try {
      if (draft.mediaType === 'photo' && draft.mediaFileId) {
        await ctx.api.sendPhoto(uid, draft.mediaFileId, { caption: draft.text, parse_mode: 'HTML', reply_markup: replyMarkup });
      } else if (draft.mediaType === 'video' && draft.mediaFileId) {
        await ctx.api.sendVideo(uid, draft.mediaFileId, { caption: draft.text, parse_mode: 'HTML', reply_markup: replyMarkup });
      } else if (draft.mediaType === 'animation' && draft.mediaFileId) {
        await ctx.api.sendAnimation(uid, draft.mediaFileId, { caption: draft.text, parse_mode: 'HTML', reply_markup: replyMarkup });
      } else {
        await ctx.api.sendMessage(uid, draft.text, { parse_mode: 'HTML', reply_markup: replyMarkup });
      }
      sent++;
      await broadcastRepo.incrementBroadcastSent(pool, broadcastId);
    } catch (err) {
      failed++;
      await broadcastRepo.incrementBroadcastFailed(pool, broadcastId);
      await broadcastRepo.addBroadcastFailure(pool, broadcastId, uid, err.message).catch(() => {});
    }

    if ((sent + failed) % 50 === 0) {
      try {
        await ctx.editMessageText(
          `📢 Broadcast <b>#${broadcastId}</b>\n📤 Sent: ${sent} | ❌ Failed: ${failed} | 📊 Total: ${total}`,
          { parse_mode: 'HTML' }
        );
      } catch { /* rate limit */ }
    }
  }

  await broadcastRepo.updateBroadcastStatus(pool, broadcastId, 'completed', { sentCount: sent, failedCount: failed });

  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.BROADCAST_SENT, { broadcast_id: broadcastId, sent, failed });

  await ctx.editMessageText(
    `✅ <b>Broadcast #${broadcastId} Complete</b>\n\n📤 Sent: ${sent}\n❌ Failed: ${failed}\n📊 Total: ${total}`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('‹ Back', 'admin:broadcast') }
  );
});

// ── Cancel ──────────────────────────────────────────────────────
composer.callbackQuery('bcast:cancel', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  drafts.delete(ctx.chat.id);
  const kb = new InlineKeyboard()
    .text('📝 New Broadcast', 'bcast:new').row()
    .text('📋 History', 'bcast:history:1').row()
    .text('‹ Back', 'admin:back');
  await ctx.editMessageText('📢 <b>Broadcast Manager</b>\n\nChoose an option:', { parse_mode: 'HTML', reply_markup: kb });
});

// ── History ─────────────────────────────────────────────────────
composer.callbackQuery(/^bcast:history:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const page = Number(ctx.callbackQuery.data.split(':')[2]);
  const pool = ctx.dbPool;
  const { items, total } = await broadcastRepo.listBroadcasts(pool, page, 5);

  if (!items.length) {
    await ctx.editMessageText('📋 <b>Broadcast History</b>\n\nNo broadcasts yet.', {
      parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('‹ Back', 'admin:broadcast')
    });
    return;
  }

  let text = '📋 <b>Broadcast History</b>\n\n';
  const kb = new InlineKeyboard();
  for (const b of items) {
    text += `┃ #${b.id} — ${b.status} — 📤 ${b.sent_count} — ${formatTimestamp(b.created_at)}\n`;
    kb.text(`👁 #${b.id}`, `bcast:view:${b.id}`).row();
  }

  const totalPages = Math.max(1, Math.ceil(total / 5));
  const nav = [];
  if (page > 1) nav.push({ text: '◀️ Prev', data: `bcast:history:${page - 1}` });
  nav.push({ text: `📄 ${page}/${totalPages}`, data: 'noop' });
  if (page < totalPages) nav.push({ text: 'Next ▶️', data: `bcast:history:${page + 1}` });
  for (const n of nav) kb.text(n.text, n.data);
  kb.row().text('‹ Back', 'admin:broadcast');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
});

// ── View broadcast ──────────────────────────────────────────────
composer.callbackQuery(/^bcast:view:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const broadcastId = Number(ctx.callbackQuery.data.split(':')[2]);
  const bcast = await broadcastRepo.getBroadcast(ctx.dbPool, broadcastId);
  if (!bcast) { await ctx.editMessageText('⚠️ Broadcast not found.'); return; }

  const text =
    `📢 <b>Broadcast #${bcast.id}</b>\n\n` +
    `📝 <b>Text:</b>\n${truncateText(bcast.message_text, 500)}\n\n` +
    `🖼️ <b>Media:</b> ${bcast.media_type || 'None'}\n` +
    `📤 <b>Sent:</b> ${bcast.sent_count}\n` +
    `❌ <b>Failed:</b> ${bcast.failed_count}\n` +
    `📊 <b>Status:</b> ${bcast.status}\n` +
    `📅 <b>Created:</b> ${formatTimestamp(bcast.created_at)}\n` +
    `👑 <b>By Admin:</b> <code>${bcast.created_by}</code>`;

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('‹ Back', 'bcast:history:1') });
});

// ── Text message handler for draft composition ──────────────────
composer.on('message:text', async (ctx, next) => {
  const draft = drafts.get(ctx.chat.id);
  if (!draft) return next();

  if (ctx.message.text === '/cancel') {
    drafts.delete(ctx.chat.id);
    await ctx.reply('❌ Cancelled.', { reply_markup: new InlineKeyboard().text('‹ Back', 'admin:broadcast') });
    return;
  }

  if (draft.step === 'text') {
    draft.text = ctx.message.text;
    draft.step = 'media';
    const kb = new InlineKeyboard().text('⏭️ Skip Media', 'bcast:skip_media');
    await ctx.reply('📷 Send a <b>photo</b>, <b>video</b>, or <b>GIF</b> to attach.\n\nOr press <b>Skip</b>.', { parse_mode: 'HTML', reply_markup: kb });
    return;
  }

  if (draft.step === 'buttons') {
    const botInfo = await ctx.api.getMe();
    const buttons = [];
    for (const line of ctx.message.text.split('\n')) {
      const parts = line.split('|').map(s => s.trim());
      if (parts.length === 2 && parts[0] && parts[1]) {
        let url = parts[1];
        if (url.startsWith('/start ')) {
          url = `https://t.me/${botInfo.username}?start=${url.slice(7).trim()}`;
        }
        buttons.push({ text: parts[0], url });
      }
    }
    draft.buttons = buttons;
    draft.step = 'confirm';
    await showPreview(ctx, draft);
    return;
  }

  return next();
});

// ── Media handler ───────────────────────────────────────────────
composer.on(['message:photo', 'message:video', 'message:animation'], async (ctx, next) => {
  const draft = drafts.get(ctx.chat.id);
  if (!draft || draft.step !== 'media') return next();

  if (ctx.message.photo) {
    draft.mediaType = 'photo';
    draft.mediaFileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  } else if (ctx.message.video) {
    draft.mediaType = 'video';
    draft.mediaFileId = ctx.message.video.file_id;
  } else if (ctx.message.animation) {
    draft.mediaType = 'animation';
    draft.mediaFileId = ctx.message.animation.file_id;
  }

  draft.step = 'buttons';
  const kb = new InlineKeyboard().text('⏭️ Skip Buttons', 'bcast:skip_buttons');
  await ctx.reply('🔘 Send <b>inline buttons</b> (one per line):\n<code>Button Text | https://url</code>\n\nOr press <b>Skip</b>.', { parse_mode: 'HTML', reply_markup: kb });
});

async function showPreview(ctx, draft) {
  const text =
    `📢 <b>Broadcast Preview</b>\n\n` +
    `📝 <b>Text:</b>\n${truncateText(draft.text, 300)}\n\n` +
    `🖼️ <b>Media:</b> ${draft.mediaType || 'None'}\n` +
    `🔘 <b>Buttons:</b> ${draft.buttons.length}\n`;

  const kb = new InlineKeyboard()
    .text('✅ Send Now', 'bcast:confirm_send')
    .text('❌ Cancel', 'bcast:cancel');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

export default composer;
