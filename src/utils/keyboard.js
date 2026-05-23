import { Keyboard, InlineKeyboard } from 'grammy';
import {
  BTN_GET_OTP, BTN_DEPOSIT, BTN_PROFILE, BTN_MORE,
  BTN_BUY_MAIL, BTN_SUPPORT, BTN_REFER_EARN, BTN_READYMADE,
  BTN_GET_EMAIL, BTN_FAVORITE, BTN_PROMO_CODE, BTN_RETURN,
  BTN_TOP_SERVICES, BTN_API, BTN_RESELLER, BTN_ADMIN_PANEL,
  BTN_ADM_BROADCAST, BTN_ADM_USERS, BTN_ADM_FORCEJOIN, BTN_ADM_ADMINS,
  BTN_ADM_WELCOME, BTN_ADM_SETTINGS, BTN_ADM_PAYMENTS, BTN_ADM_BOTSTATS,
  BTN_ADM_LOGS, BTN_ADM_BACK,
  BTN_PAY_PAYTM, BTN_PAY_BHARATPAY, BTN_PAY_CRYPTO, BTN_PAY_BACK,
  ADMIN_CB,
} from './constants.js';

// ── User main menu (Dynamic — adds Admin button for admins) ─────────
export function getMainMenu(isAdmin = false, referralEnabled = true) {
  const kb = new Keyboard()
    .text(BTN_GET_OTP).text(BTN_DEPOSIT).row()
    .text(BTN_PROFILE).text(BTN_MORE).text(BTN_BUY_MAIL).row();
  if (referralEnabled) {
    kb.text(BTN_SUPPORT).text(BTN_REFER_EARN).row();
  } else {
    kb.text(BTN_SUPPORT).row();
  }
  kb.text(BTN_READYMADE);
  if (isAdmin) {
    kb.row().text(BTN_ADMIN_PANEL);
  }
  return kb.resized();
}

// ── MORE sub-menu (Reply Keyboard) ──────────────────────────────────
export const MORE_MENU_KEYBOARD = new Keyboard()
  .text(BTN_GET_EMAIL).text(BTN_FAVORITE).row()
  .text(BTN_PROMO_CODE).text(BTN_RETURN).row()
  .text(BTN_TOP_SERVICES).text(BTN_API).row()
  .text(BTN_RESELLER)
  .resized();

// ── Admin panel static reply keyboard ───────────────────────────────
export const ADMIN_MENU_KEYBOARD = new Keyboard()
  .text(BTN_ADM_BROADCAST).text(BTN_ADM_USERS).text(BTN_ADM_ADMINS).row()
  .text(BTN_ADM_PAYMENTS).text(BTN_ADM_SETTINGS).text(BTN_ADM_FORCEJOIN).row()
  .text(BTN_ADM_WELCOME).text(BTN_ADM_BOTSTATS).text(BTN_ADM_LOGS).row()
  .text(BTN_ADM_BACK)
  .resized();

// ── Payments sub-menu static reply keyboard ─────────────────────────
export const PAYMENTS_MENU_KEYBOARD = new Keyboard()
  .text(BTN_PAY_PAYTM).text(BTN_PAY_BHARATPAY).text(BTN_PAY_CRYPTO).row()
  .text(BTN_PAY_BACK)
  .resized();

// ── Admin panel (Inline Keyboard) ────────────────────────────────────
export const ADMIN_PANEL_KEYBOARD = new InlineKeyboard()
  .text('📢 Broadcast', `${ADMIN_CB}broadcast`).text('👥 Users', `${ADMIN_CB}users`).row()
  .text('🔗 Force Join', `${ADMIN_CB}forcejoin`).text('👑 Admins', `${ADMIN_CB}admins`).row()
  .text('💬 Welcome Msg', `${ADMIN_CB}welcome`).text('📜 T&C', `${ADMIN_CB}tc`).row()
  .text('💰 Payments', `${ADMIN_CB}payments`).text('💎 Benefits', `${ADMIN_CB}benefits`).row()
  .text('🎁 Referral', `${ADMIN_CB}referral`).text('⚙️ Settings', `${ADMIN_CB}settings`).row()
  .text('🤖 Bot Stats', `${ADMIN_CB}botstats`).text('📋 Admin Logs', `${ADMIN_CB}logs`).row()
  .text('❌ Close', `${ADMIN_CB}close`);

// ── Dynamic keyboard builders ────────────────────────────────────────

/**
 * Build an InlineKeyboard from a JSON-style nested array.
 * Each inner array = one row. Each button: { text, url } or { text, callback_data }.
 */
/**
 * Validates a URL has proper format (protocol + domain with dot).
 */
function isValidBtnUrl(str) {
  try {
    const u = new URL(str);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.');
  } catch {
    return false;
  }
}

export function buildInlineButtons(buttonsJson) {
  const kb = new InlineKeyboard();
  if (!Array.isArray(buttonsJson)) return kb;

  for (const row of buttonsJson) {
    if (!Array.isArray(row)) {
      // flat list — each item is its own row
      const btn = row;
      if (btn.url) {
        if (!isValidBtnUrl(btn.url)) continue; // skip invalid URLs
        kb.url(btn.text, btn.url);
      } else {
        kb.text(btn.text, btn.callback_data || 'noop');
      }
      // Apply Telegram style (success=green, primary=blue, danger=red)
      if (btn.color && ['success', 'primary', 'danger'].includes(btn.color)) {
        kb.style(btn.color);
      }
      kb.row();
      continue;
    }
    for (const btn of row) {
      if (btn.url) {
        if (!isValidBtnUrl(btn.url)) continue; // skip invalid URLs
        kb.url(btn.text, btn.url);
      } else {
        kb.text(btn.text, btn.callback_data || 'noop');
      }
      if (btn.color && ['success', 'primary', 'danger'].includes(btn.color)) {
        kb.style(btn.color);
      }
    }
    kb.row();
  }
  return kb;
}

/**
 * Pagination: ◀ page/total ▶
 */
export function buildPaginationKeyboard(currentPage, totalPages, prefix) {
  const kb = new InlineKeyboard();
  if (currentPage > 1) {
    kb.text('◀️ Prev', `${prefix}page:${currentPage - 1}`);
  }
  kb.text(`📄 ${currentPage}/${totalPages}`, `${prefix}page:${currentPage}`);
  if (currentPage < totalPages) {
    kb.text('Next ▶️', `${prefix}page:${currentPage + 1}`);
  }
  return kb;
}

/**
 * Single-row back button.
 */
export function buildBackButton(callbackData) {
  return new InlineKeyboard().text('‹ Back', callbackData);
}
