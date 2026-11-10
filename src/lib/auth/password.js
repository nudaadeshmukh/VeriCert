// Password policy and hashing. The policy functions are PURE; hashing uses bcryptjs (cost 12, the plan's value;
// the pure-JS implementation avoids a native build on Vercel).
import bcrypt from 'bcryptjs';
import { COMMON_PASSWORDS } from './commonPasswords.js';

/** The plan: 10 or more characters. */
export const PASSWORD_MIN_LENGTH = 10;
/** bcrypt only reads the first 72 BYTES of a password; longer ones are refused rather than silently truncated. */
export const PASSWORD_MAX_BYTES = 72;
/** bcrypt cost (the plan: 12). */
export const BCRYPT_COST = 12;

const COMMON = new Set(COMMON_PASSWORDS);

/**
 * @typedef {'too_short' | 'too_long' | 'too_common' | 'too_simple' | 'contains_email'} PasswordProblem
 */

/**
 * Check a candidate password against the policy.
 * @param {unknown} password
 * @param {string} [email] the account's address: the password may not contain its local part
 * @returns {{ ok: boolean, problems: PasswordProblem[] }}
 */
export function checkPasswordPolicy(password, email) {
  /** @type {PasswordProblem[]} */
  const problems = [];
  if (typeof password !== 'string' || [...password].length < PASSWORD_MIN_LENGTH) {
    problems.push('too_short');
    return { ok: false, problems };
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) problems.push('too_long');
  const lower = password.toLowerCase();
  // "Password123!" and "password123" are the same weak password: also test it without trailing digits and punctuation.
  const stripped = lower.replace(/[0-9!@#$%^&*._\-+=?]+$/, '');
  if (COMMON.has(lower) || COMMON.has(stripped)) problems.push('too_common');
  if (new Set([...lower]).size < 5) problems.push('too_simple');
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) problems.push('contains_email');
  return { ok: problems.length === 0, problems };
}

/** Human-readable text for a problem (shown on the form). */
export const PASSWORD_PROBLEM_TEXT = Object.freeze({
  too_short: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  too_long: `Use at most ${PASSWORD_MAX_BYTES} bytes (about ${PASSWORD_MAX_BYTES} letters).`,
  too_common: 'That password is too common. Choose something less guessable.',
  too_simple: 'That password repeats too few different characters.',
  contains_email: 'The password may not contain your email name.',
});

/**
 * @param {string} password
 * @returns {Promise<string>}
 */
export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Constant-effort password check. When there is no hash (unknown account, Google-only account) a comparison against a dummy
 * hash is still run, so the response time does not reveal whether the account exists.
 * @param {string} password
 * @param {string | null | undefined} hash
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, hash) {
  if (typeof hash !== 'string' || hash === '') {
    await bcrypt.compare(password, await dummyHash());
    return false;
  }
  return bcrypt.compare(password, hash);
}

/** @type {Promise<string> | undefined} */
let dummy;
function dummyHash() {
  dummy ??= bcrypt.hash('not-a-real-password-only-for-timing', BCRYPT_COST);
  return dummy;
}
