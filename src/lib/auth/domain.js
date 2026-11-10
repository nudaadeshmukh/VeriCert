// The email-domain rule (CLAUDE.md rule 2). PURE: no I/O, no framework.
//
// Only addresses ending in EXACTLY `@<ALLOWED_EMAIL_DOMAIN>` (`@pict.edu`) may use the site. The match is on the whole
// domain after the one `@`, so look-alikes fail: `@pict.edu.evil.com`, `@notpict.edu`, `@sub.pict.edu`, `pict.edu@gmail.com`,
// `a@pict.edu@evil.com`, a trailing dot, whitespace inside the address, and non-ASCII look-alike letters.
//
// Missing configuration is a refusal, never a default (rule 5): `allowedDomain()` throws.

const LOCAL_RE = /^[a-z0-9](?:[a-z0-9._%+'-]*[a-z0-9])?$/;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

/**
 * Canonical form of an address typed into a form: trimmed and lower-cased, or null if it is not a plausible single
 * ASCII address. Everything stored in the database is in this form.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normaliseEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || /\s/.test(email)) return null;
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@')) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || !LOCAL_RE.test(local) || local.includes('..')) return null;
  if (!DOMAIN_RE.test(domain)) return null;
  return email;
}

/**
 * The configured domain, e.g. `pict.edu`. Throws if it is missing or malformed.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function allowedDomain(env = process.env) {
  const raw = env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase().replace(/^@/, '');
  if (!raw || !DOMAIN_RE.test(raw)) {
    throw new Error('ALLOWED_EMAIL_DOMAIN is missing or not a valid domain');
  }
  return raw;
}

/**
 * Is this an address of the allowed domain?
 *
 * - default (forms): the input is normalised first (trim, lower case), so " Name@PICT.edu " is accepted as `name@pict.edu`.
 * - `strict` (server guards, session emails): the value must ALREADY be canonical. Anything with surrounding spaces or
 *   upper case is refused: a stored or session email is never padded.
 *
 * @param {unknown} raw
 * @param {{ domain?: string, strict?: boolean }} [opts] `domain` defaults to ALLOWED_EMAIL_DOMAIN (throws if unset)
 */
export function isAllowedEmail(raw, { domain = allowedDomain(), strict = false } = {}) {
  const email = normaliseEmail(raw);
  if (email === null) return false;
  if (strict && email !== raw) return false;
  return email.slice(email.indexOf('@') + 1) === domain;
}

/**
 * Admin addresses from ADMIN_EMAILS (comma separated). Entries that are not valid addresses of the allowed domain are
 * ignored: an admin must be a PICT account too.
 * @param {Record<string, string | undefined>} [env]
 * @returns {Set<string>}
 */
export function adminEmails(env = process.env) {
  const domain = allowedDomain(env);
  const out = new Set();
  for (const part of (env.ADMIN_EMAILS ?? '').split(',')) {
    const email = normaliseEmail(part);
    if (email && isAllowedEmail(email, { domain })) out.add(email);
  }
  return out;
}

/**
 * Judge a Google profile for sign-in: Google must say the address is verified AND the address must be canonical and of the
 * allowed domain. (`hd=pict.edu` on the authorize request is only a hint to Google's account chooser; this is the check.)
 * @param {{ email?: unknown, email_verified?: unknown } | null | undefined} profile
 * @param {string} [domain]
 * @returns {{ ok: true, email: string } | { ok: false, reason: 'no_email' | 'email_not_verified' | 'domain_not_allowed' }}
 */
export function evaluateGoogleProfile(profile, domain = allowedDomain()) {
  if (!profile || typeof profile.email !== 'string') return { ok: false, reason: 'no_email' };
  if (profile.email_verified !== true) return { ok: false, reason: 'email_not_verified' };
  // Lower-cased first (Google's case is not guaranteed), then the strict check: padding, look-alikes and other domains fail.
  const email = profile.email.toLowerCase();
  if (!isAllowedEmail(email, { domain, strict: true })) return { ok: false, reason: 'domain_not_allowed' };
  return { ok: true, email };
}
