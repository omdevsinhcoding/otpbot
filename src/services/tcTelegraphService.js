/**
 * T&C Telegraph Service — Professional Terms & Conditions Pages
 *
 * Enterprise-grade legal terms (Microsoft / Twitter / Stripe level).
 * Key: Admin never liable. Users at own risk. All OTP use is user's responsibility.
 * ALWAYS creates new page (editPage unreliable).
 */
import logger from '../utils/logger.js';
import * as settingsRepo from '../database/repositories/settingsRepo.js';

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

// ── English T&C (Enterprise-Grade) ──────────────────────────────

function buildEnglishContent(botName) {
  const n = [];
  const today = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

  // Header
  n.push({ tag: 'p', children: [
    { tag: 'strong', children: [`TERMS OF SERVICE — ${botName.toUpperCase()}`] }
  ]});
  n.push({ tag: 'p', children: [
    { tag: 'em', children: [`Effective Date: ${today} | Last Revised: ${today}`] }
  ]});
  n.push({ tag: 'p', children: [
    `PLEASE READ THESE TERMS OF SERVICE ("TERMS") CAREFULLY. BY ACCESSING OR USING ${botName.toUpperCase()} (THE "SERVICE"), YOU ACKNOWLEDGE THAT YOU HAVE READ, UNDERSTOOD, AND AGREE TO BE BOUND BY THESE TERMS. IF YOU DO NOT AGREE, DO NOT USE THIS SERVICE.`
  ]});
  n.push({ tag: 'hr' });

  // §1 Definitions
  n.push({ tag: 'h4', children: ['§1. DEFINITIONS & SCOPE OF SERVICE'] });
  n.push({ tag: 'p', children: [`${botName} ("the Bot", "the Service", "we", "us") is an automated Telegram-based platform that provides the following digital services:`] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['Virtual/temporary phone numbers for one-time password (OTP) verification'] },
    { tag: 'li', children: ['Temporary email (TempMail) addresses for email-based OTP verification'] },
    { tag: 'li', children: ['Pre-configured (readymade) digital accounts'] },
    { tag: 'li', children: ['Reseller access and API integration services'] },
    { tag: 'li', children: ['Digital wallet system with deposit, balance management, and transfer capabilities'] },
    { tag: 'li', children: ['Promotional codes and referral reward programs'] },
  ]});
  n.push({ tag: 'p', children: [
    '"User", "you", "your" refers to any individual, entity, or automated system accessing or interacting with the Service through any means.'
  ]});
  n.push({ tag: 'hr' });

  // §2 Eligibility
  n.push({ tag: 'h4', children: ['§2. ELIGIBILITY & ACCEPTANCE'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['You must be at least 18 years of age or the legal age of majority in your jurisdiction to use this Service.'] },
    { tag: 'li', children: ['By using the Service, you represent and warrant that you have the legal capacity to enter into a binding agreement.'] },
    { tag: 'li', children: ['Your continued use of the Service after any modification to these Terms constitutes your binding acceptance of such modifications.'] },
    { tag: 'li', children: ['One natural person or entity may maintain only ONE (1) account. Creation of multiple accounts is a violation and grounds for immediate termination.'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['You explicitly acknowledge that the Service is provided for legitimate verification purposes ONLY. Any use for illegal, fraudulent, or malicious purposes is STRICTLY PROHIBITED.'] }] },
  ]});
  n.push({ tag: 'hr' });

  // §3 Nature of Service
  n.push({ tag: 'h4', children: ['§3. NATURE OF SERVICE & NO GUARANTEE'] });
  n.push({ tag: 'p', children: [{ tag: 'strong', children: ['IMPORTANT DISCLOSURE:'] }] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['The Service acts solely as an intermediary platform connecting users with third-party virtual number and email providers. We do NOT own, operate, or control any telecommunications infrastructure.'] },
    { tag: 'li', children: ['Virtual numbers are TEMPORARY and may expire, become unavailable, or be recycled at any time without prior notice.'] },
    { tag: 'li', children: ['OTP delivery depends entirely on third-party services (SMS gateways, carrier networks, target platforms). We do NOT guarantee OTP delivery, delivery speed, or successful verification.'] },
    { tag: 'li', children: ['TempMail addresses are disposable. Emails received may be deleted or become inaccessible at any time.'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['THE SERVICE IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS WITHOUT ANY WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.'] }] },
  ]});
  n.push({ tag: 'hr' });

  // §4 Financial Terms
  n.push({ tag: 'h4', children: ['§4. FINANCIAL TERMS, DEPOSITS & REFUND POLICY'] });
  n.push({ tag: 'p', children: [{ tag: 'strong', children: ['4.1 Deposits & Wallet'] }] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['All deposits are FINAL and NON-REFUNDABLE. Once funds are credited to your wallet, they cannot be withdrawn, reversed, or converted back to fiat currency.'] },
    { tag: 'li', children: ['Deposits made through unofficial channels, wrong payment addresses, or incorrect UTR/transaction IDs will NOT be credited or refunded.'] },
    { tag: 'li', children: ['Tax deductions, bonus credits, and loyalty rewards are applied automatically and may change without prior notice.'] },
    { tag: 'li', children: ['Cryptocurrency deposits are subject to network confirmations and exchange rate fluctuations.'] },
  ]});
  n.push({ tag: 'p', children: [{ tag: 'strong', children: ['4.2 Purchases & Refunds'] }] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: [{ tag: 'strong', children: ['ALL PURCHASES ARE FINAL. No refunds, chargebacks, payment reversals, or credit disputes will be entertained under ANY circumstances.'] }] },
    { tag: 'li', children: ['Once an OTP has been delivered, the transaction is COMPLETE regardless of whether the OTP was successfully used on the target platform.'] },
    { tag: 'li', children: ['Once a TempMail OTP or email has been received, the transaction is FINAL.'] },
    { tag: 'li', children: ['Readymade accounts are sold "as is" with NO warranty. Buyer assumes ALL risk.'] },
    { tag: 'li', children: ['Service credits, promotional bonuses, and referral rewards have no cash value and cannot be redeemed for real currency.'] },
  ]});
  n.push({ tag: 'p', children: [{ tag: 'strong', children: ['4.3 Balance Transfers'] }] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['Peer-to-peer balance transfers are the sole responsibility of the sending user.'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['The Service administrator is NOT responsible for transfers sent to incorrect users. ALL transfers are IRREVERSIBLE.'] }] },
  ]});
  n.push({ tag: 'p', children: [{ tag: 'strong', children: ['4.4 Payment Disputes'] }] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['Disputes must be raised within twenty-four (24) hours with valid evidence (screenshot, transaction ID, bank statement).'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['Initiating chargebacks or payment reversals without contacting support will result in IMMEDIATE PERMANENT account termination with forfeiture of ALL remaining balance.'] }] },
  ]});
  n.push({ tag: 'hr' });

  // §5 Prohibited Activities
  n.push({ tag: 'h4', children: ['§5. PROHIBITED ACTIVITIES & ACCEPTABLE USE'] });
  n.push({ tag: 'p', children: ['You agree NOT to use the Service for any of the following:'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: [{ tag: 'strong', children: ['Any illegal, unlawful, or criminal activity under any applicable jurisdiction'] }] },
    { tag: 'li', children: ['Fraud, identity theft, impersonation, phishing, social engineering, or financial crimes'] },
    { tag: 'li', children: ['Creating accounts on platforms in violation of their Terms of Service'] },
    { tag: 'li', children: ['Harassment, stalking, bullying, threats, or intimidation'] },
    { tag: 'li', children: ['Distribution of malware, spyware, ransomware, or malicious software'] },
    { tag: 'li', children: ['Spamming, mass messaging, unsolicited commercial communications'] },
    { tag: 'li', children: ['Circumventing security measures, exploiting bugs, vulnerabilities, or payment system flaws'] },
    { tag: 'li', children: ['Money laundering, terrorist financing, sanctions evasion, or AML violations'] },
    { tag: 'li', children: ['Child exploitation or abuse material (CSAM)'] },
    { tag: 'li', children: ['Reverse engineering, decompiling, or extracting source code of the Service'] },
    { tag: 'li', children: ['Automated scraping, data mining, or systematic data extraction'] },
    { tag: 'li', children: ['Reselling or redistributing the Service without explicit authorization'] },
  ]});
  n.push({ tag: 'p', children: [{ tag: 'strong', children: ['Violation will result in IMMEDIATE account termination, forfeiture of ALL balance, and may be reported to law enforcement authorities.'] }] });
  n.push({ tag: 'hr' });

  // §6 User Responsibility (CRITICAL)
  n.push({ tag: 'h4', children: ['§6. USER RESPONSIBILITY & ASSUMPTION OF RISK'] });
  n.push({ tag: 'blockquote', children: [
    { tag: 'strong', children: ['⚠️ CRITICAL — READ THIS SECTION CAREFULLY:'] }
  ]});
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: [{ tag: 'strong', children: ['YOU USE THIS SERVICE ENTIRELY AT YOUR OWN RISK. You are solely and exclusively responsible for ALL activities conducted through your account and ALL consequences arising therefrom.'] }] },
    { tag: 'li', children: [{ tag: 'strong', children: ['The Service administrator, owner, operator, and any associated individuals or entities ("the Provider") shall NOT be held responsible, liable, or accountable for ANY actions taken by users, including but not limited to illegal activities, fraud, misuse, or any unlawful conduct.'] }] },
    { tag: 'li', children: ['You understand that virtual numbers may have been previously used by others and may be reused in the future.'] },
    { tag: 'li', children: ['You are responsible for ensuring your use complies with ALL applicable laws and regulations in your jurisdiction.'] },
    { tag: 'li', children: ['The Provider has NO control over, NO knowledge of, and NO responsibility for how you use the numbers, emails, accounts, or resources obtained through this Service.'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['The Provider does NOT endorse, encourage, facilitate, or condone ANY illegal activity. The Service is designed ONLY for legitimate verification and testing purposes.'] }] },
  ]});
  n.push({ tag: 'hr' });

  // §7 Limitation of Liability
  n.push({ tag: 'h4', children: ['§7. LIMITATION OF LIABILITY & DISCLAIMER'] });
  n.push({ tag: 'blockquote', children: [
    { tag: 'strong', children: ['⚖️ LEGAL DISCLAIMER — BINDING AGREEMENT:'] }
  ]});
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: [{ tag: 'strong', children: [`TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, ${botName.toUpperCase()}, ITS OWNER, ADMINISTRATOR, OPERATORS, AFFILIATES, EMPLOYEES, AGENTS, AND SERVICE PROVIDERS SHALL NOT BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, PUNITIVE, OR EXEMPLARY DAMAGES, INCLUDING BUT NOT LIMITED TO DAMAGES FOR LOSS OF PROFITS, REVENUE, DATA, GOODWILL, OR OTHER INTANGIBLE LOSSES.`] }] },
    { tag: 'li', children: [{ tag: 'strong', children: ['THE PROVIDER SHALL NOT BE LIABLE FOR: (a) unauthorized access to or alteration of your data; (b) third-party conduct or content; (c) loss or damage from use or inability to use the Service; (d) OTP delivery failures, delays, or interceptions; (e) account suspensions or restrictions on third-party platforms resulting from virtual numbers obtained through this Service.'] }] },
    { tag: 'li', children: [{ tag: 'strong', children: ['THE PROVIDER IS NOT A PARTY TO ANY TRANSACTION OR INTERACTION BETWEEN YOU AND ANY THIRD-PARTY PLATFORM OR INDIVIDUAL.'] }] },
    { tag: 'li', children: [{ tag: 'strong', children: ['IN NO EVENT SHALL TOTAL LIABILITY EXCEED THE AMOUNT PAID BY YOU IN THE THIRTY (30) DAYS PRECEDING THE CLAIM, OR TEN US DOLLARS ($10.00), WHICHEVER IS LESS.'] }] },
    { tag: 'li', children: ['These limitations apply regardless of legal theory — contract, tort, strict liability, warranty, or otherwise.'] },
  ]});
  n.push({ tag: 'hr' });

  // §8 Indemnification
  n.push({ tag: 'h4', children: ['§8. INDEMNIFICATION'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: [{ tag: 'strong', children: ['You agree to INDEMNIFY, DEFEND, and HOLD HARMLESS the Provider from and against any claims, demands, damages, losses, liabilities, costs, and expenses (including attorneys\' fees) arising from: (a) your use of the Service; (b) violation of these Terms; (c) violation of any law; (d) violation of third-party rights; (e) any content or data you submit.'] }] },
    { tag: 'li', children: ['This indemnification obligation survives termination of your account and these Terms.'] },
  ]});
  n.push({ tag: 'hr' });

  // §9 Account
  n.push({ tag: 'h4', children: ['§9. ACCOUNT SECURITY & TERMINATION'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['You are solely responsible for maintaining the security of your Telegram account.'] },
    { tag: 'li', children: ['The Provider reserves the right to suspend or terminate ANY account at any time, for any reason, with or without notice.'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['Upon termination, ALL remaining balance is FORFEITED. No refund or compensation will be provided.'] }] },
    { tag: 'li', children: ['The Provider may cooperate with law enforcement and comply with legal requests, subpoenas, or court orders regarding user information.'] },
  ]});
  n.push({ tag: 'hr' });

  // §10 Privacy
  n.push({ tag: 'h4', children: ['§10. PRIVACY & DATA HANDLING'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['The Service collects minimal operational data: Telegram user ID, username, display name, wallet balance, transaction history, and usage logs.'] },
    { tag: 'li', children: ['Data is used exclusively for operations, fraud prevention, dispute resolution, and compliance.'] },
    { tag: 'li', children: ['Data is NOT sold or shared with third parties except when required by law enforcement.'] },
    { tag: 'li', children: ['The Service does NOT store OTPs, SMS messages, or emails received on virtual numbers or TempMail addresses.'] },
    { tag: 'li', children: ['Transaction logs may be retained for compliance and audit purposes.'] },
  ]});
  n.push({ tag: 'hr' });

  // §11 IP
  n.push({ tag: 'h4', children: ['§11. INTELLECTUAL PROPERTY'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: [`All content, branding, source code, and materials associated with ${botName} are the intellectual property of the Provider.`] },
    { tag: 'li', children: ['You may not copy, reproduce, distribute, modify, reverse engineer, or exploit any part of the Service without written consent.'] },
  ]});
  n.push({ tag: 'hr' });

  // §12 Service Changes
  n.push({ tag: 'h4', children: ['§12. SERVICE MODIFICATIONS & AVAILABILITY'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['The Provider may modify, suspend, or discontinue any part of the Service at any time without notice.'] },
    { tag: 'li', children: ['Prices and fees are subject to change without notice.'] },
    { tag: 'li', children: ['Maintenance or technical issues may cause service interruptions. These are NOT grounds for refund.'] },
  ]});
  n.push({ tag: 'hr' });

  // §13 Governing Law
  n.push({ tag: 'h4', children: ['§13. GOVERNING LAW & DISPUTE RESOLUTION'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['These Terms are governed by the laws of the jurisdiction in which the Provider operates.'] },
    { tag: 'li', children: ['Disputes shall first be resolved through informal negotiation, then binding arbitration.'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['YOU WAIVE ANY RIGHT TO PARTICIPATE IN A CLASS ACTION LAWSUIT OR CLASS-WIDE ARBITRATION.'] }] },
  ]});
  n.push({ tag: 'hr' });

  // §14 Severability
  n.push({ tag: 'h4', children: ['§14. SEVERABILITY & ENTIRE AGREEMENT'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['If any provision is found invalid, the remaining provisions continue in full force.'] },
    { tag: 'li', children: ['These Terms constitute the entire agreement and supersede all prior agreements.'] },
    { tag: 'li', children: ['Failure to enforce any provision does not constitute a waiver.'] },
  ]});
  n.push({ tag: 'hr' });

  // §15 Amendments
  n.push({ tag: 'h4', children: ['§15. AMENDMENTS & UPDATES'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['The Provider may update these Terms at any time without prior notice.'] },
    { tag: 'li', children: ['Changes are indicated by updating the "Last Revised" date.'] },
    { tag: 'li', children: ['Continued use after changes = acceptance of revised Terms.'] },
    { tag: 'li', children: ['It is YOUR responsibility to review these Terms periodically.'] },
  ]});
  n.push({ tag: 'hr' });

  // Final
  n.push({ tag: 'blockquote', children: [
    { tag: 'strong', children: ['ACKNOWLEDGMENT & AGREEMENT'] }
  ]});
  n.push({ tag: 'p', children: [
    { tag: 'strong', children: [
      `BY USING ${botName.toUpperCase()}, YOU ACKNOWLEDGE THAT: (1) You have read and understood ALL the above terms; (2) You agree to be legally bound by these Terms; (3) You use this Service entirely at YOUR OWN RISK; (4) The Provider is NOT responsible for your actions or their consequences; (5) You will comply with all applicable laws; (6) All purchases and deposits are FINAL and NON-REFUNDABLE.`
    ]}
  ]});
  n.push({ tag: 'p', children: [
    { tag: 'em', children: [`© ${new Date().getFullYear()} ${botName}. All Rights Reserved. Last updated: ${today}.`] }
  ]});

  return n;
}

// ── Hinglish T&C (Enterprise-Grade) ─────────────────────────────

function buildHinglishContent(botName) {
  const n = [];
  const today = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

  n.push({ tag: 'p', children: [
    { tag: 'strong', children: [`TERMS OF SERVICE — ${botName.toUpperCase()}`] }
  ]});
  n.push({ tag: 'p', children: [
    { tag: 'em', children: [`Effective Date: ${today} | Last Revised: ${today}`] }
  ]});
  n.push({ tag: 'p', children: [
    `${botName.toUpperCase()} ("SERVICE") KA USE KARNE SE PEHLE YE TERMS DHYAN SE PADHE. SERVICE USE KARNE KA MATLAB HAI KI AAP IN SABHI TERMS KO ACCEPT KARTE HAIN. AGAR AGREE NAHI HAIN TO SERVICE USE NA KARE.`
  ]});
  n.push({ tag: 'hr' });

  // §1
  n.push({ tag: 'h4', children: ['§1. SERVICE KA SCOPE'] });
  n.push({ tag: 'p', children: [`${botName} ek Telegram-based automated platform hai jo ye digital services provide karta hai:`] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['Virtual/temporary phone numbers (OTP verification ke liye)'] },
    { tag: 'li', children: ['Temporary email (TempMail) addresses (email OTP ke liye)'] },
    { tag: 'li', children: ['Readymade digital accounts'] },
    { tag: 'li', children: ['Reseller access aur API integration'] },
    { tag: 'li', children: ['Digital wallet system — deposit, balance, transfer'] },
    { tag: 'li', children: ['Promo codes aur referral reward programs'] },
  ]});
  n.push({ tag: 'hr' });

  // §2
  n.push({ tag: 'h4', children: ['§2. ELIGIBILITY'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['Aapki age kam se kam 18 saal honi chahiye.'] },
    { tag: 'li', children: ['Ek user = ek account. Multiple accounts = permanent ban bina refund ke.'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['Service SIRF legitimate verification purposes ke liye hai. Illegal use STRICTLY PROHIBITED hai.'] }] },
  ]});
  n.push({ tag: 'hr' });

  // §3
  n.push({ tag: 'h4', children: ['§3. SERVICE KI NATURE & GUARANTEE'] });
  n.push({ tag: 'p', children: [{ tag: 'strong', children: ['ZAROORI DISCLOSURE:'] }] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['Hum sirf ek intermediary platform hain. Virtual numbers third-party providers se aate hain. Hum koi telecom infrastructure own ya operate NAHI karte.'] },
    { tag: 'li', children: ['Virtual numbers TEMPORARY hain — kabhi bhi expire, unavailable, ya recycle ho sakte hain BINA notice ke.'] },
    { tag: 'li', children: ['OTP delivery third-party services par depend karti hai. Hum delivery, speed, ya verification ki KOI GUARANTEE NAHI dete.'] },
    { tag: 'li', children: ['TempMail addresses disposable hain. Emails kabhi bhi delete ya inaccessible ho sakti hain.'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['SERVICE "AS IS" AUR "AS AVAILABLE" BASIS PAR HAI, BINA KISI WARRANTY KE.'] }] },
  ]});
  n.push({ tag: 'hr' });

  // §4
  n.push({ tag: 'h4', children: ['§4. FINANCIAL TERMS & REFUND POLICY'] });
  n.push({ tag: 'p', children: [{ tag: 'strong', children: ['4.1 Deposits'] }] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: [{ tag: 'strong', children: ['SABHI DEPOSITS FINAL AUR NON-REFUNDABLE HAIN. Wallet me credit hone ke baad wapas nahi milega.'] }] },
    { tag: 'li', children: ['Unofficial channels, galat address, ya galat UTR se ki gayi deposits credit ya refund NAHI hongi.'] },
    { tag: 'li', children: ['Tax, bonus, aur loyalty rewards automatically apply hote hain aur bina notice ke change ho sakte hain.'] },
  ]});
  n.push({ tag: 'p', children: [{ tag: 'strong', children: ['4.2 Purchases'] }] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: [{ tag: 'strong', children: ['SABHI PURCHASES FINAL HAIN. Koi refund, chargeback, ya payment reversal accept nahi hoga.'] }] },
    { tag: 'li', children: ['OTP deliver hone ke baad transaction COMPLETE hai — chahe target platform par use hua ho ya nahi.'] },
    { tag: 'li', children: ['Readymade accounts "as is" bechte hain — koi warranty nahi. Buyer ka risk.'] },
  ]});
  n.push({ tag: 'p', children: [{ tag: 'strong', children: ['4.3 Balance Transfer'] }] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: [{ tag: 'strong', children: ['Galat user ko bheja gaya balance WAPAS NAHI AAYEGA. Transfer se pehle verify karo. Admin RESPONSIBLE NAHI hai.'] }] },
  ]});
  n.push({ tag: 'p', children: [{ tag: 'strong', children: ['4.4 Payment Disputes'] }] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['Disputes 24 ghante ke andar valid proof ke saath raise kare.'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['Support se contact kiye bina chargeback = IMMEDIATE PERMANENT BAN + balance forfeiture.'] }] },
  ]});
  n.push({ tag: 'hr' });

  // §5
  n.push({ tag: 'h4', children: ['§5. PROHIBITED ACTIVITIES'] });
  n.push({ tag: 'p', children: ['Aap Service ka use IN CHEEZON ke liye NAHI kar sakte:'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: [{ tag: 'strong', children: ['Koi bhi illegal, unlawful, ya criminal activity'] }] },
    { tag: 'li', children: ['Fraud, identity theft, phishing, social engineering, financial crimes'] },
    { tag: 'li', children: ['Kisi platform ke Terms of Service ka violation'] },
    { tag: 'li', children: ['Harassment, stalking, threats, intimidation'] },
    { tag: 'li', children: ['Malware, spyware, ransomware distribution'] },
    { tag: 'li', children: ['Spamming, mass messaging, automated abuse'] },
    { tag: 'li', children: ['Security bypass, bug exploit, payment system flaws ka misuse'] },
    { tag: 'li', children: ['Money laundering, terrorist financing, sanctions evasion'] },
    { tag: 'li', children: ['Reverse engineering ya source code extract karna'] },
  ]});
  n.push({ tag: 'p', children: [{ tag: 'strong', children: ['VIOLATION = IMMEDIATE BAN + BALANCE FORFEITURE + law enforcement reporting.'] }] });
  n.push({ tag: 'hr' });

  // §6
  n.push({ tag: 'h4', children: ['§6. USER RESPONSIBILITY & RISK'] });
  n.push({ tag: 'blockquote', children: [
    { tag: 'strong', children: ['⚠️ SABSE ZAROORI — DHYAN SE PADHO:'] }
  ]});
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: [{ tag: 'strong', children: ['AAP IS SERVICE KO PURI TARAH SE APNE RISK PAR USE KARTE HAIN. Aap apne account ki SABHI activities aur unke consequences ke liye AKELE ZIMMEDAR HAIN.'] }] },
    { tag: 'li', children: [{ tag: 'strong', children: ['Service ka administrator, owner, operator, aur koi bhi associated person ("Provider") users ke KISI BHI action ke liye RESPONSIBLE, LIABLE, YA ACCOUNTABLE NAHI HAI — chahe illegal ho, fraud ho, misuse ho, ya koi bhi unlawful conduct ho.'] }] },
    { tag: 'li', children: [{ tag: 'strong', children: ['Provider ko users ke actions par KOI CONTROL NAHI hai, KOI KNOWLEDGE NAHI hai, aur KOI RESPONSIBILITY NAHI hai.'] }] },
    { tag: 'li', children: [{ tag: 'strong', children: ['Provider kisi bhi illegal activity ko ENDORSE, ENCOURAGE, FACILITATE, ya CONDONE NAHI karta. Service SIRF legitimate verification ke liye designed hai.'] }] },
    { tag: 'li', children: [{ tag: 'strong', children: ['Agar aap service ka galat use karte hain to iske liye SIRF AAP zimmedar hain. Provider par koi bhi legal action, arrest, ya penalty APPLICABLE NAHI hai kyunki Provider ne koi illegal service provide NAHI ki hai.'] }] },
  ]});
  n.push({ tag: 'hr' });

  // §7
  n.push({ tag: 'h4', children: ['§7. LIABILITY LIMITATION'] });
  n.push({ tag: 'blockquote', children: [
    { tag: 'strong', children: ['⚖️ LEGAL DISCLAIMER — BINDING AGREEMENT:'] }
  ]});
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: [{ tag: 'strong', children: [`APPLICABLE LAW KE MAXIMUM EXTENT TAK, ${botName.toUpperCase()}, USKA OWNER, ADMINISTRATOR, OPERATORS, AFFILIATES, AUR SERVICE PROVIDERS KISI BHI DIRECT, INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, PUNITIVE, YA EXEMPLARY DAMAGES KE LIYE LIABLE NAHI HONGE.`] }] },
    { tag: 'li', children: [{ tag: 'strong', children: ['PROVIDER LIABLE NAHI HAI: (a) unauthorized access ya data alteration; (b) third-party conduct; (c) Service use se hone wale loss; (d) OTP delivery failures ya delays; (e) third-party platforms par account bans ya restrictions.'] }] },
    { tag: 'li', children: [{ tag: 'strong', children: ['KISI BHI CASE ME PROVIDER KI TOTAL LIABILITY LAST 30 DAYS KE PAID AMOUNT SE ZYADA NAHI HOGI, YA $10.00, JO BHI KAM HO.'] }] },
  ]});
  n.push({ tag: 'hr' });

  // §8
  n.push({ tag: 'h4', children: ['§8. INDEMNIFICATION'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: [{ tag: 'strong', children: ['Aap Provider ko INDEMNIFY, DEFEND, aur HOLD HARMLESS rakhne ke liye agree karte hain — sabhi claims, damages, losses, aur expenses se — jo aapke Service use, Terms violation, ya law violation se arise ho.'] }] },
  ]});
  n.push({ tag: 'hr' });

  // §9
  n.push({ tag: 'h4', children: ['§9. ACCOUNT & TERMINATION'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['Apne Telegram account ki security AAPKI zimmedari hai.'] },
    { tag: 'li', children: ['Provider KISI BHI account ko, KABHI BHI, KISI BHI reason se, BINA notice ke terminate kar sakta hai.'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['Termination par SAARA balance FORFEIT ho jayega. Koi refund ya compensation nahi.'] }] },
    { tag: 'li', children: ['Provider law enforcement ke saath cooperate kar sakta hai aur legal requests comply kar sakta hai.'] },
  ]});
  n.push({ tag: 'hr' });

  // §10
  n.push({ tag: 'h4', children: ['§10. PRIVACY & DATA'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['Minimal data store hota hai: Telegram ID, username, balance, transaction history.'] },
    { tag: 'li', children: ['Data sirf operations, fraud prevention, aur compliance ke liye.'] },
    { tag: 'li', children: ['OTPs, SMS, ya emails ka content STORE NAHI hota.'] },
    { tag: 'li', children: ['Data third parties ko share NAHI hota (law enforcement ke alawa).'] },
  ]});
  n.push({ tag: 'hr' });

  // §11
  n.push({ tag: 'h4', children: ['§11. GOVERNING LAW'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['Ye Terms Provider ke jurisdiction ke applicable laws ke under governed honge.'] },
    { tag: 'li', children: [{ tag: 'strong', children: ['AAP CLASS ACTION LAWSUIT YA CLASS-WIDE ARBITRATION KA RIGHT WAIVE KARTE HAIN.'] }] },
  ]});
  n.push({ tag: 'hr' });

  // §12
  n.push({ tag: 'h4', children: ['§12. AMENDMENTS'] });
  n.push({ tag: 'ul', children: [
    { tag: 'li', children: ['Provider in Terms ko kabhi bhi bina notice ke update kar sakta hai.'] },
    { tag: 'li', children: ['Changes ke baad Service ka use = updated Terms ki acceptance.'] },
    { tag: 'li', children: ['Regularly check karna AAPKI zimmedari hai.'] },
  ]});
  n.push({ tag: 'hr' });

  // Final
  n.push({ tag: 'blockquote', children: [
    { tag: 'strong', children: ['ACKNOWLEDGMENT'] }
  ]});
  n.push({ tag: 'p', children: [
    { tag: 'strong', children: [
      `${botName.toUpperCase()} USE KARKE AAP CONFIRM KARTE HAIN KI: (1) Sabhi terms padh aur samajh liye hain; (2) In Terms se legally bound hain; (3) Service APNE RISK par use karte hain; (4) Provider aapke actions ke liye RESPONSIBLE NAHI hai; (5) Sabhi applicable laws follow karenge; (6) SABHI purchases aur deposits FINAL aur NON-REFUNDABLE hain.`
    ]}
  ]});
  n.push({ tag: 'p', children: [
    { tag: 'em', children: [`© ${new Date().getFullYear()} ${botName}. All Rights Reserved. Last updated: ${today}.`] }
  ]});

  return n;
}

// ── Public: Generate T&C Page (always new) ───────────────────────

export async function generateDefaultTcPage(pool, language = 'en') {
  try {
    let token = await getOrCreateToken(pool);
    const customName = await settingsRepo.getSetting(pool, 'tc_telegraph_author');
    const botName = customName || await settingsRepo.getSetting(pool, 'bot_name') || 'OTPBOT';

    const isHi = language === 'hi';
    const content = isHi ? buildHinglishContent(botName) : buildEnglishContent(botName);
    const title = `⚡ ${botName} — Terms & Conditions${isHi ? ' (Hinglish)' : ''}`;

    const urlKey = isHi ? 'tc_telegraph_hi_url' : 'tc_telegraph_en_url';
    const pathKey = isHi ? 'tc_telegraph_hi_path' : 'tc_telegraph_en_path';
    const contentStr = JSON.stringify(content);

    // Always create new page (editPage is unreliable)
    const params = new URLSearchParams();
    params.append('access_token', token);
    params.append('title', title);
    params.append('content', contentStr);
    params.append('author_name', botName);

    const res = await fetch(`${API}/createPage`, { method: 'POST', body: params });
    const data = await res.json();

    if (!data.ok) {
      // Token might be invalid, create fresh account and retry
      await settingsRepo.setSetting(pool, 'telegraph_token', '');
      token = await getOrCreateToken(pool);

      const retryParams = new URLSearchParams();
      retryParams.append('access_token', token);
      retryParams.append('title', title);
      retryParams.append('content', contentStr);
      retryParams.append('author_name', botName);

      const retryRes = await fetch(`${API}/createPage`, { method: 'POST', body: retryParams });
      const retryData = await retryRes.json();
      if (!retryData.ok) throw new Error(retryData.error || 'createPage retry failed');

      const url = `https://telegra.ph/${retryData.result.path}`;
      await settingsRepo.setSetting(pool, pathKey, retryData.result.path);
      await settingsRepo.setSetting(pool, urlKey, url);
      return url;
    }

    const url = `https://telegra.ph/${data.result.path}`;
    await settingsRepo.setSetting(pool, pathKey, data.result.path);
    await settingsRepo.setSetting(pool, urlKey, url);
    return url;
  } catch (err) {
    logger.error(`[TC Telegraph] Error generating ${language} page: ${err.message}`);
    return null;
  }
}

// ── Public: Force Reset ──────────────────────────────────────────

export async function resetTcTelegraph(pool, language = 'en') {
  const isHi = language === 'hi';
  await settingsRepo.setSetting(pool, isHi ? 'tc_telegraph_hi_path' : 'tc_telegraph_en_path', '');
  await settingsRepo.setSetting(pool, isHi ? 'tc_telegraph_hi_url' : 'tc_telegraph_en_url', '');
  await settingsRepo.setSetting(pool, 'telegraph_token', '');
  return await generateDefaultTcPage(pool, language);
}
