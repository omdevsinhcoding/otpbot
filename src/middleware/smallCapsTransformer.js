/**
 * Unicode Bold Sans-Serif Transformer for grammy
 *
 * Two parts:
 * 1. OUTGOING transformer — converts all text + ALL buttons to bold sans-serif
 * 2. INCOMING middleware — decodes bold text back to ASCII so hears() handlers match
 */

// ── Bold Sans-Serif code points ────────────────────────────────────
const UPPER_START = 0x1D5D4; // 𝗔
const LOWER_START = 0x1D5EE; // 𝗮

/**
 * Convert normal text → Bold Sans-Serif Unicode
 * Preserves: HTML tags, <code> blocks, emoji, numbers, symbols
 */
export function toBoldSans(text) {
  if (!text || typeof text !== 'string') return text;

  let result = '';
  let i = 0;
  const len = text.length;

  while (i < len) {
    // Skip <code>...</code>
    if (text.slice(i, i + 6).toLowerCase() === '<code>') {
      const closeIdx = text.indexOf('</code>', i + 6);
      if (closeIdx !== -1) {
        result += text.slice(i, closeIdx + 7);
        i = closeIdx + 7;
        continue;
      }
    }

    // Skip <pre>...</pre>
    if (text.slice(i, i + 5).toLowerCase() === '<pre>') {
      const closeIdx = text.indexOf('</pre>', i + 5);
      if (closeIdx !== -1) {
        result += text.slice(i, closeIdx + 6);
        i = closeIdx + 6;
        continue;
      }
    }

    // Skip HTML tags
    if (text[i] === '<') {
      const closeIdx = text.indexOf('>', i);
      if (closeIdx !== -1) {
        result += text.slice(i, closeIdx + 1);
        i = closeIdx + 1;
        continue;
      }
    }

    const code = text.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      result += String.fromCodePoint(UPPER_START + (code - 65));
    } else if (code >= 97 && code <= 122) {
      result += String.fromCodePoint(LOWER_START + (code - 97));
    } else {
      result += text[i];
    }
    i++;
  }
  return result;
}

/**
 * Decode Bold Sans-Serif Unicode back to normal ASCII.
 * Used on INCOMING messages so hears() handlers can match.
 */
export function fromBoldSans(text) {
  if (!text || typeof text !== 'string') return text;

  let result = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    // Bold A-Z
    if (cp >= UPPER_START && cp <= UPPER_START + 25) {
      result += String.fromCharCode(65 + (cp - UPPER_START));
    }
    // Bold a-z
    else if (cp >= LOWER_START && cp <= LOWER_START + 25) {
      result += String.fromCharCode(97 + (cp - LOWER_START));
    }
    else {
      result += ch;
    }
  }
  return result;
}

/**
 * Transform ALL keyboard buttons (inline + reply) to bold.
 * Returns a new object — never mutates the original.
 */
function transformMarkup(raw) {
  try {
    const markup = JSON.parse(JSON.stringify(raw));

    if (markup.inline_keyboard) {
      markup.inline_keyboard = markup.inline_keyboard.map(row =>
        row.map(btn => ({ ...btn, text: toBoldSans(btn.text) }))
      );
    }

    if (markup.keyboard) {
      markup.keyboard = markup.keyboard.map(row =>
        row.map(btn => {
          if (typeof btn === 'string') return toBoldSans(btn);
          return { ...btn, text: toBoldSans(btn.text) };
        })
      );
    }

    return markup;
  } catch {
    return raw;
  }
}

/**
 * OUTGOING: grammy API transformer — bold sans-serif everything.
 */
export function boldSansTransformer(prev, method, payload, signal) {
  try {
    if (['sendMessage', 'editMessageText'].includes(method) && payload.text) {
      payload.text = toBoldSans(payload.text);
    }

    if (['sendPhoto', 'sendVideo', 'sendDocument', 'sendAnimation',
         'editMessageCaption'].includes(method) && payload.caption) {
      payload.caption = toBoldSans(payload.caption);
    }

    if (payload.reply_markup) {
      payload.reply_markup = transformMarkup(payload.reply_markup);
    }

    if (method === 'answerCallbackQuery' && payload.text) {
      payload.text = toBoldSans(payload.text);
    }
  } catch {
    // Never crash
  }

  return prev(method, payload, signal);
}

/**
 * INCOMING: grammy middleware — decode bold text back to ASCII
 * so hears() and command handlers can match button text.
 * Must be registered BEFORE any hears() handlers.
 */
export function boldSansDecoder(ctx, next) {
  try {
    if (ctx.message?.text) {
      ctx.message.text = fromBoldSans(ctx.message.text);
    }
    if (ctx.channelPost?.text) {
      ctx.channelPost.text = fromBoldSans(ctx.channelPost.text);
    }
  } catch {
    // Never crash
  }
  return next();
}
