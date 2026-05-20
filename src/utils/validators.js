/** Validate a user ID string → number or null. */
export function validateUserId(text) {
  if (!text) return null;
  const cleaned = String(text).trim();
  if (!/^-?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) ? n : null;
}

/** Validate a channel ID string → number or null. */
export function validateChannelId(text) {
  if (!text) return null;
  const cleaned = String(text).trim();
  if (cleaned.startsWith('@')) return null; // Not numeric
  if (!/^-?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Validate broadcast text.
 * @returns {{ isValid: boolean, errorMessage: string }}
 */
export function validateBroadcastText(text) {
  if (!text || !text.trim()) {
    return { isValid: false, errorMessage: 'Broadcast text cannot be empty.' };
  }
  if (text.length > 4096) {
    return { isValid: false, errorMessage: 'Broadcast text exceeds 4096 character limit.' };
  }
  return { isValid: true, errorMessage: '' };
}
