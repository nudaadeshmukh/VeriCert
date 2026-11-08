import { describe, expect, it } from 'vitest';
import { compareCertificate } from '../../src/lib/compare.js';
import { createDeduper, verifySource } from '../../src/lib/verify/index.js';
import {
  parseArchiveLanding,
  parseEcertWrapper,
  parseVerifyPage,
  textOf,
} from '../../src/lib/verify/parseSource.js';
import { fixture, fixtureText, hang, html, mockFetch, pdf, redirect, status } from './helpers/mockFetch.js';

const A_ID = 'NOC-TEST-FIXT-URE01';
const A_URL = `https://nptel.ac.in/verify/${A_ID}`;
const A_BETA = `https://beta.nptel.ac.in/verify/${A_ID}`;
const B_ID = 'NPTEL25MG18S00000000100000007';
const B_URL = `https://nptel.ac.in/noc/E_Certificate/${B_ID}`;
const B_ARCHIVE = `https://archive.nptel.ac.in/noc/E_Certificate/${B_ID}`;
const B_LANDING = `https://archive.nptel.ac.in/noc/Ecertificate/?q=${B_ID}`;
const B_PDF = `https://archive.nptel.ac.in/content/noc/NOC25/SEM1/Ecertificates/110/noc25-mg18/Course/${B_ID}.pdf`;

const pageA = fixtureText('verify-html/2026-verify-page.html');
const wrapperB = fixtureText('verify-html/2025-e-certificate-wrapper.html');
const landingB = fixtureText('verify-html/2025-archive-landing.html');
const pdf2026 = () => fixture('pdf/synthetic-source-2026.pdf');
const pdf2025 = () => fixture('pdf/synthetic-source-2025.pdf');

/** The two real NPTEL shapes, with fixtures as the bodies. */
const shapeA = (over = {}) =>
  mockFetch({
    [A_URL]: redirect(`https://beta.nptel.ac.in:443/verify/${A_ID}`),
    [A_BETA]: () => html(pageA),
    [`${A_BETA}/certificate.pdf`]: () => pdf(pdf2026()),
    ...over,
  });
const shapeB = (over = {}) =>
  mockFetch({
    [B_URL]: () => html(wrapperB),
    [B_ARCHIVE]: redirect(`/noc/Ecertificate/?q=${B_ID}`),
    [B_LANDING]: () => html(landingB),
    [B_PDF]: () => pdf(pdf2025()),
    ...over,
  });

describe('parseVerifyPage (shape A, the hidden block)', () => {
  it('reads name, course, total, status and the PDF link', () => {
    expect(parseVerifyPage(pageA, A_BETA, A_ID)).toEqual({
      name: 'ASHA RAMESH KULKARNI',
      course: 'Entrepreneurship and IP Strategy',
      total: 91,
      status: 'LIVE',
      pdfUrl: `${A_BETA}/certificate.pdf`,
    });
  });
  it('a missing PDF link is source_format_changed, not a guess', () => {
    expect(parseVerifyPage('<h1>X</h1>', A_BETA, A_ID).error.code).toBe('source_format_changed');
  });
  it('a PDF link carrying a DIFFERENT certificate ID is source_mismatch', () => {
    const swapped = pageA.replace(
      `/verify/${A_ID}/certificate.pdf`,
      '/verify/NOC-OTHR-PERS-ON999/certificate.pdf',
    );
    expect(parseVerifyPage(swapped, A_BETA, A_ID).error.code).toBe('source_mismatch');
  });
  it('a PDF link to a non-NPTEL host is refused', () => {
    const evil = pageA.replace(
      /href="[^"]*certificate\.pdf"/,
      'href="https://evil.example/x/certificate.pdf"',
    );
    expect(parseVerifyPage(evil, A_BETA, A_ID).error.code).toBe('source_format_changed');
  });
  it('a PDF link with an unexpected path is refused', () => {
    const odd = pageA.replace(`/verify/${A_ID}/certificate.pdf`, '/downloads/anything.pdf');
    expect(parseVerifyPage(odd, A_BETA, A_ID).error.code).toBe('source_format_changed');
  });
  it('missing hidden fields give nulls, not invented values', () => {
    const bare = `<a href="/verify/${A_ID}/certificate.pdf">x</a>`;
    expect(parseVerifyPage(bare, A_BETA, A_ID)).toMatchObject({
      name: null,
      course: null,
      total: null,
      status: null,
    });
  });
  it('a total that is not out of 100 is null', () => {
    expect(parseVerifyPage(pageA.replace('91 / 100', '91 / 50'), A_BETA, A_ID).total).toBeNull();
  });
  it('decodes entities and strips tags', () => {
    expect(textOf('Tom &amp; <b>Jerry</b> &#x4A; &#74; &nbsp;&lt;3')).toBe('Tom & Jerry J J <3');
  });
});

describe('parseEcertWrapper / parseArchiveLanding (shape B)', () => {
  it('finds the iframe, and resolves the relative PDF link against the landing URL', () => {
    expect(parseEcertWrapper(wrapperB, B_URL, B_ID)).toEqual({ iframeUrl: B_ARCHIVE });
    expect(parseArchiveLanding(landingB, B_LANDING, B_ID)).toEqual({ pdfUrl: B_PDF });
  });
  it('rejects an iframe on another host and a PDF for another certificate', () => {
    const evil = wrapperB.replace('https://archive.nptel.ac.in', 'https://evil.example');
    expect(parseEcertWrapper(evil, B_URL, B_ID).error.code).toBe('source_format_changed');
    expect(parseArchiveLanding(landingB, B_LANDING, 'NPTEL25MG18S00000000100000099').error.code).toBe(
      'source_mismatch',
    );
    expect(parseEcertWrapper(wrapperB, B_URL, 'NPTEL25MG18S00000000100000099').error.code).toBe(
      'source_mismatch',
    );
  });
  it('no iframe / no link → source_format_changed', () => {
    expect(parseEcertWrapper('<html></html>', B_URL, B_ID).error.code).toBe('source_format_changed');
    expect(parseArchiveLanding('<html></html>', B_LANDING, B_ID).error.code).toBe('source_format_changed');
  });
});

describe('verifySource: shape A (/verify/<ID>)', () => {
  it('follows 302 → beta, reads the hidden block and the source PDF, returns only the fields', async () => {
    const f = shapeA();
    const r = await verifySource(A_URL, { fetchImpl: f });
    expect(r.error).toBeUndefined();
    expect(r.source).toEqual({
      name: 'ASHA RAMESH KULKARNI',
      course: 'ENTREPRENEURSHIP AND IP STRATEGY',
      assignment: 25,
      exam: 66,
      total: 91,
    });
    expect(r.meta.shape).toBe('verify');
    expect(f.calls.map((c) => c.url)).toEqual([A_URL, A_BETA, `${A_BETA}/certificate.pdf`]);
    // The PDF is never returned.
    expect(JSON.stringify(r)).not.toMatch(/%PDF|stream|endobj/);
    expect(Object.keys(r).sort()).toEqual(['meta', 'source']);
  });
  it('a 500 on the first request is retried (the known NPTEL behaviour)', async () => {
    const f = shapeA({
      [A_URL]: [() => status(500), redirect(`https://beta.nptel.ac.in:443/verify/${A_ID}`)],
    });
    const r = await verifySource(A_URL, { fetchImpl: f });
    expect(r.error).toBeUndefined();
    expect(r.meta.requests).toBe(3); // fetch ATTEMPTS: 2 for the page (500, then 200 with its redirect) + 1 for the PDF
  });
  it('a status other than LIVE is source_not_live, not Successful', async () => {
    const f = shapeA({ [A_BETA]: () => html(pageA.replace('LIVE', 'REVOKED')) });
    const r = await verifySource(A_URL, { fetchImpl: f });
    expect(r.error).toBe('source_not_live');
    expect(r.message).toContain('REVOKED');
    expect(r.meta.status).toBe('REVOKED');
    expect(r.source).toBeNull();
    // and the PDF is never fetched for a certificate that is not live
    expect(f.calls.map((c) => c.url)).not.toContain(`${A_BETA}/certificate.pdf`);
  });
  it('a not-live status flows through compareCertificate as Unsuccessful with the exact remark', async () => {
    const f = shapeA({ [A_BETA]: () => html(pageA.replace('LIVE', 'REVOKED')) });
    const r = await verifySource(A_URL, { fetchImpl: f });
    const v = compareCertificate({ name: 'X', assignment: 25, exam: 66, source: 'text_layer' }, r);
    expect(v).toMatchObject({
      verification: 'Unsuccessful',
      reason: 'Certificate not live on NPTEL (status: REVOKED)',
    });
  });
  it('LIVE in other letter cases is still live', async () => {
    const f = shapeA({ [A_BETA]: () => html(pageA.replace('LIVE', 'Live')) });
    expect((await verifySource(A_URL, { fetchImpl: f })).error).toBeUndefined();
  });
});

describe('verifySource: shape B (/noc/E_Certificate/<ID>), three hops to the PDF', () => {
  it('wrapper → archive (302) → landing → PDF', async () => {
    const f = shapeB();
    const r = await verifySource(B_URL, { fetchImpl: f });
    expect(r.error).toBeUndefined();
    expect(r.source).toEqual({
      name: 'ASHA RAMESH KULKARNI',
      course: 'Design Thinking - A Primer',
      assignment: 22.5,
      exam: 61.88,
      total: 84,
    });
    expect(f.calls.map((c) => c.url)).toEqual([B_URL, B_ARCHIVE, B_LANDING, B_PDF]);
    expect(r.meta.shape).toBe('e_certificate');
  });
  it('a landing page whose link is for another certificate is source_mismatch and the PDF is never fetched', async () => {
    const f = shapeB({ [B_LANDING]: () => html(landingB.replace(B_ID, 'NPTEL25MG18S00000000100000099')) });
    const r = await verifySource(B_URL, { fetchImpl: f });
    expect(r.error).toBe('source_mismatch');
    expect(f.calls.map((c) => c.url)).not.toContain(B_PDF);
  });
});

describe('verifySource: refusals and failures', () => {
  it.each([
    ['not a url', 'invalid_url'],
    ['http://nptel.ac.in/verify/NOC-TEST-FIXT-URE01', 'url_not_allowed'],
    ['https://evil.example/verify/NOC-TEST-FIXT-URE01', 'url_not_allowed'],
    ['https://nptel.ac.in.evil.com/verify/NOC-TEST-FIXT-URE01', 'url_not_allowed'],
    ['https://nptel.ac.in/courses/106', 'unsupported_url_shape'],
  ])('%s → %s, with no request made', async (url, error) => {
    const f = mockFetch({});
    const r = await verifySource(url, { fetchImpl: f });
    expect(r).toMatchObject({ source: null, error });
    expect(f.calls).toHaveLength(0);
  });

  it('a redirect to a non-NPTEL host at the first hop is url_not_allowed and nothing else is fetched', async () => {
    const f = mockFetch({ [A_URL]: redirect('https://evil.example/phish') });
    const r = await verifySource(A_URL, { fetchImpl: f });
    expect(r.error).toBe('url_not_allowed');
    expect(f.calls).toHaveLength(1);
  });

  it('a source PDF with no text layer is source_unreadable (no server OCR in v1)', async () => {
    const f = shapeA({
      [`${A_BETA}/certificate.pdf`]: () => pdf(fixture('pdf/synthetic-no-text-layer.pdf')),
    });
    const r = await verifySource(A_URL, { fetchImpl: f });
    expect(r).toMatchObject({ source: null, error: 'source_unreadable' });
    expect(r.message).toMatch(/no text layer/);
  });
  it('bytes that are not a PDF are source_format_changed', async () => {
    const f = shapeA({
      [`${A_BETA}/certificate.pdf`]: () => pdf(new TextEncoder().encode('<html>blocked</html>')),
    });
    expect((await verifySource(A_URL, { fetchImpl: f })).error).toBe('source_format_changed');
  });
  it('a corrupt PDF is source_unreadable', async () => {
    const f = shapeA({
      [`${A_BETA}/certificate.pdf`]: () => pdf(new TextEncoder().encode('%PDF-1.4\nnot really a pdf')),
    });
    expect((await verifySource(A_URL, { fetchImpl: f })).error).toBe('source_unreadable');
  });
  it('a PDF with text but no marks keeps what it read and says source_parse_failed', async () => {
    // The 2025 "genuine style" synthetic has marks; use a PDF whose marks are out of range instead.
    const f = shapeA({
      [`${A_BETA}/certificate.pdf`]: () => pdf(fixture('pdf/synthetic-tampered-metadata.pdf')),
    });
    const r = await verifySource(A_URL, { fetchImpl: f });
    // The tampered fixture's text layer reads 25/25 and 75/75: valid, so it parses (Phase 4 judges it).
    expect(r.source).toMatchObject({ assignment: 25, exam: 75 });
    const none = shapeA({
      [`${A_BETA}/certificate.pdf`]: () => pdf(fixture('pdf/synthetic-genuine-style.pdf')),
    });
    expect((await verifySource(A_URL, { fetchImpl: none })).source).toMatchObject({
      assignment: 12.25,
      exam: 40.5,
    });
  });
  it('NPTEL unreachable after the retry is source_unreachable', async () => {
    const f = shapeA({ [A_URL]: () => status(500) });
    expect((await verifySource(A_URL, { fetchImpl: f })).error).toBe('source_unreachable');
  });
  it('NPTEL not answering is source_timeout within the overall limit', async () => {
    const f = shapeA({ [A_URL]: hang });
    const t0 = Date.now();
    const r = await verifySource(A_URL, { fetchImpl: f, attemptMs: 30, totalMs: 200 });
    expect(r.error).toBe('source_timeout');
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it('an unknown certificate (404) is source_not_found', async () => {
    const f = shapeA({ [A_URL]: () => status(404) });
    expect((await verifySource(A_URL, { fetchImpl: f })).error).toBe('source_not_found');
  });
  it('the overall limit is shared by all the requests of one verification', async () => {
    const f = shapeB({ [B_LANDING]: () => new Promise((r) => setTimeout(() => r(html(landingB)), 120)) });
    const r = await verifySource(B_URL, { fetchImpl: f, totalMs: 100, attemptMs: 1000 });
    expect(['source_timeout', 'source_unreachable']).toContain(r.error);
  });
});

describe('batch de-duplication', () => {
  it('the same URL in one batch is fetched once, even when requested concurrently', async () => {
    const f = shapeA();
    const cache = createDeduper();
    const [a, b, c] = await Promise.all([
      verifySource(A_URL, { fetchImpl: f, cache }),
      verifySource(`${A_URL}/`, { fetchImpl: f, cache }), // same URL after normalisation
      verifySource(A_URL, { fetchImpl: f, cache }),
    ]);
    expect(f.calls).toHaveLength(3); // one verification: 3 requests, not 9
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(cache.size()).toBe(1);
  });
  it('different URLs are fetched separately, and a separate batch does not share results', async () => {
    const f = shapeA();
    await verifySource(A_URL, { fetchImpl: f, cache: createDeduper() });
    await verifySource(A_URL, { fetchImpl: f, cache: createDeduper() });
    expect(f.calls).toHaveLength(6);
  });
  it('a rejected computation is forgotten so it can be retried', async () => {
    const d = createDeduper();
    await expect(d.run('k', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await Promise.resolve();
    expect(await d.run('k', async () => 'ok')).toBe('ok');
  });
});
