import logger from '../utils/logger.js';

export async function activityTracker(ctx, next) {
  await next(); // Process the update first

  // Fire-and-forget activity tracking
  if (!ctx.from || !ctx.tracker) return;

  try {
    let actionType = 'unknown';
    let actionData = {};

    if (ctx.message?.text) {
      if (ctx.message.text.startsWith('/')) {
        actionType = 'command_used';
        actionData = { command: ctx.message.text.split(' ')[0] };
      } else {
        actionType = 'message_sent';
        actionData = { text_preview: ctx.message.text.slice(0, 50) };
      }
    } else if (ctx.callbackQuery) {
      actionType = 'button_click';
      actionData = { callback_data: ctx.callbackQuery.data };
    }

    ctx.tracker.trackFireAndForget(
      ctx.from.id,
      actionType,
      actionData,
      ctx.chat?.id || null,
      ctx.chat?.type || null,
    );
  } catch (err) {
    logger.debug(`Activity tracker error: ${err.message}`);
  }
}
