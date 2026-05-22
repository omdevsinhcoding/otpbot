/**
 * Unicode Bold Sans-Serif Transformer for grammy
 * Converts all outgoing text to bold sans-serif Unicode characters.
 * Matches the thick/bold style seen in premium Telegram bots.
 * Preserves: HTML tags, <code> content, emoji, numbers, symbols
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
    // Skip <code>...</code> blocks (preserve order IDs, addresses, amounts)
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

    // Skip HTML tags (don't convert tag names/attributes)
    if (text[i] === '<') {
      const closeIdx = text.indexOf('>', i);
      if (closeIdx !== -1) {
        result += text.slice(i, closeIdx + 1);
        i = closeIdx + 1;
        continue;
      }
    }

    const code = text.charCodeAt(i);

    // A-Z → Bold Sans A-Z (U+1D5D4 + offset)
    if (code >= 65 && code <= 90) {
      result += String.fromCodePoint(0x1D5D4 + (code - 65));
    }
    // a-z → Bold Sans a-z (U+1D5EE + offset)
    else if (code >= 97 && code <= 122) {
      result += String.fromCodePoint(0x1D5EE + (code - 97));
    }
    // Everything else unchanged (emoji, numbers, ₹, symbols)
    else {
      result += text[i];
    }
    i++;
  }

  return result;
}

/**
 * Transform inline keyboard and reply keyboard button text
 */
function transformKeyboard(markup) {
  if (!markup) return markup;

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
}

/**
 * grammy API transformer — intercepts all outgoing messages
 * and applies Bold Sans-Serif conversion automatically.
 */
export function boldSansTransformer(prev, method, payload, signal) {
  // Text messages
  if (['sendMessage', 'editMessageText'].includes(method) && payload.text) {
    payload.text = toBoldSans(payload.text);
  }

  // Captions
  if (['sendPhoto', 'sendVideo', 'sendDocument', 'sendAnimation',
       'editMessageCaption'].includes(method) && payload.caption) {
    payload.caption = toBoldSans(payload.caption);
  }

  // Keyboard buttons
  if (payload.reply_markup) {
    payload.reply_markup = transformKeyboard(
      typeof payload.reply_markup === 'string'
        ? JSON.parse(payload.reply_markup)
        : { ...payload.reply_markup }
    );
  }

  // Callback query popup text
  if (method === 'answerCallbackQuery' && payload.text) {
    payload.text = toBoldSans(payload.text);
  }

  return prev(method, payload, signal);
}
