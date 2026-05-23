import { Composer } from 'grammy';
import { escRe } from './index.js';
import { BTN_TOP_SERVICES } from '../../utils/constants.js';
import { MORE_MENU_KEYBOARD } from '../../utils/keyboard.js';

const composer = new Composer();

composer.hears(new RegExp(`^${escRe(BTN_TOP_SERVICES)}$`), async (ctx) => {
  await ctx.reply(
    '📊 <b>Top Services</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: MORE_MENU_KEYBOARD }
  );
});

export default composer;
