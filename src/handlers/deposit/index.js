/**
 * Deposit Handlers — Combiner
 *
 * Imports all gateway-specific handlers and the text input router.
 * Single export replaces the old monolithic deposit.js.
 */
import { Composer } from 'grammy';
import { userStates } from './shared.js';
import { handlePaytmAmount } from './paytm.js';
import { handleBharatpayUTR } from './bharatpay.js';
import { handleCryptomusDeposit, handleCryptoWebDeposit } from './crypto.js';

// ── Import all gateway composers ────────────────────────────────
import menu from './menu.js';
import paytm from './paytm.js';
import bharatpay from './bharatpay.js';
import crypto from './crypto.js';

const composer = new Composer();

composer.use(menu);
composer.use(paytm);
composer.use(bharatpay);
composer.use(crypto);

// ═══════════════════════════════════════════════════════════════════
//  TEXT INPUT ROUTER (dispatches to correct gateway handler)
// ═══════════════════════════════════════════════════════════════════

// Reply keyboard button texts — if user presses these, clear state & forward
const MENU_BUTTONS = new Set([
  '📠 GET OTP', '💰 DEPOSIT', '👤 PROFILE', '🔥 MORE',
  '📩 BUY MAIL', '🎧 SUPPORT', '🎁 REFER & EARN', '💎 READYMADE ACCOUNT',
  '📧 TEMP MAIL', '😊 Favorite', 'Promo Code 👾', '◀️ RETURN',
  '📊 TOP SERVICES', '⚙️ API', '🔮 Reseller Account', '🔧 ADMIN PANEL',
  // Admin static buttons
  '📢 Broadcast', '👥 Users', '🔗 Force Join', '👑 Admins',
  '💬 Welcome Msg', '⚙️ Settings', '💰 Payments', '🤖 Bot Stats',
  '📋 Admin Logs', '◀️ BACK',
  // Payment sub-buttons
  '💳 Paytm', '🏦 BharatPay', '₿ Crypto', '◀️ Back to Admin',
]);

composer.on('message:text', async (ctx, next) => {
  const state = userStates.get(ctx.chat.id);
  if (!state) return next();

  // If user presses a reply keyboard button, clear state and forward
  if (MENU_BUTTONS.has(ctx.message.text.trim())) {
    userStates.delete(ctx.chat.id);
    return next();
  }

  switch (state.step) {
    case 'paytm_amount': return handlePaytmAmount(ctx);
    case 'bharatpay_utr': return handleBharatpayUTR(ctx);
    case 'cryptomus_amount': return handleCryptomusDeposit(ctx, state.currency, state.network, parseFloat(ctx.message.text.trim()));
    case 'cryptomus_web_amount': return handleCryptoWebDeposit(ctx, parseFloat(ctx.message.text.trim()));
    default: return next();
  }
});

export default composer;
