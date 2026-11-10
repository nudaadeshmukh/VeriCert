import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// requireUser() is the real gatekeeper (tested in auth.guards.test.js); here it is a stand-in whose answer each test chooses.
const requireUser = vi.fn();
vi.mock('../../src/lib/auth/guards.js', () => ({ requireUser: () => requireUser() }));
const SIGNED_IN = {
  ok: true,
  user: { id: '64b0c0ffee0000000000abcd', email: 'staff@pict.edu', name: null, role: 'user' },
};
const refused = (status, code) => ({
  ok: false,
  status,
  code,
  response: NextResponse.json({ error: code }, { status }),
});

const verifySource = vi.fn();
vi.mock('../../src/lib/verify/index.js', async (orig) => ({
  ...(await orig()),
  verifySource: (...a) => verifySource(...a),
}));
const { POST, maxDuration } = await import('../../app/api/verify/route.js');

const post = (body, headers = {}) =>
  POST(new Request('http://localhost/api/verify', { method: 'POST', body, headers }));
const ok = {
  source: { name: 'N', course: 'C', assignment: 1, exam: 2, total: 3 },
  meta: { shape: 'verify', ms: 5, requests: 3 },
};

beforeEach(() => {
  verifySource.mockReset();
  requireUser.mockReset();
  requireUser.mockResolvedValue(SIGNED_IN);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/verify requires a user (Phase 5: the Phase 3 dev-only guard is gone)', () => {
  const body = JSON.stringify({ url: 'https://nptel.ac.in/verify/NOC-TEST-FIXT-URE01' });

  it.each([
    [401, 'no_session'],
    [403, 'domain_not_allowed'],
    [403, 'account_disabled'],
    [403, 'email_not_verified'],
    [503, 'service_unavailable'],
  ])('answers %i (%s) and does no work', async (status, code) => {
    requireUser.mockResolvedValue(refused(status, code));
    const res = await post(body);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: code });
    expect(verifySource).not.toHaveBeenCalled();
  });

  it('checks the session BEFORE it reads or validates the body', async () => {
    requireUser.mockResolvedValue(refused(401, 'no_session'));
    expect((await post('this is not json')).status).toBe(401);
    expect((await post(JSON.stringify({ url: 'x', pad: 'y'.repeat(3000) }))).status).toBe(401); // not 413
  });

  it('has no environment switch: NODE_ENV and VERIFY_DEV_ENDPOINT make no difference', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERIFY_DEV_ENDPOINT', '1');
    vi.stubEnv('VERCEL_ENV', 'preview');
    requireUser.mockResolvedValue(refused(401, 'no_session'));
    expect((await post(body)).status).toBe(401);
    requireUser.mockResolvedValue(SIGNED_IN);
    verifySource.mockResolvedValue(ok);
    expect((await post(body)).status).toBe(200);
  });

  it('the Phase 3 stop-gap is deleted', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    expect(fs.existsSync(path.resolve(import.meta.dirname, '../../src/lib/verify/guard.js'))).toBe(false);
    const src = fs.readFileSync(path.resolve(import.meta.dirname, '../../app/api/verify/route.js'), 'utf8');
    expect(src).not.toMatch(/isVerifyEndpointEnabled|guard\.js/);
    expect(src.replace(/\/\/.*$/gm, '')).not.toMatch(/VERIFY_DEV_ENDPOINT/); // only the comment mentions it
  });
});

describe('POST /api/verify', () => {
  it('maxDuration fits the 20 s verification budget and the Hobby limit', () => {
    expect(maxDuration).toBe(30);
  });

  it('returns the verification result as JSON, uncached', async () => {
    verifySource.mockResolvedValue(ok);
    const res = await post(JSON.stringify({ url: 'https://nptel.ac.in/verify/NOC-TEST-FIXT-URE01' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual(ok);
    expect(verifySource).toHaveBeenCalledWith(
      'https://nptel.ac.in/verify/NOC-TEST-FIXT-URE01',
      expect.objectContaining({ cache: expect.anything() }),
    );
  });

  it('a source problem is HTTP 200 with an error code (data, not a server failure)', async () => {
    verifySource.mockResolvedValue({
      source: null,
      error: 'source_unreadable',
      message: 'm',
      meta: { ms: 1 },
    });
    const res = await post(JSON.stringify({ url: 'https://nptel.ac.in/verify/NOC-TEST-FIXT-URE01' }));
    expect(res.status).toBe(200);
    expect((await res.json()).error).toBe('source_unreadable');
  });

  it.each(['invalid_url', 'url_not_allowed', 'unsupported_url_shape'])('%s is HTTP 400', async (error) => {
    verifySource.mockResolvedValue({ source: null, error, message: 'm', meta: { ms: 0 } });
    expect((await post(JSON.stringify({ url: 'https://x.example/' }))).status).toBe(400);
  });

  it.each([
    ['not json', 400],
    [JSON.stringify({}), 400],
    [JSON.stringify({ url: 42 }), 400],
    [JSON.stringify({ url: '' }), 400],
    [JSON.stringify({ url: 'https://nptel.ac.in/' + 'a'.repeat(400) }), 400],
    [JSON.stringify({ url: 'x', pad: 'y'.repeat(3000) }), 413],
    ['null', 400],
  ])('rejects a bad body (%#) with %i and never calls verifySource', async (body, want) => {
    const res = await post(body);
    expect(res.status).toBe(want);
    expect((await res.json()).error).toBe('invalid_request');
    expect(verifySource).not.toHaveBeenCalled();
  });

  it('logs without personal data: no URL, no names', async () => {
    verifySource.mockResolvedValue(ok);
    await post(JSON.stringify({ url: 'https://nptel.ac.in/verify/NOC-TEST-FIXT-URE01' }));
    const line = console.log.mock.calls[0][0];
    expect(JSON.parse(line)).toEqual({
      event: 'verify',
      ok: true,
      error: null,
      shape: 'verify',
      ms: 5,
      requests: 3,
    });
    expect(line).not.toMatch(/NOC-TEST|nptel\.ac\.in/);
  });
});
