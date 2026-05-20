/**
 * Text formatting helpers.
 */

/** Escape HTML special characters for Telegram's HTML parse mode. */
export function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Format a number with comma separators: 1234567 → "1,234,567". */
export function formatNumber(n) {
  if (n == null) return '0';
  return Number(n).toLocaleString('en-IN');
}

/** Relative time string: "2 hours ago", "3 days ago", etc. */
export function formatTimestamp(date) {
  if (!date) return 'Unknown';
  const now = Date.now();
  const ts = date instanceof Date ? date.getTime() : new Date(date).getTime();
  const diffMs = now - ts;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMon = Math.floor(diffDay / 30);
  if (diffMon < 12) return `${diffMon}mo ago`;
  return `${Math.floor(diffMon / 12)}y ago`;
}

/** Build an attractive HTML user profile card. */
export function formatUserCard(u) {
  return (
    `╔══════════════════════╗\n` +
    `      👤 <b>USER PROFILE</b>\n` +
    `╠══════════════════════╣\n` +
    `┃ 🆔 <b>ID:</b> <code>${u.user_id}</code>\n` +
    `┃ 📛 <b>Name:</b> ${escapeHtml(u.full_name || 'N/A')}\n` +
    `┃ 👤 <b>Username:</b> ${u.username ? '@' + escapeHtml(u.username) : 'N/A'}\n` +
    `┃ 📅 <b>Joined:</b> ${formatTimestamp(u.first_seen)}\n` +
    `┃ ⏰ <b>Last Active:</b> ${formatTimestamp(u.last_active)}\n` +
    `┃ ⭐ <b>Status:</b> ${u.is_banned ? '🚫 Banned' : '✅ Active'}\n` +
    `╚══════════════════════╝`
  );
}

/** Build an HTML admin card. */
export function formatAdminCard(a) {
  const role = a.role === 'super_admin' ? '👑 Super Admin' : '🛡️ Admin';
  return (
    `👑 <b>Admin Details</b>\n\n` +
    `🆔 <b>User ID:</b> <code>${a.admin_id}</code>\n` +
    `📛 <b>Username:</b> ${a.username ? '@' + escapeHtml(a.username) : 'N/A'}\n` +
    `🏷️ <b>Role:</b> ${role}\n` +
    `📅 <b>Added:</b> ${formatTimestamp(a.added_at)}\n`
  );
}

/** Truncate text to maxLen, appending "…" if needed. */
export function truncateText(text, maxLen = 100) {
  if (!text) return '';
  const s = String(text);
  return s.length <= maxLen ? s : s.slice(0, maxLen) + '…';
}
