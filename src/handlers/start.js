import { Composer } from 'grammy';
import crypto from 'crypto';
import { checkForceJoin } from '../middleware/forceJoinCheck.js';
import * as userRepo from '../database/repositories/userRepo.js';
import * as adminRepo from '../database/repositories/adminRepo.js';
import * as welcomeRepo from '../database/repositories/welcomeRepo.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import { getMainMenu, buildInlineButtons } from '../utils/keyboard.js';
import { ActionType } from '../utils/constants.js';
import logger from '../utils/logger.js';

const composer = new Composer();

composer.command('start', async (ctx) => {
  if (!ctx.from) return;
  const pool = ctx.dbPool;
  const tracker = ctx.tracker;

  // ── Parse deep-link referral ────────────────────────────────────
  let referredBy = null;
  const payload = ctx.match;
  if (payload && payload.startsWith('ref_')) {
    const refCode = payload.slice(4);
    try {
      const { rows } = await pool.query(
        'SELECT user_id FROM users WHERE referral_code = $1', [refCode]
      );
      if (rows.length > 0 && rows[0].user_id !== ctx.from.id) {
        referredBy = rows[0].user_id;
      }
    } catch (err) {
      logger.debug(`Referral lookup failed: ${err.message}`);
    }
  }

  // ── Upsert user ────────────────────────────────────────────────
  const referralCode = `${ctx.from.id.toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const existingUser = await userRepo.getUser(pool, ctx.from.id);
  const isReturning = !!existingUser;

  await userRepo.upsertUser(pool, {
    userId: ctx.from.id,
    username: ctx.from.username || null,
    fullName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '),
    languageCode: ctx.from.language_code || null,
    isPremium: ctx.from.is_premium || false,
    referralCode: existingUser?.referral_code || referralCode,
    referredBy,
  });

  // ── Track ──────────────────────────────────────────────────────
  tracker.trackFireAndForget(
    ctx.from.id,
    isReturning ? ActionType.USER_RESTART : ActionType.USER_START,
    { payload: payload || null, referred_by: referredBy },
    ctx.chat?.id,
    ctx.chat?.type,
  );

  // ── Force join gate ────────────────────────────────────────────
  if (!await checkForceJoin(ctx)) return;

  // ── Check if admin (for dynamic menu) ──────────────────────────
  const isAdmin = await adminRepo.isAdmin(pool, ctx.from.id);
  const mainMenu = getMainMenu(isAdmin);

  // ── Welcome message ────────────────────────────────────────────
  try {
    const welcomeEnabled = await settingsRepo.getSetting(pool, 'welcome_enabled');
    if (welcomeEnabled) {
      const welcome = await welcomeRepo.getWelcomeMessage(pool);
      if (welcome) {
        const kb = welcome.buttons?.length
          ? buildInlineButtons(welcome.buttons)
          : undefined;

        if (welcome.media_type === 'photo' && welcome.media_file_id) {
          await ctx.replyWithPhoto(welcome.media_file_id, {
            caption: welcome.message_text,
            parse_mode: welcome.parse_mode || 'HTML',
            reply_markup: kb,
          });
        } else if (welcome.media_type === 'video' && welcome.media_file_id) {
          await ctx.replyWithVideo(welcome.media_file_id, {
            caption: welcome.message_text,
            parse_mode: welcome.parse_mode || 'HTML',
            reply_markup: kb,
          });
        } else {
          await ctx.reply(welcome.message_text, {
            parse_mode: welcome.parse_mode || 'HTML',
            reply_markup: kb,
          });
        }
        await ctx.reply('Select an option below:', { reply_markup: mainMenu });
        return;
      }
    }
  } catch (err) {
    logger.debug(`Welcome message fetch failed: ${err.message}`);
  }

  // Default greeting
  const name = ctx.from.first_name || 'User';
  await ctx.reply(
    `👋 <b>Welcome${isReturning ? ' back' : ''}, ${name}!</b>\n\n` +
    `Use the menu below to get started.`,
    { parse_mode: 'HTML', reply_markup: mainMenu }
  );
});

// ── Force-join verification callback ──────────────────────────────
composer.callbackQuery('fjcheck:verify', async (ctx) => {
  await ctx.answerCallbackQuery();
  const passed = await checkForceJoin(ctx);
  if (passed) {
    await ctx.editMessageText('✅ Verification passed! Send /start to continue.');
  }
});

export default composer;
