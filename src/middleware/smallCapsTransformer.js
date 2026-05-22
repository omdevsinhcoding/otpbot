/**
 * Unicode Bold Sans-Serif Transformer for grammy
 * Converts outgoing text to bold sans-serif Unicode characters.
 *
 * IMPORTANT: Reply keyboard buttons are NOT transformed because
 * Telegram sends button text as a message when clicked, and the
 * bot's hears() handlers match against the original text.
 * Only message text, captions, and INLINE keyboard buttons are transformed.
 */

/**
 * Convert text to Bold Sans-Serif Unicode
 * A-Z → 𝗔-𝗭 (U+1D5D4 to U+1D5ED)
 * a-z → 𝗮-𝘇 (U+1D5EE to U+1D607)
 */
export function toBoldSans(text) {
  if (!text || typeof text !== 'string') return text;

  let result = '';
  let i = 0;
  const len = text.length;

  while (i < len) {
    // Skip <code>...</code> blocks
    if (text.slice(i, i + 6).toLowerCase() === '<code>') {
      const closeIdx = text.indexOf('</code>', i + 6);
      if (closeIdx !== -1) {
        result += text.slice(i, closeIdx + 7);
        i = closeIdx + 7;
        continue;
      }
    }

    // Skip <pre>...</pre> blocks
    if (text.slice(i, i + 5).toLowerCase() === '<pre>') {
      const closeIdx = text.indexOf('</pre>', i + 5);
      if (closeIdx !== -1) {
        result += text.slice(i, closeIdx + 6);
        i = closeIdx + 6;
        continue;
      }
    }

    // Skip HTML tags entirely
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
      result += String.fromCodePoint(0x1D5D4 + (code - 65));
    } else if (code >= 97 && code <= 122) {
      result += String.fromCodePoint(0x1D5EE + (code - 97));
    } else {
      result += text[i];
    }
    i++;
  }

  return result;
}

/**
 * Transform ONLY inline keyboard buttons (not reply keyboard).
 * Returns a new object — never mutates the original.
 */
function transformMarkup(raw) {
  try {
    const markup = JSON.parse(JSON.stringify(raw));

    // Transform inline keyboard buttons only
    if (markup.inline_keyboard) {
      markup.inline_keyboard = markup.inline_keyboard.map(row =>
        row.map(btn => ({ ...btn, text: toBoldSans(btn.text) }))
      );
    }

    // DO NOT transform reply keyboard buttons (markup.keyboard)
    // because Telegram sends button text as a message on click,
    // and hears() handlers need to match the original text.

    return markup;
  } catch {
    return raw;
  }
}

/**
 * grammy API transformer — Bold Sans-Serif for messages + inline buttons.
 * Never crashes the bot (wrapped in try-catch).
 */
export function boldSansTransformer(prev, method, payload, signal) {
  try {
    // Text messages
    if (['sendMessage', 'editMessageText'].includes(method) && payload.text) {
      payload.text = toBoldSans(payload.text);
    }

    // Captions
    if (['sendPhoto', 'sendVideo', 'sendDocument', 'sendAnimation',
         'editMessageCaption'].includes(method) && payload.caption) {
      payload.caption = toBoldSans(payload.caption);
    }

    // Keyboard — only inline buttons, skip reply keyboard
    if (payload.reply_markup) {
      payload.reply_markup = transformMarkup(payload.reply_markup);
    }

    // Callback popup text
    if (method === 'answerCallbackQuery' && payload.text) {
      payload.text = toBoldSans(payload.text);
    }
  } catch {
    // Silently pass through — never crash
  }

  return prev(method, payload, signal);
}
