import { Composer } from 'grammy';
import { escapeHtml } from '../utils/formatters.js';

const composer = new Composer();

composer.command('id', async (ctx) => {
  const chat = ctx.chat;
  const user = ctx.from;

  if (chat.type === 'private') {
    const name = escapeHtml([user.first_name, user.last_name].filter(Boolean).join(' '));
    const username = user.username ? `@${escapeHtml(user.username)}` : '<i>not set</i>';

    const text =
      `<blockquote>` +
      `🆔 <b>Your Telegram ID</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `👤 <b>Name:</b> ${name}\n` +
      `👤 <b>Username:</b> ${username}\n` +
      `🔑 <b>ID:</b> <code>${user.id}</code>` +
      `</blockquote>`;

    await ctx.reply(text, { parse_mode: 'HTML' });

  } else if (chat.type === 'group' || chat.type === 'supergroup') {
    let memberCount = '—';
    try { memberCount = String(await ctx.api.getChatMemberCount(chat.id)); } catch {}
    const username = chat.username ? `@${escapeHtml(chat.username)}` : '<i>not set</i>';

    const text =
      `<blockquote>` +
      `🆔 <b>Group Info</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `📝 <b>Name:</b> ${escapeHtml(chat.title || '—')}\n` +
      `👤 <b>Username:</b> ${username}\n` +
      `🔑 <b>ID:</b> <code>${chat.id}</code>\n` +
      `👥 <b>Members:</b> ${memberCount}` +
      `</blockquote>`;

    await ctx.reply(text, { parse_mode: 'HTML' });

  } else if (chat.type === 'channel') {
    let memberCount = '—';
    try { memberCount = String(await ctx.api.getChatMemberCount(chat.id)); } catch {}
    const username = chat.username ? `@${escapeHtml(chat.username)}` : '<i>not set</i>';

    const text =
      `<blockquote>` +
      `🆔 <b>Channel Info</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `📝 <b>Name:</b> ${escapeHtml(chat.title || '—')}\n` +
      `👤 <b>Username:</b> ${username}\n` +
      `🔑 <b>ID:</b> <code>${chat.id}</code>\n` +
      `👥 <b>Subscribers:</b> ${memberCount}` +
      `</blockquote>`;

    await ctx.reply(text, { parse_mode: 'HTML' });
  }
});

export default composer;
