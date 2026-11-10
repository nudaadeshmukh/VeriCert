// Session guards for route handlers and server pages. THE enforcement point for "who may use this" (CLAUDE.md rules 2, 4 and 5).
//
//   const guard = await requireUser();
//   if (!guard.ok) return guard.response;        // 401 / 403 / 503 JSON
//   guard.user.id                                // the id every database query must filter by (rule 4)
//
// Every call re-reads the user from the database and re-applies the domain, disabled and verified checks (access.js), whatever the
// session says. A database error, a missing variable or an unreadable session is a refusal, never a pass (rule 5).
import { ObjectId } from 'mongodb';
import { NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { getDb } from '../db/client.js';
import { evaluateAccess, requireAdminAccess } from './access.js';
import { writeAudit } from './audit.js';
import { auth } from './auth.js';

/**
 * @typedef {import('./access.js').AccessUser} AccessUser
 * @typedef {{ ok: true, user: AccessUser }
 *   | { ok: false, status: number, code: string, response: NextResponse }} Guard
 */

/** @param {number} status @param {string} code @returns {Guard} */
function deny(status, code) {
  return {
    ok: false,
    status,
    code,
    response: NextResponse.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } }),
  };
}

/**
 * @returns {Promise<Guard>}
 */
export async function requireUser() {
  try {
    const session = await auth();
    const id = session?.user?.id;
    if (!id || !ObjectId.isValid(id)) return deny(401, 'no_session');

    const db = await getDb();
    const dbUser = await db.collection('users').findOne({ _id: new ObjectId(id) });
    const access = evaluateAccess(dbUser);
    if (!access.ok) {
      // A live session that no longer qualifies (disabled, or its address is not an allowed one) is ended, so the person is
      // signed out on their next request instead of staying signed in.
      if (dbUser && (access.code === 'account_disabled' || access.code === 'domain_not_allowed')) {
        await db.collection('sessions').deleteMany({ userId: dbUser._id });
        await writeAudit(db, {
          action: 'session_rejected',
          userId: dbUser._id,
          target: String(dbUser.email ?? ''),
          meta: { reason: access.code },
        });
      }
      return deny(access.status, access.code);
    }
    return { ok: true, user: access.user };
  } catch (err) {
    console.error(JSON.stringify({ event: 'auth_check_failed', error: err?.name ?? 'Error' }));
    return deny(503, 'service_unavailable');
  }
}

/**
 * Admin routes: a separate, explicit check on top of requireUser (rule 4). Admin rights come from ADMIN_EMAILS on every request.
 * @returns {Promise<Guard>}
 */
export async function requireAdmin() {
  const guard = await requireUser();
  if (!guard.ok) return guard;
  const admin = requireAdminAccess({ ok: true, user: guard.user });
  return admin.ok ? guard : deny(admin.status, admin.code);
}

/**
 * For server components (pages): the signed-in user, or a redirect to /login.
 * @param {string} [next] where to come back to after signing in
 * @returns {Promise<AccessUser>}
 */
export async function requirePageUser(next) {
  const guard = await requireUser();
  if (!guard.ok) redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  return guard.user;
}
