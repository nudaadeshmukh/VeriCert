// Auth.js (NextAuth v5) configuration: Google sign-in and database sessions on the MongoDB adapter.
//
// The email/password sign-in is NOT an Auth.js provider (its Credentials provider cannot make database sessions): it lives in
// app/api/auth/account/* and writes the same kind of session (src/lib/auth/session.js).
//
// Layers of the @pict.edu rule on the Google path:
//   1. `hd=<domain>` on the authorize request: a hint that filters Google's account chooser. Not trusted.
//   2. The `signIn` callback below: Google must report `email_verified === true` and the address must be exactly @<domain>
//      (src/lib/auth/domain.js). Otherwise the sign-in is refused and an audit record `login_rejected_domain` is written.
//   3. `requireUser()` (guards.js) on every request, which re-reads the user (access.js).
//
// The configuration is built lazily, per request: the build and CI need no secrets, and a missing variable (AUTH_SECRET,
// ALLOWED_EMAIL_DOMAIN, MONGODB_URI...) makes the request fail instead of falling back to a default (rule 5).
import { MongoDBAdapter } from '@auth/mongodb-adapter';
import { ObjectId } from 'mongodb';
import { headers } from 'next/headers';
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { getClientPromise, getDb } from '../db/client.js';
import { SESSION_MAX_AGE_SECONDS, SESSION_UPDATE_AGE_SECONDS } from './config.js';
import { writeAudit, clientIp } from './audit.js';
import { allowedDomain } from './domain.js';
import { decideGoogleSignIn } from './googleSignIn.js';
import { markEmailVerified, recordLogin } from './users.js';

async function requestIp() {
  try {
    return clientIp(await headers());
  } catch {
    return 'unknown';
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const domain = allowedDomain(); // throws if ALLOWED_EMAIL_DOMAIN is missing: the request fails closed
  const databaseName = process.env.MONGODB_DB;
  if (!databaseName) throw new Error('Missing required environment variable MONGODB_DB');

  return {
    adapter: MongoDBAdapter(getClientPromise(), { databaseName }),
    session: { strategy: 'database', maxAge: SESSION_MAX_AGE_SECONDS, updateAge: SESSION_UPDATE_AGE_SECONDS },
    // Vercel is trusted automatically; locally the dev server is. AUTH_URL fixes the public origin used in callbacks.
    trustHost: Boolean(process.env.VERCEL) || process.env.NODE_ENV !== 'production',
    pages: { signIn: '/login', error: '/login' },
    providers: [
      Google({
        // AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET are read from the environment by Auth.js.
        authorization: { params: { hd: domain, prompt: 'select_account' } },
        // Linking by email is safe here ONLY because the signIn callback below requires Google's email_verified and the exact
        // domain, and removes the password of an unverified signup for the same address before the link is made.
        allowDangerousEmailAccountLinking: true,
        profile(p) {
          return {
            id: p.sub,
            name: p.name ?? null,
            email: p.email?.toLowerCase() ?? null,
            image: p.picture ?? null,
          };
        },
      }),
    ],
    callbacks: {
      async signIn({ account, profile }) {
        try {
          const db = await getDb();
          return await decideGoogleSignIn({
            account,
            profile: /** @type {any} */ (profile),
            db,
            ip: await requestIp(),
            domain,
          });
        } catch (err) {
          console.error(JSON.stringify({ event: 'google_signin_check_failed', error: err?.name ?? 'Error' }));
          return false; // fail closed
        }
      },
      async session({ session, user }) {
        session.user.id = user.id;
        return session;
      },
    },
    events: {
      async createUser({ user }) {
        if (!user.id) return;
        const db = await getDb();
        await db
          .collection('users')
          .updateOne(
            { _id: new ObjectId(user.id) },
            { $set: { disabled: false, createdAt: new Date(), lastLoginAt: null } },
          );
      },
      async signIn({ user, account }) {
        if (account?.provider !== 'google' || !user.id) return;
        const db = await getDb();
        const userId = new ObjectId(user.id);
        const now = new Date();
        // Google vouched for the address (the signIn callback required email_verified), so the account is verified.
        await markEmailVerified(db, userId, now);
        await recordLogin(db, userId, now);
        await writeAudit(db, {
          action: 'login',
          userId,
          target: user.email ?? null,
          meta: { provider: 'google' },
          ip: await requestIp(),
        });
      },
      async signOut(message) {
        const session = 'session' in message ? message.session : null;
        if (!session?.userId) return;
        const db = await getDb();
        await writeAudit(db, { action: 'logout', userId: session.userId, meta: {}, ip: await requestIp() });
      },
    },
  };
});
