import QRCode from 'qrcode';
import sharp from 'sharp';
import logger from '../utils/logger.js';

/**
 * Generate a premium branded QR payment image — LARGE format.
 * Designed to fill the full Telegram chat width like Loot Factory X.
 *
 * Canvas: 800 x ~1000px  →  QR: 600px
 */
export async function generateBrandedQR({
  storeName = 'OTP BOT',
  amount,
  currency = '₹',
  refId,
  upiLink,
  developer = '@Erroroo',
}) {
  try {
    // ── QR code — BIG (600px) ────────────────────────────────
    const qrSize = 600;
    const qrBuffer = await QRCode.toBuffer(upiLink, {
      width: qrSize,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' },
      errorCorrectionLevel: 'H',
    });

    // ── Canvas dimensions — LARGE ────────────────────────────
    const canvasW = 800;
    const headerH = 100;
    const qrCardPad = 24;
    const qrCardW = qrSize + qrCardPad * 2;
    const qrCardH = qrSize + qrCardPad * 2;
    const footerH = 240;
    const canvasH = headerH + qrCardH + footerH;
    const cx = canvasW / 2;
    const qrCardX = (canvasW - qrCardW) / 2;
    const qrCardY = headerH;
    const qrX = Math.floor(qrCardX + qrCardPad);
    const qrY = qrCardY + qrCardPad;

    // ── Escape XML ───────────────────────────────────────────
    const esc = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    // ── Footer Y positions ───────────────────────────────────
    const fBase = qrCardY + qrCardH + 32;

    const svg = `
<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Main background gradient -->
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f0c29"/>
      <stop offset="50%" stop-color="#1a1a3e"/>
      <stop offset="100%" stop-color="#0f0c29"/>
    </linearGradient>

    <!-- Title gradient (gold/amber) -->
    <linearGradient id="titleG" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#f7971e"/>
      <stop offset="100%" stop-color="#ffd200"/>
    </linearGradient>

    <!-- Top accent glow -->
    <radialGradient id="topGlow" cx="50%" cy="0%" r="60%" fx="50%" fy="0%">
      <stop offset="0%" stop-color="#6c5ce7" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#6c5ce7" stop-opacity="0"/>
    </radialGradient>

    <!-- Bottom accent glow -->
    <radialGradient id="botGlow" cx="50%" cy="100%" r="60%" fx="50%" fy="100%">
      <stop offset="0%" stop-color="#00cec9" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#00cec9" stop-opacity="0"/>
    </radialGradient>

    <!-- QR card glow -->
    <filter id="cardGlow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="0" stdDeviation="16" flood-color="#6c5ce7" flood-opacity="0.35"/>
    </filter>

    <!-- Amount glow -->
    <filter id="amtGlow" x="-20%" y="-30%" width="140%" height="160%">
      <feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="#ffd200" flood-opacity="0.4"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="100%" height="100%" fill="url(#bg)" rx="24"/>

  <!-- Top ambient glow -->
  <rect width="100%" height="${canvasH / 2}" fill="url(#topGlow)"/>

  <!-- Bottom ambient glow -->
  <rect y="${canvasH / 2}" width="100%" height="${canvasH / 2}" fill="url(#botGlow)"/>

  <!-- Subtle border -->
  <rect width="${canvasW}" height="${canvasH}" fill="none" stroke="#2d2d5e" stroke-width="1.5" rx="24"/>

  <!-- Top decorative line -->
  <rect x="${cx - 50}" y="14" width="100" height="3" fill="#6c5ce7" rx="1.5" opacity="0.7"/>

  <!-- Store name (gold gradient, bold, large) -->
  <text x="${cx}" y="66" text-anchor="middle"
        font-family="'Segoe UI', Arial, Helvetica, sans-serif" font-size="34" font-weight="bold"
        fill="url(#titleG)" letter-spacing="3">${esc(storeName)}</text>

  <!-- Thin separator under title -->
  <line x1="${cx - 60}" y1="82" x2="${cx + 60}" y2="82"
        stroke="#6c5ce7" stroke-width="1.5" opacity="0.4"/>

  <!-- QR white card with glow -->
  <rect x="${qrCardX}" y="${qrCardY}"
        width="${qrCardW}" height="${qrCardH}"
        fill="#ffffff" rx="16" filter="url(#cardGlow)"/>

  <!-- Inner border on QR card -->
  <rect x="${qrCardX + 3}" y="${qrCardY + 3}"
        width="${qrCardW - 6}" height="${qrCardH - 6}"
        fill="none" stroke="#eeeeee" stroke-width="1" rx="14"/>

  <!-- Amount (large, glowing) -->
  <text x="${cx}" y="${fBase + 8}"
        text-anchor="middle" font-family="'Segoe UI', Arial, Helvetica, sans-serif"
        font-size="36" font-weight="bold" fill="#ffffff" filter="url(#amtGlow)">
    ${esc(currency)}${esc(String(amount))}
  </text>

  <!-- Separator -->
  <line x1="${cx - 80}" y1="${fBase + 30}" x2="${cx + 80}" y2="${fBase + 30}"
        stroke="#2d2d5e" stroke-width="1.5"/>

  <!-- Ref ID -->
  <text x="${cx}" y="${fBase + 60}"
        text-anchor="middle" font-family="'Segoe UI', Arial, Helvetica, sans-serif"
        font-size="16" fill="#6c6c9a">
    Ref: ${esc(refId)}
  </text>

  <!-- Scan instruction (teal/green accent) -->
  <text x="${cx}" y="${fBase + 104}"
        text-anchor="middle" font-family="'Segoe UI', Arial, Helvetica, sans-serif"
        font-size="20" font-weight="bold" fill="#00cec9">
    Scan with any UPI app
  </text>

  <!-- Bottom separator -->
  <line x1="${cx - 120}" y1="${fBase + 130}" x2="${cx + 120}" y2="${fBase + 130}"
        stroke="#1e1e3e" stroke-width="1"/>

  <!-- Developer credit -->
  <text x="${cx}" y="${fBase + 158}"
        text-anchor="middle" font-family="'Segoe UI', Arial, Helvetica, sans-serif"
        font-size="15" fill="#4a4a7a">
    Developer: ${esc(developer)}
  </text>

  <!-- Bottom decorative line -->
  <rect x="${cx - 40}" y="${canvasH - 14}" width="80" height="3" fill="#00cec9" rx="1.5" opacity="0.5"/>
</svg>`;

    // ── Render SVG → PNG ─────────────────────────────────────
    const bgBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

    // ── Composite QR onto branded background ─────────────────
    const finalImage = await sharp(bgBuffer)
      .composite([{
        input: qrBuffer,
        top: qrY,
        left: qrX,
      }])
      .png()
      .toBuffer();

    return finalImage;
  } catch (err) {
    logger.error(`QR image generation failed: ${err.message}`);
    throw err;
  }
}
