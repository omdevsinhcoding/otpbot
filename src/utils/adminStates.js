/**
 * Centralized admin state registry.
 * All admin modules register their state Maps here.
 * The global middleware clears all states when a reply keyboard button is pressed
 * so that button text doesn't get captured as text input.
 */

import { Composer } from 'grammy';
import { isReplyKeyboardButton } from './constants.js';

// Registry of all admin state Maps
const registeredStates = [];

/**
 * Register a state Map so it can be cleared globally.
 * Call this in each admin module: registerAdminState(states);
 */
export function registerAdminState(stateMap) {
  registeredStates.push(stateMap);
}

/**
 * Clear ALL admin input states for a given chat.
 * Called when a reply keyboard button press is detected.
 */
export function clearAllAdminStates(chatId) {
  for (const map of registeredStates) {
    map.delete(chatId);
  }
}

/**
 * Global middleware: If the text matches a reply keyboard button,
 * clear all admin input states and let the button handler process it.
 * Must be registered BEFORE all admin handlers in index.js.
 */
export const adminStateGuard = new Composer();
adminStateGuard.on('message:text', (ctx, next) => {
  if (ctx.message?.text && isReplyKeyboardButton(ctx.message.text)) {
    clearAllAdminStates(ctx.chat.id);
  }
  return next();
});
