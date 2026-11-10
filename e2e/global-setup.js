// Playwright runs against a SEPARATE database (`<MONGODB_DB>_test`) so that tests never touch real accounts. This drops it before the
// run (clean rate limits and users) and after it. It refuses to drop anything whose name does not end in `_test`.
import { MongoClient } from 'mongodb';
import { TEST_DB } from './helpers/testEnv.js';

async function dropTestDb() {
  if (!TEST_DB.endsWith('_test'))
    throw new Error('refusing to drop a database that is not a *_test database');
  if (!process.env.MONGODB_URI) return;
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    await client.db(TEST_DB).dropDatabase();
  } finally {
    await client.close();
  }
}

// `next dev` compiles a route on its first request and may hot-reload the page a test is on. Hitting every route once here (invalid
// requests only: nothing is created) keeps compilation out of the tests.
async function warmUp(origin) {
  const headers = { 'content-type': 'application/json' };
  for (const page of [
    '/login',
    '/signup',
    '/forgot-password',
    '/reset-password?token=x',
    '/verify-email?token=x',
    '/dashboard',
  ]) {
    await fetch(origin + page, { redirect: 'manual' }).catch(() => {});
  }
  for (const route of ['signup', 'login', 'verify-email', 'forgot-password', 'reset-password']) {
    await fetch(`${origin}/api/auth/account/${route}`, { method: 'POST', headers, body: '{}' }).catch(
      () => {},
    );
  }
  await fetch(`${origin}/api/verify`, { method: 'POST', headers, body: '{}' }).catch(() => {});
}

export default async function globalSetup(config) {
  await dropTestDb();
  const origin = config.projects[0].use.baseURL ?? 'http://localhost:3000';
  if (!process.env.PLAYWRIGHT_BASE_URL) await warmUp(origin);
  return dropTestDb;
}
