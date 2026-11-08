// Phase 2: extractCertificate in a REAL browser (Chromium), through the dev scratch page.
//
// Real certificates are never committed: they are read from the gitignored `samples/` folder, and
// their expected values from `samples/expected.local.json`. Without them those tests are skipped.
// Tests on committed fixtures and generated inputs run everywhere.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '..');
const SAMPLES = path.join(ROOT, 'samples');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'pdf');
const expectedPath = path.join(SAMPLES, 'expected.local.json');
const expected = fs.existsSync(expectedPath) ? JSON.parse(fs.readFileSync(expectedPath, 'utf8')) : {};
const haveSamples = Object.keys(expected).some((k) => !k.startsWith('_'));

/**
 * Feed files to the scratch page and read back the JSON that extractCertificate returned.
 * @param {import('@playwright/test').Page} page
 * @param {(string | { name: string, mimeType: string, buffer: Buffer })[]} files
 */
async function extract(page, files, query = '') {
  await page.goto(`/dev/extract${query}`);
  await page.getByTestId('file-input').setInputFiles(files);
  await page.getByTestId('status').filter({ hasText: 'done' }).waitFor({ timeout: 120_000 });
  const out = {};
  for (const f of files) {
    const name = typeof f === 'string' ? path.basename(f) : f.name;
    out[name] = JSON.parse(await page.getByTestId(`result-${name}`).innerText());
  }
  return out;
}

test.describe('real samples (local only)', () => {
  test.skip(!haveSamples, 'samples/ and samples/expected.local.json are not present');

  for (const [file, want] of Object.entries(expected)) {
    if (file.startsWith('_')) continue;
    test(`extracts ${file}`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const external = new Set();
      page.on('request', (r) => {
        const u = new URL(r.url());
        if (/^https?:$/.test(u.protocol) && u.hostname !== 'localhost') external.add(u.hostname);
      });

      const got = (await extract(page, [path.join(SAMPLES, file)]))[file];

      expect(got.errors, JSON.stringify(got.errors)).toEqual([]);
      expect({
        name: got.name,
        course: got.course,
        assignment: got.assignment,
        exam: got.exam,
        verifyUrl: got.verifyUrl,
        certificateId: got.certificateId,
        rollNo: got.rollNo,
        source: got.source,
      }).toEqual(want);
      expect(got.timings.totalMs).toBeLessThan(8000);
      expect(errors).toEqual([]);
      // Privacy / CSP groundwork: no third-party requests while reading a certificate.
      expect([...external]).toEqual([]);
    });
  }

  test('the tampered screenshot reads the EDITED marks and the same QR as the genuine one', async ({
    page,
  }) => {
    test.skip(!expected['NPTEL.png'] || !expected['NPTEL_tampered.png'], 'needs both PNG samples');
    const r = await extract(page, [
      path.join(SAMPLES, 'NPTEL.png'),
      path.join(SAMPLES, 'NPTEL_tampered.png'),
    ]);
    expect(r['NPTEL_tampered.png'].verifyUrl).toBe(r['NPTEL.png'].verifyUrl);
    expect([r['NPTEL_tampered.png'].assignment, r['NPTEL_tampered.png'].exam]).toEqual([20, 70]);
    expect([r['NPTEL.png'].assignment, r['NPTEL.png'].exam]).toEqual([22.5, 61.88]);
  });

  test('OCR budget exceeded gives "not confirmed (timeout)" and no values', async ({ page }) => {
    test.skip(!expected['NPTEL.png'], 'needs NPTEL.png');
    const got = (await extract(page, [path.join(SAMPLES, 'NPTEL.png')], '?budget=1'))['NPTEL.png'];
    expect(got.errors.map((e) => e.code)).toContain('ocr_timeout');
    expect(got.errors.find((e) => e.code === 'ocr_timeout').message).toBe('not confirmed (timeout)');
    expect([got.name, got.course, got.assignment, got.exam]).toEqual([null, null, null, null]);
    expect(got.verifyUrl).toBe(expected['NPTEL.png'].verifyUrl); // the QR does not depend on OCR
    // and the engine recovers: the next certificate works normally
    const again = (await extract(page, [path.join(SAMPLES, 'NPTEL.png')]))['NPTEL.png'];
    expect(again.errors).toEqual([]);
    expect(again.assignment).toBe(22.5);
  });

  test('a JPEG (the PNG re-encoded as a lossy JPG in the browser) goes through the same engine', async ({
    page,
  }) => {
    test.skip(!expected['NPTEL.png'], 'needs NPTEL.png');
    await page.goto('/dev/extract');
    const png = fs.readFileSync(path.join(SAMPLES, 'NPTEL.png'));
    for (const quality of [0.92, 0.75]) {
      const jpg = await page.evaluate(
        async ({ b64, quality }) => {
          const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
          const c = document.createElement('canvas');
          c.width = bitmap.width;
          c.height = bitmap.height;
          c.getContext('2d').drawImage(bitmap, 0, 0);
          const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
          return Array.from(new Uint8Array(await blob.arrayBuffer()));
        },
        { b64: png.toString('base64'), quality },
      );
      const name = `q${Math.round(quality * 100)}.jpg`;
      const got = (await extract(page, [{ name, mimeType: 'image/jpeg', buffer: Buffer.from(jpg) }]))[name];
      const want = expected['NPTEL.png'];
      expect(got.errors, `${name}: ${JSON.stringify(got.errors)}`).toEqual([]);
      expect([got.name, got.course, got.assignment, got.exam, got.verifyUrl]).toEqual([
        want.name,
        want.course,
        want.assignment,
        want.exam,
        want.verifyUrl,
      ]);
    }
  });

  test('PDF bytes: pdf.js detaches the ORIGINAL buffer (control); readPdf keeps its own copy intact', async ({
    page,
  }) => {
    const pdf = Object.keys(expected).find((k) => k.endsWith('.pdf'));
    test.skip(!pdf, 'needs a PDF sample');
    await extract(page, [path.join(SAMPLES, pdf)]);
    const checks = JSON.parse(await page.getByTestId(`pdfchecks-${pdf}`).innerText());
    // The known fact, measured: handing pdf.js the original buffer detaches it...
    expect(checks.controlBefore).toBe(checks.fileSize);
    expect(checks.controlAfter).toBe(0);
    // ...and our copy-first loader leaves the retained bytes whole and still a PDF.
    expect(checks.keptBytesLength).toBe(checks.fileSize);
    expect(checks.keptBytesMagic).toBe('%PDF-');
  });
});

test.describe('committed fixtures and generated inputs', () => {
  test('a PDF with a text layer but no QR: values from the text layer, specific QR failure', async ({
    page,
  }) => {
    const file = path.join(FIXTURES, 'synthetic-genuine-style.pdf');
    const got = (await extract(page, [file]))['synthetic-genuine-style.pdf'];
    expect(got).toMatchObject({
      name: 'ASHA RAMESH KULKARNI',
      course: 'DATA ANALYTICS WITH PYTHON',
      assignment: 12.25,
      exam: 40.5,
      rollNo: 'NPTEL25MG18S000000003',
      source: 'text_layer',
      verifyUrl: null,
      certificateId: null,
    });
    expect(got.errors.map((e) => e.code)).toEqual(['qr_not_found']);
    expect(got.errors[0].field).toBe('verifyUrl');
    expect(got.timings.ocrMs).toBeUndefined(); // a complete text layer never triggers OCR
  });

  test('the tampered-metadata PDF still extracts (its edited marks are what the text layer says)', async ({
    page,
  }) => {
    const got = (await extract(page, [path.join(FIXTURES, 'synthetic-tampered-metadata.pdf')]))[
      'synthetic-tampered-metadata.pdf'
    ];
    expect([got.assignment, got.exam]).toEqual([25, 75]);
  });

  test('a file that is not a certificate format is refused with unsupported_type', async ({ page }) => {
    const r = await extract(page, [
      { name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('this is plain text, not a PNG') },
    ]);
    expect(r['notes.png'].errors.map((e) => e.code)).toEqual(['unsupported_type']);
    expect(r['notes.png'].name).toBeNull();
  });

  test('a corrupt PDF gives pdf_unreadable, not a crash', async ({ page }) => {
    const r = await extract(page, [
      { name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nnot really a pdf') },
    ]);
    expect(r['broken.pdf'].errors.map((e) => e.code)).toEqual(['pdf_unreadable']);
  });

  test('a blank image: every field is not confirmed and each failure says why; nothing is guessed', async ({
    page,
  }) => {
    await page.goto('/dev/extract');
    const png = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 900;
      c.height = 640;
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, 900, 640);
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    const r = await extract(page, [{ name: 'blank.png', mimeType: 'image/png', buffer: Buffer.from(png) }]);
    const got = r['blank.png'];
    expect([got.name, got.course, got.assignment, got.exam, got.verifyUrl]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(got.source).toBe('ocr');
    const codes = got.errors.map((e) => e.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'qr_not_found',
        'name_not_confirmed',
        'course_not_confirmed',
        'marks_not_confirmed',
      ]),
    );
  });
});
