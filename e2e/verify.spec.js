// POST /api/verify, refusals only: none of these reach NPTEL, so they run anywhere. The LIVE test
// (real NPTEL, both URL shapes) is `npm run smoke:nptel`, which is deliberately not part of this suite.
import { expect, test } from '@playwright/test';
import { registerAndLogin } from './helpers/auth.js';

const post = (request, data) =>
  request.post('/api/verify', { data, headers: { 'content-type': 'application/json' } });

test.describe('POST /api/verify (signed in)', () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), 'needs the local server with the email stub');
  test.beforeEach(async ({ request }) => {
    await registerAndLogin(request);
  });

  test('a non-NPTEL host is refused with 400 and no source', async ({ request }) => {
    const res = await post(request, { url: 'https://evil.example/verify/NOC-AAAA-BBBB-CCCCC' });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ source: null, error: 'url_not_allowed' });
  });

  test('look-alike hosts, plain http and unknown paths are refused', async ({ request }) => {
    for (const [url, error] of [
      ['https://nptel.ac.in.evil.com/verify/NOC-AAAA-BBBB-CCCCC', 'url_not_allowed'],
      ['https://nptel.ac.in@evil.com/verify/NOC-AAAA-BBBB-CCCCC', 'url_not_allowed'],
      ['http://nptel.ac.in/verify/NOC-AAAA-BBBB-CCCCC', 'url_not_allowed'],
      ['https://nptel.ac.in/courses/106', 'unsupported_url_shape'],
      ['not a url', 'invalid_url'],
    ]) {
      const res = await post(request, { url });
      expect(res.status(), url).toBe(400);
      expect((await res.json()).error, url).toBe(error);
    }
  });

  test('bad bodies are 400, oversized bodies 413, and GET is not allowed', async ({ request }) => {
    expect((await request.post('/api/verify', { data: 'nope' })).status()).toBe(400);
    expect((await post(request, { nope: 1 })).status()).toBe(400);
    expect((await post(request, { url: 'x', pad: 'y'.repeat(4000) })).status()).toBe(413);
    expect((await request.get('/api/verify')).status()).toBe(405);
  });

  test('responses are never cached', async ({ request }) => {
    const res = await post(request, { url: 'nope' });
    expect(res.headers()['cache-control']).toBe('no-store');
  });
});
