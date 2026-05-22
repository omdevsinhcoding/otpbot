/**
 * Unicode Small Caps Transformer for grammy
 * Automatically converts all outgoing bot messages to small caps font style.
 * Preserves: HTML tags, <code> content, emoji, numbers, symbols
 */

// Small caps mapping (lowercase → Unicode small caps)
const SMALL_CAPS = {
  'a': 'ᴀ', 'b': 'ʙ', 'c': 'ᴄ', 'd': 'ᴅ', 'e': 'ᴇ', 'f': 'ꜰ',
  'g': 'ɢ', 'h': 'ʜ', 'i': 'ɪ', 'j': 'ᴊ', 'k': 'ᴋ', 'l': 'ʟ',
  'm': 'ᴍ', 'n': 'ɴ', 'o': 'ᴏ', 'p': 'ᴘ', 'q': 'ǫ', 'r': 'ʀ',
  's': 'ꜱ', 't': 'ᴛ', 'u': 'ᴜ', 'v': 'ᴠ', 'w': 'ᴡ', 'x': 'x',
  'y': 'ʏ', 'z': 'ᴢ',
};

/**
 * Convert text to small caps, preserving HTML tags and <code> blocks
 */
export function toSmallCaps(text) {
  if (!text || typeof text !== 'string') return text;

  let result = '';
  let i = 0;
  const len = text.length;

  while (i < len) {
    // Skip <code>...</code> blocks (preserve order IDs, addresses, etc.)
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

    // Skip HTML tags entirely (don't convert tag names/attributes)
    if (text[i] === '<') {
      const closeIdx = text.indexOf('>', i);
      if (closeIdx !== -1) {
        result += text.slice(i, closeIdx + 1);
        i = closeIdx + 1;
        continue;
      }
    }

    // Convert lowercase to small caps
    const ch = text[i];
    result += SMALL_CAPS[ch] || ch;
    i++;
  }

  return result;
}

/**
 * Transform inline keyboard button text to small caps
 */
function transformKeyboard(markup) {
  if (!markup) return markup;

  // InlineKeyboard
  if (markup.inline_keyboard) {
    markup.inline_keyboard = markup.inline_keyboard.map(row =>
      row.map(btn => ({
        ...btn,
        text: toSmallCaps(btn.text),
      }))
    );
  }

  // ReplyKeyboard
  if (markup.keyboard) {
    markup.keyboard = markup.keyboard.map(row =>
      row.map(btn => {
        if (typeof btn === 'string') return toSmallCaps(btn);
        return { ...btn, text: toSmallCaps(btn.text) };
      })
    );
  }

  return markup;
}

/**
 * grammy API transformer — intercepts all outgoing messages
 * and applies small caps conversion automatically.
 *
 * Usage in index.js:
 *   import { smallCapsTransformer } from './middleware/smallCapsTransformer.js';
 *   bot.api.config.use(smallCapsTransformer);
 */
export function smallCapsTransformer(prev, method, payload, signal) {
  // Methods that have 'text' field
  if (['sendMessage', 'editMessageText'].includes(method) && payload.text) {
    payload.text = toSmallCaps(payload.text);
  }

  // Methods that have 'caption' field
  if (['sendPhoto', 'sendVideo', 'sendDocument', 'sendAnimation',
       'editMessageCaption'].includes(method) && payload.caption) {
    payload.caption = toSmallCaps(payload.caption);
  }

  // Transform keyboard button text
  if (payload.reply_markup) {
    payload.reply_markup = transformKeyboard(
      typeof payload.reply_markup === 'string'
        ? JSON.parse(payload.reply_markup)
        : { ...payload.reply_markup }
    );
  }

  // answerCallbackQuery text
  if (method === 'answerCallbackQuery' && payload.text) {
    payload.text = toSmallCaps(payload.text);
  }

  return prev(method, payload, signal);
}
