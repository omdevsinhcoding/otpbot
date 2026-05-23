import { Composer } from 'grammy';
import { checkForceJoin } from '../../middleware/forceJoinCheck.js';
import { escRe, menuFor } from './index.js';
import { BTN_READYMADE } from '../../utils/constants.js';

const composer = new Composer();

composer.hears(new RegExp(`^${escRe(BTN_READYMADE)}$`), async (ctx) => {
  if (!await checkForceJoin(ctx)) return;
  await ctx.reply(
    '💎 <b>Readymade Account</b>\n\nThis feature is coming soon. Stay tuned!',
    { parse_mode: 'HTML', reply_markup: await menuFor(ctx) }
  );
});

export default composer;
