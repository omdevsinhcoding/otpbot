/** Encode a page number + prefix into a callback_data cursor. */
export function encodeCursor(page, prefix) {
  return `${prefix}page:${page}`;
}

/** Decode a cursor callback_data → { page, prefix }. */
export function decodeCursor(callbackData) {
  const match = callbackData.match(/^(.+)page:(\d+)$/);
  if (!match) return { page: 1, prefix: '' };
  return { prefix: match[1], page: Number(match[2]) };
}

/** Calculate the SQL OFFSET for a given page. */
export function getOffset(page, pageSize) {
  return Math.max(0, (page - 1) * pageSize);
}
