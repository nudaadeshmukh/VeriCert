import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findRollNo,
  isPlausibleCourse,
  isPlausibleName,
  normalizeText,
  parseCertificateText,
  parseMarks,
  parseVerifyUrl,
} from '../../src/lib/extract/parse.js';

const FIX = path.resolve(import.meta.dirname, '../fixtures');
const load = (rel) => JSON.parse(fs.readFileSync(path.join(FIX, rel), 'utf8'));
const textFixtures = fs.readdirSync(path.join(FIX, 'text')).filter((f) => f.endsWith('-text.json'));

describe('fixtures are present', () => {
  it('has the Phase 0 set', () => {
    expect(textFixtures.length).toBeGreaterThanOrEqual(11);
  });
});

describe('parseCertificateText: genuine layouts (observed values from NOTES.md)', () => {
  it('Jul–Sep 2026: item order name, course, total, marks; roll number in one item', () => {
    const f = load('text/genuine-2026-julsep-text.json');
    const r = parseCertificateText(f.items, { page: f.page });
    expect(r).toEqual({
      name: 'ASHA RAMESH KULKARNI',
      course: 'ENTREPRENEURSHIP AND IP STRATEGY',
      assignment: 25,
      exam: 66,
      rollNo: 'NPTEL26HS164S000000001',
      errors: [],
    });
  });

  it('Jan–Feb 2025: bottom-up item order, decimal marks, roll number split from its label', () => {
    const f = load('text/genuine-2025-janfeb-text.json');
    const r = parseCertificateText(f.items, { page: f.page });
    expect(r).toEqual({
      name: 'ASHA RAMESH KULKARNI',
      course: 'Design Thinking - A Primer',
      assignment: 22.5,
      exam: 61.88,
      rollNo: 'NPTEL25MG18S000000001',
      errors: [],
    });
  });

  it('is independent of the order of the text items (position, not order, is used)', () => {
    const f = load('text/genuine-2026-julsep-text.json');
    const shuffled = [...f.items].reverse();
    expect(parseCertificateText(shuffled, { page: f.page })).toMatchObject({
      name: 'ASHA RAMESH KULKARNI',
      assignment: 25,
      exam: 66,
    });
  });
});

describe('parseCertificateText: every synthetic variant fixture', () => {
  const variants = textFixtures.filter((f) => f.startsWith('variant-'));

  it.each(variants)('%s', (file) => {
    const f = load(`text/${file}`);
    const r = parseCertificateText(f.items, { page: f.page });
    const expected = f.expected;
    if (expected.error === 'out_of_range') {
      expect(r.assignment).toBeNull();
      expect(r.exam).toBeNull();
      expect(r.errors.map((e) => e.code)).toEqual(['marks_out_of_range', 'marks_out_of_range']);
      expect(r.errors.map((e) => e.field)).toEqual(['assignment', 'exam']);
      return;
    }
    if (file === 'variant-ocr-slips-text.json') {
      // Strict (text layer) mode must refuse OCR slips; tolerant mode reads them.
      expect(r.assignment).toBeNull();
      expect(r.errors.length).toBeGreaterThan(0);
      return;
    }
    expect(r.errors).toEqual([]);
    expect(r.assignment).toBe(expected.assignment);
    expect(r.exam).toBe(expected.exam);
    expect(r.name).toBe(normalizeText(f.items[0].str));
    expect(r.course).toBe(normalizeText(f.items[1].str));
  });

  it('decimal marks keep their decimals', () => {
    const f = load('text/variant-decimal-marks-text.json');
    const r = parseCertificateText(f.items, { page: f.page });
    expect([r.assignment, r.exam]).toEqual([12.25, 40.5]);
  });

  it('zero marks are a real value, not "missing"', () => {
    const f = load('text/variant-zero-marks-text.json');
    const r = parseCertificateText(f.items, { page: f.page });
    expect([r.assignment, r.exam]).toEqual([0, 0]);
    expect(r.errors).toEqual([]);
  });

  it('long name and long course survive intact', () => {
    const n = load('text/variant-long-name-text.json');
    expect(parseCertificateText(n.items, { page: n.page }).name).toBe(
      'VENKATARAMANAN SUBRAMANIAM PADMANABHAN IYENGAR-KRISHNAMURTHY',
    );
    const c = load('text/variant-long-course-name-text.json');
    expect(parseCertificateText(c.items, { page: c.page }).course).toBe(
      'INTRODUCTION TO PROFESSIONAL ETHICS, CORPORATE GOVERNANCE AND SUSTAINABLE BUSINESS PRACTICES',
    );
  });

  it('Devanagari names are accepted (combining marks), and returned in NFC', () => {
    const f = load('text/variant-devanagari-name-text.json');
    const r = parseCertificateText(f.items, { page: f.page });
    expect(r.name).toBe('आशा रमेश कुलकर्णी');
    expect(r.errors).toEqual([]);
  });

  it('decomposed nukta (U+091C U+093C) is normalised to the same NFC form as the precomposed one', () => {
    const f = load('text/variant-devanagari-nukta-decomposed-text.json');
    const r = parseCertificateText(f.items, { page: f.page });
    expect(r.name).toBe('ज़ीनत शेख'.normalize('NFC'));
    expect(normalizeText('ज़')).toBe(normalizeText('ज़'));
    expect(r.errors).toEqual([]);
  });

  it('wrapped (two-line) course titles are joined', () => {
    const items = [
      { str: 'RAHUL ANIL PATIL', x: 300, y: 400 },
      { str: 'INTRODUCTION TO PROFESSIONAL ETHICS,', x: 250, y: 360 },
      { str: 'CORPORATE GOVERNANCE', x: 250, y: 340 },
      { str: '53%', x: 487, y: 295 },
      { str: '12/25', x: 371, y: 262 },
      { str: '40/75', x: 569, y: 262 },
    ];
    const r = parseCertificateText(items, { page: { height: 595 } });
    expect(r.course).toBe('INTRODUCTION TO PROFESSIONAL ETHICS, CORPORATE GOVERNANCE');
    expect(r.name).toBe('RAHUL ANIL PATIL');
  });
});

describe('parseCertificateText: failures are reported, never guessed', () => {
  it('no marks row → layout_not_recognised plus both marks errors, name and course null', () => {
    const r = parseCertificateText([
      { str: 'SOMEONE', y: 100 },
      { str: 'Some Course', y: 80 },
    ]);
    expect(r.name).toBeNull();
    expect(r.course).toBeNull();
    expect(r.errors.map((e) => e.code)).toEqual([
      'marks_not_found',
      'marks_not_found',
      'layout_not_recognised',
    ]);
  });

  it('an empty text layer (scanned PDF) yields errors only', () => {
    const r = parseCertificateText([]);
    expect(r.assignment).toBeNull();
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('OCR junk as a name is malformed, not accepted', () => {
    const items = [
      { str: '|~|', y: 400 },
      { str: 'EFFECTIVE WRITING', y: 340 },
      { str: '20/25', y: 262 },
      { str: '60/75', y: 262 },
    ];
    const r = parseCertificateText(items);
    expect(r.name).toBeNull();
    expect(r.errors.map((e) => e.code)).toContain('name_malformed');
    expect(r.assignment).toBe(20);
  });

  it('a name that OCR read as a bare "7" is dropped as a number, leaving no name (never accepted)', () => {
    const items = [
      { str: '7', y: 400 },
      { str: 'EFFECTIVE WRITING', y: 340 },
      { str: '20/25', y: 262 },
      { str: '60/75', y: 262 },
    ];
    const r = parseCertificateText(items);
    expect(r.name).toBeNull();
    expect(r.errors.map((e) => e.code)).toContain('layout_not_recognised');
  });

  it('two different values for the same field are ambiguous, not "first wins"', () => {
    const r = parseMarks('20/25 and 21/25 and 60/75');
    expect(r.assignment).toBeNull();
    expect(r.exam).toBe(60);
    expect(r.errors).toEqual([expect.objectContaining({ code: 'ambiguous_marks', field: 'assignment' })]);
  });
});

describe('parseMarks', () => {
  it('reads plain, decimal and spaced forms', () => {
    expect(parseMarks('25/25 66/75')).toMatchObject({ assignment: 25, exam: 66, errors: [] });
    expect(parseMarks('22.5/25 61.88/75')).toMatchObject({ assignment: 22.5, exam: 61.88 });
    expect(parseMarks('20 / 25   70 /75')).toMatchObject({ assignment: 20, exam: 70 });
  });

  it('accepts the boundaries 0 and the maxima', () => {
    expect(parseMarks('0/25 0/75')).toMatchObject({ assignment: 0, exam: 0, errors: [] });
    expect(parseMarks('25/25 75/75')).toMatchObject({ assignment: 25, exam: 75, errors: [] });
  });

  it('rejects out-of-range values as parse errors, not clamped', () => {
    const r = parseMarks('26/25 80/75');
    expect(r.assignment).toBeNull();
    expect(r.exam).toBeNull();
    expect(r.errors.map((e) => e.code)).toEqual(['marks_out_of_range', 'marks_out_of_range']);
    expect(parseMarks('25.01/25 10/75').assignment).toBeNull();
  });

  it('a missing field is reported with the field name', () => {
    const r = parseMarks('22/25');
    expect(r.exam).toBeNull();
    expect(r.errors).toEqual([expect.objectContaining({ code: 'marks_not_found', field: 'exam' })]);
  });

  it('strict mode (text layer) does NOT accept OCR slips', () => {
    expect(parseMarks('2O/25 6l/75').assignment).toBeNull();
    expect(parseMarks('25/2S 66/7S').errors.length).toBe(2);
  });

  describe('tolerant mode (OCR output)', () => {
    const t = (s) => parseMarks(s, { tolerant: true });
    it('O→0, l/I→1, S→5 in the numerator', () => {
      expect(t('2O/25 6l/75')).toMatchObject({ assignment: 20, exam: 61 });
      expect(t('I9/25 7I/75')).toMatchObject({ assignment: 19, exam: 71 });
      expect(t('2S/25 6S/75')).toMatchObject({ assignment: 25, exam: 65 });
    });
    it('slips in the denominator, spaces around the slash, comma decimals', () => {
      expect(t('2O / 25   6l.88/7S')).toMatchObject({ assignment: 20, exam: 61.88, errors: [] });
      expect(t('22,5/2S 61,88 /75')).toMatchObject({ assignment: 22.5, exam: 61.88 });
    });
    it('still enforces ranges after correcting slips', () => {
      const r = t('S6/25 9O/75');
      expect(r.assignment).toBeNull();
      expect(r.exam).toBeNull();
      expect(r.errors.map((e) => e.code)).toEqual(['marks_out_of_range', 'marks_out_of_range']);
    });
    it('a token with no real digit is noise, not a mark', () => {
      expect(t('S/25 l/75').errors.map((e) => e.code)).toEqual(['marks_not_found', 'marks_not_found']);
    });
    it('the OCR-slip fixture parses', () => {
      const f = load('text/variant-ocr-slips-text.json');
      const r = parseMarks(f.items.map((i) => i.str).join(' '), { tolerant: true });
      expect([r.assignment, r.exam]).toEqual([f.expected.assignment, f.expected.exam]);
    });
  });
});

describe('name and course plausibility', () => {
  it.each(['ASHA RAMESH KULKARNI', 'Mary-Ann O’Neil', 'K. R. Narayanan', 'आशा रमेश कुलकर्णी', 'ज़ीनत शेख'])(
    'accepts name %s',
    (n) => expect(isPlausibleName(n)).toBe(true),
  );
  it.each(['7', '', ' ', '|||', 'A', 'AAAA', '12345', 'NAME 2', 'x'.repeat(101)])('rejects name %j', (n) =>
    expect(isPlausibleName(n)).toBe(false),
  );
  it('letters-only would reject Devanagari; ours must not', () => {
    expect(/^[\p{L} ]+$/u.test('आशा रमेश')).toBe(false);
    expect(isPlausibleName('आशा रमेश')).toBe(true);
  });
  it.each([
    'Design Thinking - A Primer',
    'Data Structures & Algorithms - Part 2',
    'ENTREPRENEURSHIP AND IP STRATEGY',
  ])('accepts course %s', (c) => expect(isPlausibleCourse(c)).toBe(true));
  it.each(['', '--', '1 2 3', '| ~ ^ ,'])('rejects course %j', (c) =>
    expect(isPlausibleCourse(c)).toBe(false),
  );
});

describe('findRollNo', () => {
  it('finds both observed formats', () => {
    expect(findRollNo('Roll No: NPTEL26HS164S000000001')).toBe('NPTEL26HS164S000000001');
    expect(findRollNo('x NPTEL25MG18S000000001 y')).toBe('NPTEL25MG18S000000001');
  });
  it('returns undefined when absent', () => {
    expect(findRollNo('Roll No:')).toBeUndefined();
  });
});

describe('parseVerifyUrl', () => {
  it('shape A: /verify/<ID>', () => {
    expect(parseVerifyUrl('https://nptel.ac.in/verify/NOC-TEST-FIXT-URE01')).toEqual({
      url: 'https://nptel.ac.in/verify/NOC-TEST-FIXT-URE01',
      shape: 'verify',
      certificateId: 'NOC-TEST-FIXT-URE01',
    });
  });
  it('shape B: /noc/E_Certificate/<ID>', () => {
    expect(parseVerifyUrl('https://nptel.ac.in/noc/E_Certificate/NPTEL25MG18S00000000100000007')).toEqual({
      url: 'https://nptel.ac.in/noc/E_Certificate/NPTEL25MG18S00000000100000007',
      shape: 'e_certificate',
      certificateId: 'NPTEL25MG18S00000000100000007',
    });
  });
  it('accepts *.nptel.ac.in, :443, trailing slash; drops query and fragment', () => {
    expect(parseVerifyUrl('https://beta.nptel.ac.in:443/verify/NOC-TEST-FIXT-URE01/?x=1#y').url).toBe(
      'https://beta.nptel.ac.in/verify/NOC-TEST-FIXT-URE01',
    );
    expect(parseVerifyUrl('  HTTPS://NPTEL.AC.IN/verify/NOC-TEST-FIXT-URE01  ').shape).toBe('verify');
  });
  it.each([
    'https://nptel.ac.in.evil.com/verify/NOC-TEST-FIXT-URE01',
    'https://evilnptel.ac.in/verify/NOC-TEST-FIXT-URE01',
    'https://nptel.ac.in@evil.com/verify/NOC-TEST-FIXT-URE01',
    'https://user:pw@nptel.ac.in/verify/NOC-TEST-FIXT-URE01',
    'https://nptel.ac.in:8443/verify/NOC-TEST-FIXT-URE01',
    'https://evil.com/?u=https://nptel.ac.in/verify/NOC-TEST-FIXT-URE01',
    'https://nptel.ac.in./verify/NOC-TEST-FIXT-URE01',
  ])('rejects %s as not NPTEL', (u) => expect(parseVerifyUrl(u).error?.code).toBe('qr_not_nptel'));
  it('rejects http, non-URLs and unknown NPTEL paths with specific codes', () => {
    expect(parseVerifyUrl('http://nptel.ac.in/verify/NOC-TEST-FIXT-URE01').error?.code).toBe(
      'qr_unsupported_scheme',
    );
    expect(parseVerifyUrl('hello world').error?.code).toBe('qr_not_url');
    expect(parseVerifyUrl('https://nptel.ac.in/courses/106').error?.code).toBe('qr_unknown_shape');
    expect(parseVerifyUrl('https://nptel.ac.in/verify/../../x').error?.code).toBe('qr_unknown_shape');
  });
});

describe('purity', () => {
  it('parse.js has no imports and no browser-only globals (Phase 3 reuses it on the server)', () => {
    const src = fs.readFileSync(path.resolve(import.meta.dirname, '../../src/lib/extract/parse.js'), 'utf8');
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\b(window|document|navigator|OffscreenCanvas|Worker)\b\s*[.[(]/);
  });
});
