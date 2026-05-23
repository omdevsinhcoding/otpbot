/**
 * Temp Mail Service — uses temp-mail.io API to create temporary emails
 * and check inbox for received messages.
 */

import logger from '../utils/logger.js';

const API_BASE = 'https://api.internal.temp-mail.io/api/v3';

/**
 * Create a new temporary email address.
 * @param {number} minNameLength - Minimum length for the email name part (default: 10)
 * @param {number} maxNameLength - Maximum length for the email name part (default: 10)
 * @returns {Promise<{success: boolean, email?: string, token?: string, error?: string}>}
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
      logger.error(`Temp mail create failed: ${res.status} ${body}`);
      return { success: false, error: `API returned ${res.status}` };
    }

    const data = await res.json();
    if (!data.email) {
      return { success: false, error: 'No email returned from API' };
    }

    return {
      success: true,
      email: data.email,
      token: data.token,
    };
  } catch (err) {
    logger.error('Temp mail create error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Check inbox for a given email address.
 * Uses the email directly in the URL path (no encoding of @).
 * @param {string} email - The temporary email address
 * @returns {Promise<{success: boolean, messages?: Array, error?: string}>}
 */
export async function checkInbox(email) {
  try {
    const url = `${API_BASE}/email/${email}/messages`;
    logger.info(`Checking temp mail inbox: ${url}`);

    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error(`Temp mail inbox check failed: ${res.status} ${body}`);
      return { success: false, error: `API returned ${res.status}: ${body}` };
    }

    const data = await res.json();
    return {
      success: true,
      messages: Array.isArray(data) ? data : [],
    };
  } catch (err) {
    logger.error('Temp mail inbox error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Delete a temporary email address.
 * @param {string} email - The email address to delete
 * @param {string} token - The token associated with the email
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteTempEmail(email, token) {
  try {
    const res = await fetch(`${API_BASE}/email/${email}`, {
      method: 'DELETE',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error(`Temp mail delete failed: ${res.status} ${body}`);
    }

    return { success: res.ok };
  } catch (err) {
    logger.error('Temp mail delete error:', err);
    return { success: false, error: err.message };
  }
}
