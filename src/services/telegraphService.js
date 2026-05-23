/**
 * Telegraph Service — auto-generate beautiful rule pages
 *
 * Strategy: edit existing page → verify it worked → if not, reset & create new.
 * This handles the case where stored token doesn't own the page.
 */
import logger from '../utils/logger.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import * as depositRulesRepo from '../database/repositories/depositRulesRepo.js';

const API = 'https://api.telegra.ph';

// ── Telegraph Account ────────────────────────────────────────────

/** Create a fresh Telegraph account, store token in DB */
async function createFreshAccount(pool) {
  const botName = await settingsRepo.getSetting(pool, 'bot_name') || 'OTPBOT';
  const params = new URLSearchParams();
  params.append('short_name', botName);
  params.append('author_name', botName);
  const res = await fetch(`${API}/createAccount`, { method: 'POST', body: params });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'createAccount failed');
  const token = data.result.access_token;
  await settingsRepo.setSetting(pool, 'telegraph_token', token);
  return token;
}

/** Get existing token or create new account */
async function getToken(pool) {
  const token = await settingsRepo.getSetting(pool, 'telegraph_token');
  if (token) return token;
  return createFreshAccount(pool);
}

// ── Helpers ──────────────────────────────────────────────────────

function fmt(n) {
  return Number(n).toLocaleString('en-IN');
}

/** Build Telegraph content nodes from rules */
function buildContent(rules, botName) {
  const nodes = [];

  // Header
  nodes.push({ tag: 'h4', children: [`💎 Extra Deposit Benefits`] });
  nodes.push({ tag: 'p', children: [{ tag: 'em', children: ['Deposit more, earn more! Here are all the benefits you get when you deposit.'] }] });
  nodes.push({ tag: 'hr' });

  // Tax rules
  const taxRules = rules.filter(r => r.rule_type === 'tax');
  if (taxRules.length > 0) {
    nodes.push({ tag: 'h4', children: ['⚠️ Tax Rules'] });
    for (const r of taxRules) {
      const max = parseFloat(r.max_deposit);
      const pct = parseFloat(r.percentage);
      if (max > 0) {
        nodes.push({
          tag: 'blockquote', children: [
            `😮‍💨 If you deposit less than ₹${fmt(max)} at once, you pay `,
            { tag: 'strong', children: [`${pct}% tax`] },
            `.`
          ]
        });
      }
    }
    nodes.push({ tag: 'hr' });
  }

  // Simple bonus rules
  const bonusRules = rules.filter(r => r.rule_type === 'bonus');
  if (bonusRules.length > 0) {
    nodes.push({ tag: 'h4', children: ['🎁 Instant Bonus'] });
    nodes.push({ tag: 'p', children: [{ tag: 'em', children: ['You get bonus instantly on every qualifying deposit!'] }] });
    for (const r of bonusRules) {
      const min = parseFloat(r.min_deposit);
      const pct = parseFloat(r.percentage);
      nodes.push({
        tag: 'blockquote', children: [
          `🙂 If you deposit ₹${fmt(min)} or more, you get `,
          { tag: 'strong', children: [`${pct}% extra money`] },
          ` of your deposit amount.`
        ]
      });
    }
    nodes.push({ tag: 'hr' });
  }

  // Loyalty rules
  const loyaltyRules = rules.filter(r => r.rule_type === 'loyalty_bonus')
    .sort((a, b) => parseFloat(a.rolling_30d_min) - parseFloat(b.rolling_30d_min));
  const emojis = ['☺️', '🥰', '🤑', '🥳', '😉', '🤩', '💰'];

  if (loyaltyRules.length > 0) {
    nodes.push({ tag: 'h4', children: ['🏆 Loyalty Rewards'] });
    nodes.push({ tag: 'p', children: [{ tag: 'em', children: ['The more you deposit over time, the higher your bonus! Your deposit history in the last few days determines your loyalty tier.'] }] });

    for (let i = 0; i < loyaltyRules.length; i++) {
      const r = loyaltyRules[i];
      const min = parseFloat(r.min_deposit) || 0;
      const rolling = parseFloat(r.rolling_30d_min) || 0;
      const days = parseInt(r.rolling_period_days) || 30;
      const pct = parseFloat(r.percentage);
      const emoji = emojis[i % emojis.length];

      const children = [`${emoji} `];
      if (min > 0) children.push(`If you deposit ₹${fmt(min)}+ and `);
      else children.push(`If `);
      children.push(`your last ${days} days deposit total is ₹${fmt(rolling)} or more, you get `);
      children.push({ tag: 'strong', children: [`${pct}% extra money`] });
      children.push(` of your deposit.`);

      nodes.push({ tag: 'blockquote', children });
    }

    // Tier reference
    nodes.push({ tag: 'hr' });
    nodes.push({ tag: 'h4', children: ['📊 Quick Reference'] });
    nodes.push({ tag: 'p', children: [{ tag: 'strong', children: ['Tier → Required History → Bonus %'] }] });
    for (let i = 0; i < loyaltyRules.length; i++) {
      const r = loyaltyRules[i];
      const rolling = parseFloat(r.rolling_30d_min) || 0;
      const days = parseInt(r.rolling_period_days) || 30;
      const pct = parseFloat(r.percentage);
      nodes.push({
        tag: 'p', children: [
          `${emojis[i % emojis.length]}  ₹${fmt(rolling)}+ in ${days} days  →  `,
          { tag: 'strong', children: [`${pct}% bonus`] }
        ]
      });
    }
  }

  // Footer
  nodes.push({ tag: 'hr' });
  nodes.push({ tag: 'p', children: [
    { tag: 'em', children: [`Rules are applied automatically when you deposit. The highest applicable bonus is always given. Powered by ${botName || 'OTPBOT'}.`] }
  ]});

  return nodes;
}

// ── Core: Create a new Telegraph page ────────────────────────────

async function createNewPage(pool, token, title, contentStr, botName) {
  const params = new URLSearchParams();
  params.append('access_token', token);
  params.append('title', title);
  params.append('content', contentStr);
  params.append('author_name', botName);

  const res = await fetch(`${API}/createPage`, { method: 'POST', body: params });
  const data = await res.json();
  if (!data.ok) throw new Error(`createPage: ${data.error || 'unknown error'}`);

  const page = data.result;
  await settingsRepo.setSetting(pool, 'telegraph_rules_path', page.path);
  const url = `https://telegra.ph/${page.path}`;
  await settingsRepo.setSetting(pool, 'telegraph_rules_url', url);
  return url;
}

// ── Core: Edit existing Telegraph page ───────────────────────────

async function editExistingPage(token, path, title, contentStr, botName) {
  const params = new URLSearchParams();
  params.append('access_token', token);
  params.append('title', title);
  params.append('content', contentStr);
  params.append('author_name', botName);
  params.append('return_content', 'true');  // Get content back to verify

  const res = await fetch(`${API}/editPage/${path}`, { method: 'POST', body: params });
  const data = await res.json();
  if (!data.ok) return { success: false, error: data.error || 'editPage failed' };

  // Verify the edit actually applied by checking returned content
  const returnedContent = JSON.stringify(data.result.content || []);
  const sentContent = contentStr;
  // Simple length check — if content is drastically different, edit didn't apply
  if (Math.abs(returnedContent.length - sentContent.length) > sentContent.length * 0.5) {
    return { success: false, error: 'Content mismatch after edit — token may not own this page' };
  }

  return { success: true, path: data.result.path };
}

// ── Public: Update rules page (edit or create) ───────────────────

/**
 * Create or update Telegraph page with current rules.
 * Auto-heals if stored token doesn't own the page.
 * @returns {string|null} page URL or null
 */
export async function updateRulesPage(pool) {
  try {
    const rules = await depositRulesRepo.getActiveRules(pool);
    if (rules.length === 0) return null;

    let token = await getToken(pool);
    const customName = await settingsRepo.getSetting(pool, 'telegraph_author_name');
    const botName = customName || await settingsRepo.getSetting(pool, 'bot_name') || 'OTPBOT';
    const content = buildContent(rules, botName);
    const title = `💎 ${botName} — Deposit Benefits`;
    const contentStr = JSON.stringify(content);

    const existingPath = await settingsRepo.getSetting(pool, 'telegraph_rules_path');

    // Try editing existing page
    if (existingPath) {
      const result = await editExistingPage(token, existingPath, title, contentStr, botName);
      if (result.success) {
        const url = `https://telegra.ph/${result.path}`;
        await settingsRepo.setSetting(pool, 'telegraph_rules_url', url);
        return url;
      }

      // Edit failed — reset and create fresh
      logger.warn(`[Telegraph] Edit failed (${result.error}), resetting and creating new page`);
      await settingsRepo.setSetting(pool, 'telegraph_rules_path', '');
      await settingsRepo.setSetting(pool, 'telegraph_rules_url', '');
      await settingsRepo.setSetting(pool, 'telegraph_token', '');
      token = await createFreshAccount(pool);
    }

    // Create new page
    return await createNewPage(pool, token, title, contentStr, botName);
  } catch (err) {
    logger.error(`[Telegraph] Update failed: ${err.message}`);
    return null;
  }
}

// ── Public: Force reset everything ───────────────────────────────

/**
 * Force reset Telegraph — delete stored token/path/url, create fresh.
 * Use when telegraph is stuck or not updating.
 * @returns {string|null} new page URL
 */
export async function resetAndRecreate(pool) {
  // Clear all stored Telegraph state
  await settingsRepo.setSetting(pool, 'telegraph_token', '');
  await settingsRepo.setSetting(pool, 'telegraph_rules_path', '');
  await settingsRepo.setSetting(pool, 'telegraph_rules_url', '');

  // Create fresh
  return await updateRulesPage(pool);
}

/** Get the current Telegraph rules URL */
export async function getRulesUrl(pool) {
  return await settingsRepo.getSetting(pool, 'telegraph_rules_url');
}
