import { Composer, InlineKeyboard } from 'grammy';
import { adminRequired } from '../middleware/auth.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import { ActionType } from '../utils/constants.js';
import { escapeHtml, truncateText } from '../utils/formatters.js';
import logger from '../utils/logger.js';
import { registerAdminState } from '../utils/adminStates.js';

const composer = new Composer();
const states = new Map(); // chatId → { step, data }
registerAdminState(states);

const COLOR_OPTIONS = [
  { style: 'success', label: '🟢 Green' },
  { style: 'primary', label: '🔵 Blue' },
  { style: 'danger',  label: '🔴 Red' },
  { style: '',        label: '⬜ Default' },
];

// ── T&C panel ───────────────────────────────────────────────────
async function showTcPanel(ctx) {
  const pool = ctx.dbPool;
  const enabled = await settingsRepo.getSetting(pool, 'tc_enabled');
  const buttons = await settingsRepo.getSetting(pool, 'tc_buttons') || [];
  const message = await settingsRepo.getSetting(pool, 'tc_message');
  const rawAccept = await settingsRepo.getSetting(pool, 'tc_accept_color');
  const rawDecline = await settingsRepo.getSetting(pool, 'tc_decline_color');
  const acceptColor = rawAccept !== null && rawAccept !== undefined ? rawAccept : 'success';
  const declineColor = rawDecline !== null && rawDecline !== undefined ? rawDecline : 'danger';
  const acceptInfo = COLOR_OPTIONS.find(c => c.style === acceptColor) || COLOR_OPTIONS[0];
  const declineInfo = COLOR_OPTIONS.find(c => c.style === declineColor) || COLOR_OPTIONS[2];

  const statusEmoji = enabled ? '🟢' : '🔴';
  const toggleLabel = enabled ? '🔴 Disable' : '🟢 Enable';

  const tcAuthor = await settingsRepo.getSetting(pool, 'tc_telegraph_author') || '';

  let text = `📜 <b>TERMS & CONDITIONS</b>\n\n`;
  text += `<blockquote>`;
  text += `${statusEmoji} <b>Status:</b> ${enabled ? 'Active' : 'Inactive'}\n`;
  text += `🔗 <b>Buttons:</b> ${buttons.length} configured\n`;
  text += `💬 <b>Message:</b> ${message ? '✅ Set' : '✅ Default'}\n`;
  text += `✅ <b>Accept Btn:</b> ${acceptInfo.label}\n`;
  text += `❌ <b>Decline Btn:</b> ${declineInfo.label}`;
  if (tcAuthor) text += `\n📝 <b>Telegraph Name:</b> ${escapeHtml(tcAuthor)}`;
  text += `</blockquote>`;

  if (buttons.length > 0) {
    text += `\n\n<blockquote>📋 <b>BUTTONS</b>\n\n`;
    buttons.forEach((btn, i) => {
      text += `${i + 1}. ${escapeHtml(btn.text)} → ${truncateText(btn.url, 35)}\n`;
    });
    text += `</blockquote>`;
  }

  const kb = new InlineKeyboard()
    .text(toggleLabel, 'tc:toggle').row()
    .text('➕ Add Button', 'tc:add_btn').text('💬 Set Message', 'tc:set_msg').row()
    .text(`✅ Accept Color`, 'tc:accept_color').text(`❌ Decline Color`, 'tc:decline_color').row();
  if (buttons.length > 0) {
    kb.text('✏️ Edit Button', 'tc:edit_list').text('🗑 Remove Button', 'tc:remove_list').row();
    kb.text('👁 Preview', 'tc:preview').row();
  }
  kb.text('🌐 Generate Default T&C', 'tc:gen_default').row();
  kb.text('📝 Set Telegraph Name', 'tc:set_author').row();
  kb.text('◀ Back', 'admin:back');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
}

composer.callbackQuery('admin:tc', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await showTcPanel(ctx);
});

// ── Toggle ──────────────────────────────────────────────────────
composer.callbackQuery('tc:toggle', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const current = await settingsRepo.getSetting(pool, 'tc_enabled');
  const newState = !current;
  await settingsRepo.setSetting(pool, 'tc_enabled', newState, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'toggle_tc', new_state: newState });
  await showTcPanel(ctx);
});

// ── Add Button ──────────────────────────────────────────────────
composer.callbackQuery('tc:add_btn', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.set(ctx.chat.id, { step: 'add_btn' });
  await ctx.editMessageText(
    '➕ <b>Add T&C Button</b>\n\n' +
    'Send the button in format:\n' +
    '<code>Button Name | https://url</code>\n\n' +
    '<i>Examples:</i>\n' +
    '<code>📖 English Version | https://telegra.ph/Terms-EN</code>\n' +
    '<code>📖 हिंदी Version | https://telegra.ph/Terms-HI</code>',
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'tc:cancel') }
  );
});

// ── Remove Button List ──────────────────────────────────────────
composer.callbackQuery('tc:remove_list', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const buttons = await settingsRepo.getSetting(ctx.dbPool, 'tc_buttons') || [];

  if (buttons.length === 0) {
    await ctx.editMessageText('⚠️ No buttons to remove.', {
      reply_markup: new InlineKeyboard().text('◀ Back', 'admin:tc')
    });
    return;
  }

  let text = '🗑 <b>Remove T&C Button</b>\n\nSelect a button to remove:\n\n';
  const kb = new InlineKeyboard();
  buttons.forEach((btn, i) => {
    text += `${i + 1}. ${escapeHtml(btn.text)} → ${truncateText(btn.url, 35)}\n`;
    kb.text(`🗑 #${i + 1} — ${truncateText(btn.text, 20)}`, `tc:remove:${i}`).row();
  });
  kb.text('◀ Back', 'admin:tc');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
});

// ── Remove Button Confirm ───────────────────────────────────────
composer.callbackQuery(/^tc:remove:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const idx = Number(ctx.callbackQuery.data.split(':')[2]);
  const pool = ctx.dbPool;
  const buttons = await settingsRepo.getSetting(pool, 'tc_buttons') || [];

  if (idx < 0 || idx >= buttons.length) {
    await ctx.editMessageText('⚠️ Button not found.', {
      reply_markup: new InlineKeyboard().text('◀ Back', 'admin:tc')
    });
    return;
  }

  const removed = buttons.splice(idx, 1)[0];
  await settingsRepo.setSetting(pool, 'tc_buttons', buttons, ctx.from.id);
  ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'remove_tc_button' });

  await ctx.editMessageText(`✅ Button "${escapeHtml(removed.text)}" removed.`, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('◀ Back', 'admin:tc')
  });
});

// ── Edit Button List ────────────────────────────────────────────
composer.callbackQuery('tc:edit_list', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const buttons = await settingsRepo.getSetting(ctx.dbPool, 'tc_buttons') || [];

  if (buttons.length === 0) {
    await ctx.editMessageText('⚠️ No buttons to edit.', {
      reply_markup: new InlineKeyboard().text('◀ Back', 'admin:tc')
    });
    return;
  }

  let text = '✏️ <b>Edit T&C Button</b>\n\nSelect a button to edit:\n\n';
  const kb = new InlineKeyboard();
  buttons.forEach((btn, i) => {
    text += `${i + 1}. ${escapeHtml(btn.text)} → ${truncateText(btn.url, 35)}\n`;
    kb.text(`✏️ #${i + 1} — ${truncateText(btn.text, 20)}`, `tc:edit:${i}`).row();
  });
  kb.text('◀ Back', 'admin:tc');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
});

// ── Edit Button Select ──────────────────────────────────────────
composer.callbackQuery(/^tc:edit:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const idx = Number(ctx.callbackQuery.data.split(':')[2]);
  const buttons = await settingsRepo.getSetting(ctx.dbPool, 'tc_buttons') || [];

  if (idx < 0 || idx >= buttons.length) {
    await ctx.editMessageText('⚠️ Button not found.', {
      reply_markup: new InlineKeyboard().text('◀ Back', 'admin:tc')
    });
    return;
  }

  const btn = buttons[idx];
  states.set(ctx.chat.id, { step: 'edit_btn', data: { index: idx } });
  await ctx.editMessageText(
    `✏️ <b>Edit Button #${idx + 1}</b>\n\n` +
    `Current:\n<code>${escapeHtml(btn.text)} | ${escapeHtml(btn.url)}</code>\n\n` +
    `Send the new button in format:\n<code>Button Name | https://url</code>`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'tc:cancel') }
  );
});

// ── Set Message ─────────────────────────────────────────────────
composer.callbackQuery('tc:set_msg', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.set(ctx.chat.id, { step: 'set_msg' });
  await ctx.editMessageText(
    '💬 <b>Set T&C Message</b>\n\n' +
    'Send the message text that users will see before the Accept/Decline buttons.\n' +
    'You can use HTML formatting.',
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'tc:cancel') }
  );
});

// ── Preview ─────────────────────────────────────────────────────
composer.callbackQuery('tc:preview', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const pool = ctx.dbPool;
  const buttons = await settingsRepo.getSetting(pool, 'tc_buttons') || [];
  const message = await settingsRepo.getSetting(pool, 'tc_message') ||
    "Dear Users,\nThere Are Some Terms & Conditions Given Please Read Carefully, Else If You Face Any Problem Related To Terms And Conditions So We Can't Help You...";
  const rawA = await settingsRepo.getSetting(pool, 'tc_accept_color');
  const rawD = await settingsRepo.getSetting(pool, 'tc_decline_color');
  const acceptColor = rawA !== null && rawA !== undefined ? rawA : 'success';
  const declineColor = rawD !== null && rawD !== undefined ? rawD : 'danger';

  const kb = new InlineKeyboard();
  for (const btn of buttons) {
    kb.url(btn.text, btn.url);
    if (btn.color) kb.style(btn.color);
    kb.row();
  }
  kb.text('✅ Accept', 'tc:preview_noop');
  if (acceptColor) kb.style(acceptColor);
  kb.text('❌ Decline', 'tc:preview_noop');
  if (declineColor) kb.style(declineColor);

  const previewMsg = await ctx.reply(message, { parse_mode: 'HTML', reply_markup: kb });

  // Send a control message so admin can delete the preview and go back
  const controlKb = new InlineKeyboard()
    .text('🗑 Delete Preview', `tc:del_preview:${previewMsg.message_id}`).row()
    .text('◀ Back', 'admin:tc');
  await ctx.reply('👆 <b>Preview shown above.</b>\nUse the buttons below to continue.', {
    parse_mode: 'HTML',
    reply_markup: controlKb
  });
});

// Delete preview message
composer.callbackQuery(/^tc:del_preview:\d+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const previewMsgId = Number(ctx.callbackQuery.data.split(':')[2]);
  try {
    await ctx.api.deleteMessage(ctx.chat.id, previewMsgId);
  } catch (err) {
    logger.warn('Could not delete preview message:', err.message);
  }
  // Also delete the control message itself
  try {
    await ctx.deleteMessage();
  } catch {}
  // Show the T&C panel again as a new message
  const pool = ctx.dbPool;
  const enabled = await settingsRepo.getSetting(pool, 'tc_enabled');
  const btns = await settingsRepo.getSetting(pool, 'tc_buttons') || [];
  const msg = await settingsRepo.getSetting(pool, 'tc_message');
  const rawAccept = await settingsRepo.getSetting(pool, 'tc_accept_color');
  const rawDecline = await settingsRepo.getSetting(pool, 'tc_decline_color');
  const acColor = rawAccept !== null && rawAccept !== undefined ? rawAccept : 'success';
  const dcColor = rawDecline !== null && rawDecline !== undefined ? rawDecline : 'danger';
  const acceptInfo = COLOR_OPTIONS.find(c => c.style === acColor) || COLOR_OPTIONS[0];
  const declineInfo = COLOR_OPTIONS.find(c => c.style === dcColor) || COLOR_OPTIONS[2];

  const statusEmoji = enabled ? '🟢' : '🔴';
  const toggleLabel = enabled ? '🔴 Disable' : '🟢 Enable';
  const tcAuthor = await settingsRepo.getSetting(pool, 'tc_telegraph_author') || '';

  let text = `📜 <b>TERMS & CONDITIONS</b>\n\n`;
  text += `<blockquote>`;
  text += `${statusEmoji} <b>Status:</b> ${enabled ? 'Active' : 'Inactive'}\n`;
  text += `🔗 <b>Buttons:</b> ${btns.length} configured\n`;
  text += `💬 <b>Message:</b> ${msg ? '✅ Set' : '✅ Default'}\n`;
  text += `✅ <b>Accept Btn:</b> ${acceptInfo.label}\n`;
  text += `❌ <b>Decline Btn:</b> ${declineInfo.label}`;
  if (tcAuthor) text += `\n📝 <b>Telegraph Name:</b> ${escapeHtml(tcAuthor)}`;
  text += `</blockquote>`;

  if (btns.length > 0) {
    text += `\n\n<blockquote>📋 <b>BUTTONS</b>\n\n`;
    btns.forEach((btn, i) => {
      text += `${i + 1}. ${escapeHtml(btn.text)} → ${truncateText(btn.url, 35)}\n`;
    });
    text += `</blockquote>`;
  }

  const panelKb = new InlineKeyboard()
    .text(toggleLabel, 'tc:toggle').row()
    .text('➕ Add Button', 'tc:add_btn').text('💬 Set Message', 'tc:set_msg').row()
    .text(`✅ Accept Color`, 'tc:accept_color').text(`❌ Decline Color`, 'tc:decline_color').row();
  if (btns.length > 0) {
    panelKb.text('✏️ Edit Button', 'tc:edit_list').text('🗑 Remove Button', 'tc:remove_list').row();
    panelKb.text('👁 Preview', 'tc:preview').row();
  }
  panelKb.text('🌐 Generate Default T&C', 'tc:gen_default').row();
  panelKb.text('📝 Set Telegraph Name', 'tc:set_author').row();
  panelKb.text('◀ Back', 'admin:back');

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: panelKb });
});

// Preview noop
composer.callbackQuery('tc:preview_noop', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery('This is a preview — buttons are inactive.'); } catch {}
});

// ── Text handler for T&C states ─────────────────────────────────
composer.on('message:text', async (ctx, next) => {
  const state = states.get(ctx.chat.id);
  if (!state) return next();

  if (ctx.message.text === '/cancel') {
    states.delete(ctx.chat.id);
    await ctx.reply('❌ Cancelled.', { reply_markup: new InlineKeyboard().text('◀ Back', 'admin:tc') });
    return;
  }

  const input = ctx.message.text.trim();

  if (state.step === 'add_btn') {
    states.delete(ctx.chat.id);
    const parts = ctx.message.text.split('|').map(s => s.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      await ctx.reply('⚠️ Invalid format. Use: <code>Button Name | https://url</code>', {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('➕ Try Again', 'tc:add_btn').text('◀ Back', 'admin:tc')
      });
      return;
    }

    const [btnText, btnUrl] = parts;

    // Validate URL has proper domain (not just 'https://url')
    let validUrl = false;
    try {
      const u = new URL(btnUrl);
      validUrl = (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.');
    } catch {}

    if (!validUrl) {
      await ctx.reply('⚠️ Invalid URL! Must be a real link like:\n<code>https://telegra.ph/my-article</code>\n<code>https://example.com/terms</code>', {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('➕ Try Again', 'tc:add_btn').text('◀ Back', 'admin:tc')
      });
      return;
    }

    const pool = ctx.dbPool;
    const buttons = await settingsRepo.getSetting(pool, 'tc_buttons') || [];
    buttons.push({ text: btnText, url: btnUrl });
    await settingsRepo.setSetting(pool, 'tc_buttons', buttons, ctx.from.id);
    ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'add_tc_button' });

    await ctx.reply(`✅ Button "${escapeHtml(btnText)}" added!`, {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('➕ Add More', 'tc:add_btn').text('◀ Back', 'admin:tc')
    });
    return;
  }

  if (state.step === 'edit_btn') {
    states.delete(ctx.chat.id);
    const parts = ctx.message.text.split('|').map(s => s.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      await ctx.reply('⚠️ Invalid format. Use: <code>Button Name | https://url</code>', {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('✏️ Try Again', `tc:edit:${state.data.index}`).text('◀ Back', 'admin:tc')
      });
      return;
    }

    const [btnText, btnUrl] = parts;
    let validUrl = false;
    try {
      const u = new URL(btnUrl);
      validUrl = (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.');
    } catch {}

    if (!validUrl) {
      await ctx.reply('⚠️ Invalid URL! Must be a real link like:\n<code>https://telegra.ph/my-article</code>', {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('✏️ Try Again', `tc:edit:${state.data.index}`).text('◀ Back', 'admin:tc')
      });
      return;
    }

    const pool = ctx.dbPool;
    const buttons = await settingsRepo.getSetting(pool, 'tc_buttons') || [];
    const idx = state.data.index;
    if (idx >= 0 && idx < buttons.length) {
      buttons[idx] = { text: btnText, url: btnUrl };
      await settingsRepo.setSetting(pool, 'tc_buttons', buttons, ctx.from.id);
      ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'edit_tc_button' });
      await ctx.reply(`✅ Button #${idx + 1} updated to "${escapeHtml(btnText)}"!`, {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('◀ Back', 'admin:tc')
      });
    } else {
      await ctx.reply('⚠️ Button not found.', {
        reply_markup: new InlineKeyboard().text('◀ Back', 'admin:tc')
      });
    }
    return;
  }

  if (state.step === 'set_msg') {
    states.delete(ctx.chat.id);
    await settingsRepo.setSetting(ctx.dbPool, 'tc_message', ctx.message.text, ctx.from.id);
    ctx.tracker?.trackAdminFireAndForget(ctx.from.id, ctx.from.username, ActionType.SETTINGS_CHANGED, { action: 'set_tc_message' });
    await ctx.reply('✅ T&C message updated!', {
      reply_markup: new InlineKeyboard().text('◀ Back', 'admin:tc')
    });
    return;
  }

  if (state.step === 'set_tc_author') {
    if (!input || input.length > 64) {
      await ctx.reply('⚠️ Name must be 1–64 characters:');
      return;
    }
    await settingsRepo.setSetting(ctx.dbPool, 'tc_telegraph_author', input, ctx.from.id);
    states.delete(ctx.chat.id);
    await ctx.reply(`✅ Telegraph name set to: <b>${escapeHtml(input)}</b>`, {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('◀ Back to T&C', 'admin:tc')
    });
    return;
  }

  return next();
});

// ── Cancel ──────────────────────────────────────────────────────
composer.callbackQuery('tc:cancel', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  states.delete(ctx.chat.id);
  await showTcPanel(ctx);
});

// ── Set Telegraph Author Name ───────────────────────────────────
composer.callbackQuery('tc:set_author', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const current = await settingsRepo.getSetting(ctx.dbPool, 'tc_telegraph_author') || '';
  let text = `📝 <b>Set Telegraph Name</b>\n\n`;
  text += `<blockquote>This is <b>optional</b>. If you set a name here, it will be shown as the author on the Telegraph T&C pages instead of the default.\n\n`;
  text += `Current: <b>${current || '(not set — using default)'}</b></blockquote>\n\n`;
  text += `Type the name you want to show on Telegraph:`;
  states.set(ctx.chat.id, { step: 'set_tc_author' });
  const kb = new InlineKeyboard();
  if (current) kb.text('🗑 Remove Name', 'tc:remove_author').row();
  kb.text('❌ Cancel', 'tc:cancel');
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb }); }
});

composer.callbackQuery('tc:remove_author', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await settingsRepo.setSetting(ctx.dbPool, 'tc_telegraph_author', '', ctx.from.id);
  states.delete(ctx.chat.id);
  await showTcPanel(ctx);
});

// ── Generate Default T&C ────────────────────────────────────────
composer.callbackQuery('tc:gen_default', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  await ctx.editMessageText(
    '🌐 <b>Generate Default T&C</b>\n\n' +
    '<blockquote>This will create a beautiful, detailed Terms & Conditions page on Telegraph automatically.\n\n' +
    'Choose a language version:</blockquote>',
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard()
      .text('🇬🇧 English Version', 'tc:gen_en').row()
      .text('🇮🇳 Hinglish Version', 'tc:gen_hi').row()
      .text('◀ Back', 'admin:tc') }
  );
});

composer.callbackQuery(/^tc:gen_(en|hi)$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery('⏳ Generating...'); } catch {}
  const lang = ctx.callbackQuery.data.split('_')[1];
  const langLabel = lang === 'hi' ? '🇮🇳 Hinglish' : '🇬🇧 English';

  try {
    const { generateDefaultTcPage } = await import('../services/tcTelegraphService.js');
    const url = await generateDefaultTcPage(ctx.dbPool, lang);
    if (!url) throw new Error('Generation failed');

    // Store for auto-add
    states.set(ctx.chat.id, { step: 'gen_done', data: { url, lang, langLabel } });

    await ctx.editMessageText(
      `✅ <b>${langLabel} T&C Generated!</b>\n\n` +
      `<blockquote>📎 <b>URL:</b> ${url}</blockquote>\n\n` +
      `Would you like to add this as a T&C button?`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard()
        .text(`➕ Add as T&C Button`, 'tc:auto_add_btn').row()
        .text('🌐 Generate Other Language', 'tc:gen_default').row()
        .text('◀ Back', 'admin:tc') }
    );
  } catch (err) {
    await ctx.editMessageText(
      `❌ <b>Failed to generate ${langLabel} T&C</b>\n\n<i>${escapeHtml(err.message)}</i>`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔄 Retry', `tc:gen_${lang}`).text('◀ Back', 'admin:tc') }
    );
  }
});

composer.callbackQuery('tc:auto_add_btn', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const state = states.get(ctx.chat.id);
  if (!state?.data?.url) {
    await ctx.editMessageText('⚠️ Session expired.', { reply_markup: new InlineKeyboard().text('◀ Back', 'admin:tc') });
    return;
  }
  const { url, langLabel } = state.data;
  const btnText = langLabel.includes('Hinglish') ? '📖 Terms & Conditions (Hinglish)' : '📖 Terms & Conditions (English)';
  const pool = ctx.dbPool;
  const buttons = await settingsRepo.getSetting(pool, 'tc_buttons') || [];
  buttons.push({ text: btnText, url });
  await settingsRepo.setSetting(pool, 'tc_buttons', buttons, ctx.from.id);
  states.delete(ctx.chat.id);

  await ctx.editMessageText(
    `✅ Button "${escapeHtml(btnText)}" added!\n\n<i>Link: ${url}</i>`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('◀ Back', 'admin:tc') }
  );
});

// ── Accept button color picker ──────────────────────────────────
composer.callbackQuery('tc:accept_color', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const current = await settingsRepo.getSetting(ctx.dbPool, 'tc_accept_color');
  const acceptColor = current !== null && current !== undefined ? current : 'success';
  const kb = new InlineKeyboard();
  for (const c of COLOR_OPTIONS) {
    const active = (c.style || '') === (acceptColor || '') ? ' ✓' : '';
    kb.text(`${c.label}${active}`, `tc:set_accept_color:${c.style || 'none'}`);
    if (c.style) kb.style(c.style);
    kb.row();
  }
  kb.text('◀ Back', 'admin:tc');
  await ctx.editMessageText(
    `✅ <b>Accept Button Color</b>\n\nCurrent: <b>${(COLOR_OPTIONS.find(c => c.style === acceptColor) || COLOR_OPTIONS[0]).label}</b>\n\nSelect a new color:`,
    { parse_mode: 'HTML', reply_markup: kb }
  );
});

composer.callbackQuery(/^tc:set_accept_color:.+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const raw = ctx.callbackQuery.data.split(':')[2];
  const style = raw === 'none' ? '' : raw;
  await settingsRepo.setSetting(ctx.dbPool, 'tc_accept_color', style, ctx.from.id);
  await showTcPanel(ctx);
});

// ── Decline button color picker ─────────────────────────────────
composer.callbackQuery('tc:decline_color', adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const current = await settingsRepo.getSetting(ctx.dbPool, 'tc_decline_color');
  const declineColor = current !== null && current !== undefined ? current : 'danger';
  const kb = new InlineKeyboard();
  for (const c of COLOR_OPTIONS) {
    const active = (c.style || '') === (declineColor || '') ? ' ✓' : '';
    kb.text(`${c.label}${active}`, `tc:set_decline_color:${c.style || 'none'}`);
    if (c.style) kb.style(c.style);
    kb.row();
  }
  kb.text('◀ Back', 'admin:tc');
  await ctx.editMessageText(
    `❌ <b>Decline Button Color</b>\n\nCurrent: <b>${(COLOR_OPTIONS.find(c => c.style === declineColor) || COLOR_OPTIONS[2]).label}</b>\n\nSelect a new color:`,
    { parse_mode: 'HTML', reply_markup: kb }
  );
});

composer.callbackQuery(/^tc:set_decline_color:.+$/, adminRequired, async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const raw = ctx.callbackQuery.data.split(':')[2];
  const style = raw === 'none' ? '' : raw;
  await settingsRepo.setSetting(ctx.dbPool, 'tc_decline_color', style, ctx.from.id);
  await showTcPanel(ctx);
});

export default composer;
