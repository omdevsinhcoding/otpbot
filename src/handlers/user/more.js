import { Composer } from 'grammy';
import { checkForceJoin } from '../../middleware/forceJoinCheck.js';
import { escRe, menuFor } from './index.js';
import { BTN_MORE, BTN_RETURN } from '../../utils/constants.js';
import { MORE_MENU_KEYBOARD } from '../../utils/keyboard.js';

const composer = new Composer();

// 🔥 MORE → shows sub-menu reply keyboard
composer.hears(new RegExp(`^${escRe(BTN_MORE)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;
  await ctx.reply('🔥 <b>More Options</b>', { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD });
});

// ◀️ RETURN → back to main menu
composer.hears(new RegExp(`^${escRe(BTN_RETURN)}$`), async (ctx) => {
  await ctx.reply('🏠 <b>Main Menu</b>', { parse_mode: 'HTML', reply_markup: await menuFor(ctx) });
});

export default composer;
