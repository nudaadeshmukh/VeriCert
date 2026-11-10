// Phase 4: the tampering checks on real files, in a REAL browser (Chromium), through /dev/tamper.
//
// Real certificates are never committed: they come from the gitignored `samples/`, with their expected values from
// `samples/expected.local.json`. NPTEL's source for them is stubbed from those same values (they are exactly what NPTEL
// serves; Phase 3's smoke test proved that), so these tests need no network, except the one marked LIVE.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { registerAndLogin } from './helpers/auth.js';
import {
  buildImagePdf,
  drawCertificate,
  editScreenshot,
  hiddenLayer,
} from './helpers/syntheticCertificate.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SAMPLES = path.join(ROOT, 'samples');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'pdf');
const expectedPath = path.join(SAMPLES, 'expected.local.json');
const expected = fs.existsSync(expectedPath) ? JSON.parse(fs.readFileSync(expectedPath, 'utf8')) : {};
const G1 = 'NPTEL Entrepreneurship and IP Strategies.pdf';
const G2 = path.join(SAMPLES, 'derived', 'genuine-2025-nptel-served.pdf');
const haveReal = Boolean(expected[G1] && expected['NPTEL.png'] && expected['NPTEL_tampered.png']);

/** The NPTEL source as the verification service would return it. */
const nptel = (e) => ({
  source: { name: e.name, course: e.course, assignment: e.assignment, exam: e.exam, total: null },
  meta: { shape: 'stub', ms: 0 },
});

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ name: string, mimeType: string, buffer: Buffer } | string} file
 * @param {Record<string, any>} [sourceMap]
 */
async function assess(page, file, sourceMap = {}, query = '') {
  await page.goto(`/dev/tamper${query}`);
  const json = JSON.stringify(sourceMap);
  // The dev page can hot-reload after a file edit and reset the box: make sure the source is in before choosing the file.
  await expect(async () => {
    await page.getByTestId('source-map').fill(json);
    await expect(page.getByTestId('source-map')).toHaveValue(json);
  }).toPass({ timeout: 15_000 });
  await page.getByTestId('file-input').setInputFiles(file);
  await page.getByTestId('status').filter({ hasText: 'done' }).waitFor({ timeout: 120_000 });
  const name = typeof file === 'string' ? path.basename(file) : file.name;
  return JSON.parse(await page.getByTestId(`tamper-${name}`).innerText());
}
const outcomes = (r) => Object.fromEntries(r.tamper.checks.map((c) => [c.id, c.outcome]));

test.describe('GENUINE samples: every one must give "No tampering detected"', () => {
  test.skip(!haveReal, 'samples/ and samples/expected.local.json are not present');

  test('G1: the genuine Jul–Sep 2026 PDF (text layer, MuPDF Producer, shape A)', async ({ page }) => {
    const r = await assess(page, path.join(SAMPLES, G1), { [G1]: nptel(expected[G1]) });
    expect(r.tamper.verdict, JSON.stringify(r.tamper.checks)).toBe('No tampering detected');
    expect(outcomes(r)).toEqual({
      id_match: 'not_applicable', // /verify/<ID> has no relationship to the roll number
      name_match: 'pass',
      course_match: 'pass',
      marks_match: 'pass',
      layer_vs_render: 'pass',
      metadata: 'pass',
    });
    expect(r.verification.verdict).toBe('Successful');
    expect(r.tamper.checks.find((c) => c.id === 'metadata').detail).toContain('MuPDF 1.28.2');
  });

  test('G2: the genuine Jan–Feb 2025 NPTEL-served PDF (FPDF Producer, shape B, roll number from the text layer)', async ({
    page,
  }) => {
    test.skip(!fs.existsSync(G2), 'samples/derived/genuine-2025-nptel-served.pdf is not present');
    const name = path.basename(G2);
    const r = await assess(page, G2, { [name]: nptel(expected['NPTEL.png']) });
    expect(r.tamper.verdict, JSON.stringify(r.tamper.checks)).toBe('No tampering detected');
    expect(outcomes(r)).toEqual({
      id_match: 'pass',
      name_match: 'pass',
      course_match: 'pass',
      marks_match: 'pass',
      layer_vs_render: 'pass',
      metadata: 'pass',
    });
    expect(r.tamper.checks.find((c) => c.id === 'metadata').detail).toContain('FPDF 1.81');
  });

  test('G3: the genuine 2025 screenshot (OCR only; the PDF-only checks are not applicable)', async ({
    page,
  }) => {
    const r = await assess(page, path.join(SAMPLES, 'NPTEL.png'), {
      'NPTEL.png': nptel(expected['NPTEL.png']),
    });
    expect(r.tamper.verdict, JSON.stringify(r.tamper.checks)).toBe('No tampering detected');
    expect(outcomes(r)).toMatchObject({
      name_match: 'pass',
      course_match: 'pass',
      marks_match: 'pass',
      layer_vs_render: 'not_applicable',
      metadata: 'not_applicable',
    });
    expect(['pass', 'not_confirmed']).toContain(outcomes(r).id_match); // the OCR roll is optional
    expect(r.verification.verdict).toBe('Successful');
  });

  test('lossy JPEG copies of the genuine screenshot (quality 92 and 75) are still not flagged', async ({
    page,
  }) => {
    await page.goto('/dev/tamper');
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
      const name = `g${Math.round(quality * 100)}.jpg`;
      const r = await assess(
        page,
        { name, mimeType: 'image/jpeg', buffer: Buffer.from(jpg) },
        { [name]: nptel(expected['NPTEL.png']) },
      );
      expect(r.tamper.verdict, `${name}: ${JSON.stringify(r.tamper.checks)}`).toBe('No tampering detected');
    }
  });

  test('LIVE: the chain end to end with the real /api/verify (real NPTEL) on the genuine 2026 PDF', async ({
    page,
  }) => {
    await registerAndLogin(page.request); // /api/verify needs a signed-in user (Phase 5); the page shares this session
    const r = await assess(page, path.join(SAMPLES, G1), {}, '?live=1');
    expect(r.verification.verdict).toBe('Successful');
    expect(r.tamper.verdict).toBe('No tampering detected');
  });
});

test.describe('KNOWN-TAMPERED sample', () => {
  test.skip(!haveReal, 'samples/ and samples/expected.local.json are not present');

  test('NPTEL_tampered.png (marks edited to 20 and 70): Tampering detected, naming marks_match only', async ({
    page,
  }) => {
    // NPTEL's source is the GENUINE certificate's values (the tampered image has the same QR).
    const r = await assess(page, path.join(SAMPLES, 'NPTEL_tampered.png'), {
      'NPTEL_tampered.png': nptel(expected['NPTEL.png']),
    });
    expect(r.tamper.verdict).toBe('Tampering detected');
    expect(r.tamper.failing).toEqual(['marks_match']);
    expect(r.tamper.reason).toMatch(/Assignment marks on the certificate are 20, NPTEL has 22\.5/);
    expect(r.tamper.reason).toMatch(/Exam marks on the certificate are 70, NPTEL has 61\.88/);
    expect(outcomes(r)).toMatchObject({ name_match: 'pass', course_match: 'pass' });
    expect(r.verification.verdict).toBe('Unsuccessful'); // independent of tampering, and agrees
  });

  test('the same edit saved as a lossy JPEG is still detected', async ({ page }) => {
    await page.goto('/dev/tamper');
    const png = fs.readFileSync(path.join(SAMPLES, 'NPTEL_tampered.png'));
    const jpg = await page.evaluate(
      async ({ b64 }) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = document.createElement('canvas');
        c.width = bitmap.width;
        c.height = bitmap.height;
        c.getContext('2d').drawImage(bitmap, 0, 0);
        const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      },
      { b64: png.toString('base64') },
    );
    const r = await assess(
      page,
      { name: 't85.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg) },
      { 't85.jpg': nptel(expected['NPTEL.png']) },
    );
    expect(r.tamper.verdict, JSON.stringify(r.tamper.checks)).toBe('Tampering detected');
    expect(r.tamper.failing).toContain('marks_match');
  });
});

test.describe('FORGED NAME or COURSE on a real genuine screenshot (marks untouched)', () => {
  test.skip(!haveReal, 'samples/ and samples/expected.local.json are not present');
  const genuine = () => fs.readFileSync(path.join(SAMPLES, 'NPTEL.png'));
  const forged = async (page, edit, name) => {
    await page.goto('/dev/tamper');
    const png = await editScreenshot(page, genuine(), edit);
    return assess(
      page,
      { name, mimeType: 'image/png', buffer: png },
      { [name]: nptel(expected['NPTEL.png']) },
    );
  };

  test('control: the same repaint with the ORIGINAL name written back is not flagged', async ({ page }) => {
    const r = await forged(page, { name: expected['NPTEL.png'].name }, 'same-name.png');
    expect(r.tamper.verdict, JSON.stringify(r.tamper.checks)).toBe('No tampering detected');
    expect(outcomes(r).name_match).toBe('pass');
  });

  test("a classmate's name painted over the genuine one: Tampering detected, naming name_match only", async ({
    page,
  }) => {
    const r = await forged(page, { name: 'PRIYA ANIL DESHPANDE' }, 'forged-name.png');
    expect(r.tamper.verdict, JSON.stringify(r.tamper.checks)).toBe('Tampering detected');
    expect(r.tamper.failing).toEqual(['name_match']);
    const detail = r.tamper.checks.find((c) => c.id === 'name_match').detail;
    expect(detail).toContain(`NPTEL: "${expected['NPTEL.png'].name}"`); // both names side by side
    expect(detail).toMatch(/Certificate: "[^"]+" \| NPTEL: "/);
    expect(outcomes(r)).toMatchObject({ course_match: 'pass', marks_match: 'pass' });
    expect(r.verification.verdict).toBe('Successful'); // Verification compares marks only; tampering is what catches this
  });

  test('a different course painted over the genuine one: Tampering detected, naming course_match only', async ({
    page,
  }) => {
    const r = await forged(page, { course: 'Introduction to Machine Learning' }, 'forged-course.png');
    expect(r.tamper.verdict, JSON.stringify(r.tamper.checks)).toBe('Tampering detected');
    expect(r.tamper.failing).toEqual(['course_match']);
  });

  test('name and course both forged: both are named', async ({ page }) => {
    const r = await forged(
      page,
      { name: 'PRIYA ANIL DESHPANDE', course: 'Introduction to Machine Learning' },
      'forged-both.png',
    );
    expect(r.tamper.failing).toEqual(['name_match', 'course_match']);
  });
});

test.describe('synthetic fixtures (committed or generated, nothing real)', () => {
  const claimed = { name: 'ASHA RAMESH KULKARNI', course: 'DATA ANALYTICS WITH PYTHON' };

  test('tampered METADATA PDF (editor Producer, ModDate, incremental update): Tampering detected, naming metadata', async ({
    page,
  }) => {
    const file = path.join(FIXTURES, 'synthetic-tampered-metadata.pdf');
    // NPTEL agrees with what its text layer says (25 and 75), so only the file structure gives it away.
    const r = await assess(page, file, {
      'synthetic-tampered-metadata.pdf': { source: { ...claimed, assignment: 25, exam: 75, total: null } },
    });
    expect(r.tamper.verdict).toBe('Tampering detected');
    expect(r.tamper.failing).toEqual(['metadata']);
    const d = r.tamper.checks.find((c) => c.id === 'metadata').detail;
    expect(d).toMatch(/Adobe Acrobat Pro DC 23\.1.*PDF editor/);
    expect(d).toMatch(/incremental update/);
    expect(d).toMatch(/ModDate is 172/);
  });

  test('a clean synthetic PDF (FPDF Producer) is not flagged; unreadable render checks are a tolerated minority', async ({
    page,
  }) => {
    const file = path.join(FIXTURES, 'synthetic-genuine-style.pdf');
    const r = await assess(page, file, {
      'synthetic-genuine-style.pdf': {
        source: {
          name: 'ASHA RAMESH KULKARNI',
          course: 'DATA ANALYTICS WITH PYTHON',
          assignment: 12.25,
          exam: 40.5,
          total: null,
        },
      },
    });
    expect(r.tamper.verdict, JSON.stringify(r.tamper.checks)).toBe('No tampering detected');
    expect(outcomes(r)).toMatchObject({
      metadata: 'pass',
      marks_match: 'pass',
      id_match: 'not_confirmed',
      layer_vs_render: 'not_confirmed',
    });
  });

  test("without NPTEL's source the core checks cannot run: Not checked (and a clean file is not called tampered)", async ({
    page,
  }) => {
    const r = await assess(page, path.join(FIXTURES, 'synthetic-genuine-style.pdf'));
    expect(r.tamper.verdict).toBe('Not checked');
    expect(r.tamper.reason).toMatch(/could not be compared with NPTEL/);
    expect(r.verification.verdict).toBe('Error');
  });

  test.describe('EDITED TEXT LAYER (the picture says one thing, the hidden text another)', () => {
    const drawn = {
      name: 'MEERA SUNIL JOSHI',
      course: 'Data Analytics with Python',
      assignment: '12.25/25',
      exam: '40.5/75',
    };
    const truth = {
      source: { name: drawn.name, course: drawn.course, assignment: 12.25, exam: 40.5, total: null },
    };

    test('control: a text layer that matches the picture passes layer_vs_render', async ({ page }) => {
      await page.goto('/dev/tamper');
      const jpeg = await drawCertificate(page, drawn);
      const pdf = buildImagePdf({ jpeg, textItems: hiddenLayer(drawn) });
      const r = await assess(
        page,
        { name: 'consistent.pdf', mimeType: 'application/pdf', buffer: pdf },
        { 'consistent.pdf': truth },
      );
      expect(
        r.tamper.checks.find((c) => c.id === 'layer_vs_render').outcome,
        JSON.stringify(r.evidence?.renderOcr),
      ).toBe('pass');
      expect(r.tamper.verdict).toBe('No tampering detected');
    });

    test('edited marks in the text layer: Tampering detected, naming layer_vs_render even though NPTEL agrees with the text', async ({
      page,
    }) => {
      await page.goto('/dev/tamper');
      const jpeg = await drawCertificate(page, drawn);
      const edited = { ...drawn, assignment: '25/25', exam: '75/75' };
      const pdf = buildImagePdf({ jpeg, textItems: hiddenLayer(edited) });
      const claimedByAttacker = {
        source: { name: drawn.name, course: drawn.course, assignment: 25, exam: 75, total: null },
      };
      const r = await assess(
        page,
        { name: 'edited.pdf', mimeType: 'application/pdf', buffer: pdf },
        { 'edited.pdf': claimedByAttacker },
      );
      expect(r.tamper.verdict).toBe('Tampering detected');
      expect(r.tamper.failing).toEqual(['layer_vs_render']);
      expect(r.tamper.reason).toMatch(/assignment marks: text layer 25, render 12\.25/);
    });

    test("against NPTEL's real values both marks_match and layer_vs_render are named", async ({ page }) => {
      await page.goto('/dev/tamper');
      const jpeg = await drawCertificate(page, drawn);
      const pdf = buildImagePdf({
        jpeg,
        textItems: hiddenLayer({ ...drawn, assignment: '25/25', exam: '75/75' }),
      });
      const r = await assess(
        page,
        { name: 'edited2.pdf', mimeType: 'application/pdf', buffer: pdf },
        { 'edited2.pdf': truth },
      );
      expect(r.tamper.verdict).toBe('Tampering detected');
      expect(r.tamper.failing).toEqual(['marks_match', 'layer_vs_render']);
    });

    test('and with NPTEL unreachable the edited layer is STILL caught (any fail wins over "Not checked")', async ({
      page,
    }) => {
      await page.goto('/dev/tamper');
      const jpeg = await drawCertificate(page, drawn);
      const pdf = buildImagePdf({ jpeg, textItems: hiddenLayer({ ...drawn, assignment: '25/25' }) });
      const r = await assess(page, { name: 'edited3.pdf', mimeType: 'application/pdf', buffer: pdf }, {});
      expect(r.tamper.verdict).toBe('Tampering detected');
      expect(r.tamper.failing).toEqual(['layer_vs_render']);
    });

    test('an edited NAME in the text layer is caught when it is clearly different', async ({ page }) => {
      await page.goto('/dev/tamper');
      const jpeg = await drawCertificate(page, drawn);
      const pdf = buildImagePdf({ jpeg, textItems: hiddenLayer({ ...drawn, name: 'PRIYA ANIL DESHPANDE' }) });
      const r = await assess(
        page,
        { name: 'edited4.pdf', mimeType: 'application/pdf', buffer: pdf },
        { 'edited4.pdf': { source: { ...truth.source, name: 'PRIYA ANIL DESHPANDE' } } },
      );
      expect(r.tamper.failing).toEqual(['layer_vs_render']);
    });

    test('a hidden editor Producer on the same file is flagged by metadata as well', async ({ page }) => {
      await page.goto('/dev/tamper');
      const jpeg = await drawCertificate(page, drawn);
      const pdf = buildImagePdf({ jpeg, textItems: hiddenLayer(drawn), producer: 'Sejda PDF Editor 5.0' });
      const r = await assess(
        page,
        { name: 'sejda.pdf', mimeType: 'application/pdf', buffer: pdf },
        { 'sejda.pdf': truth },
      );
      expect(r.tamper.failing).toEqual(['metadata']);
    });
  });

  test.describe('EDITED NAME on an IMAGE (synthetic, anonymised)', () => {
    const owner = {
      name: 'MEERA SUNIL JOSHI',
      course: 'Data Analytics with Python',
      assignment: '25/25',
      exam: '66/75',
    };
    const nptelValues = {
      source: { name: owner.name, course: owner.course, assignment: 25, exam: 66, total: null },
    };
    const asPng = (jpeg, name) => ({ name, mimeType: 'image/jpeg', buffer: jpeg });

    test("control: the owner's own image is not flagged, and the details show both names", async ({
      page,
    }) => {
      await page.goto('/dev/tamper');
      const jpeg = await drawCertificate(page, owner);
      const r = await assess(page, asPng(jpeg, 'owner.jpg'), { 'owner.jpg': nptelValues });
      expect(r.tamper.verdict, JSON.stringify(r.tamper.checks)).toBe('No tampering detected');
      expect(r.tamper.checks.find((c) => c.id === 'name_match').detail).toBe(
        'Name matches NPTEL. Certificate: "MEERA SUNIL JOSHI" | NPTEL: "MEERA SUNIL JOSHI"',
      );
    });

    test("the classmate's name drawn on the owner's certificate: Tampering detected, naming name_match", async ({
      page,
    }) => {
      await page.goto('/dev/tamper');
      const jpeg = await drawCertificate(page, { ...owner, name: 'PRIYA ANIL DESHPANDE' });
      const r = await assess(page, asPng(jpeg, 'forged.jpg'), { 'forged.jpg': nptelValues });
      expect(r.tamper.verdict, JSON.stringify(r.tamper.checks)).toBe('Tampering detected');
      expect(r.tamper.failing).toEqual(['name_match']);
      expect(r.tamper.reason).toContain('Certificate: "PRIYA ANIL DESHPANDE" | NPTEL: "MEERA SUNIL JOSHI"');
    });

    test('a one-letter change is left for a manual check, not accused', async ({ page }) => {
      await page.goto('/dev/tamper');
      const jpeg = await drawCertificate(page, { ...owner, name: 'MEERA SUNIL JOSHY' });
      const r = await assess(page, asPng(jpeg, 'oneletter.jpg'), { 'oneletter.jpg': nptelValues });
      expect(r.tamper.failing).toEqual([]);
      const c = r.tamper.checks.find((k) => k.id === 'name_match');
      expect(c.outcome).toBe('not_confirmed');
      expect(c.detail).toMatch(/^Name could not be confirmed – check manually/);
    });
  });

  test('a non-certificate file gives Not checked, never "Tampering detected"', async ({ page }) => {
    const r = await assess(page, {
      name: 'notes.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not an image'),
    });
    expect(r.tamper.verdict).toBe('Not checked');
  });
});
