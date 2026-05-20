import { Composer } from 'grammy';
import { escapeHtml, formatNumber } from '../utils/formatters.js';

const composer = new Composer();

composer.command('id', async (ctx) => {
  const chat = ctx.chat;
  const user = ctx.from;

  if (chat.type === 'private') {
    const text =
      `╔══════════════════╗\n` +
      `   📋 <b>YOUR INFO</b>\n` +
      `╠══════════════════╣\n` +
      `┃ 🆔 <b>User ID:</b> <code>${user.id}</code>\n` +
      `┃ 👤 <b>Name:</b> ${escapeHtml([user.first_name, user.last_name].filter(Boolean).join(' '))}\n` +
      `┃ 📛 <b>Username:</b> ${user.username ? '@' + escapeHtml(user.username) : 'N/A'}\n` +
      `┃ 🌐 <b>Language:</b> ${user.language_code || 'N/A'}\n` +
      `┃ ⭐ <b>Account:</b> ${user.is_premium ? 'Premium' : 'Standard'}\n` +
      `╚══════════════════╝`;
    await ctx.reply(text, { parse_mode: 'HTML' });
  } else if (chat.type === 'group' || chat.type === 'supergroup') {
    let memberCount = 'N/A';
    try { memberCount = formatNumber(await ctx.api.getChatMemberCount(chat.id)); } catch { /* ignore */ }
    const text =
      `╔══════════════════╗\n` +
      `   📋 <b>GROUP INFO</b>\n` +
      `╠══════════════════╣\n` +
      `┃ 🆔 <b>Group ID:</b> <code>${chat.id}</code>\n` +
      `┃ 📝 <b>Name:</b> ${escapeHtml(chat.title || 'N/A')}\n` +
      `┃ 📛 <b>Username:</b> ${chat.username ? '@' + escapeHtml(chat.username) : 'N/A'}\n` +
      `┃ 👥 <b>Members:</b> ${memberCount}\n` +
      `╚══════════════════╝`;
    await ctx.reply(text, { parse_mode: 'HTML' });
  } else if (chat.type === 'channel') {
    const text =
      `╔══════════════════╗\n` +
      `   📋 <b>CHANNEL INFO</b>\n` +
      `╠══════════════════╣\n` +
      `┃ 🆔 <b>Channel ID:</b> <code>${chat.id}</code>\n` +
      `┃ 📝 <b>Name:</b> ${escapeHtml(chat.title || 'N/A')}\n` +
      `┃ 📛 <b>Username:</b> ${chat.username ? '@' + escapeHtml(chat.username) : 'N/A'}\n` +
      `╚══════════════════╝`;
    await ctx.reply(text, { parse_mode: 'HTML' });
  }
});

export default composer;
