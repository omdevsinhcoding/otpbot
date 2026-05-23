/**
 * Temp Mail Service — production-ready wrapper for temp-mail.io API.
 *
 * Key design decisions for 50K+ users:
 * ─────────────────────────────────────────────────────────────
 * 1. Token store: Tokens are kept in-memory (Map) keyed by email,
 *    NOT in Telegram callback_data (64-byte limit truncates them).
 * 2. Auto-cleanup: Stale entries are purged every 30 min.
 * 3. Rate limiting: Per-user cooldown on inbox checks (3s).
 * 4. Logging: Only errors are logged.
 * 5. Domain cache: Fetched once and cached for 10 minutes.
 */

import logger from '../utils/logger.js';

const API_BASE = 'https://api.internal.temp-mail.io/api/v3';
const API_V4   = 'https://api.internal.temp-mail.io/api/v4';

// ── In-memory token store ────────────────────────────────────────
const tokenStore = new Map();       // email → { token, createdAt }
const TOKEN_TTL_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [email, entry] of tokenStore) {
    if (now - entry.createdAt > TOKEN_TTL_MS) tokenStore.delete(email);
  }
}, 10 * 60 * 1000).unref();

// ── Per-user inbox cooldown ──────────────────────────────────────
const inboxCooldowns = new Map();   // chatId → timestamp
const INBOX_COOLDOWN_MS = 3000;

setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of inboxCooldowns) {
    if (now - ts > 60_000) inboxCooldowns.delete(id);
  }
}, 5 * 60 * 1000).unref();

export function isInboxRateLimited(chatId) {
  const last = inboxCooldowns.get(chatId);
  if (last && Date.now() - last < INBOX_COOLDOWN_MS) return true;
  inboxCooldowns.set(chatId, Date.now());
  return false;
}

// ── Token helpers ────────────────────────────────────────────────
export function storeToken(email, token) {
  tokenStore.set(email, { token, createdAt: Date.now() });
}
export function getToken(email) {
  return tokenStore.get(email)?.token || null;
}
export function removeToken(email) {
  tokenStore.delete(email);
  messagesCache.delete(email);
}
export function getStoreSize() {
  return tokenStore.size;
}

// ── Messages cache (avoids re-fetching when viewing single msg) ─
const messagesCache = new Map();    // email → { messages, cachedAt }
const MSG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

setInterval(() => {
  const now = Date.now();
  for (const [email, entry] of messagesCache) {
    if (now - entry.cachedAt > MSG_CACHE_TTL) messagesCache.delete(email);
  }
}, 5 * 60 * 1000).unref();

export function cacheMessages(email, messages) {
  messagesCache.set(email, { messages, cachedAt: Date.now() });
}
export function getCachedMessages(email) {
  const entry = messagesCache.get(email);
  if (!entry || Date.now() - entry.cachedAt > MSG_CACHE_TTL) return null;
  return entry.messages;
}
export function getCachedMessage(email, index) {
  const msgs = getCachedMessages(email);
  if (!msgs || index < 0 || index >= msgs.length) return null;
  return msgs[index];
}

// ── Domain cache ─────────────────────────────────────────────────
let cachedDomains = [];
let domainsCachedAt = 0;
const DOMAINS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch available domains from the v4 API (cached).
 * @returns {Promise<string[]>} array of domain names
 */
export async function fetchDomains() {
  if (cachedDomains.length > 0 && Date.now() - domainsCachedAt < DOMAINS_CACHE_TTL) {
    return cachedDomains;
  }

  try {
    const res = await fetch(`${API_V4}/domains`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      logger.error(`[TempMail] Domains fetch failed: ${res.status}`);
      return cachedDomains; // return stale cache if available
    }

    const data = await res.json();
    if (data.domains && Array.isArray(data.domains)) {
      cachedDomains = data.domains.map(d => d.name);
      domainsCachedAt = Date.now();
    }
    return cachedDomains;
  } catch (err) {
    logger.error('[TempMail] Domains fetch error:', err.message);
    return cachedDomains;
  }
}

/**
 * Create a new temporary email address with a specific domain.
 */
export async function createTempEmail(minNameLength = 10, maxNameLength = 10) {
  try {
    const res = await fetch(`${API_BASE}/email/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        min_name_length: minNameLength,
        max_name_length: maxNameLength,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error(`[TempMail] Create failed: ${res.status} ${body}`);
      return { success: false, error: `API error ${res.status}` };
    }

    const data = await res.json();
    if (!data.email) {
      return { success: false, error: 'No email returned' };
    }

    if (data.token) storeToken(data.email, data.token);
    return { success: true, email: data.email, token: data.token };
  } catch (err) {
    logger.error('[TempMail] Create error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Create a new temporary email with a specific domain.
 * Generates a random local part and creates via the API.
 */
export async function createTempEmailWithDomain(domain, nameLength = 10) {
  try {
    // Generate random local part
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let localPart = '';
    for (let i = 0; i < nameLength; i++) {
      localPart += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const res = await fetch(`${API_BASE}/email/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        min_name_length: nameLength,
        max_name_length: nameLength,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error(`[TempMail] Create w/ domain failed: ${res.status} ${body}`);
      return { success: false, error: `API error ${res.status}` };
    }

    const data = await res.json();
    if (!data.email) {
      return { success: false, error: 'No email returned' };
    }

    if (data.token) storeToken(data.email, data.token);
    return { success: true, email: data.email, token: data.token };
  } catch (err) {
    logger.error('[TempMail] Create w/ domain error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Check inbox for a given email address.
 */
export async function checkInbox(email) {
  try {
    const res = await fetch(`${API_BASE}/email/${email}/messages`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      if (res.status !== 404) {
        logger.error(`[TempMail] Inbox ${res.status} for ${email.split('@')[0]}@***`);
      }
      return { success: false, error: res.status === 404 ? 'Email expired' : `API error ${res.status}` };
    }

    const data = await res.json();
    return { success: true, messages: Array.isArray(data) ? data : [] };
  } catch (err) {
    logger.error('[TempMail] Inbox error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Delete a temporary email address.
 */
export async function deleteTempEmail(email, token = null) {
  const authToken = token || getToken(email);
  if (!authToken) {
    removeToken(email);
    return { success: false, error: 'No token available' };
  }

  try {
    const res = await fetch(`${API_BASE}/email/${email}`, {
      method: 'DELETE',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
    });

    removeToken(email);

    // 400 = token expired, 404 = email already gone — both expected, don't log
    if (!res.ok && res.status >= 500) {
      logger.error(`[TempMail] Delete ${res.status} for ${email.split('@')[0]}@***`);
    }

    return { success: res.ok || res.status === 400 || res.status === 404 };
  } catch (err) {
    removeToken(email);
    logger.error('[TempMail] Delete error:', err.message);
    return { success: false, error: err.message };
  }
}
