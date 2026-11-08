import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isVerifyEndpointEnabled } from '../../src/lib/verify/guard.js';

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
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe('isVerifyEndpointEnabled (temporary guard; Phase 5 removes it)', () => {
  it('is enabled outside production (dev, tests)', () => {
    expect(isVerifyEndpointEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(isVerifyEndpointEnabled({ NODE_ENV: 'test' })).toBe(true);
  });
  it('is DISABLED in production by default', () => {
    expect(isVerifyEndpointEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(isVerifyEndpointEnabled({ NODE_ENV: 'production', VERCEL_ENV: 'production' })).toBe(false);
  });
  it('is enabled on a Vercel Preview only with VERIFY_DEV_ENDPOINT=1', () => {
    const preview = { NODE_ENV: 'production', VERCEL_ENV: 'preview' };
    expect(isVerifyEndpointEnabled(preview)).toBe(false);
    expect(isVerifyEndpointEnabled({ ...preview, VERIFY_DEV_ENDPOINT: '1' })).toBe(true);
    expect(isVerifyEndpointEnabled({ ...preview, VERIFY_DEV_ENDPOINT: 'true' })).toBe(false);
    expect(isVerifyEndpointEnabled({ ...preview, VERIFY_DEV_ENDPOINT: '0' })).toBe(false);
  });
  it('setting VERIFY_DEV_ENDPOINT on PRODUCTION (or an unknown environment) does not open it', () => {
    expect(
      isVerifyEndpointEnabled({ NODE_ENV: 'production', VERCEL_ENV: 'production', VERIFY_DEV_ENDPOINT: '1' }),
    ).toBe(false);
    expect(isVerifyEndpointEnabled({ NODE_ENV: 'production', VERIFY_DEV_ENDPOINT: '1' })).toBe(false); // `next start`
    expect(
      isVerifyEndpointEnabled({
        NODE_ENV: 'production',
        VERCEL_ENV: 'development',
        VERIFY_DEV_ENDPOINT: '1',
      }),
    ).toBe(false);
  });
});

describe('POST /api/verify', () => {
  it('maxDuration fits the 20 s verification budget and the Hobby limit', () => {
    expect(maxDuration).toBe(30);
  });

  it('is a 404 with no work done when the guard says no', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await post(JSON.stringify({ url: 'https://nptel.ac.in/verify/NOC-TEST-FIXT-URE01' }));
    expect(res.status).toBe(404);
    expect(verifySource).not.toHaveBeenCalled();
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
