import logger from '../utils/logger.js';

/**
 * Tracker — only tracks admin actions for accountability.
 * No user activity tracking. Admin logs show who did what.
 */
export class Tracker {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Track an admin action (settings change, ban, broadcast, etc.)
   */
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

  /**
   * Fire-and-forget admin tracking (non-blocking)
   */
  trackAdminFireAndForget(adminId, adminUsername, actionType, actionData = null, targetUserId = null) {
    this.trackAdmin(adminId, adminUsername, actionType, actionData, targetUserId).catch(err =>
      logger.debug(`Fire-and-forget admin tracking failed: ${err.message}`)
    );
  }
}
