// MongoDB client, cached across invocations.
//
// Next.js dev reloads modules on every change, and Vercel reuses warm lambdas, so the
// connection promise lives on `globalThis` (the standard `global._mongoClientPromise`
// pattern). Relative imports with explicit `.js` extensions are used across `src/lib/db`
// so the same files also run under plain Node (`scripts/db-indexes.mjs`).
//
// Fail closed (CLAUDE.md rule 5): missing configuration throws; it never falls back to a
// default URI or database name.
import { MongoClient } from 'mongodb';

/**
 * Read a required environment variable or throw.
 * @param {string} name
 * @returns {string}
 */
function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value.trim();
}

/**
 * Resolve the shared client promise. Throws if `MONGODB_URI` is missing. A failed
 * connection is not cached, so the next call retries.
 * @returns {Promise<import('mongodb').MongoClient>}
 */
export function getClientPromise() {
  const uri = requireEnv('MONGODB_URI');
  if (!globalThis._mongoClientPromise) {
    const client = new MongoClient(uri, {
      // Fail fast: the health check and API routes must answer within Vercel's limits.
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      appName: 'vericert',
    });
    globalThis._mongoClientPromise = client.connect().catch((err) => {
      globalThis._mongoClientPromise = undefined;
      client.close().catch(() => {});
      throw err;
    });
  }
  return globalThis._mongoClientPromise;
}

/**
 * The application database (`MONGODB_DB`, `vericert` in `.env.example`).
 * @returns {Promise<import('mongodb').Db>}
 */
export async function getDb() {
  const name = requireEnv('MONGODB_DB');
  const client = await getClientPromise();
  return client.db(name);
}
