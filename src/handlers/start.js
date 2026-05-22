import { Composer, InlineKeyboard } from 'grammy';
import crypto from 'crypto';
import { checkForceJoin, verifyForceJoin } from '../middleware/forceJoinCheck.js';
import * as userRepo from '../database/repositories/userRepo.js';
import * as adminRepo from '../database/repositories/adminRepo.js';
import * as welcomeRepo from '../database/repositories/welcomeRepo.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import { getMainMenu, buildInlineButtons } from '../utils/keyboard.js';
import { replaceWelcomePlaceholders } from '../utils/formatters.js';
import { DEFAULT_WELCOME_TEXT } from '../utils/constants.js';
import logger from '../utils/logger.js';

const composer = new Composer();

/**
 * Helper: Send the welcome message + main menu to the user.
 */
async function sendWelcomeAndMenu(ctx) {
  const pool = ctx.dbPool;
  const isAdmin = await adminRepo.isAdmin(pool, ctx.from.id);
  const mainMenu = getMainMenu(isAdmin);

  try {
    const welcomeEnabled = await settingsRepo.getSetting(pool, 'welcome_enabled');
    if (welcomeEnabled) {
      const welcome = await welcomeRepo.getWelcomeMessage(pool);
      if (welcome) {
        const msgText = replaceWelcomePlaceholders(welcome.message_text, ctx.from);

        // Build inline buttons — skip any with invalid URLs
        let kb = undefined;
        if (welcome.buttons?.length) {
          try {
            kb = buildInlineButtons(welcome.buttons);
          } catch (err) {
            logger.debug(`Failed to build inline buttons: ${err.message}`);
          }
        }

        if (welcome.media_type === 'photo' && welcome.media_file_id) {
          await ctx.replyWithPhoto(welcome.media_file_id, {
            caption: msgText,
            parse_mode: welcome.parse_mode || 'HTML',
            reply_markup: kb,
          });
        } else if (welcome.media_type === 'video' && welcome.media_file_id) {
          await ctx.replyWithVideo(welcome.media_file_id, {
            caption: msgText,
            parse_mode: welcome.parse_mode || 'HTML',
            reply_markup: kb,
          });
        } else {
          await ctx.reply(msgText, {
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

  // Default premium greeting with user placeholders
  const defaultText = replaceWelcomePlaceholders(DEFAULT_WELCOME_TEXT, ctx.from);
  await ctx.reply(defaultText, { parse_mode: 'HTML' });
  await ctx.reply('Select an option below:', { reply_markup: mainMenu });
}

composer.command('start', async (ctx) => {
  if (!ctx.from) return;
  const pool = ctx.dbPool;

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

  await userRepo.upsertUser(pool, {
    userId: ctx.from.id,
    username: ctx.from.username || null,
    fullName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '),
    languageCode: ctx.from.language_code || null,
    isPremium: ctx.from.is_premium || false,
    referralCode: existingUser?.referral_code || referralCode,
    referredBy,
  });

  // ── Force join gate ────────────────────────────────────────────
  if (!await checkForceJoin(ctx)) return;

  // ── Terms & Conditions gate ────────────────────────────────────
  try {
    const tcEnabled = await settingsRepo.getSetting(pool, 'tc_enabled');
    if (tcEnabled) {
      const tcButtons = await settingsRepo.getSetting(pool, 'tc_buttons') || [];
      const tcMessage = await settingsRepo.getSetting(pool, 'tc_message') ||
        "Dear Users,\nThere Are Some Terms & Conditions Given Please Read Carefully, Else If You Face Any Problem Related To Terms And Conditions So We Can't Help You...";

      const tcKb = new InlineKeyboard();
      for (const btn of tcButtons) {
        if (btn.url && isValidUrl(btn.url)) {
          tcKb.url(btn.text, btn.url).row();
        }
      }
      tcKb.text('✅ Accept', 'tc:accept').style('success');
      tcKb.text('❌ Decline', 'tc:decline').style('danger');

      await ctx.reply(tcMessage, { parse_mode: 'HTML', reply_markup: tcKb });
      return; // Wait for accept/decline
    }
  } catch (err) {
    logger.debug(`T&C check failed: ${err.message}`);
  }

  // ── No T&C → go straight to welcome ────────────────────────────
  await sendWelcomeAndMenu(ctx);
});

// ── T&C Accept callback ─────────────────────────────────────────────
composer.callbackQuery('tc:accept', async (ctx) => {
  try { await ctx.answerCallbackQuery('✅ Terms accepted!'); } catch {}

  // Remove/update the T&C message
  try {
    await ctx.editMessageText('✅ Terms & Conditions accepted.');
  } catch { /* may fail if message was deleted */ }

  // Proceed to welcome message + menu
  await sendWelcomeAndMenu(ctx);
});

// ── T&C Decline callback ────────────────────────────────────────────
composer.callbackQuery('tc:decline', async (ctx) => {
  try {
    await ctx.answerCallbackQuery({
      text: 'You Must Accept Terms And Condition To Use This Bot ❌',
      show_alert: true,
    });
  } catch {}
});

// ── Force-join verification callback ──────────────────────────────
composer.callbackQuery('fjcheck:verify', async (ctx) => {
  try { await ctx.answerCallbackQuery(); } catch {}
  const passed = await verifyForceJoin(ctx);
  if (passed) {
    await ctx.editMessageText('✅ Verification passed! Send /start to continue.');
  }
});

/**
 * Basic URL validation — checks if a URL has a valid domain with a dot.
 */
function isValidUrl(str) {
  try {
    const u = new URL(str);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.');
  } catch {
    return false;
  }
}

export default composer;
