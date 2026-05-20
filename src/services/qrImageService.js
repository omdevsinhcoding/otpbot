import QRCode from 'qrcode';
import sharp from 'sharp';
import logger from '../utils/logger.js';

/**
 * Generate a premium branded QR payment image.
 *
 * NEW DESIGN — Clean, minimal, fintech-grade.
 * Inspired by: PhonePe/GPay payment screens.
 *
 * Layout (800 x 1020):
 *   ┌──────────────────────────────────────────┐
 *   │          ✦  STORE NAME  ✦               │  white bold on dark
 *   │                                          │
 *   │   ┌──────────────────────────────────┐   │
 *   │   │                                  │   │
 *   │   │          ▓▓ QR CODE ▓▓           │   │  white card, 600px QR
 *   │   │                                  │   │
 *   │   └──────────────────────────────────┘   │
 *   │                                          │
 *   │            ₹ 1 2 . 0 0                  │  big white
 *   │           ━━━━━━━━━━━━                   │
 *   │          Ref: TXN_xxxxx                  │
 *   │                                          │
 *   │        Scan with any UPI app             │  accent color
 *   │         Developer: @Erroroo              │
 *   └──────────────────────────────────────────┘
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
    // ── QR code — large ──────────────────────────────────────
    const qrSize = 600;
    const qrBuffer = await QRCode.toBuffer(upiLink, {
      width: qrSize,
      margin: 2,
      color: { dark: '#1a1a2e', light: '#FFFFFF' },
      errorCorrectionLevel: 'H',
    });

    // ── Canvas ───────────────────────────────────────────────
    const canvasW = 800;
    const headerH = 110;
    const qrCardPad = 22;
    const qrCardW = qrSize + qrCardPad * 2;
    const qrCardH = qrSize + qrCardPad * 2;
    const footerH = 260;
    const canvasH = headerH + qrCardH + footerH;
    const cx = canvasW / 2;
    const qrCardX = Math.floor((canvasW - qrCardW) / 2);
    const qrCardY = headerH;
    const qrX = qrCardX + qrCardPad;
    const qrY = qrCardY + qrCardPad;

    const esc = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    const fBase = qrCardY + qrCardH + 20;

    const svg = `
<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#16213e"/>
      <stop offset="100%" stop-color="#0f3460"/>
    </linearGradient>
    <linearGradient id="accentLine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#e94560" stop-opacity="0"/>
      <stop offset="50%" stop-color="#e94560"/>
      <stop offset="100%" stop-color="#e94560" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bottomLine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#533483" stop-opacity="0"/>
      <stop offset="50%" stop-color="#533483"/>
      <stop offset="100%" stop-color="#533483" stop-opacity="0"/>
    </linearGradient>
    <filter id="qrShadow" x="-8%" y="-8%" width="116%" height="116%">
      <feDropShadow dx="0" dy="4" stdDeviation="20" flood-color="#000000" flood-opacity="0.5"/>
    </filter>
    <filter id="textGlow" x="-15%" y="-25%" width="130%" height="150%">
      <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#e94560" flood-opacity="0.6"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="${canvasW}" height="${canvasH}" fill="url(#bgG)" rx="28"/>

  <!-- Outer subtle border -->
  <rect x="1" y="1" width="${canvasW - 2}" height="${canvasH - 2}" fill="none" stroke="#1a3a6e" stroke-width="2" rx="27"/>

  <!-- Top accent line (red gradient) -->
  <rect x="0" y="0" width="${canvasW}" height="4" fill="url(#accentLine)" rx="0"/>

  <!-- Store name -->
  <text x="${cx}" y="70" text-anchor="middle"
        font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
        font-size="38" font-weight="700" fill="#ffffff" letter-spacing="4"
        filter="url(#textGlow)">${esc(storeName)}</text>

  <!-- Subtitle line -->
  <rect x="${cx - 70}" y="86" width="140" height="2" fill="#e94560" rx="1" opacity="0.6"/>

  <!-- QR white card with shadow -->
  <rect x="${qrCardX}" y="${qrCardY}"
        width="${qrCardW}" height="${qrCardH}"
        fill="#ffffff" rx="18" filter="url(#qrShadow)"/>

  <!-- ── Footer section ── -->

  <!-- Amount -->
  <text x="${cx}" y="${fBase + 40}"
        text-anchor="middle" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
        font-size="44" font-weight="700" fill="#ffffff" letter-spacing="2">
    ${esc(currency)}${esc(String(amount))}
  </text>

  <!-- Divider -->
  <rect x="${cx - 100}" y="${fBase + 58}" width="200" height="2" fill="url(#bottomLine)" rx="1"/>

  <!-- Ref -->
  <text x="${cx}" y="${fBase + 90}"
        text-anchor="middle" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
        font-size="17" fill="#7b8da8" letter-spacing="0.5">
    Ref: ${esc(refId)}
  </text>

  <!-- Scan instruction -->
  <text x="${cx}" y="${fBase + 136}"
        text-anchor="middle" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
        font-size="22" font-weight="600" fill="#e94560" letter-spacing="1">
    Scan with any UPI app
  </text>

  <!-- Bottom divider -->
  <rect x="${cx - 140}" y="${fBase + 162}" width="280" height="1" fill="#1a3a6e" rx="0.5"/>

  <!-- Developer -->
  <text x="${cx}" y="${fBase + 190}"
        text-anchor="middle" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
        font-size="15" fill="#4a6fa5" letter-spacing="0.5">
    Developer: ${esc(developer)}
  </text>

  <!-- Bottom accent line (red gradient) -->
  <rect x="0" y="${canvasH - 4}" width="${canvasW}" height="4" fill="url(#accentLine)" rx="0"/>
</svg>`;

    const bgBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

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
