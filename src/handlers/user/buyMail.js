import { Composer } from 'grammy';
import { checkForceJoin } from '../../middleware/forceJoinCheck.js';
import { escRe, menuFor } from './index.js';
import { BTN_BUY_MAIL } from '../../utils/constants.js';

const composer = new Composer();

composer.hears(new RegExp(`^${escRe(BTN_BUY_MAIL)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;
  await ctx.reply(
    '📮 <b>Buy Mail</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: await menuFor(ctx) }
  );
});

export default composer;
