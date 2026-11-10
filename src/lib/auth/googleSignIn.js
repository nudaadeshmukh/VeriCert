// The Google sign-in decision (layer 2 of the @pict.edu rule; see auth.js for the three layers). Plain function so it is tested without
// Auth.js: it returns whether the sign-in may proceed and writes the audit record of every refusal.
import { writeAudit } from './audit.js';
import { evaluateGoogleProfile, normaliseEmail } from './domain.js';
import { dropUnverifiedPassword } from './users.js';

/**
 * @param {{
 *   account: { provider?: string } | null | undefined,
 *   profile: { email?: unknown, email_verified?: unknown } | null | undefined,
 *   db: import('mongodb').Db,
 *   ip: string,
 *   domain: string,
 * }} input
 * @returns {Promise<boolean>} true = let Auth.js create or link the account and the session
 */
export async function decideGoogleSignIn({ account, profile, db, ip, domain }) {
  if (account?.provider !== 'google') return false; // no other provider is enabled
  const decision = evaluateGoogleProfile(profile, domain);
  try {
    if (!decision.ok) {
      // The attempted address goes into the audit log: that is how a refused sign-in is found afterwards.
      await writeAudit(db, {
        action: 'login_rejected_domain',
        target: normaliseEmail(profile?.email) ?? 'invalid',
        meta: { provider: 'google', reason: decision.reason },
        ip,
      });
      return false;
    }
    const existing = await db.collection('users').findOne({ email: decision.email });
    if (existing?.disabled === true) {
      await writeAudit(db, {
        action: 'login_rejected',
        userId: existing._id,
        target: decision.email,
        meta: { provider: 'google', reason: 'account_disabled' },
        ip,
      });
      return false;
    }
    // Pre-hijack defence: an unverified password signup for this address loses its password before the Google account is linked.
    await dropUnverifiedPassword(db, decision.email);
    return true;
  } catch (err) {
    // Fail closed: if the checks cannot run, the sign-in does not happen.
    console.error(JSON.stringify({ event: 'google_signin_check_failed', error: err?.name ?? 'Error' }));
    return false;
  }
}
