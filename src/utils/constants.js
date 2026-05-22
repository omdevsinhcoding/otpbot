// ── Callback prefixes ────────────────────────────────────────────────
export const ADMIN_CB = "admin:";
export const BROADCAST_CB = "bcast:";
export const USER_MGMT_CB = "usrmgmt:";
export const ADMIN_MGMT_CB = "admgmt:";
export const FORCE_JOIN_CB = "forcejoin:";
export const WELCOME_CB = "welcome:";
export const ANALYTICS_CB = "analytics:";
export const LOGS_CB = "logs:";
export const SETTINGS_CB = "settings:";
export const BOT_STATS_CB = "botstats:";
export const MENU_CB = "menu:";
export const FJ_CHECK_CB = "fjcheck:";

// ── Action types ─────────────────────────────────────────────────────
export const ActionType = Object.freeze({
  USER_START: "user_start",
  USER_RESTART: "user_restart",
  BUTTON_CLICK: "button_click",
  COMMAND_USED: "command_used",

  BROADCAST_SENT: "broadcast_sent",
  BROADCAST_FAILED: "broadcast_failed",
  BROADCAST_CREATED: "broadcast_created",

  ADMIN_ADDED: "admin_added",
  ADMIN_REMOVED: "admin_removed",
  ADMIN_ACTION: "admin_action",

  FORCE_JOIN_CHECK: "force_join_check",
  FORCE_JOIN_PASSED: "force_join_passed",
  FORCE_JOIN_FAILED: "force_join_failed",

  USER_BANNED: "user_banned",
  USER_UNBANNED: "user_unbanned",
  USER_SEARCHED: "user_searched",

  WELCOME_SENT: "welcome_sent",
  SETTINGS_CHANGED: "settings_changed",

  ERROR_OCCURRED: "error_occurred",
  BOT_STARTED: "bot_started",

  FINANCIAL_DEPOSIT: "financial_deposit",
  FINANCIAL_WITHDRAWAL: "financial_withdrawal",
  FINANCIAL_PROFIT: "financial_profit",
  FINANCIAL_LOSS: "financial_loss",
});

// ── Permissions ──────────────────────────────────────────────────────
export const Permission = Object.freeze({
  BROADCAST: "broadcast",
  USER_MANAGEMENT: "user_management",
  ADMIN_MANAGEMENT: "admin_management",
  FORCE_JOIN: "force_join",
  WELCOME_MESSAGE: "welcome_message",
  ANALYTICS: "analytics",
  LOGS: "logs",
  SETTINGS: "settings",
  BOT_STATS: "bot_stats",
  ALL: "all",
});

// ── User-facing reply-keyboard button labels ─────────────────────────
export const BTN_GET_OTP = "⭐ GET OTP";
export const BTN_DEPOSIT = "💰 DEPOSIT";
export const BTN_PROFILE = "👤 PROFILE";
export const BTN_MORE = "🔥 MORE";
export const BTN_SMS_CHECKER = "📩 SMS CHECKER";
export const BTN_SUPPORT = "🎧 SUPPORT";
export const BTN_REFER_EARN = "🎁 REFER & EARN";
export const BTN_READYMADE = "💎 READYMADE ACCOUNT";

// ── MORE sub-menu button labels ──────────────────────────────────────
export const BTN_GET_EMAIL = "📧 GET EMAIL";
export const BTN_FAVORITE = "😊 Favorite";
export const BTN_PROMO_CODE = "Promo Code 🔮";
export const BTN_RETURN = "◀️ RETURN";
export const BTN_TOP_SERVICES = "📊 TOP SERVICES";
export const BTN_API = "⚙️ API";
export const BTN_RESELLER = "♻️ Reseller Account";

// ── Admin button in main menu ────────────────────────────────────────
export const BTN_ADMIN_PANEL = "🔧 ADMIN PANEL";

// ── Admin panel reply-keyboard button labels ─────────────────────────
export const BTN_ADM_BROADCAST = "📢 Broadcast";
export const BTN_ADM_USERS = "👥 Users";
export const BTN_ADM_FORCEJOIN = "🔗 Force Join";
export const BTN_ADM_ADMINS = "👑 Admins";
export const BTN_ADM_WELCOME = "💬 Welcome Msg";
export const BTN_ADM_SETTINGS = "⚙️ Settings";
export const BTN_ADM_PAYMENTS = "💰 Payments";
export const BTN_ADM_BOTSTATS = "🤖 Bot Stats";
export const BTN_ADM_LOGS = "📋 Admin Logs";
export const BTN_ADM_BACK = "◀️ BACK";

// ── Payments sub-menu button labels ──────────────────────────────────
export const BTN_PAY_PAYTM = "💳 Paytm";
export const BTN_PAY_BHARATPAY = "🏦 BharatPay";
export const BTN_PAY_CRYPTO = "₿ Crypto";
export const BTN_PAY_BACK = "◀️ Back to Admin";

// ── Default welcome message (premium template) ──────────────────────
export const DEFAULT_WELCOME_TEXT =
`Hey {user}! 👋

<blockquote>Welcome to the bot! We're glad to have you here.

⚡ Fast & Reliable
🔒 Secure & Private
💎 Best-in-class Service</blockquote>

<i>👇 Tap below to get started!</i>`;
