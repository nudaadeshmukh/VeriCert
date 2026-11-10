// Idempotent index creation for every index in docs/implementation_plan.md "Data model".
// Run with `npm run db:indexes`. Safe to run repeatedly, including after changing the
// retention period (a changed TTL is applied with `collMod`).

const DAY_SECONDS = 24 * 60 * 60;

/** Audit logs are kept for a year (plan: `audit_logs` TTL 365 days). */
export const AUDIT_LOG_TTL_DAYS = 365;

/**
 * `rate_limits` windows are at most a minute long; one hour keeps rows long enough to
 * inspect an incident and short enough that the collection stays tiny.
 */
export const RATE_LIMIT_TTL_SECONDS = 60 * 60;

/**
 * Parse `RESULT_RETENTION_DAYS`. Unset means the plan's default of 180; a bad value is an
 * error, never a silent fallback (a typo must not shorten or disable retention).
 * @param {string | undefined} raw
 * @returns {number}
 */
export function parseRetentionDays(raw) {
  if (raw === undefined || raw.trim() === '') return 180;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`RESULT_RETENTION_DAYS must be a whole number of days, got "${raw}"`);
  }
  const days = Number(raw.trim());
  if (days < 1 || days > 3650) {
    throw new Error(`RESULT_RETENTION_DAYS must be between 1 and 3650, got ${days}`);
  }
  return days;
}

/**
 * Index definitions, as data, so they can be tested without a database.
 * @param {number} retentionDays
 * @returns {{ collection: string, key: Record<string, 1 | -1 | 'text'>, options: import('mongodb').CreateIndexesOptions }[]}
 */
export function indexSpecs(retentionDays) {
  const resultTtl = retentionDays * DAY_SECONDS;
  return [
    // runs
    { collection: 'runs', key: { userId: 1, createdAt: -1 }, options: { name: 'userId_createdAt' } },
    {
      collection: 'runs',
      key: { createdAt: 1 },
      options: { name: 'createdAt_ttl', expireAfterSeconds: resultTtl },
    },
    // results
    { collection: 'results', key: { runId: 1 }, options: { name: 'runId' } },
    { collection: 'results', key: { userId: 1, createdAt: -1 }, options: { name: 'userId_createdAt' } },
    // `default_language: 'none'` turns off stemming and stop-words: they make no sense for
    // personal names, and would mangle Devanagari ones.
    {
      collection: 'results',
      key: { candidateName: 'text' },
      options: { name: 'candidateName_text', default_language: 'none' },
    },
    {
      collection: 'results',
      key: { createdAt: 1 },
      options: { name: 'createdAt_ttl', expireAfterSeconds: resultTtl },
    },
    // audit_logs
    {
      collection: 'audit_logs',
      key: { createdAt: 1 },
      options: { name: 'createdAt_ttl', expireAfterSeconds: AUDIT_LOG_TTL_DAYS * DAY_SECONDS },
    },
    // rate_limits
    {
      collection: 'rate_limits',
      key: { windowStart: 1 },
      options: { name: 'windowStart_ttl', expireAfterSeconds: RATE_LIMIT_TTL_SECONDS },
    },
    // Phase 5: needed BEFORE any account exists (Phase 1 known issue 4) and by the login throttle.
    // rate_limits: one counter row per (key, window); the unique index makes concurrent first requests safe.
    {
      collection: 'rate_limits',
      key: { key: 1, windowStart: 1 },
      options: { name: 'key_windowStart', unique: true },
    },
    // users: one account per address, compared case-insensitively (strength 2). Addresses are also stored lower case.
    {
      collection: 'users',
      key: { email: 1 },
      options: { name: 'email_unique', unique: true, collation: { locale: 'en', strength: 2 } },
    },
    // sessions (Auth.js adapter): the lookup key, per-user revocation, and removal of expired sessions.
    {
      collection: 'sessions',
      key: { sessionToken: 1 },
      options: { name: 'sessionToken_unique', unique: true },
    },
    { collection: 'sessions', key: { userId: 1 }, options: { name: 'userId' } },
    { collection: 'sessions', key: { expires: 1 }, options: { name: 'expires_ttl', expireAfterSeconds: 0 } },
    // accounts (Auth.js adapter): one row per linked provider account.
    {
      collection: 'accounts',
      key: { provider: 1, providerAccountId: 1 },
      options: { name: 'provider_account_unique', unique: true },
    },
    { collection: 'accounts', key: { userId: 1 }, options: { name: 'userId' } },
    // email_tokens (verification and reset links, stored hashed): lookup by hash, per-user replacement, and expiry.
    {
      collection: 'email_tokens',
      key: { tokenHash: 1 },
      options: { name: 'tokenHash_unique', unique: true },
    },
    { collection: 'email_tokens', key: { userId: 1, type: 1 }, options: { name: 'userId_type' } },
    {
      collection: 'email_tokens',
      key: { expiresAt: 1 },
      options: { name: 'expiresAt_ttl', expireAfterSeconds: 0 },
    },
  ];
}

// MongoDB error codes for "same index name/keys, different options".
const INDEX_OPTIONS_CONFLICT = 85;
const INDEX_KEY_SPECS_CONFLICT = 86;

/**
 * Create every index. Returns one line per index describing what happened.
 * @param {import('mongodb').Db} db
 * @param {{ retentionDays?: number }} [opts]
 * @returns {Promise<string[]>}
 */
export async function ensureIndexes(
  db,
  { retentionDays = parseRetentionDays(process.env.RESULT_RETENTION_DAYS) } = {},
) {
  const report = [];
  for (const { collection, key, options } of indexSpecs(retentionDays)) {
    const label = `${collection}.${options.name}`;
    try {
      await db.collection(collection).createIndex(key, options);
      report.push(`ok       ${label}`);
    } catch (err) {
      const conflict = err?.code === INDEX_OPTIONS_CONFLICT || err?.code === INDEX_KEY_SPECS_CONFLICT;
      if (conflict && options.expireAfterSeconds !== undefined) {
        // Only the TTL changed (retention period edited): update it in place.
        await db.command({
          collMod: collection,
          index: { name: options.name, expireAfterSeconds: options.expireAfterSeconds },
        });
        report.push(`updated  ${label} (expireAfterSeconds=${options.expireAfterSeconds})`);
      } else {
        throw err;
      }
    }
  }
  return report;
}
