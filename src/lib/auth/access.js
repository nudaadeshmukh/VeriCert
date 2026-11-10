// The per-request access decision (the THIRD enforcement layer, CLAUDE.md rules 2 and 5). PURE.
//
// Layer 1: `hd=pict.edu` on the Google request (a hint only). Layer 2: the sign-in callback (Google says the address is verified and
// the address is exactly @pict.edu). Layer 3, this file, runs on EVERY request that needs a user: even with a valid session, the
// stored user is re-read and must still be a verified, enabled account of the allowed domain. So a disabled user, or a domain
// that was misconfigured at sign-in, is cut off on the next request.
import { adminEmails, allowedDomain, isAllowedEmail } from './domain.js';

/**
 * @typedef {{ id: string, email: string, name: string | null, role: 'user' | 'admin' }} AccessUser
 * @typedef {'no_session' | 'domain_not_allowed' | 'account_disabled' | 'email_not_verified' | 'not_admin' | 'service_unavailable'} AccessCode
 */

/** HTTP status for each refusal: 401 means "sign in", 403 means "signed in but not allowed". */
export const ACCESS_STATUS = Object.freeze({
  no_session: 401,
  domain_not_allowed: 403,
  account_disabled: 403,
  email_not_verified: 403,
  not_admin: 403,
  service_unavailable: 503,
});

/**
 * @param {{ _id?: unknown, email?: unknown, name?: unknown, emailVerified?: unknown, disabled?: unknown } | null | undefined} dbUser
 *   the user as stored in the database (re-read for this request)
 * @param {{ domain?: string, admins?: Set<string> }} [opts]
 * @returns {{ ok: true, user: AccessUser } | { ok: false, status: number, code: AccessCode }}
 */
export function evaluateAccess(dbUser, { domain = allowedDomain(), admins = adminEmails() } = {}) {
  /** @param {AccessCode} code */
  const refuse = (code) => ({ ok: /** @type {const} */ (false), status: ACCESS_STATUS[code], code });
  if (!dbUser || dbUser._id === undefined || dbUser._id === null) return refuse('no_session');
  // Strict: a stored address is canonical; padded or upper-case values are refused, never "fixed up" here.
  if (!isAllowedEmail(dbUser.email, { domain, strict: true })) return refuse('domain_not_allowed');
  if (dbUser.disabled === true) return refuse('account_disabled');
  if (!dbUser.emailVerified) return refuse('email_not_verified');
  const email = /** @type {string} */ (dbUser.email);
  return {
    ok: true,
    user: {
      id: String(dbUser._id),
      email,
      name: typeof dbUser.name === 'string' ? dbUser.name : null,
      // Derived from ADMIN_EMAILS on every request, not trusted from a stored field: removing an address from the variable
      // removes admin rights immediately.
      role: admins.has(email) ? 'admin' : 'user',
    },
  };
}

/**
 * Admin access is a separate, explicitly checked path (rule 4).
 * @param {ReturnType<typeof evaluateAccess>} access
 * @returns {ReturnType<typeof evaluateAccess>}
 */
export function requireAdminAccess(access) {
  if (!access.ok) return access;
  if (access.user.role !== 'admin') return { ok: false, status: ACCESS_STATUS.not_admin, code: 'not_admin' };
  return access;
}
