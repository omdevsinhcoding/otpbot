import logger from '../utils/logger.js';

export class Tracker {
  constructor(pool) {
    this.pool = pool;
  }

  async track(userId, actionType, actionData = null, chatId = null, chatType = null) {
    const { logActivity } = await import('../database/repositories/trackingRepo.js');
    try {
      await logActivity(this.pool, {
        userId,
        actionType,
        actionData: typeof actionData === 'string' ? { raw: actionData } : actionData,
        chatId,
        chatType,
      });
    } catch (err) {
      logger.error(`Tracking error: ${err.message}`);
    }
  }

  trackFireAndForget(userId, actionType, actionData = null, chatId = null, chatType = null) {
    this.track(userId, actionType, actionData, chatId, chatType).catch(err =>
      logger.debug(`Fire-and-forget tracking failed: ${err.message}`)
    );
  }

  async trackAdmin(adminId, adminUsername, actionType, actionData = null, targetUserId = null) {
    const { logAdminAction } = await import('../database/repositories/trackingRepo.js');
    try {
      await logAdminAction(this.pool, {
        adminId,
        adminUsername,
        actionType,
        actionData: typeof actionData === 'string' ? { raw: actionData } : actionData,
        targetUserId,
      });
    } catch (err) {
      logger.error(`Admin tracking error: ${err.message}`);
    }
  }

  trackAdminFireAndForget(adminId, adminUsername, actionType, actionData = null, targetUserId = null) {
    this.trackAdmin(adminId, adminUsername, actionType, actionData, targetUserId).catch(err =>
      logger.debug(`Fire-and-forget admin tracking failed: ${err.message}`)
    );
  }

  async trackFinancial(userId, transactionType, amount, options = {}) {
    const { logFinancial } = await import('../database/repositories/trackingRepo.js');
    try {
      await logFinancial(this.pool, {
        userId,
        transactionType,
        amount,
        currency: options.currency || 'INR',
        referenceId: options.referenceId || null,
        metadata: options.metadata || {},
        status: options.status || 'pending',
      });
    } catch (err) {
      logger.error(`Financial tracking error: ${err.message}`);
    }
  }

  trackFinancialFireAndForget(userId, transactionType, amount, options = {}) {
    this.trackFinancial(userId, transactionType, amount, options).catch(err =>
      logger.debug(`Fire-and-forget financial tracking failed: ${err.message}`)
    );
  }
}
