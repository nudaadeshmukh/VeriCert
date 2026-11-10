import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from './helpers/fakeDb.js';

const auth = vi.fn();
const getDb = vi.fn();
vi.mock('../../src/lib/auth/auth.js', () => ({ auth: () => auth() }));
vi.mock('../../src/lib/db/client.js', () => ({ getDb: () => getDb() }));
vi.mock('next/navigation', () => ({
  redirect: (to) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to });
  },
}));

const { requireAdmin, requirePageUser, requireUser } = await import('../../src/lib/auth/guards.js');
const { emailStubEnabled } = await import('../../src/lib/auth/email.js');
const { SESSION_COOKIE_NAMES } = await import('../../src/lib/auth/config.js');

let db;
const addUser = async (over = {}) => {
  const { insertedId } = await db
    .collection('users')
    .insertOne({ email: 'staff@pict.edu', emailVerified: new Date(), disabled: false, ...over });
  auth.mockResolvedValue({ user: { id: String(insertedId) } });
  return insertedId;
};

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAIL_DOMAIN', 'pict.edu');
  vi.stubEnv('ADMIN_EMAILS', 'admin@pict.edu');
  db = fakeDb();
  getDb.mockResolvedValue(db);
  auth.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('requireUser', () => {
  it('no session is 401', async () => {
    auth.mockResolvedValue(null);
    const g = await requireUser();
    expect(g).toMatchObject({ ok: false, status: 401, code: 'no_session' });
    expect(g.response.status).toBe(401);
  });
  it('a session whose user id is not an ObjectId is refused (never a pass)', async () => {
    auth.mockResolvedValue({ user: { id: 'not-an-id' } });
    const g = await requireUser();
    expect(g.ok).toBe(false);
    expect([401, 503]).toContain(g.status);
  });
  it('a session whose user no longer exists is 401', async () => {
    auth.mockResolvedValue({ user: { id: String(new ObjectId()) } });
    expect((await requireUser()).status).toBe(401);
  });
  it('a valid verified @pict.edu user passes, with the id to filter by', async () => {
    const id = await addUser();
    const g = await requireUser();
    expect(g.ok).toBe(true);
    expect(g.user).toMatchObject({ id: String(id), email: 'staff@pict.edu', role: 'user' });
  });
  it('a wrong domain is 403 and the account is signed out and audited', async () => {
    const id = await addUser({ email: 'x@gmail.com' });
    await db.collection('sessions').insertOne({ sessionToken: 't2', userId: id });
    const g = await requireUser();
    expect(g).toMatchObject({ ok: false, status: 403, code: 'domain_not_allowed' });
    expect(db.all('sessions').filter((s) => String(s.userId) === String(id))).toHaveLength(0);
    expect(db.all('audit_logs')[0]).toMatchObject({ action: 'session_rejected' });
  });
  it.each(['staff@pict.edu.evil.com', 'staff@notpict.edu', 'STAFF@pict.edu', ' staff@pict.edu'])(
    'a stored look-alike or non-canonical address %j is refused',
    async (email) => {
      await addUser({ email });
      expect((await requireUser()).status).toBe(403);
    },
  );
  it('a disabled user is 403', async () => {
    await addUser({ disabled: true });
    expect(await requireUser()).toMatchObject({ ok: false, status: 403, code: 'account_disabled' });
  });
  it('an unverified email is 403', async () => {
    await addUser({ emailVerified: null });
    expect(await requireUser()).toMatchObject({ ok: false, status: 403, code: 'email_not_verified' });
  });
  it('a database error is 503, never a pass', async () => {
    await addUser();
    getDb.mockRejectedValue(new Error('down'));
    expect(await requireUser()).toMatchObject({ ok: false, status: 503 });
  });
  it('a missing ALLOWED_EMAIL_DOMAIN is 503, never a pass', async () => {
    await addUser();
    vi.stubEnv('ALLOWED_EMAIL_DOMAIN', '');
    expect(await requireUser()).toMatchObject({ ok: false, status: 503 });
  });
  it('an error reading the session is 503', async () => {
    auth.mockRejectedValue(new Error('boom'));
    expect((await requireUser()).status).toBe(503);
  });
});

describe('requireAdmin and requirePageUser', () => {
  it('a normal user is 403 not_admin; a listed admin passes', async () => {
    await addUser();
    expect(await requireAdmin()).toMatchObject({ ok: false, status: 403, code: 'not_admin' });
    await addUser({ email: 'admin@pict.edu' });
    const g = await requireAdmin();
    expect(g.ok).toBe(true);
    expect(g.user.role).toBe('admin');
  });
  it('a page redirects signed-out visitors to /login with a next parameter', async () => {
    auth.mockResolvedValue(null);
    await expect(requirePageUser('/dashboard')).rejects.toMatchObject({ to: '/login?next=%2Fdashboard' });
  });
});

describe('email stub safety', () => {
  it('works only outside production and Vercel, and only when asked for', () => {
    expect(emailStubEnabled({ AUTH_EMAIL_STUB: '1' })).toBe(true);
    expect(emailStubEnabled({})).toBe(false);
    expect(emailStubEnabled({ AUTH_EMAIL_STUB: '1', NODE_ENV: 'production' })).toBe(false);
    expect(emailStubEnabled({ AUTH_EMAIL_STUB: '1', VERCEL: '1' })).toBe(false);
  });
});

describe('session cookie names (the proxy looks for these)', () => {
  it('are the Auth.js names', () => {
    expect(Object.values(SESSION_COOKIE_NAMES)).toEqual(
      expect.arrayContaining(['authjs.session-token', '__Secure-authjs.session-token']),
    );
  });
});
