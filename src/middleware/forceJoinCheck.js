import { InlineKeyboard } from 'grammy';
import logger from '../utils/logger.js';

/**
 * Show force-join channel buttons on /start.
 * Always shows ALL channel buttons regardless of join status.
 * Returns true if no channels configured or force join disabled, false if blocked.
 */
export async function checkForceJoin(ctx) {
  if (!ctx.from) return true;
  const pool = ctx.dbPool;

  try {
    // Check if force join is enabled
    const { getSetting } = await import('../database/repositories/settingsRepo.js');
    const enabled = await getSetting(pool, 'force_join_enabled');
    if (!enabled) return true;

    // Admins bypass
    const { isAdmin } = await import('../database/repositories/adminRepo.js');
    if (await isAdmin(pool, ctx.from.id)) return true;

    // Get ALL active channels
    const { getActiveChannels } = await import('../database/repositories/forceJoinRepo.js');
    const channels = await getActiveChannels(pool);
    if (!channels || channels.length === 0) return true;

    // Always show ALL channel buttons — no membership check here
    // Verification happens only when user clicks "✅ I Joined All"
    const kb = new InlineKeyboard();
    for (const ch of channels) {
      const link = ch.invite_link || (ch.channel_username ? `https://t.me/${ch.channel_username}` : null);
      if (link) {
        kb.url(`📢 ${ch.channel_title || 'Join Channel'}`, link);
        if (ch.btn_style) kb.style(ch.btn_style);
        kb.row();
      }
    }

    kb.text('✅ Joined', 'fjcheck:verify').style('success').row();

    // Build clickable user mention
    const firstName = ctx.from.first_name || 'User';
    const userMention = `<a href="tg://user?id=${ctx.from.id}">${firstName.replace(/[<>&]/g, '')}</a>`;

    // Read admin-configured message or use default
    const customMsg = await getSetting(pool, 'fj_message');
    let text;
    if (customMsg) {
      text = customMsg
        .replace(/\{user\}/gi, userMention)
        .replace(/\{first_name\}/gi, firstName.replace(/[<>&]/g, ''))
        .replace(/\{channel_count\}/gi, String(channels.length));
    } else {
      text = `👋 Hey! ${userMention}, Please Join Our Channel${channels.length > 1 ? 's' : ''} To Access The Bot\n\n`;
      text += `<blockquote>`;
      text += `You must join <b>${channels.length}</b> channel${channels.length > 1 ? 's' : ''} to continue.`;
      text += `</blockquote>`;
    }

    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
    return false;
  } catch (err) {
    logger.error(`Force join check error: ${err.message}`);
    return true; // Fail open
  }
}

/**
 * Verify force-join: checks if user actually joined ALL channels.
 * Called only when user clicks the "✅ Joined" button.
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

    // Now actually check membership for EACH channel
    const notJoined = [];
    for (const ch of channels) {
      try {
        const member = await ctx.api.getChatMember(ch.channel_id, ctx.from.id);
        if (['left', 'kicked'].includes(member.status)) {
          notJoined.push(ch);
        }
      } catch (err) {
        logger.debug(`Cannot check channel ${ch.channel_id}: ${err.message}`);
      }
    }

    if (notJoined.length === 0) return true;

    // User hasn't joined all — show which ones are missing
    const kb = new InlineKeyboard();
    for (const ch of notJoined) {
      const link = ch.invite_link || (ch.channel_username ? `https://t.me/${ch.channel_username}` : null);
      if (link) {
        kb.url(`📢 ${ch.channel_title || 'Join Channel'}`, link);
        if (ch.btn_style) kb.style(ch.btn_style);
        kb.row();
      }
    }
    kb.text('✅ Joined', 'fjcheck:verify').style('success').row();

    const totalRequired = channels.length;
    const joinedCount = totalRequired - notJoined.length;

    const firstName = ctx.from.first_name || 'User';
    const userMention = `<a href="tg://user?id=${ctx.from.id}">${firstName.replace(/[<>&]/g, '')}</a>`;

    let text = `⚠️ ${userMention}, You haven't joined all channels yet!\n\n`;
    text += `<blockquote>`;
    text += `Still need to join <b>${notJoined.length}</b> channel${notJoined.length > 1 ? 's' : ''}.\n\n`;
    text += `Progress: ${joinedCount}/${totalRequired} joined`;
    text += `</blockquote>`;

    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    return false;
  } catch (err) {
    logger.error(`Force join verify error: ${err.message}`);
    return true;
  }
}
