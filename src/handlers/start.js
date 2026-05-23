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
  const refEnabled = await settingsRepo.getSetting(pool, 'referral_enabled');
  const mainMenu = getMainMenu(isAdmin, !!refEnabled);

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
  if (payload) {
    let refCode = null;
    if (payload.startsWith('ref_')) {
      // Legacy format: ref_<code>
      refCode = payload.slice(4);
    } else if (/^[A-Z0-9]+-[A-Z0-9]{8}$/.test(payload)) {
      // New format: PREFIX-XXXXXXXX (the entire payload IS the code)
      refCode = payload;
    }
    if (refCode) {
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
  }

  // ── Upsert user ────────────────────────────────────────────────
  // Generate new-format referral code for new users
  const existingUser = await userRepo.getUser(pool, ctx.from.id);
  let referralCode = existingUser?.referral_code;
  if (!referralCode) {
    try {
      const { generateUniqueCode } = await import('../database/repositories/referralRepo.js');
      const prefix = await settingsRepo.getSetting(pool, 'referral_code_prefix') || 'ERRORRO';
      referralCode = await generateUniqueCode(pool, prefix);
    } catch {
      referralCode = `${ctx.from.id.toString(36)}${crypto.randomBytes(3).toString('hex')}`;
    }
  }

  await userRepo.upsertUser(pool, {
    userId: ctx.from.id,
    username: ctx.from.username || null,
    fullName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '),
    languageCode: ctx.from.language_code || null,
    isPremium: ctx.from.is_premium || false,
    referralCode,
    referredBy,
  });

  // ── Notify referrer when new user joins via their link ──────────
  if (referredBy && !existingUser) {
    try {
      const refEnabled = await settingsRepo.getSetting(pool, 'referral_enabled');
      if (refEnabled) {
        const commPct = parseFloat(await settingsRepo.getSetting(pool, 'referral_commission_pct')) || 10;
        const notifText =
          `🎉 <b>New Referral!</b>\n\n` +
          `👤 A user joined using your link!\n` +
          `💰 You'll earn <b>${commPct}%</b> on their deposits!\n\n` +
          `🔥 <i>Keep sharing to earn more!</i>`;
        await ctx.api.sendMessage(referredBy, notifText, { parse_mode: 'HTML' });
      }
    } catch {
      // Notification failure is non-critical
    }
  }

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
          tcKb.url(btn.text, btn.url);
          if (btn.color) tcKb.style(btn.color);
          tcKb.row();
        }
      }
      const rawAccept = await settingsRepo.getSetting(pool, 'tc_accept_color');
      const rawDecline = await settingsRepo.getSetting(pool, 'tc_decline_color');
      const acceptColor = rawAccept !== null && rawAccept !== undefined ? rawAccept : 'success';
      const declineColor = rawDecline !== null && rawDecline !== undefined ? rawDecline : 'danger';
      tcKb.text('✅ Accept', 'tc:accept');
      if (acceptColor) tcKb.style(acceptColor);
      tcKb.text('❌ Decline', 'tc:decline');
      if (declineColor) tcKb.style(declineColor);

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
    // Remove the force join message
    try { await ctx.editMessageText('✅ Verification passed!'); } catch {}

    const pool = ctx.dbPool;

    // ── Next step: T&C gate ──
    try {
      const tcEnabled = await settingsRepo.getSetting(pool, 'tc_enabled');
      if (tcEnabled) {
        const tcButtons = await settingsRepo.getSetting(pool, 'tc_buttons') || [];
        const tcMessage = await settingsRepo.getSetting(pool, 'tc_message') ||
          "Dear Users,\nThere Are Some Terms & Conditions Given Please Read Carefully, Else If You Face Any Problem Related To Terms And Conditions So We Can't Help You...";

        const tcKb = new InlineKeyboard();
        for (const btn of tcButtons) {
          if (btn.url && isValidUrl(btn.url)) {
            tcKb.url(btn.text, btn.url);
            if (btn.color) tcKb.style(btn.color);
            tcKb.row();
          }
        }
        const rawAccept2 = await settingsRepo.getSetting(pool, 'tc_accept_color');
        const rawDecline2 = await settingsRepo.getSetting(pool, 'tc_decline_color');
        const acceptColor2 = rawAccept2 !== null && rawAccept2 !== undefined ? rawAccept2 : 'success';
        const declineColor2 = rawDecline2 !== null && rawDecline2 !== undefined ? rawDecline2 : 'danger';
        tcKb.text('✅ Accept', 'tc:accept');
        if (acceptColor2) tcKb.style(acceptColor2);
        tcKb.text('❌ Decline', 'tc:decline');
        if (declineColor2) tcKb.style(declineColor2);

        await ctx.reply(tcMessage, { parse_mode: 'HTML', reply_markup: tcKb });
        return; // Wait for accept/decline
      }
    } catch (err) {
      logger.debug(`T&C check after fjcheck failed: ${err.message}`);
    }

    // ── No T&C → go to welcome ──
    await sendWelcomeAndMenu(ctx);
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
