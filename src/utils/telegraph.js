/**
 * 📜 Telegraph Page Utility
 *
 * Creates referral T&C pages on Telegraph in English and Hinglish.
 * Pages are created fresh (never edited) and URLs stored in settings.
 */
import * as settingsRepo from '../database/repositories/settingsRepo.js';
import logger from './logger.js';

// ═══════════════════════════════════════════════════════════════════
//  ENGLISH CONTENT
// ═══════════════════════════════════════════════════════════════════
function buildEnglishContent(commPct) {
  return [
    { tag: 'h3', children: ['🎁 How Refer & Earn Works'] },
    { tag: 'p', children: ['Earning money through referrals is super easy! Just follow these 3 simple steps:'] },
    { tag: 'br' },

    { tag: 'h4', children: ['Step 1: 📤 Share Your Referral Link'] },
    { tag: 'p', children: ['Open "🎁 Refer & Earn" in the bot. You\'ll see your unique referral link and code. Copy it and share with your friends, family, or post it on social media!'] },
    { tag: 'br' },

    { tag: 'h4', children: ['Step 2: 👥 Your Friend Joins The Bot'] },
    { tag: 'p', children: ['When someone clicks your link and starts the bot, they automatically become your referral. You\'ll get a notification right away! 🔔'] },
    { tag: 'br' },

    { tag: 'h4', children: [
      'Step 3: 💰 Earn ',
      { tag: 'strong', children: [`${commPct}%`] },
      ' On Every Deposit'
    ]},
    { tag: 'p', children: ['Every time your referred friend makes a successful deposit, you earn a commission! The bonus goes straight into your wallet — no extra steps needed.'] },
    { tag: 'br' },

    { tag: 'h4', children: ['💡 Let\'s Understand With Examples'] },
    { tag: 'p', children: [`✅ Your friend deposits ₹500 → You earn ₹${(500 * commPct / 100).toFixed(0)} 🎉`] },
    { tag: 'p', children: [`✅ Your friend deposits ₹1000 → You earn ₹${(1000 * commPct / 100).toFixed(0)} 💰`] },
    { tag: 'p', children: [`✅ Your friend deposits ₹2000 → You earn ₹${(2000 * commPct / 100).toFixed(0)} 🤑`] },
    { tag: 'p', children: [`✅ Your friend deposits ₹5000 → You earn ₹${(5000 * commPct / 100).toFixed(0)} 🔥`] },
    { tag: 'p', children: [{ tag: 'strong', children: ['There\'s no earning limit! The more you refer, the more you earn! 🚀'] }] },
    { tag: 'br' },

    { tag: 'hr' },
    { tag: 'h3', children: ['💰 Where Does My Earning Go?'] },
    { tag: 'p', children: ['• Your commission is added directly to your wallet balance'] },
    { tag: 'p', children: ['• Use your wallet balance to purchase coupons, OTPs, and more!'] },
    { tag: 'p', children: ['• Everything is fully automatic — earn while you sleep! ✅'] },
    { tag: 'br' },

    { tag: 'hr' },
    { tag: 'h3', children: ['🚫 Important Rules'] },
    { tag: 'p', children: ['❌ Self-referral is strictly NOT allowed'] },
    { tag: 'p', children: ['❌ Fake or duplicate accounts → Your bonus will be cancelled'] },
    { tag: 'p', children: ['❌ Any suspicious activity → Account action will be taken'] },
    { tag: 'p', children: ['✅ Only successful deposits are counted for commission'] },
    { tag: 'p', children: ['✅ Each user gets one unique referral code'] },
    { tag: 'p', children: ['✅ Commission is credited instantly after successful deposit'] },
    { tag: 'br' },

    { tag: 'hr' },
    { tag: 'h3', children: ['🔥 Start Earning Now!'] },
    { tag: 'p', children: [
      'Open the bot → Tap ',
      { tag: 'strong', children: ['"🎁 Refer & Earn"'] },
      ' → Copy your link → Share it → Watch your earnings grow! 💰'
    ]},
    { tag: 'p', children: [
      { tag: 'em', children: ['More referrals = More deposits = More earnings. It\'s that simple! 😎'] }
    ]},
  ];
}

// ═══════════════════════════════════════════════════════════════════
//  HINGLISH CONTENT
// ═══════════════════════════════════════════════════════════════════
function buildHinglishContent(commPct) {
  return [
    { tag: 'h3', children: ['🎁 Refer & Earn — Kaise Kaam Karta Hai?'] },
    { tag: 'p', children: ['Bahut simple hai bhai! Bas 3 steps follow karo aur paisa kamao:'] },
    { tag: 'br' },

    { tag: 'h4', children: ['Step 1: 📤 Apna Link Share Karo'] },
    { tag: 'p', children: ['Bot me "🎁 Refer & Earn" open karo. Apka unique referral link aur code milega. Usse copy karo aur apne friends, family ya social media pe share karo!'] },
    { tag: 'br' },

    { tag: 'h4', children: ['Step 2: 👥 Friend Bot Join Kare'] },
    { tag: 'p', children: ['Jab koi apka link use karke bot start kare, wo automatically apka referral ban jaata hai. Apko turant notification milega! 🔔'] },
    { tag: 'br' },

    { tag: 'h4', children: [
      'Step 3: 💰 Har Deposit Pe Kamao (',
      { tag: 'strong', children: [`${commPct}% Commission`] },
      ')'
    ]},
    { tag: 'p', children: ['Jab apka referred friend successful deposit kare, apko commission milta hai! Bonus seedha apke wallet me aa jaata hai — koi extra step nahi!'] },
    { tag: 'br' },

    { tag: 'h4', children: ['💡 Example Se Samjho'] },
    { tag: 'p', children: [`✅ Friend ₹500 deposit kare → Apko ₹${(500 * commPct / 100).toFixed(0)} milega 🎉`] },
    { tag: 'p', children: [`✅ Friend ₹1000 deposit kare → Apko ₹${(1000 * commPct / 100).toFixed(0)} milega 💰`] },
    { tag: 'p', children: [`✅ Friend ₹2000 deposit kare → Apko ₹${(2000 * commPct / 100).toFixed(0)} milega 🤑`] },
    { tag: 'p', children: [`✅ Friend ₹5000 deposit kare → Apko ₹${(5000 * commPct / 100).toFixed(0)} milega 🔥`] },
    { tag: 'p', children: [{ tag: 'strong', children: ['Koi limit nahi bhai! Jitna share karo utna kamao! 🚀'] }] },
    { tag: 'br' },

    { tag: 'hr' },
    { tag: 'h3', children: ['💰 Earning Kaha Jaata Hai?'] },
    { tag: 'p', children: ['• Commission seedha apke wallet balance me add hota hai'] },
    { tag: 'p', children: ['• Wallet balance se coupons, OTPs ya kuch bhi kharid sakte ho!'] },
    { tag: 'p', children: ['• Sab automatic hai — sote sote bhi kamao! ✅'] },
    { tag: 'br' },

    { tag: 'hr' },
    { tag: 'h3', children: ['🚫 Rules — Zaroor Follow Karo'] },
    { tag: 'p', children: ['❌ Self-referral bilkul allowed NAHI hai'] },
    { tag: 'p', children: ['❌ Fake ya duplicate accounts banaye → Bonus cancel hoga'] },
    { tag: 'p', children: ['❌ Suspicious activity → Account pe action liya jaayega'] },
    { tag: 'p', children: ['✅ Sirf SUCCESSFUL deposits count honge'] },
    { tag: 'p', children: ['✅ Har user ko ek unique referral code milta hai'] },
    { tag: 'p', children: ['✅ Commission turant credit hota hai deposit ke baad'] },
    { tag: 'br' },

    { tag: 'hr' },
    { tag: 'h3', children: ['🔥 Abhi Start Karo!'] },
    { tag: 'p', children: [
      'Bot open karo → ',
      { tag: 'strong', children: ['"🎁 Refer & Earn"'] },
      ' tap karo → Link copy karo → Share karo → Earning shuru! 💰'
    ]},
    { tag: 'p', children: [
      { tag: 'em', children: ['Jyada refer = Jyada deposit = Jyada earning. Bas itna simple hai! 😎'] }
    ]},
  ];
}

// ═══════════════════════════════════════════════════════════════════
//  TELEGRAPH API HELPERS
// ═══════════════════════════════════════════════════════════════════

/** Get or create a Telegraph API token */
async function getOrCreateToken(pool) {
  let token = await settingsRepo.getSetting(pool, 'telegraph_token');
  if (token) return token;

  const res = await fetch('https://api.telegra.ph/createAccount', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ short_name: 'ReferBot', author_name: 'Refer & Earn' })
  });
  const data = await res.json();
  if (!data.ok) throw new Error('Telegraph account creation failed');

  token = data.result.access_token;
  await settingsRepo.setSetting(pool, 'telegraph_token', token);
  return token;
}

/**
 * Create a NEW Telegraph page (never edits existing ones).
 * @param {object} pool - DB pool
 * @param {'english'|'hinglish'} language - which version
 * @returns {string} page URL
 */
export async function createTelegraphPage(pool, language) {
  const token = await getOrCreateToken(pool);
  const commPct = parseFloat(await settingsRepo.getSetting(pool, 'referral_commission_pct')) || 10;
  const authorName = await settingsRepo.getSetting(pool, 'telegraph_author_name') || 'Refer & Earn Bot';

  const isEnglish = language === 'english';
  const content = isEnglish ? buildEnglishContent(commPct) : buildHinglishContent(commPct);
  const title = isEnglish
    ? '🎁 Refer & Earn — Terms & Conditions'
    : '🎁 Refer & Earn — Niyam aur Shartein';

  const res = await fetch('https://api.telegra.ph/createPage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: token,
      title,
      content,
      author_name: authorName,
      return_content: false,
    })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegraph page creation failed: ${JSON.stringify(data)}`);

  const url = data.result.url;
  const settingKey = isEnglish ? 'referral_terms_url_en' : 'referral_terms_url_hi';
  await settingsRepo.setSetting(pool, settingKey, url);

  logger.info(`[Telegraph] Created ${language} page: ${url}`);
  return url;
}

/**
 * Ensure Telegraph pages exist based on current language setting.
 * Creates missing pages lazily.
 * @returns {{ en: string|null, hi: string|null }} URLs
 */
export async function ensureTelegraphPages(pool) {
  const langMode = await settingsRepo.getSetting(pool, 'telegraph_language') || 'english';
  const result = { en: null, hi: null };

  try {
    if (langMode === 'english' || langMode === 'both') {
      let url = await settingsRepo.getSetting(pool, 'referral_terms_url_en');
      if (!url) url = await createTelegraphPage(pool, 'english');
      result.en = url;
    }

    if (langMode === 'hinglish' || langMode === 'both') {
      let url = await settingsRepo.getSetting(pool, 'referral_terms_url_hi');
      if (!url) url = await createTelegraphPage(pool, 'hinglish');
      result.hi = url;
    }
  } catch (err) {
    logger.debug(`[Telegraph] ensurePages failed: ${err.message}`);
  }

  return result;
}

/**
 * Force-regenerate Telegraph pages (creates new ones, overwrites URLs).
 * Used by admin panel when settings change.
 */
export async function regeneratePages(pool) {
  const langMode = await settingsRepo.getSetting(pool, 'telegraph_language') || 'english';
  const result = { en: null, hi: null };

  if (langMode === 'english' || langMode === 'both') {
    result.en = await createTelegraphPage(pool, 'english');
  }
  if (langMode === 'hinglish' || langMode === 'both') {
    result.hi = await createTelegraphPage(pool, 'hinglish');
  }

  return result;
}
