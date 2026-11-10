// Database sessions for the email/password sign-in.
//
// Auth.js (v5) cannot create a DATABASE session from its Credentials provider, so credentials sign-in is handled by our own routes
// which write a session document in exactly the shape the adapter uses and set the cookie Auth.js itself reads
// (`authjs.session-token`, or `__Secure-authjs.session-token` over https). From then on `auth()`, `signOut()` and revocation treat it
// like any other session: it lives in `sessions`, can be deleted to sign someone out, and expires on its own.
import { randomUUID } from 'node:crypto';
import { SESSION_COOKIE_NAMES, SESSION_MAX_AGE_SECONDS } from './config.js';
import { appOrigin } from './email.js';

/** @param {Record<string, string | undefined>} [env] */
export function secureCookies(env = process.env) {
  return new URL(appOrigin(env)).protocol === 'https:';
}

/** @param {Record<string, string | undefined>} [env] */
export function sessionCookieName(env = process.env) {
  return secureCookies(env) ? SESSION_COOKIE_NAMES.secure : SESSION_COOKIE_NAMES.plain;
}

/**
 * @param {import('mongodb').Db} db
 * @param {import('mongodb').ObjectId} userId
 * @param {Date} [now]
 * @returns {Promise<{ sessionToken: string, expires: Date }>}
 */
export async function createDbSession(db, userId, now = new Date()) {
  const sessionToken = randomUUID();
  const expires = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  await db.collection('sessions').insertOne({ sessionToken, userId, expires });
  return { sessionToken, expires };
}

/**
 * Cookie options for the session cookie: HttpOnly (scripts cannot read it), SameSite=Lax, Secure over https, site-wide.
 * @param {Date} expires
 * @param {Record<string, string | undefined>} [env]
 */
export function sessionCookieOptions(expires, env = process.env) {
  return {
    httpOnly: true,
    sameSite: /** @type {const} */ ('lax'),
    path: '/',
    secure: secureCookies(env),
    expires,
  };
}
