// Authentication settings. Values with no external constraint are chosen here, with the reason.
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * Session lifetime (database sessions). Seven days: staff open the tool a few times a week, a stolen cookie is useful for at most a
 * week, and the user can always sign out to revoke it. The updateAge makes an active session slide forward once a day.
 */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

/** Auth.js cookie names for the session token (v5): the `__Secure-` variant is used when the site is served over https. */
export const SESSION_COOKIE_NAMES = Object.freeze({
  plain: 'authjs.session-token',
  secure: '__Secure-authjs.session-token',
});

/** The plan: verification tokens last 24 hours, reset tokens 1 hour. Both are single use and stored hashed. */
export const VERIFY_TOKEN_TTL_MS = 24 * HOUR;
export const RESET_TOKEN_TTL_MS = 1 * HOUR;

/**
 * Throttles (fixed windows in `rate_limits`), per client IP and per email. A request is refused (HTTP 429) as soon as ANY of its
 * rules is over its limit. Chosen to stop password guessing and mail-bombing while leaving a real person room for typos:
 * 8 password attempts per address per 15 minutes, 3 sign-up or reset mails per address per hour.
 * @type {Record<string, { scope: 'ip' | 'email', limit: number, windowMs: number }[]>}
 */
export const RATE_LIMITS = Object.freeze({
  signup: [
    { scope: 'ip', limit: 10, windowMs: HOUR },
    { scope: 'email', limit: 3, windowMs: HOUR },
  ],
  login: [
    { scope: 'ip', limit: 20, windowMs: 15 * MINUTE },
    { scope: 'email', limit: 8, windowMs: 15 * MINUTE },
  ],
  forgot: [
    { scope: 'ip', limit: 10, windowMs: HOUR },
    { scope: 'email', limit: 3, windowMs: HOUR },
  ],
  verify: [{ scope: 'ip', limit: 30, windowMs: HOUR }],
  reset: [{ scope: 'ip', limit: 20, windowMs: HOUR }],
});

/** Collections owned by this module (the Auth.js adapter owns users, accounts, sessions and verification_tokens). */
export const COLLECTIONS = Object.freeze({
  emailTokens: 'email_tokens',
  rateLimits: 'rate_limits',
  audit: 'audit_logs',
});
