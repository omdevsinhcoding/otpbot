/**
 * 📧 TEMP MAIL handler — Domain picker → Email card → Inbox list → Message detail.
 *
 * Production-ready design:
 * - 3-screen approach: each screen is SHORT and fixed-size
 * - Messages cached in memory to avoid re-fetching on button clicks
 * - Prev/Next navigation between messages
 * - Delete loops back to domain picker (flow continues)
 */
import { Composer, InlineKeyboard } from 'grammy';
import { escRe } from './index.js';
import { BTN_GET_EMAIL } from '../../utils/constants.js';
import { escapeHtml } from '../../utils/formatters.js';
import * as tempMailService from '../../services/tempMailService.js';
import logger from '../../utils/logger.js';

const composer = new Composer();

// ── Entry point: TEMP MAIL button in More section ───────────────
composer.hears(new RegExp(`^${escRe(BTN_GET_EMAIL)}$`), async (ctx) => {
  await handleCreateTempMail(ctx);
});

// ── Step 1: Show domain picker ──────────────────────────────────
async function handleCreateTempMail(ctx) {
  try {
    const domains = await tempMailService.fetchDomains();
    if (!domains.length) {
      await ctx.reply('⚠️ <b>Error</b>\n\nNo domains available. Please try again later.', { parse_mode: 'HTML' });
      return;
    }

    const kb = new InlineKeyboard();
    for (let i = 0; i < domains.length; i += 2) {
      kb.text(`📧 @${domains[i]}`, `tm:dom:${domains[i]}`);
      if (domains[i + 1]) {
        kb.text(`📧 @${domains[i + 1]}`, `tm:dom:${domains[i + 1]}`);
      }
      kb.row();
    }
    kb.text('❌ Cancel', 'tm:cancel');

    await ctx.reply(
      '📧 <b>Temporary Email</b>\n\n' +
      'Select a domain to generate your email address:',
      { parse_mode: 'HTML', reply_markup: kb }
    );
  } catch (err) {
    logger.error('Temp mail domain list error:', err);
    await ctx.reply('⚠️ Something went wrong. Please try again.', { parse_mode: 'HTML' });
  }
}

// ── Step 2: Domain selected → create email card ─────────────────
composer.callbackQuery(/^tm:dom:/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}

  try {
    const result = await tempMailService.createTempEmail(10, 10);
    if (!result.success) {
      try {
        await ctx.editMessageText('⚠️ <b>Error</b>\n\nCould not generate email. Please try again.', { parse_mode: 'HTML' });
      } catch { /* ignore */ }
      return;
    }

    const text = buildEmailCard(result.email);
    const kb = buildEmailCardKb(result.email);

    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    } catch { /* ignore */ }
  } catch (err) {
    logger.error('Temp mail create error:', err);
    try { await ctx.editMessageText('⚠️ Something went wrong.', { parse_mode: 'HTML' }); } catch {}
  }
});

// ── Helpers ──────────────────────────────────────────────────────
function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

function parseFrom(raw) {
  if (!raw) return 'Unknown';
  const decoded = decodeHtmlEntities(raw);
  const match = decoded.match(/^"?([^"<]+)"?\s*<?([^>]+)>?$/);
  if (match) {
    const name = match[1].trim();
    const email = match[2].trim();
    if (name && email && name !== email) return `${name}`;
    return email || name;
  }
  return decoded;
}

function extractOTP(bodyText) {
  if (!bodyText) return null;
  const patterns = [
    /(?:verification|confirm|security|otp|auth)\s*(?:code|pin|number)[\s:]*(\d{4,8})/i,
    /(?:code|pin|otp)[\s:]+(\d{4,8})/i,
    /\b(\d{6})\b/,
  ];
  for (const p of patterns) {
    const m = bodyText.match(p);
    if (m) return m[1];
  }
  return null;
}

// ── Screen 1: Email card (static, short) ────────────────────────
function buildEmailCard(email) {
  return (
    '╔══════════════════════════╗\n' +
    '   📧 <b>Temporary Email</b>\n' +
    '╚══════════════════════════╝\n\n' +
    `✉️ <b>Email:</b>\n<code>${escapeHtml(email)}</code>\n\n` +
    '📭 <i>No messages yet.\nUse this email and tap Check Inbox.</i>'
  );
}

function buildEmailCardKb(email) {
  const token = tempMailService.getToken(email);
  const kb = new InlineKeyboard();
  if (token) {
    kb.url('🌐 Open In Browser', `https://temp-mail.io/en/email/${email}/token/${token}`)
      .row();
  }
  kb.text('📬 Check Inbox', `tm:chk:${email}`)
    .text('🗑 Delete Email', `tm:del:${email}`);
  return kb;
}

// ── Screen 2: Inbox list (compact subject buttons) ──────────────
function buildInboxList(email, messages) {
  let text = '╔══════════════════════════╗\n';
  text += '   📬 <b>Inbox</b>\n';
  text += '╚══════════════════════════╝\n\n';
  text += `✉️ <code>${escapeHtml(email)}</code>\n`;
  text += `📨 <b>${messages.length}</b> message${messages.length > 1 ? 's' : ''}\n\n`;
  text += '<i>Tap a message to read it:</i>';
  return text;
}

function buildInboxListKb(email, messages) {
  const token = tempMailService.getToken(email);
  const kb = new InlineKeyboard();

  // Browser link at top
  if (token) {
    kb.url('🌐 Open In Browser', `https://temp-mail.io/en/email/${email}/token/${token}`).row();
  }

  // Each message = 1 button row
  const show = messages.slice(0, 10);
  for (let i = 0; i < show.length; i++) {
    const msg = show[i];
    const from = parseFrom(msg.from);
    const subject = decodeHtmlEntities(msg.subject || '(No Subject)');
    const label = `#${i + 1} · ${from} · ${subject}`.substring(0, 45);
    kb.text(label, `tm:msg:${email}:${i}`).row();
  }

  if (messages.length > 10) {
    kb.text(`… +${messages.length - 10} more (open browser)`, `tm:noop`).row();
  }

  // Bottom actions
  kb.text('🔄 Refresh', `tm:chk:${email}`)
    .text('🗑 Delete', `tm:del:${email}`);
  return kb;
}

// ── Screen 3: Single message detail ─────────────────────────────
function buildMessageDetail(email, msg, index) {
  const from = parseFrom(msg.from);
  const fromEmail = (() => {
    const decoded = decodeHtmlEntities(msg.from || '');
    const m = decoded.match(/<([^>]+)>/);
    return m ? m[1] : '';
  })();
  const subject = decodeHtmlEntities(msg.subject || '(No Subject)');
  const bodyRaw = decodeHtmlEntities(msg.body_text || '');
  const body = bodyRaw.replace(/\n{3,}/g, '\n\n').split('\n').map(l => l.trim()).join('\n').trim();
  const otp = extractOTP(body);

  let text = '┌─────────────────────────┐\n';
  text += `  📩 <b>Message #${index + 1}</b>\n`;
  text += '├─────────────────────────┤\n';
  text += `  📤 <b>From:</b> ${escapeHtml(from)}\n`;
  if (fromEmail) {
    text += `  📧 <code>${escapeHtml(fromEmail)}</code>\n`;
  }
  text += `  📝 <b>Subject:</b>\n  ${escapeHtml(subject)}\n`;

  if (otp) {
    text += `\n  🔑 <b>Verification Code:</b>\n`;
    text += `  ┌──────────────┐\n`;
    text += `  │  <code> ${otp} </code>  │\n`;
    text += `  └──────────────┘\n`;
  }

  if (body) {
    text += `\n  📄 <b>Content:</b>\n`;
    const lines = body.split('\n').filter(l => l.trim());
    for (const line of lines.slice(0, 10)) {
      const trimmed = line.substring(0, 60);
      text += `  <i>${escapeHtml(trimmed)}${line.length > 60 ? '…' : ''}</i>\n`;
    }
    if (lines.length > 10) {
      text += '  <i>…</i>\n';
    }
  }

  text += '└─────────────────────────┘';
  return text;
}

function buildMessageDetailKb(email, index, totalMessages) {
  const kb = new InlineKeyboard();

  if (index > 0) {
    kb.text('◀️ Prev', `tm:msg:${email}:${index - 1}`);
  }
  kb.text('📋 Back to Inbox', `tm:chk:${email}`);
  if (index < totalMessages - 1) {
    kb.text('Next ▶️', `tm:msg:${email}:${index + 1}`);
  }
  kb.row();
  kb.text('🗑 Delete Email', `tm:del:${email}`);
  return kb;
}

// ═══════════════════════════════════════════════════════════════════
//  CALLBACK HANDLERS
// ═══════════════════════════════════════════════════════════════════

// ── 📬 Check Inbox ──────────────────────────────────────────────
composer.callbackQuery(/^tm:chk:/, async (ctx) => {
  const email = ctx.callbackQuery.data.replace('tm:chk:', '');

  const cooldown = tempMailService.isInboxRateLimited(ctx.from.id);
  if (cooldown) {
    try { await ctx.answerCallbackQuery({ text: `⏳ Please wait ${cooldown} second${cooldown > 1 ? 's' : ''}.` }); } catch {}
    return;
  }

  try {
    const result = await tempMailService.checkInbox(email);

    if (!result.success) {
      try { await ctx.answerCallbackQuery({ text: `⚠️ ${result.error}`, show_alert: true }); } catch {}
      return;
    }

    if (result.messages.length === 0) {
      try { await ctx.answerCallbackQuery({ text: '📭 No messages received yet.' }); } catch {}
      return;
    }

    // Cache messages for single-message view
    tempMailService.cacheMessages(email, result.messages);

    try { await ctx.answerCallbackQuery(); } catch {}

    const text = buildInboxList(email, result.messages);
    const kb = buildInboxListKb(email, result.messages);

    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    } catch (e) {
      if (!e.message?.includes('message is not modified')) logger.error('Inbox list edit error:', e);
    }
  } catch (err) {
    logger.error('Temp mail inbox error:', err);
    try { await ctx.answerCallbackQuery({ text: '⚠️ Something went wrong.', show_alert: true }); } catch {}
  }
});

// ── 📩 View single message ──────────────────────────────────────
composer.callbackQuery(/^tm:msg:/, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}

  const parts = ctx.callbackQuery.data.replace('tm:msg:', '').split(':');
  const email = parts[0];
  const index = parseInt(parts[1], 10);

  const msg = tempMailService.getCachedMessage(email, index);
  if (!msg) {
    // Cache expired — re-fetch inbox
    try {
      const result = await tempMailService.checkInbox(email);
      if (result.success && result.messages.length > 0) {
        tempMailService.cacheMessages(email, result.messages);
        const freshMsg = result.messages[index];
        if (freshMsg) {
          const text = buildMessageDetail(email, freshMsg, index);
          const kb = buildMessageDetailKb(email, index, result.messages.length);
          try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); } catch {}
          return;
        }
      }
    } catch { /* ignore */ }
    try {
      await ctx.editMessageText('⚠️ Message not found. Refreshing inbox...', { parse_mode: 'HTML' });
    } catch {}
    return;
  }

  const cachedMsgs = tempMailService.getCachedMessages(email);
  const total = cachedMsgs ? cachedMsgs.length : index + 1;

  const text = buildMessageDetail(email, msg, index);
  const kb = buildMessageDetailKb(email, index, total);

  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  } catch (e) {
    if (!e.message?.includes('message is not modified')) logger.error('Msg detail edit error:', e);
  }
});

// ── Noop ─────────────────────────────────────────────────────────
composer.callbackQuery('tm:noop', async (ctx) => {
  try { await ctx.answerCallbackQuery({ text: 'Open in browser to see all messages.' }); } catch {}
});

// ── 🗑 Delete Email → edit message back to domain picker ────────
composer.callbackQuery(/^tm:del:/, async (ctx) => {
  const email = ctx.callbackQuery.data.replace('tm:del:', '');

  try { await tempMailService.deleteTempEmail(email); } catch {}
  try { await ctx.answerCallbackQuery({ text: '🗑 Email deleted.' }); } catch {}

  // Show domain picker again in the SAME message
  try {
    const domains = await tempMailService.fetchDomains();
    if (domains.length) {
      const kb = new InlineKeyboard();
      for (let i = 0; i < domains.length; i += 2) {
        kb.text(`📧 @${domains[i]}`, `tm:dom:${domains[i]}`);
        if (domains[i + 1]) {
          kb.text(`📧 @${domains[i + 1]}`, `tm:dom:${domains[i + 1]}`);
        }
        kb.row();
      }
      kb.text('❌ Cancel', 'tm:cancel');

      await ctx.editMessageText(
        '🗑 <i>Previous email deleted.</i>\n\n' +
        '📧 <b>Temporary Email</b>\n\n' +
        'Select a domain to generate a new email:',
        { parse_mode: 'HTML', reply_markup: kb }
      );
      return;
    }
  } catch { /* ignore */ }

  // Fallback if domains fetch fails
  try { await ctx.deleteMessage(); } catch {}
});

// ── ❌ Cancel ────────────────────────────────────────────────────
composer.callbackQuery('tm:cancel', async (ctx) => {
  try { await ctx.deleteMessage(); } catch {}
  try { await ctx.answerCallbackQuery(); } catch {}
});

export default composer;
