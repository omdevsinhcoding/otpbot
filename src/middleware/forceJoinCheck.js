import { InlineKeyboard } from 'grammy';
import logger from '../utils/logger.js';

/**
 * Check force-join requirements. Returns true if passed, false if blocked.
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

    // Get channels
    const { getActiveChannels } = await import('../database/repositories/forceJoinRepo.js');
    const channels = await getActiveChannels(pool);
    if (!channels || channels.length === 0) return true;

    const notJoined = [];
    for (const ch of channels) {
      try {
        const member = await ctx.api.getChatMember(ch.channel_id, ctx.from.id);
        if (['left', 'kicked'].includes(member.status)) {
          notJoined.push(ch);
        }
      } catch (err) {
        // If we can't check, skip this channel
        logger.debug(`Cannot check channel ${ch.channel_id}: ${err.message}`);
      }
    }

    if (notJoined.length === 0) return true;

    // Build join buttons
    const kb = new InlineKeyboard();
    for (const ch of notJoined) {
      const link = ch.invite_link || (ch.channel_username ? `https://t.me/${ch.channel_username}` : null);
      if (link) {
        kb.url(`📢 ${ch.channel_title || 'Join Channel'}`, link).row();
      }
    }
    kb.text('✅ I Joined', 'fjcheck:verify').row();

    await ctx.reply(
      '🔗 <b>Join Required</b>\n\nPlease join the following channels to use this bot:',
      { parse_mode: 'HTML', reply_markup: kb }
    );
    return false;
  } catch (err) {
    logger.error(`Force join check error: ${err.message}`);
    return true; // Fail open
  }
}
