/**
 * User Handlers — Combiner
 *
 * Exports shared helpers (escRe, menuFor) and combines all
 * feature-specific handler composers into one export.
 *
 * Each feature lives in its own file for clean separation.
 */
import { Composer } from 'grammy';
import * as adminRepo from '../../database/repositories/adminRepo.js';
import { getMainMenu } from '../../utils/keyboard.js';

// ── Shared helpers (imported by feature files) ──────────────────

/** Escape button text for use in RegExp. */
export function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Get the correct main menu keyboard (checks admin status). */
export async function menuFor(ctx) {
  const isAdmin = await adminRepo.isAdmin(ctx.dbPool, ctx.from.id);
  return getMainMenu(isAdmin);
}

// ── Import all feature handlers ─────────────────────────────────
import getOtp from './getOtp.js';
import deposit from './deposit.js';
import profile from './profile.js';
import buyMail from './buyMail.js';
import support from './support.js';
import referEarn from './referEarn.js';
import readymade from './readymade.js';
import more from './more.js';
import tempMail from './tempMail.js';
import favorite from './favorite.js';
import promoCode from './promoCode.js';
import topServices from './topServices.js';
import api from './api.js';
import reseller from './reseller.js';
import adminPanel from './adminPanel.js';

// ── Combine into single composer ────────────────────────────────
const composer = new Composer();

composer.use(getOtp);
composer.use(deposit);
composer.use(profile);
composer.use(buyMail);
composer.use(support);
composer.use(referEarn);
composer.use(readymade);
composer.use(more);
composer.use(tempMail);
composer.use(favorite);
composer.use(promoCode);
composer.use(topServices);
composer.use(api);
composer.use(reseller);
composer.use(adminPanel);

export default composer;
