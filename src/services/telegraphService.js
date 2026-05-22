/**
 * Telegraph Service — auto-generate beautiful rule pages
 */
import logger from '../utils/logger.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import * as depositRulesRepo from '../database/repositories/depositRulesRepo.js';

const API = 'https://api.telegra.ph';

async function apiCall(method, params) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Telegraph API error');
  return data.result;
}

/** Get or create a Telegraph account, store token in DB */
async function getToken(pool) {
  let token = await settingsRepo.getSetting(pool, 'telegraph_token');
  if (token) return token;

  const botName = await settingsRepo.getSetting(pool, 'bot_name') || 'OTPBOT';
  const result = await apiCall('createAccount', {
    short_name: botName,
    author_name: botName,
  });
  token = result.access_token;
  await settingsRepo.setSetting(pool, 'telegraph_token', token);
  return token;
}

/** Format number with commas */
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

    // Tier table
    nodes.push({ tag: 'hr' });
    nodes.push({ tag: 'h4', children: ['📊 Quick Reference'] });

    const tableHeader = { tag: 'tr', children: [
      { tag: 'th', children: ['Tier'] },
      { tag: 'th', children: ['Deposit History'] },
      { tag: 'th', children: ['Bonus'] },
    ]};

    const tableRows = loyaltyRules.map((r, i) => {
      const rolling = parseFloat(r.rolling_30d_min) || 0;
      const days = parseInt(r.rolling_period_days) || 30;
      const pct = parseFloat(r.percentage);
      return {
        tag: 'tr', children: [
          { tag: 'td', children: [`${emojis[i % emojis.length]}`] },
          { tag: 'td', children: [`₹${fmt(rolling)}+ in ${days}d`] },
          { tag: 'td', children: [{ tag: 'strong', children: [`${pct}%`] }] },
        ]
      };
    });

    // Telegraph doesn't support tables, use list instead
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

/**
 * Create or update Telegraph page with current rules.
 * Returns the page URL.
 */
export async function updateRulesPage(pool) {
  try {
    const rules = await depositRulesRepo.getActiveRules(pool);
    if (rules.length === 0) return null;

    const token = await getToken(pool);
    const customName = await settingsRepo.getSetting(pool, 'telegraph_author_name');
    const botName = customName || await settingsRepo.getSetting(pool, 'bot_name') || 'OTPBOT';
    const content = buildContent(rules, botName);
    const title = `💎 ${botName} — Deposit Benefits`;

    // Check if page already exists
    const existingPath = await settingsRepo.getSetting(pool, 'telegraph_rules_path');

    // Telegraph API needs content as JSON string in form data
    const contentStr = JSON.stringify(content);

    let page;
    if (existingPath) {
      // Edit existing page
      const params = new URLSearchParams();
      params.append('access_token', token);
      params.append('title', title);
      params.append('content', contentStr);
      params.append('author_name', botName);

      const res = await fetch(`${API}/editPage/${existingPath}`, {
        method: 'POST',
        body: params,
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'editPage failed');
      page = data.result;
    } else {
      // Create new page
      const params = new URLSearchParams();
      params.append('access_token', token);
      params.append('title', title);
      params.append('content', contentStr);
      params.append('author_name', botName);

      const res = await fetch(`${API}/createPage`, {
        method: 'POST',
        body: params,
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'createPage failed');
      page = data.result;
      await settingsRepo.setSetting(pool, 'telegraph_rules_path', page.path);
    }

    const url = `https://telegra.ph/${page.path}`;
    await settingsRepo.setSetting(pool, 'telegraph_rules_url', url);
    logger.info(`[Telegraph] Rules page updated: ${url}`);
    return url;
  } catch (err) {
    logger.error(`[Telegraph] Error updating rules page: ${err.message}`);
    return null;
  }
}

/** Get the current Telegraph rules URL */
export async function getRulesUrl(pool) {
  return await settingsRepo.getSetting(pool, 'telegraph_rules_url');
}
