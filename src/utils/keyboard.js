import { Keyboard, InlineKeyboard } from 'grammy';
import {
  BTN_GET_OTP, BTN_DEPOSIT, BTN_PROFILE, BTN_MORE,
  BTN_SMS_CHECKER, BTN_SUPPORT, BTN_REFER_EARN, BTN_READYMADE,
  ADMIN_CB, BROADCAST_CB, USER_MGMT_CB, ADMIN_MGMT_CB,
  FORCE_JOIN_CB, WELCOME_CB, ANALYTICS_CB, LOGS_CB,
  SETTINGS_CB, BOT_STATS_CB, MENU_CB,
} from './constants.js';

// ── User main menu (Reply Keyboard) ─────────────────────────────────
export const USER_MAIN_MENU = new Keyboard()
  .text(BTN_GET_OTP).text(BTN_DEPOSIT).row()
  .text(BTN_PROFILE).text(BTN_MORE).text(BTN_SMS_CHECKER).row()
  .text(BTN_SUPPORT).text(BTN_REFER_EARN).row()
  .text(BTN_READYMADE)
  .resized();

// ── Admin panel (Inline Keyboard) ────────────────────────────────────
export const ADMIN_PANEL_KEYBOARD = new InlineKeyboard()
  .text('📢 Broadcast', `${ADMIN_CB}broadcast`).text('👥 Users', `${ADMIN_CB}users`).row()
  .text('🔗 Force Join', `${ADMIN_CB}forcejoin`).text('👑 Admins', `${ADMIN_CB}admins`).row()
  .text('📊 Analytics', `${ADMIN_CB}analytics`).text('📋 Logs', `${ADMIN_CB}logs`).row()
  .text('💬 Welcome Msg', `${ADMIN_CB}welcome`).text('⚙️ Settings', `${ADMIN_CB}settings`).row()
  .text('🤖 Bot Stats', `${ADMIN_CB}botstats`).row()
  .text('❌ Close', `${ADMIN_CB}close`);

// ── Dynamic keyboard builders ────────────────────────────────────────

/**
 * Build an InlineKeyboard from a JSON-style nested array.
 * Each inner array = one row. Each button: { text, url } or { text, callback_data }.
 */
export function buildInlineButtons(buttonsJson) {
  const kb = new InlineKeyboard();
  if (!Array.isArray(buttonsJson)) return kb;

  for (const row of buttonsJson) {
    if (!Array.isArray(row)) {
      // flat list — each item is its own row
      const btn = row;
      if (btn.url) kb.url(btn.text, btn.url);
      else kb.text(btn.text, btn.callback_data || 'noop');
      kb.row();
      continue;
    }
    for (const btn of row) {
      if (btn.url) kb.url(btn.text, btn.url);
      else kb.text(btn.text, btn.callback_data || 'noop');
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
