// `audit_logs` (append only): `{ userId, action, target, meta, ip, createdAt }` (plan, data model). Every rejection is recorded.
//
// Actions written by Phase 5: login, logout, login_rejected_domain (a non-PICT address tried to sign in or sign up),
// login_rejected (meta.reason: bad_credentials, email_not_verified, account_disabled, rate_limited, email_not_verified),
// signup, email_verified, password_reset_requested, password_reset, session_rejected (a live session failed the per-request check).
// `target` is the email address involved (needed to see who was refused); `meta` never holds a password, token, cookie or link.
import { COLLECTIONS } from './config.js';

/**
 * The client IP as seen by Vercel (`x-vercel-forwarded-for` or the first `x-forwarded-for` entry), else "unknown".
 * @param {Headers | { get(name: string): string | null }} headers
 * @returns {string}
 */
export function clientIp(headers) {
  const raw =
    headers.get('x-vercel-forwarded-for') ?? headers.get('x-forwarded-for') ?? headers.get('x-real-ip') ?? '';
  const first = raw.split(',')[0].trim();
  return first.length > 0 && first.length <= 64 ? first : 'unknown';
}

/**
 * Append an audit record. Failure to write is logged (class name only) and NEVER turns a refusal into an acceptance.
 * @param {import('mongodb').Db} db
 * @param {{ action: string, userId?: import('mongodb').ObjectId | string | null, target?: string | null,
 *   meta?: Record<string, unknown>, ip?: string }} entry
 * @returns {Promise<boolean>} whether the record was stored
 */
export async function writeAudit(db, { action, userId = null, target = null, meta = {}, ip = 'unknown' }) {
  try {
    await db
      .collection(COLLECTIONS.audit)
      .insertOne({ userId, action, target, meta, ip, createdAt: new Date() });
    return true;
  } catch (err) {
    console.error(JSON.stringify({ event: 'audit_write_failed', action, error: err?.name ?? 'Error' }));
    return false;
  }
}
