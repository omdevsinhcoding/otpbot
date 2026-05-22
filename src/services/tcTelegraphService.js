/**
 * T&C Telegraph Service — auto-generate Terms & Conditions pages
 */
import logger from '../utils/logger.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';

const API = 'https://api.telegra.ph';

/** Get or create Telegraph account token (reuses same token as deposit benefits) */
async function getToken(pool) {
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

/** Build English T&C content */
function buildEnglishContent(botName) {
  const n = [];

  n.push({ tag: 'p', children: [
    `Using the ${botName} bot means that you accept ✅ these rules and terms. Please read them carefully.`
  ]});
  n.push({ tag: 'hr' });

  // 1. Introduction
  n.push({ tag: 'h3', children: ['🔹 1. Introduction'] });
  n.push({ tag: 'p', children: [`👉 ${botName} is a virtual number provider bot that offers you the following services:`] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['🔢 Virtual / temporary numbers (For OTP/verification)'] },
    { tag: 'li', children: ['📧 Tempmail OTPs'] },
    { tag: 'li', children: ['👤 Readymade accounts'] },
    { tag: 'li', children: ['🤝 Reseller services'] },
    { tag: 'li', children: ['💸 Balance transfer system'] },
    { tag: 'li', children: ['🎁 Promo codes via channel'] },
    { tag: 'li', children: ['💬 WhatsApp/Telegram numbers (rare availability)'] },
    { tag: 'li', children: ['🆘 Best support'] },
  ]});
  n.push({ tag: 'hr' });

  // 2. Purchase / Delivery / Refund
  n.push({ tag: 'h3', children: ['🔹 2. Purchase / Delivery / Refund Policy ⚠️'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['🚫 No refund will be provided after the OTP/account has been delivered.'] },
    { tag: 'li', children: ['🔄 Number/account availability is automatic — if it is currently unavailable, you will need to retry manually. Once available, the system will automatically add it.'] },
    { tag: 'li', children: ['📧 Refund claims will not be accepted after the TempMail OTP has been delivered.'] },
    { tag: 'li', children: ['✅ Readymade accounts are provided at the buyer\'s own risk.'] },
    { tag: 'li', children: ['⏳ Virtual numbers are temporary and may expire at any time — the bot is NOT responsible for expired numbers or missed OTPs.'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['🚫 All purchases are final. No chargebacks, disputes, or payment reversals will be entertained.'] }] },
  ]});
  n.push({ tag: 'hr' });

  // 3. Deposit / Wallet
  n.push({ tag: 'h3', children: ['🔹 3. Deposit / Wallet 💳'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['💳 Once a deposit is made, withdrawal is NOT available (unless explicitly mentioned). Please deposit only the amount you actually need.'] },
    { tag: 'li', children: ['🔄 Balance transfer between users is available (if enabled by admin). Admin is NOT responsible for wrong transfers — verify recipient before sending.'] },
    { tag: 'li', children: ['⚠️ All payment disputes must be raised within 24 hours with valid proof (screenshot, transaction ID, etc.)'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['🚫 Deposits made through unofficial channels or to wrong addresses will NOT be honored or refunded.'] }] },
    { tag: 'li', children: ['💰 Bonus/cashback offers (if any) are subject to change without notice and may have conditions attached.'] },
  ]});
  n.push({ tag: 'hr' });

  // 4. Account & Security
  n.push({ tag: 'h3', children: ['🔹 4. Account & Security 🔐'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['👤 One account per user. Creating multiple accounts will result in permanent ban without refund.'] },
    { tag: 'li', children: ['🔒 Sharing your account credentials or access with others is strictly prohibited.'] },
    { tag: 'li', children: ['⚖️ Admin reserves the right to ban, suspend, or restrict any account without prior notice if suspicious activity is detected.'] },
    { tag: 'li', children: ['🛡️ Users are responsible for keeping their Telegram account secure. We are not liable for unauthorized access.'] },
    { tag: 'li', children: ['📱 If your Telegram account is compromised, contact admin immediately. We are NOT responsible for losses due to compromised accounts.'] },
  ]});
  n.push({ tag: 'hr' });

  // 5. Usage Rules
  n.push({ tag: 'h3', children: ['🔹 5. Usage Rules 📋'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['📌 The bot is for personal and educational use only.'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['🚫 Using bot services for illegal activities, fraud, scamming, phishing, harassment, or any unlawful purpose is STRICTLY PROHIBITED.'] }] },
    { tag: 'li', children: ['⚠️ Users are FULLY responsible for how they use the numbers, accounts, and services purchased through this bot.'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['🛡️ The bot owner/admin is NOT liable for any misuse, illegal activity, or consequences arising from user actions.'] }] },
    { tag: 'li', children: ['🤖 Spamming bot commands, flooding, or abusing the system will result in immediate and permanent ban.'] },
    { tag: 'li', children: ['📢 Attempting to exploit bugs, vulnerabilities, or payment system flaws will result in ban and possible legal action.'] },
  ]});
  n.push({ tag: 'hr' });

  // 6. Service Availability
  n.push({ tag: 'h3', children: ['🔹 6. Service Availability ⏱'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['📡 Services are provided "as-is" with no uptime guarantee.'] },
    { tag: 'li', children: ['🔧 The bot may go offline for maintenance, updates, or technical issues without prior notice.'] },
    { tag: 'li', children: ['📞 Number availability depends on third-party providers — there is no guarantee of specific numbers, countries, or services.'] },
    { tag: 'li', children: ['💲 Prices may change without notice based on provider costs and market conditions.'] },
    { tag: 'li', children: ['⏰ Service delays due to high demand or provider issues are not grounds for refund.'] },
  ]});
  n.push({ tag: 'hr' });

  // 7. Privacy & Data
  n.push({ tag: 'h3', children: ['🔹 7. Privacy & Data 🔒'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['📊 The bot stores minimal user data (Telegram ID, username, balance, transaction history) for operational purposes only.'] },
    { tag: 'li', children: ['🔐 User data is NOT shared with any third parties.'] },
    { tag: 'li', children: ['👁️ Admin may access transaction logs for dispute resolution and fraud prevention.'] },
    { tag: 'li', children: ['📱 The bot does NOT store OTPs, messages, or any content received on virtual numbers.'] },
    { tag: 'li', children: ['🗑️ Users can request account deletion by contacting admin. All balance will be forfeited upon deletion.'] },
  ]});
  n.push({ tag: 'hr' });

  // 8. Liability Disclaimer
  n.push({ tag: 'h3', children: ['🔹 8. Liability Disclaimer ⚖️'] });
  n.push({ tag: 'blockquote', children: [
    { tag: 'strong', children: ['⚠️ IMPORTANT — READ CAREFULLY:'] }
  ]});
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: [{ tag: 'strong', children: [`🛡️ ${botName} and its administrators are NOT responsible for any loss, damage, legal consequences, or any other issues arising from the use of this service.`] }] },
    { tag: 'li', children: [{ tag: 'strong', children: ['⚠️ Users use this service entirely at their OWN RISK. You are solely responsible for your actions.'] }] },
    { tag: 'li', children: ['🚫 Admin is NOT liable for any third-party service failures, number expiry, OTP delays, or account issues.'] },
    { tag: 'li', children: ['📜 No warranties, guarantees, or representations — express or implied — are provided regarding the reliability, accuracy, or availability of services.'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['🔒 By using this bot, you acknowledge and agree that you are solely responsible for all your activities and any consequences thereof.'] }] },
    { tag: 'li', children: ['⚖️ Any legal dispute shall be resolved under the applicable laws of the admin\'s jurisdiction. Users waive any right to class action.'] },
  ]});
  n.push({ tag: 'hr' });

  // 9. Changes to Terms
  n.push({ tag: 'h3', children: ['🔹 9. Changes to Terms 📝'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['📋 Admin reserves the right to update, modify, or change these terms at any time without prior notice.'] },
    { tag: 'li', children: ['✅ Continued use of the bot after changes = automatic acceptance of the updated terms.'] },
    { tag: 'li', children: ['🔔 It is the user\'s responsibility to check back regularly for updates.'] },
  ]});
  n.push({ tag: 'hr' });

  // Footer
  const today = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
  n.push({ tag: 'blockquote', children: [
    { tag: 'em', children: [
      `By using ${botName}, you confirm that you have read, understood, and agreed to ALL the above terms and conditions. You use this service entirely at your own risk. Last updated: ${today}`
    ]}
  ]});

  return n;
}

/** Build Hinglish T&C content */
function buildHinglishContent(botName) {
  const n = [];

  n.push({ tag: 'p', children: [
    `${botName} bot ka use karne ka matlab hai ki aap in rules ko accept ✅ karte ho. Kripya dhyan se padhe.`
  ]});
  n.push({ tag: 'hr' });

  // 1. Introduction
  n.push({ tag: 'h3', children: ['🔹 1. Introduction / परिचय'] });
  n.push({ tag: 'p', children: [`👉 ${botName} ek virtual number provider bot hai jo aapko ye services deta hai:`] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['🔢 Virtual / temporary numbers (OTP/verification ke liye)'] },
    { tag: 'li', children: ['📧 Tempmail OTPs'] },
    { tag: 'li', children: ['👤 Readymade accounts'] },
    { tag: 'li', children: ['🤝 Reseller services'] },
    { tag: 'li', children: ['💸 Balance transfer system'] },
    { tag: 'li', children: ['🎁 Promo codes via channel'] },
    { tag: 'li', children: ['💬 WhatsApp/Telegram numbers (rare availability)'] },
    { tag: 'li', children: ['🆘 Accha support'] },
  ]});
  n.push({ tag: 'hr' });

  // 2. Purchase / Delivery / Refund
  n.push({ tag: 'h3', children: ['🔹 2. Purchase / Delivery / Refund Policy ⚠️'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['🚫 OTP / account deliver hone ke baad refund nahi milega.'] },
    { tag: 'li', children: ['🔄 Number/account availability automatic hai — agar unavailable hai to aapko khud retry karna hoga; jab available hoga to system auto add karega.'] },
    { tag: 'li', children: ['📧 Tempmail OTP deliver hone ke baad refund claim accept nahi hoga.'] },
    { tag: 'li', children: ['✅ Readymade accounts buyer ke risk par diye jaate hain.'] },
    { tag: 'li', children: ['⏳ Virtual numbers temporary hain aur kabhi bhi expire ho sakte hain — bot expired numbers ya missed OTPs ke liye responsible NAHI hai.'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['🚫 Sabhi purchases final hain. Koi chargeback, dispute, ya payment reversal accept nahi hoga.'] }] },
  ]});
  n.push({ tag: 'hr' });

  // 3. Deposit / Wallet
  n.push({ tag: 'h3', children: ['🔹 3. Deposit / Wallet 💳'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['💳 Ek baar deposit hone ke baad, withdrawal available NAHI hai (jab tak explicitly mention na ho). Sirf utna hi deposit kare jitna aapko chahiye.'] },
    { tag: 'li', children: ['🔄 Users ke beech balance transfer available hai (agar admin ne enable kiya ho). Galat transfer ke liye admin responsible NAHI hai — bhejne se pehle verify kare.'] },
    { tag: 'li', children: ['⚠️ Payment disputes 24 ghante ke andar valid proof ke saath raise karne honge (screenshot, transaction ID, etc.)'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['🚫 Unofficial channels ya galat address par ki gayi deposits ko honor ya refund NAHI kiya jayega.'] }] },
    { tag: 'li', children: ['💰 Bonus/cashback offers (agar koi ho) bina notice ke change ho sakte hain aur unme conditions lag sakti hain.'] },
  ]});
  n.push({ tag: 'hr' });

  // 4. Account & Security
  n.push({ tag: 'h3', children: ['🔹 4. Account & Security 🔐'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['👤 Ek user = ek account. Multiple accounts banane par permanent ban bina refund ke.'] },
    { tag: 'li', children: ['🔒 Apna account kisi ke saath share karna bilkul mana hai.'] },
    { tag: 'li', children: ['⚖️ Admin ko kisi bhi account ko bina notice ke ban, suspend, ya restrict karne ka pura adhikar hai.'] },
    { tag: 'li', children: ['🛡️ Apna Telegram account secure rakhna user ki zimmedari hai. Unauthorized access ke liye hum liable nahi hain.'] },
    { tag: 'li', children: ['📱 Agar aapka Telegram account compromise ho jaye to turant admin se contact kare. Compromised accounts ke karan hone wale loss ke liye hum responsible NAHI hain.'] },
  ]});
  n.push({ tag: 'hr' });

  // 5. Usage Rules
  n.push({ tag: 'h3', children: ['🔹 5. Usage Rules 📋'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['📌 Bot sirf personal aur educational use ke liye hai.'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['🚫 Bot services ka illegal activities, fraud, scamming, phishing, harassment, ya kisi bhi unlawful purpose ke liye use karna BILKUL MANA hai.'] }] },
    { tag: 'li', children: ['⚠️ Users PURI TARAH se responsible hain ki wo kharide gaye numbers, accounts aur services ka kaise use karte hain.'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['🛡️ Bot owner/admin kisi bhi misuse, illegal activity, ya users ke actions se hone wale consequences ke liye LIABLE NAHI hai.'] }] },
    { tag: 'li', children: ['🤖 Bot commands spam karna, flood karna, ya system abuse karna = immediate permanent ban.'] },
    { tag: 'li', children: ['📢 Bugs, vulnerabilities, ya payment system ki kamzoriyo ka exploit karne ki koshish par ban aur possible legal action hoga.'] },
  ]});
  n.push({ tag: 'hr' });

  // 6. Service Availability
  n.push({ tag: 'h3', children: ['🔹 6. Service Availability ⏱'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['📡 Services "as-is" basis par provide ki jaati hain, uptime ki koi guarantee nahi hai.'] },
    { tag: 'li', children: ['🔧 Bot maintenance, updates, ya technical issues ke liye bina notice ke offline ho sakta hai.'] },
    { tag: 'li', children: ['📞 Number availability third-party providers par depend karti hai — kisi specific number, country, ya service ki guarantee nahi hai.'] },
    { tag: 'li', children: ['💲 Provider costs aur market conditions ke basis par prices bina notice ke change ho sakti hain.'] },
    { tag: 'li', children: ['⏰ High demand ya provider issues ke karan service delays refund ka reason nahi hai.'] },
  ]});
  n.push({ tag: 'hr' });

  // 7. Privacy & Data
  n.push({ tag: 'h3', children: ['🔹 7. Privacy & Data 🔒'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['📊 Bot minimal user data store karta hai (Telegram ID, username, balance, transaction history) sirf operational purposes ke liye.'] },
    { tag: 'li', children: ['🔐 User data kisi bhi third party ke saath share NAHI kiya jaata.'] },
    { tag: 'li', children: ['👁️ Admin dispute resolution aur fraud prevention ke liye transaction logs access kar sakta hai.'] },
    { tag: 'li', children: ['📱 Bot virtual numbers par aane wale OTPs, messages, ya koi content store NAHI karta.'] },
    { tag: 'li', children: ['🗑️ Users admin se contact karke account deletion request kar sakte hain. Deletion par saara balance forfeit ho jayega.'] },
  ]});
  n.push({ tag: 'hr' });

  // 8. Liability Disclaimer
  n.push({ tag: 'h3', children: ['🔹 8. Liability Disclaimer / Jimmedari ⚖️'] });
  n.push({ tag: 'blockquote', children: [
    { tag: 'strong', children: ['⚠️ ZAROORI HAI — DHYAN SE PADHE:'] }
  ]});
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: [{ tag: 'strong', children: [`🛡️ ${botName} aur uske administrators is service ke use se hone wale kisi bhi loss, damage, legal consequences, ya kisi aur issues ke liye RESPONSIBLE NAHI hain.`] }] },
    { tag: 'li', children: [{ tag: 'strong', children: ['⚠️ Users is service ko puri tarah se APNE RISK par use karte hain. Aap apne actions ke liye khud jimmedar hain.'] }] },
    { tag: 'li', children: ['🚫 Admin kisi bhi third-party service failures, number expiry, OTP delays, ya account issues ke liye LIABLE NAHI hai.'] },
    { tag: 'li', children: ['📜 Services ki reliability, accuracy, ya availability ke baare me koi warranties, guarantees, ya representations — express ya implied — nahi di jaati hain.'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['🔒 Is bot ka use karke, aap ye accept karte hain ki aap apni sabhi activities aur unke consequences ke liye KHUD jimmedar hain.'] }] },
    { tag: 'li', children: ['⚖️ Koi bhi legal dispute admin ke jurisdiction ke applicable laws ke andar resolve hoga.'] },
  ]});
  n.push({ tag: 'hr' });

  // 9. Changes to Terms
  n.push({ tag: 'h3', children: ['🔹 9. Changes to Terms 📝'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['📋 Admin ko in terms ko bina prior notice ke kabhi bhi update, modify, ya change karne ka pura adhikar hai.'] },
    { tag: 'li', children: ['✅ Changes ke baad bot ka continued use = updated terms ki automatic acceptance.'] },
    { tag: 'li', children: ['🔔 Updates ke liye regularly check karna user ki zimmedari hai.'] },
  ]});
  n.push({ tag: 'hr' });

  // Footer
  const today = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
  n.push({ tag: 'blockquote', children: [
    { tag: 'em', children: [
      `${botName} ka use karke, aap confirm karte hain ki aapne upar likhe sabhi terms aur conditions ko padh liya hai, samajh liya hai, aur agree karte hain. Aap is service ko apne risk par use karte hain. Last updated: ${today}`
    ]}
  ]});

  return n;
}

/**
 * Generate a default T&C page on Telegraph.
 * @param {object} pool - DB pool
 * @param {'en'|'hi'} language - Language version
 * @returns {string|null} - Telegraph URL
 */
export async function generateDefaultTcPage(pool, language = 'en') {
  try {
    const token = await getToken(pool);
    const customName = await settingsRepo.getSetting(pool, 'tc_telegraph_author');
    const botName = customName || await settingsRepo.getSetting(pool, 'bot_name') || 'OTPBOT';

    const isHi = language === 'hi';
    const content = isHi ? buildHinglishContent(botName) : buildEnglishContent(botName);
    const title = `⚡ ${botName} — Terms & Conditions${isHi ? ' (Hinglish)' : ''}`;

    const pathKey = isHi ? 'tc_telegraph_hi_path' : 'tc_telegraph_en_path';
    const urlKey = isHi ? 'tc_telegraph_hi_url' : 'tc_telegraph_en_url';

    const existingPath = await settingsRepo.getSetting(pool, pathKey);
    const contentStr = JSON.stringify(content);

    let page;
    if (existingPath) {
      const params = new URLSearchParams();
      params.append('access_token', token);
      params.append('title', title);
      params.append('content', contentStr);
      params.append('author_name', botName);
      const res = await fetch(`${API}/editPage/${existingPath}`, { method: 'POST', body: params });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'editPage failed');
      page = data.result;
    } else {
      const params = new URLSearchParams();
      params.append('access_token', token);
      params.append('title', title);
      params.append('content', contentStr);
      params.append('author_name', botName);
      const res = await fetch(`${API}/createPage`, { method: 'POST', body: params });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'createPage failed');
      page = data.result;
      await settingsRepo.setSetting(pool, pathKey, page.path);
    }

    const url = `https://telegra.ph/${page.path}`;
    await settingsRepo.setSetting(pool, urlKey, url);
    return url;
  } catch (err) {
    logger.error(`[TC Telegraph] Error generating ${language} page: ${err.message}`);
    return null;
  }
}
