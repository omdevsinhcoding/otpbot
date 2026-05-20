import QRCode from 'qrcode';
import sharp from 'sharp';
import logger from '../utils/logger.js';

/**
 * Generate a premium branded QR payment image.
 *
 * Layout (dark theme, eye-catchy):
 *   ┌─────────────────────────────┐
 *   │         💎 STORE NAME       │  ← vibrant title
 *   │      ─ ─ ─ ─ ─ ─ ─ ─       │  ← separator line
 *   │                             │
 *   │   ┌───────────────────┐     │
 *   │   │   ████ QR ████    │     │  ← QR on rounded white card
 *   │   │   ████ CODE ████  │     │
 *   │   └───────────────────┘     │
 *   │                             │
 *   │     Amount: ₹12.00         │  ← large white text
 *   │     ───────────────         │  ← separator
 *   │     Ref: TXN_xxxxx         │  ← subtle gray
 *   │                             │
 *   │   ✅ Scan with any UPI app  │  ← green accent
 *   │                             │
 *   │     Developer: @Erroroo    │  ← tiny footer
 *   └─────────────────────────────┘
 */
export async function generateBrandedQR({
  storeName = 'OTP Bot',
  amount,
  currency = '₹',
  refId,
  upiLink,
  developer = '@Erroroo',
}) {
  try {
    // Generate QR code as PNG buffer
    const qrSize = 340;
    const qrBuffer = await QRCode.toBuffer(upiLink, {
      width: qrSize,
      margin: 3,
      color: { dark: '#1a1a2e', light: '#FFFFFF' },
      errorCorrectionLevel: 'H',
    });

    // Canvas dimensions
    const padding = 50;
    const imgWidth = qrSize + padding * 2 + 20; // extra breathing room
    const headerHeight = 70;
    const qrCardPadding = 14;
    const footerHeight = 180;
    const imgHeight = headerHeight + qrSize + qrCardPadding * 2 + footerHeight;
    const centerX = imgWidth / 2;
    const qrCardLeft = (imgWidth - qrSize - qrCardPadding * 2) / 2;
    const qrTop = headerHeight + qrCardPadding;

    // Escape XML entities
    const esc = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    // Footer positions
    const footerStart = qrTop + qrSize + qrCardPadding + 20;

    const svg = `
<svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Gradient background -->
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0c0c1e"/>
      <stop offset="100%" stop-color="#141432"/>
    </linearGradient>
    <!-- Accent gradient for title -->
    <linearGradient id="titleGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#e94560"/>
      <stop offset="100%" stop-color="#ff6b6b"/>
    </linearGradient>
    <!-- QR card shadow -->
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.4"/>
    </filter>
  </defs>

  <!-- Background with gradient -->
  <rect width="100%" height="100%" fill="url(#bgGrad)" rx="16"/>

  <!-- Top accent line -->
  <rect x="${centerX - 60}" y="8" width="120" height="3" fill="#e94560" rx="2" opacity="0.6"/>

  <!-- Store name -->
  <text x="${centerX}" y="45" text-anchor="middle"
        font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="bold"
        fill="url(#titleGrad)">${esc(storeName)}</text>

  <!-- Separator line -->
  <line x1="${centerX - 80}" y1="58" x2="${centerX + 80}" y2="58"
        stroke="#2a2a4a" stroke-width="1" opacity="0.5"/>

  <!-- QR white card with rounded corners + shadow -->
  <rect x="${qrCardLeft}" y="${headerHeight}"
        width="${qrSize + qrCardPadding * 2}" height="${qrSize + qrCardPadding * 2}"
        fill="#f8f9fa" rx="12" filter="url(#shadow)"/>

  <!-- Amount (large, prominent) -->
  <text x="${centerX}" y="${footerStart}"
        text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
        font-size="22" font-weight="bold" fill="#ffffff">
    ${esc(currency)}${esc(String(amount))}
  </text>

  <!-- Separator -->
  <line x1="${centerX - 50}" y1="${footerStart + 12}" x2="${centerX + 50}" y2="${footerStart + 12}"
        stroke="#2a2a4a" stroke-width="1"/>

  <!-- Ref ID -->
  <text x="${centerX}" y="${footerStart + 38}"
        text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
        font-size="13" fill="#7a7a9a">
    Ref: ${esc(refId)}
  </text>

  <!-- Scan instruction (green accent) -->
  <text x="${centerX}" y="${footerStart + 70}"
        text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
        font-size="15" font-weight="bold" fill="#16c784">
    Scan with any UPI app
  </text>

  <!-- Bottom separator -->
  <line x1="${centerX - 100}" y1="${footerStart + 88}" x2="${centerX + 100}" y2="${footerStart + 88}"
        stroke="#1e1e3a" stroke-width="1"/>

  <!-- Developer credit -->
  <text x="${centerX}" y="${footerStart + 110}"
        text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
        font-size="11" fill="#4a4a6a">
    Developer: ${esc(developer)}
  </text>

  <!-- Bottom accent line -->
  <rect x="${centerX - 40}" y="${imgHeight - 10}" width="80" height="3" fill="#e94560" rx="2" opacity="0.4"/>
</svg>`;

    // Render SVG to PNG
    const bgBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

    // Composite QR onto branded background
    const finalImage = await sharp(bgBuffer)
      .composite([{
        input: qrBuffer,
        top: qrTop,
        left: Math.floor(qrCardLeft + qrCardPadding),
      }])
      .png()
      .toBuffer();

    return finalImage;
  } catch (err) {
    logger.error(`QR image generation failed: ${err.message}`);
    throw err;
  }
}
