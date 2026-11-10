// Fixed-window rate limiting on the `rate_limits` collection (`{ key, windowStart, count }`).
//
// One atomic upsert-and-increment per rule. A TTL index on `windowStart` removes old rows (src/lib/db/indexes.js) and a unique
// index on `{ key, windowStart }` makes concurrent first requests safe. FAIL CLOSED (rule 5): if the database cannot be reached the
// request is refused (`allowed: false`), never waved through.
import { COLLECTIONS, RATE_LIMITS } from './config.js';

/**
 * @param {import('mongodb').Db} db
 * @param {string} key  e.g. `login:ip:203.0.113.7`
 * @param {{ limit: number, windowMs: number }} rule
 * @param {number} [nowMs]
 * @returns {Promise<{ allowed: boolean, count: number, retryAfterSeconds: number }>}
 */
export async function consume(db, key, { limit, windowMs }, nowMs = Date.now()) {
  const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
  const windowStart = new Date(windowStartMs);
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStartMs + windowMs - nowMs) / 1000));
  const col = db.collection(COLLECTIONS.rateLimits);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const doc = await col.findOneAndUpdate(
        { key, windowStart },
        { $inc: { count: 1 } },
        { upsert: true, returnDocument: 'after' },
      );
      const count = doc?.count ?? 1;
      return { allowed: count <= limit, count, retryAfterSeconds };
    } catch (err) {
      // Two first requests racing on the unique index: the loser retries once and increments the winner's row.
      if (err?.code === 11000 && attempt === 0) continue;
      throw err;
    }
  }
  throw new Error('rate limit counter unavailable');
}

/**
 * Apply every rule of an action. All counters are incremented (a refused request still counts against the client).
 * @param {import('mongodb').Db} db
 * @param {keyof typeof RATE_LIMITS} action
 * @param {{ ip: string, email?: string | null }} who
 * @param {number} [nowMs]
 * @returns {Promise<{ allowed: boolean, retryAfterSeconds: number }>}
 */
export async function checkRateLimits(db, action, { ip, email }, nowMs = Date.now()) {
  let allowed = true;
  let retryAfterSeconds = 0;
  try {
    for (const rule of RATE_LIMITS[action]) {
      const subject = rule.scope === 'ip' ? ip : email;
      if (!subject) continue; // no address to count (for example a token-only request): the IP rule still applies
      const r = await consume(db, `${action}:${rule.scope}:${subject}`, rule, nowMs);
      if (!r.allowed) {
        allowed = false;
        retryAfterSeconds = Math.max(retryAfterSeconds, r.retryAfterSeconds);
      }
    }
  } catch {
    return { allowed: false, retryAfterSeconds: 60 }; // fail closed
  }
  return { allowed, retryAfterSeconds };
}
