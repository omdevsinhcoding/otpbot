import { InlineKeyboard } from 'grammy';
import logger from '../utils/logger.js';

const NUM_LABELS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

/**
 * Build channel buttons keyboard.
 * Uses custom btn_text if set, otherwise generic numbered labels.
 */
function buildChannelKb(channelList) {
  const kb = new InlineKeyboard();
  for (let i = 0; i < channelList.length; i++) {
    const ch = channelList[i];
    const link = ch.invite_link || (ch.channel_username ? `https://t.me/${ch.channel_username}` : null);
    if (link) {
      const label = ch.btn_text || (channelList.length > 1 ? `📢 Join Channel ${NUM_LABELS[i] || i + 1}` : '📢 Join Channel');
      kb.url(label, link);
      if (ch.btn_style) kb.style(ch.btn_style);
      kb.row();
    }
  }
  kb.text('✅ Joined', 'fjcheck:verify').style('success').row();
  return kb;
}

/**
 * Check which channels the user has NOT joined.
 * Returns array of not-joined channels.
 * If getChatMember fails → treats as NOT joined (fail-closed).
 */
async function getNotJoinedChannels(ctx, channels) {
  const notJoined = [];
  for (const ch of channels) {
    try {
      const member = await ctx.api.getChatMember(ch.channel_id, ctx.from.id);
      if (['left', 'kicked'].includes(member.status)) {
        notJoined.push(ch);
      }
    } catch (err) {
      // Cannot verify → treat as NOT joined (fail-closed)
      logger.debug(`Cannot check channel ${ch.channel_id}: ${err.message} — treating as not joined`);
      notJoined.push(ch);
    }
  }
  return notJoined;
}

/**
 * Force join check on /start.
 * Actually verifies membership before letting user through.
 * Returns true if user can proceed, false if blocked.
 */
export async function checkForceJoin(ctx) {
  if (!ctx.from) return true;
  const pool = ctx.dbPool;

  try {
    const { getSetting } = await import('../database/repositories/settingsRepo.js');
    const enabled = await getSetting(pool, 'force_join_enabled');
    if (!enabled) return true;

    const { isAdmin } = await import('../database/repositories/adminRepo.js');
    if (await isAdmin(pool, ctx.from.id)) return true;

    const { getActiveChannels } = await import('../database/repositories/forceJoinRepo.js');
    const channels = await getActiveChannels(pool);
    if (!channels || channels.length === 0) return true;

    // Actually verify membership
    const notJoined = await getNotJoinedChannels(ctx, channels);
    if (notJoined.length === 0) return true; // All joined → proceed

    // User hasn't joined → show channel buttons
    const kb = buildChannelKb(notJoined);

    const firstName = ctx.from.first_name || 'User';
    const userMention = `<a href="tg://user?id=${ctx.from.id}">${firstName.replace(/[<>&]/g, '')}</a>`;

    const getSetting2 = getSetting;
    const customMsg = await getSetting2(pool, 'fj_message');
    let text;
    if (customMsg) {
      text = customMsg
        .replace(/\{user\}/gi, userMention)
        .replace(/\{first_name\}/gi, firstName.replace(/[<>&]/g, ''))
        .replace(/\{channel_count\}/gi, String(notJoined.length));
    } else {
      text = `👋 Hey! ${userMention}, Please Join Our Channel${notJoined.length > 1 ? 's' : ''} To Access The Bot\n\n`;
      text += `<blockquote>`;
      text += `You must join <b>${notJoined.length}</b> channel${notJoined.length > 1 ? 's' : ''} to continue.`;
      text += `</blockquote>`;
    }

    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
    return false;
  } catch (err) {
    logger.error(`Force join check error: ${err.message}`);
    return true; // Fail open on unexpected errors
  }
}

/**
 * Verify force join when user clicks "✅ Joined".
 * Returns true if all joined, false if some not joined.
 */
export async function verifyForceJoin(ctx) {
  if (!ctx.from) return true;
  const pool = ctx.dbPool;

  try {
    const { getSetting } = await import('../database/repositories/settingsRepo.js');
    const enabled = await getSetting(pool, 'force_join_enabled');
    if (!enabled) return true;

    const { isAdmin } = await import('../database/repositories/adminRepo.js');
    if (await isAdmin(pool, ctx.from.id)) return true;

    const { getActiveChannels } = await import('../database/repositories/forceJoinRepo.js');
    const channels = await getActiveChannels(pool);
    if (!channels || channels.length === 0) return true;

    // Check membership — fail-closed
    const notJoined = await getNotJoinedChannels(ctx, channels);
    if (notJoined.length === 0) return true;

    // Still not joined — show which ones are missing
    const kb = buildChannelKb(notJoined);

    const totalRequired = channels.length;
    const joinedCount = totalRequired - notJoined.length;

    const firstName = ctx.from.first_name || 'User';
    const userMention = `<a href="tg://user?id=${ctx.from.id}">${firstName.replace(/[<>&]/g, '')}</a>`;

    let text = `⚠️ ${userMention}, You haven't joined all channels yet!\n\n`;
    text += `<blockquote>`;
    text += `Still need to join <b>${notJoined.length}</b> channel${notJoined.length > 1 ? 's' : ''}.\n\n`;
    text += `Progress: ${joinedCount}/${totalRequired} joined`;
    text += `</blockquote>`;

    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    } catch (editErr) {
      // Message unchanged — show popup alert instead
      try {
        await ctx.answerCallbackQuery({ text: `⚠️ You still need to join ${notJoined.length} channel${notJoined.length > 1 ? 's' : ''}!`, show_alert: true });
      } catch {}
    }
    return false;
  } catch (err) {
    logger.error(`Force join verify error: ${err.message}`);
    return false; // Fail-closed — don't let unverified users through
  }
}
