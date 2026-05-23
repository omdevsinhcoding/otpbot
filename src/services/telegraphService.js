/**
 * Telegraph Service — auto-generate beautiful rule pages
 *
 * STRATEGY: Always create a NEW page on every update.
 * Telegraph editPage is unreliable (returns ok:true without actually saving).
 * Pages are free, so creating new ones costs nothing.
 * The stored URL is always updated, so users always see the latest.
 */
import logger from '../utils/logger.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import * as depositRulesRepo from '../database/repositories/depositRulesRepo.js';

const API = 'https://api.telegra.ph';

// ── Telegraph Account ────────────────────────────────────────────

async function getOrCreateToken(pool) {
  let token = await settingsRepo.getSetting(pool, 'telegraph_token');
  if (token) return token;

  const botName = await settingsRepo.getSetting(pool, 'bot_name') || 'OTPBOT';
  const params = new URLSearchParams();
  params.append('short_name', botName);
  params.append('author_name', botName);
  const res = await fetch(`${API}/createAccount`, { method: 'POST', body: params });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'createAccount failed');
  token = data.result.access_token;
  await settingsRepo.setSetting(pool, 'telegraph_token', token);
  return token;
}

// ── Helpers ──────────────────────────────────────────────────────

function fmt(n) {
  return Number(n).toLocaleString('en-IN');
}

function buildContent(rules, botName) {
  const nodes = [];

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

  // Bonus rules
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

// ── Core: Always create a FRESH page ─────────────────────────────

/**
 * Create or update Telegraph page with current deposit rules.
 * ALWAYS creates a new page (editPage is unreliable).
 * @returns {string|null} page URL or null
 */
export async function updateRulesPage(pool) {
  try {
    const rules = await depositRulesRepo.getActiveRules(pool);
    if (rules.length === 0) return null;

    const token = await getOrCreateToken(pool);
    const customName = await settingsRepo.getSetting(pool, 'telegraph_author_name');
    const botName = customName || await settingsRepo.getSetting(pool, 'bot_name') || 'OTPBOT';
    const content = buildContent(rules, botName);
    const title = `💎 ${botName} — Deposit Benefits`;
    const contentStr = JSON.stringify(content);

    // Always create a new page — editPage is unreliable
    const params = new URLSearchParams();
    params.append('access_token', token);
    params.append('title', title);
    params.append('content', contentStr);
    params.append('author_name', botName);

    const res = await fetch(`${API}/createPage`, { method: 'POST', body: params });
    const data = await res.json();

    if (!data.ok) {
      // Token might be invalid, create fresh account and retry
      logger.warn(`[Telegraph] createPage failed (${data.error}), resetting token`);
      await settingsRepo.setSetting(pool, 'telegraph_token', '');
      const newToken = await getOrCreateToken(pool);

      const retryParams = new URLSearchParams();
      retryParams.append('access_token', newToken);
      retryParams.append('title', title);
      retryParams.append('content', contentStr);
      retryParams.append('author_name', botName);

      const retryRes = await fetch(`${API}/createPage`, { method: 'POST', body: retryParams });
      const retryData = await retryRes.json();
      if (!retryData.ok) throw new Error(retryData.error || 'createPage retry failed');

      const url = `https://telegra.ph/${retryData.result.path}`;
      await settingsRepo.setSetting(pool, 'telegraph_rules_path', retryData.result.path);
      await settingsRepo.setSetting(pool, 'telegraph_rules_url', url);
      return url;
    }

    const url = `https://telegra.ph/${data.result.path}`;
    await settingsRepo.setSetting(pool, 'telegraph_rules_path', data.result.path);
    await settingsRepo.setSetting(pool, 'telegraph_rules_url', url);
    return url;
  } catch (err) {
    logger.error(`[Telegraph] Update failed: ${err.message}`);
    return null;
  }
}

/**
 * Force reset — clear all stored state and recreate.
 */
export async function resetAndRecreate(pool) {
  await settingsRepo.setSetting(pool, 'telegraph_token', '');
  await settingsRepo.setSetting(pool, 'telegraph_rules_path', '');
  await settingsRepo.setSetting(pool, 'telegraph_rules_url', '');
  return await updateRulesPage(pool);
}

/** Get the current Telegraph rules URL */
export async function getRulesUrl(pool) {
  return await settingsRepo.getSetting(pool, 'telegraph_rules_url');
}
