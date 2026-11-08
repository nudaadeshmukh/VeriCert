import { describe, expect, it } from 'vitest';
import { BROWSER_HEADERS, fetchNptel, LIMITS, SourceFetchError } from '../../src/lib/verify/fetchSource.js';
import { hang, html, mockFetch, redirect, status } from './helpers/mockFetch.js';

const U = 'https://nptel.ac.in/verify/NOC-TEST-FIXT-URE01';
const code = async (p) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(SourceFetchError);
    return e.code;
  }
  throw new Error('expected a rejection');
};

describe('allowlist on the first URL', () => {
  it.each([
    'https://evil.com/verify/NOC-TEST-FIXT-URE01',
    'http://nptel.ac.in/verify/NOC-TEST-FIXT-URE01',
    'https://nptel.ac.in.evil.com/verify/x',
    'https://evilnptel.ac.in/verify/x',
    'https://nptel.ac.in@evil.com/verify/x',
    'https://user:pw@nptel.ac.in/verify/x',
    'https://nptel.ac.in:8443/verify/x',
    'https://169.254.169.254/latest/meta-data/',
    'https://localhost/x',
    'file:///etc/passwd',
    'not a url',
  ])('refuses %s without making any request', async (url) => {
    const f = mockFetch({});
    expect(await code(fetchNptel(url, { fetchImpl: f }))).toBe('url_not_allowed');
    expect(f.calls).toHaveLength(0);
  });
});

describe('redirects are followed by hand and every hop is checked', () => {
  it("follows NPTEL's real shape: 302 with an explicit :443 to beta.nptel.ac.in", async () => {
    const f = mockFetch({
      [U]: redirect('https://beta.nptel.ac.in:443/verify/NOC-TEST-FIXT-URE01'),
      'https://beta.nptel.ac.in/verify/NOC-TEST-FIXT-URE01': html('<p>ok</p>'),
    });
    const r = await fetchNptel(U, { fetchImpl: f });
    expect(r.url).toBe('https://beta.nptel.ac.in/verify/NOC-TEST-FIXT-URE01');
    expect(r.hops).toEqual([U, 'https://beta.nptel.ac.in/verify/NOC-TEST-FIXT-URE01']);
    expect(f.calls.every((c) => c.init.redirect === 'manual')).toBe(true);
  });

  it('resolves a relative Location against the current URL', async () => {
    const f = mockFetch({
      'https://archive.nptel.ac.in/noc/E_Certificate/ID123456': redirect('/noc/Ecertificate/?q=ID123456'),
      'https://archive.nptel.ac.in/noc/Ecertificate/?q=ID123456': html('landing'),
    });
    const r = await fetchNptel('https://archive.nptel.ac.in/noc/E_Certificate/ID123456', { fetchImpl: f });
    expect(r.url).toBe('https://archive.nptel.ac.in/noc/Ecertificate/?q=ID123456');
  });

  it.each([
    'https://evil.example/steal',
    'http://nptel.ac.in/verify/downgrade',
    'https://nptel.ac.in.evil.com/verify/x',
    'https://nptel.ac.in@evil.com/x',
    'https://169.254.169.254/latest/meta-data/',
    'https://localhost:3000/api/health',
  ])('a redirect to %s is refused and never requested', async (target) => {
    const f = mockFetch({ [U]: redirect(target) });
    expect(await code(fetchNptel(U, { fetchImpl: f }))).toBe('url_not_allowed');
    expect(f.calls.map((c) => c.url)).toEqual([U]); // only the first hop was fetched
  });

  it('a redirect that bounces back out after a valid hop is caught on the later hop', async () => {
    const f = mockFetch({
      [U]: redirect('https://beta.nptel.ac.in/step2'),
      'https://beta.nptel.ac.in/step2': redirect('https://evil.example/exfil'),
    });
    expect(await code(fetchNptel(U, { fetchImpl: f }))).toBe('url_not_allowed');
    expect(f.calls).toHaveLength(2);
  });

  it('follows at most 5 redirects: 5 is fine, 6 is refused', async () => {
    const chain = (n) => {
      const routes = {};
      for (let i = 0; i < n; i++)
        routes[`https://nptel.ac.in/h${i}`] = redirect(`https://nptel.ac.in/h${i + 1}`);
      routes[`https://nptel.ac.in/h${n}`] = html('end');
      return mockFetch(routes);
    };
    expect((await fetchNptel('https://nptel.ac.in/h0', { fetchImpl: chain(5) })).hops).toHaveLength(6);
    expect(await code(fetchNptel('https://nptel.ac.in/h0', { fetchImpl: chain(6) }))).toBe(
      'too_many_redirects',
    );
  });

  it('a redirect without a Location header is an error, not a loop', async () => {
    const f = mockFetch({ [U]: new Response(null, { status: 302 }) });
    expect(await code(fetchNptel(U, { fetchImpl: f }))).toBe('bad_redirect');
  });
});

describe('retry: one, on a 5xx', () => {
  it('500 then 200 succeeds on the second attempt', async () => {
    const f = mockFetch({ [U]: [() => status(500), () => html('ok')] });
    const r = await fetchNptel(U, { fetchImpl: f });
    expect(r.attempts).toBe(2);
    expect(f.calls).toHaveLength(2);
  });
  it('500 then 500 gives up after exactly two attempts', async () => {
    const f = mockFetch({ [U]: [() => status(500), () => status(503)] });
    expect(await code(fetchNptel(U, { fetchImpl: f }))).toBe('source_unreachable');
    expect(f.calls).toHaveLength(2);
  });
  it('a network error is retried once', async () => {
    const f = mockFetch({ [U]: [new TypeError('fetch failed'), () => html('ok')] });
    expect((await fetchNptel(U, { fetchImpl: f })).attempts).toBe(2);
  });
  it('404 and 410 are source_not_found and are not retried', async () => {
    for (const s of [404, 410]) {
      const f = mockFetch({ [U]: () => status(s) });
      expect(await code(fetchNptel(U, { fetchImpl: f }))).toBe('source_not_found');
      expect(f.calls).toHaveLength(1);
    }
  });
  it('other 4xx (for example a block) is source_http_error, reported and not worked around', async () => {
    const f = mockFetch({ [U]: () => status(403) });
    expect(await code(fetchNptel(U, { fetchImpl: f }))).toBe('source_http_error');
    expect(f.calls).toHaveLength(1);
  });
});

describe('timeouts', () => {
  it('an attempt that hangs is aborted and retried once', async () => {
    const f = mockFetch({ [U]: [hang, () => html('ok')] });
    const r = await fetchNptel(U, { fetchImpl: f, attemptMs: 40 });
    expect(r.attempts).toBe(2);
  });
  it('two hanging attempts give source_timeout', async () => {
    const f = mockFetch({ [U]: hang });
    expect(await code(fetchNptel(U, { fetchImpl: f, attemptMs: 30 }))).toBe('source_timeout');
    expect(f.calls).toHaveLength(2);
  });
  it('the overall limit stops everything even when attempts would allow more', async () => {
    const f = mockFetch({ [U]: hang });
    const t0 = Date.now();
    expect(await code(fetchNptel(U, { fetchImpl: f, attemptMs: 1000, totalMs: 60 }))).toBe('source_timeout');
    expect(Date.now() - t0).toBeLessThan(500);
  });
  it('a deadline shared across calls is honoured', async () => {
    const f = mockFetch({ [U]: () => html('ok') });
    expect(await code(fetchNptel(U, { fetchImpl: f, deadline: Date.now() - 1 }))).toBe('source_timeout');
    expect(f.calls).toHaveLength(0);
  });
  it('the real limits are 8 s per attempt, 20 s in total, 5 redirects, 2 attempts', () => {
    expect(LIMITS).toMatchObject({ attemptMs: 8000, totalMs: 20000, maxHops: 5, maxAttempts: 2 });
  });
});

describe('request shape', () => {
  it('sends browser headers and a plain GET, with an Accept override', async () => {
    const f = mockFetch({ [U]: () => html('ok') });
    await fetchNptel(U, { fetchImpl: f, accept: 'application/pdf' });
    const { init } = f.calls[0];
    expect(init.method).toBe('GET');
    expect(init.headers['User-Agent']).toBe(BROWSER_HEADERS['User-Agent']);
    expect(init.headers['User-Agent']).toMatch(/Mozilla\/5\.0 .*Chrome\//);
    expect(init.headers['Accept-Language']).toBe('en-US,en;q=0.9');
    expect(init.headers.Accept).toBe('application/pdf');
    expect(Object.keys(init.headers).sort()).toEqual(['Accept', 'Accept-Language', 'User-Agent']); // nothing else
  });
});

describe('response size cap', () => {
  it('refuses a declared content-length over the limit', async () => {
    const f = mockFetch({ [U]: () => html('x', { headers: { 'content-length': '999999' } }) });
    expect(await code(fetchNptel(U, { fetchImpl: f, maxBytes: 1000 }))).toBe('source_too_large');
  });
  it('stops reading a streamed body that grows past the limit', async () => {
    const f = mockFetch({ [U]: () => html('y'.repeat(5000)) });
    expect(await code(fetchNptel(U, { fetchImpl: f, maxBytes: 1000 }))).toBe('source_too_large');
  });
  it('returns the bytes when within the limit', async () => {
    const f = mockFetch({ [U]: () => html('hello') });
    expect(new TextDecoder().decode((await fetchNptel(U, { fetchImpl: f })).body)).toBe('hello');
  });
});
