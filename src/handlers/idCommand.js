import { Composer } from 'grammy';
import { escapeHtml, formatNumber } from '../utils/formatters.js';

const composer = new Composer();

composer.command('id', async (ctx) => {
  const chat = ctx.chat;
  const user = ctx.from;

  if (chat.type === 'private') {
    const name = escapeHtml([user.first_name, user.last_name].filter(Boolean).join(' '));
    const username = user.username ? '@' + escapeHtml(user.username) : '<i>not set</i>';
    const lang = user.language_code?.toUpperCase() || '—';

    const text =
      `👤 <b>YOUR INFO</b>\n\n` +
      `<blockquote>` +
      `🆔  <b>User ID</b>\n` +
      `    <code>${user.id}</code>\n\n` +
      `📛  <b>Name</b>\n` +
      `    ${name}\n\n` +
      `🏷  <b>Username</b>\n` +
      `    ${username}\n\n` +
      `🌐  <b>Language</b>\n` +
      `    ${lang}` +
      `</blockquote>`;

    await ctx.reply(text, { parse_mode: 'HTML' });

  } else if (chat.type === 'group' || chat.type === 'supergroup') {
    let memberCount = '—';
    try { memberCount = formatNumber(await ctx.api.getChatMemberCount(chat.id)); } catch { /* ignore */ }
    const username = chat.username ? '@' + escapeHtml(chat.username) : '<i>not set</i>';

    const text =
      `👥 <b>GROUP INFO</b>\n\n` +
      `<blockquote>` +
      `🆔  <b>Group ID</b>\n` +
      `    <code>${chat.id}</code>\n\n` +
      `📝  <b>Name</b>\n` +
      `    ${escapeHtml(chat.title || '—')}\n\n` +
      `🏷  <b>Username</b>\n` +
      `    ${username}\n\n` +
      `👥  <b>Members</b>\n` +
      `    ${memberCount}` +
      `</blockquote>`;

    await ctx.reply(text, { parse_mode: 'HTML' });

  } else if (chat.type === 'channel') {
    let memberCount = '—';
    try { memberCount = formatNumber(await ctx.api.getChatMemberCount(chat.id)); } catch { /* ignore */ }
    const username = chat.username ? '@' + escapeHtml(chat.username) : '<i>not set</i>';

    const text =
      `📢 <b>CHANNEL INFO</b>\n\n` +
      `<blockquote>` +
      `🆔  <b>Channel ID</b>\n` +
      `    <code>${chat.id}</code>\n\n` +
      `📝  <b>Name</b>\n` +
      `    ${escapeHtml(chat.title || '—')}\n\n` +
      `🏷  <b>Username</b>\n` +
      `    ${username}\n\n` +
      `👥  <b>Subscribers</b>\n` +
      `    ${memberCount}` +
      `</blockquote>`;

    await ctx.reply(text, { parse_mode: 'HTML' });
  }
});

export default composer;
