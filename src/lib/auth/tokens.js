// Single-use email tokens (email verification and password reset).
//
// The token itself is 32 random bytes (256 bits), sent only in the email link. The database holds only its SHA-256 hash, so a
// database leak does not yield usable links. Redeeming is one atomic `findOneAndDelete`, so a token works exactly once even
// with two simultaneous requests, and an expired token is never returned.
import { createHash, randomBytes } from 'node:crypto';
import { COLLECTIONS, RESET_TOKEN_TTL_MS, VERIFY_TOKEN_TTL_MS } from './config.js';

/** @typedef {'verify_email' | 'reset_password'} TokenType */

const TTL = { verify_email: VERIFY_TOKEN_TTL_MS, reset_password: RESET_TOKEN_TTL_MS };

/** @param {string} token */
export function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** @returns {{ token: string, tokenHash: string }} */
export function newToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

/**
 * Create a token for a user, replacing any earlier unused token of the same type for that user (so only the newest link works).
 * @param {import('mongodb').Db} db
 * @param {{ userId: import('mongodb').ObjectId, email: string, type: TokenType, now?: Date }} o
 * @returns {Promise<string>} the plain token, to put in the email and nowhere else
 */
export async function issueEmailToken(db, { userId, email, type, now = new Date() }) {
  const { token, tokenHash } = newToken();
  const col = db.collection(COLLECTIONS.emailTokens);
  await col.deleteMany({ userId, type });
  await col.insertOne({
    tokenHash,
    type,
    userId,
    email,
    createdAt: now,
    expiresAt: new Date(now.getTime() + TTL[type]),
  });
  return token;
}

/**
 * Look at a token WITHOUT using it (so a rejected new password does not burn the reset link). The real use is `redeemEmailToken`.
 * @param {import('mongodb').Db} db
 * @param {unknown} token
 * @param {TokenType} type
 * @param {Date} [now]
 */
export async function peekEmailToken(db, token, type, now = new Date()) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  return db
    .collection(COLLECTIONS.emailTokens)
    .findOne({ tokenHash: hashToken(token), type, expiresAt: { $gt: now } });
}

/**
 * Use a token. Returns the stored record, or null if the token is unknown, already used, expired or of another type.
 * @param {import('mongodb').Db} db
 * @param {unknown} token
 * @param {TokenType} type
 * @param {Date} [now]
 */
export async function redeemEmailToken(db, token, type, now = new Date()) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  return db
    .collection(COLLECTIONS.emailTokens)
    .findOneAndDelete({ tokenHash: hashToken(token), type, expiresAt: { $gt: now } });
}
