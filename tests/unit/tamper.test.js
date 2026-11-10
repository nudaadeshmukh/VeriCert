import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareCertificate } from '../../src/lib/compare.js';
import {
  assessTampering,
  differenceRatio,
  idMatchCheck,
  layerVsRenderCheck,
  marksMatchCheck,
  metadataCheck,
} from '../../src/lib/tamper/checks.js';
import * as config from '../../src/lib/tamper/config.js';
import { parsePdfDate, readPdfMetadata } from '../../src/lib/tamper/metadata.js';

const FIX = path.resolve(import.meta.dirname, '../fixtures/pdf');
const bytes = (name) => new Uint8Array(fs.readFileSync(path.join(FIX, name)));
const enc = (s) => new TextEncoder().encode(s);

/** A minimal PDF-ish byte string with chosen Info fields and structure, for isolating one signal at a time. */
function mini({ info = '', eof = 1, linearized = false, prev = 0, extra = '' } = {}) {
  let s = `%PDF-1.4\n${linearized ? '1 0 obj\n<</Linearized 1/L 100>>\nendobj\n' : ''}`;
  s += `2 0 obj\n<</Type/Catalog>>\nendobj\nxref\n0 1\n0000000000 65535 f \ntrailer\n<</Root 2 0 R${prev ? '/Prev 9' : ''}/Info<<${info}>>>>\nstartxref\n9\n%%EOF\n`;
  for (let i = 1; i < eof; i++)
    s += `xref\n0 1\n0000000000 65535 f \ntrailer\n<</Root 2 0 R/Prev 9>>\nstartxref\n9\n%%EOF\n`;
  return enc(s + extra);
}
const meta = (evidence) => metadataCheck({ pdfBytes: evidence }, 'pdf');

describe('readPdfMetadata (raw bytes)', () => {
  it('reads the genuine-style fixture: FPDF, a CreationDate, one of everything', () => {
    const m = readPdfMetadata(bytes('synthetic-genuine-style.pdf'));
    expect(m).toMatchObject({
      producer: 'FPDF 1.81',
      creationDate: 'D:20250331193315',
      eofCount: 1,
      startxrefCount: 1,
      xrefTableCount: 1,
      prevCount: 0,
      linearized: false,
      encrypted: false,
    });
    expect(m.modDate).toBeUndefined();
    expect(m.creationDateParsed?.toISOString()).toBe('2025-03-31T19:33:15.000Z');
  });

  it('sees an incremental update: two %%EOF, a /Prev, two Producers, a ModDate', () => {
    const m = readPdfMetadata(bytes('synthetic-tampered-metadata.pdf'));
    expect(m).toMatchObject({ eofCount: 2, startxrefCount: 2, xrefTableCount: 2, prevCount: 1 });
    expect(m.allProducers).toEqual(['FPDF 1.81', 'Adobe Acrobat Pro DC 23.1']);
    expect(m.producer).toBe('Adobe Acrobat Pro DC 23.1'); // the LAST one is the current one
    expect(m.modDate).toBe('D:20250920101500');
  });

  it('finds a Producer in an Info dictionary that hangs off the Catalog (the 2026 NPTEL layout)', () => {
    const s = enc(
      '%PDF-1.7\n1 0 obj\n<</Type/Catalog/Pages 2 0 R/Info<</Producer(MuPDF 1.28.2)>>>>\nendobj\ntrailer\n<</Size 5/Root 1 0 R>>\nstartxref\n5\n%%EOF\n',
    );
    expect(readPdfMetadata(s).producer).toBe('MuPDF 1.28.2');
  });

  it('decodes escapes, balanced parentheses, hex strings, UTF-16BE and indirect references', () => {
    expect(readPdfMetadata(mini({ info: '/Producer(A \\(b\\) \\101 (nested) \\\\)' })).producer).toBe(
      'A (b) A (nested) \\',
    );
    expect(readPdfMetadata(mini({ info: '/Producer<4D 75 50 44 46>' })).producer).toBe('MuPDF');
    expect(readPdfMetadata(mini({ info: '/Producer<FEFF004100420043>' })).producer).toBe('ABC');
    const ind = enc(
      '%PDF-1.4\n7 0 obj\n(Adobe Acrobat Pro)\nendobj\ntrailer\n<</Info<</Producer 7 0 R>>>>\nstartxref\n1\n%%EOF\n',
    );
    expect(readPdfMetadata(ind).producer).toBe('Adobe Acrobat Pro');
  });

  it('falls back to pdf.js info only where the raw scan finds nothing, and says so', () => {
    const m = readPdfMetadata(mini({ info: '' }), {
      Producer: 'Hidden In Object Stream 1.0',
      CreationDate: 'D:20240101000000',
    });
    expect(m.producer).toBe('Hidden In Object Stream 1.0');
    expect(m.creationDateParsed?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect([...m.fromPdfjs].sort()).toEqual(['CreationDate', 'Producer']);
  });

  it('prefers the raw value over pdf.js', () => {
    const m = readPdfMetadata(mini({ info: '/Producer(Raw One)' }), { Producer: 'From pdfjs' });
    expect(m.producer).toBe('Raw One');
  });

  it('does not choke on a large binary file (no stack overflow)', () => {
    const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 31) & 0xff);
    big.set(enc('%PDF-1.4\n'), 0);
    expect(readPdfMetadata(big).size).toBe(3 * 1024 * 1024);
  });
});

describe('parsePdfDate', () => {
  it.each([
    ['D:20250331193315', '2025-03-31T19:33:15.000Z'],
    ["D:20250331193315+05'30'", '2025-03-31T14:03:15.000Z'],
    ["D:20250331193315-08'00'", '2025-04-01T03:33:15.000Z'],
    ['D:20250331193315Z', '2025-03-31T19:33:15.000Z'],
    ['D:2025', '2025-01-01T00:00:00.000Z'],
    ['20250331', '2025-03-31T00:00:00.000Z'],
  ])('%s', (s, iso) => expect(parsePdfDate(s)?.toISOString()).toBe(iso));
  it.each([undefined, '', 'yesterday', 'D:abcd'])('%s is null', (s) => expect(parsePdfDate(s)).toBeNull());
});

describe('metadata check', () => {
  it('passes both genuine-style layouts and notes (not flags) the Producer', () => {
    const fpdf = meta(bytes('synthetic-genuine-style.pdf'));
    expect(fpdf.outcome).toBe('pass');
    expect(fpdf.detail).toMatch(/Producer "FPDF 1\.81" is not on the editor list \(noted, not flagged\)/);
    const mupdf = meta(bytes('synthetic-source-2026.pdf'));
    expect(mupdf.outcome).toBe('pass');
    expect(mupdf.detail).toMatch(/MuPDF 1\.28\.2.*noted, not flagged.*no CreationDate.*no ModDate/);
  });

  it('FAILS the tampered-metadata fixture and names every signal', () => {
    const c = meta(bytes('synthetic-tampered-metadata.pdf'));
    expect(c.outcome).toBe('fail');
    expect(c.detail).toMatch(/Adobe Acrobat Pro DC 23\.1.*PDF editor/);
    expect(c.detail).toMatch(/ModDate is 172\.\d days after CreationDate/);
    expect(c.detail).toMatch(/incremental update: 2 %%EOF, 2 xref sections, 1 \/Prev/);
  });

  describe('each signal on its own', () => {
    it('an editor Producer alone', () => {
      const c = meta(mini({ info: '/Producer(Sejda PDF Editor 5.1)' }));
      expect(c.outcome).toBe('fail');
      expect(c.detail).toContain('sejda');
    });
    it('an editor named only in Creator, or only in an EARLIER save, still counts', () => {
      expect(meta(mini({ info: '/Creator(Foxit PDF Editor 12)/Producer(FPDF 1.81)' })).outcome).toBe('fail');
      const hidden = enc(
        '%PDF-1.4\n1 0 obj\n<</Producer(iLovePDF)>>\nendobj\nxref\n0 1\n0000000000 65535 f \ntrailer\n<</Info<</Producer(FPDF 1.81)>>>>\nstartxref\n9\n%%EOF\n',
      );
      expect(metadataCheck({ pdfBytes: hidden }, 'pdf').outcome).toBe('fail');
    });
    it('an incremental update alone (a second %%EOF), with unknown and clean Info', () => {
      const c = meta(mini({ info: '/Producer(FPDF 1.81)', eof: 2 }));
      expect(c.outcome).toBe('fail');
      expect(c.detail).toMatch(/incremental update/);
      expect(c.detail).not.toMatch(/editor|ModDate/);
    });
    it('a /Prev alone', () => {
      expect(meta(mini({ info: '/Producer(FPDF 1.81)', prev: 1 })).outcome).toBe('fail');
    });
    it('a ModDate far after CreationDate alone', () => {
      const c = meta(
        mini({ info: '/Producer(FPDF 1.81)/CreationDate(D:20250101000000)/ModDate(D:20250301000000)' }),
      );
      expect(c.outcome).toBe('fail');
      expect(c.detail).toMatch(/ModDate is 59\.0 days after CreationDate/);
    });
  });

  describe('thresholds sit exactly where config.js says', () => {
    const gap = config.MODDATE_MIN_GAP_SECONDS;
    const info = (seconds) => {
      const d = new Date(Date.UTC(2025, 0, 1, 0, 0, 0) + seconds * 1000);
      const f = (n) => String(n).padStart(2, '0');
      const mod = `D:${d.getUTCFullYear()}${f(d.getUTCMonth() + 1)}${f(d.getUTCDate())}${f(d.getUTCHours())}${f(d.getUTCMinutes())}${f(d.getUTCSeconds())}`;
      return `/Producer(FPDF 1.81)/CreationDate(D:20250101000000)/ModDate(${mod})`;
    };
    it('exactly the threshold is not flagged; one second more is', () => {
      expect(meta(mini({ info: info(gap) })).outcome).toBe('pass');
      expect(meta(mini({ info: info(gap + 1) })).outcome).toBe('fail');
    });
    it('a ModDate seconds after CreationDate (a generator stamping both) is fine', () => {
      expect(meta(mini({ info: info(5) })).outcome).toBe('pass');
    });
    it('a ModDate without a CreationDate, or before it, is not flagged', () => {
      expect(meta(mini({ info: '/Producer(FPDF 1.81)/ModDate(D:20250301000000)' })).outcome).toBe('pass');
      expect(meta(mini({ info: '/CreationDate(D:20250301000000)/ModDate(D:20250101000000)' })).outcome).toBe(
        'pass',
      );
    });
  });

  describe('what is deliberately NOT flagged', () => {
    it.each([
      'FPDF 1.81',
      'MuPDF 1.28.2',
      'Adobe PDF Library 15.0',
      'Acrobat Distiller 9.0',
      'Microsoft® Word 2019',
      'Microsoft: Print To PDF',
      'Skia/PDF m120',
      'LibreOffice 7.6',
      'iText 7.2.5',
      'SomeBrandNewGenerator 0.1',
    ])('Producer %s is noted, not flagged', (producer) => {
      const c = meta(mini({ info: `/Producer(${producer})` }));
      expect(c.outcome).toBe('pass');
      expect(c.detail).toContain('noted, not flagged');
    });
    it('the editor list is matched case-insensitively', () => {
      expect(meta(mini({ info: '/Producer(ADOBE ACROBAT PRO)' })).outcome).toBe('fail');
      expect(meta(mini({ info: '/Producer(smallpdf.com)' })).outcome).toBe('fail');
    });
    it('every denylist entry is lower case (they are compared lower-cased) and none matches a genuine Producer', () => {
      for (const e of config.EDITOR_DENYLIST) {
        expect(e).toBe(e.toLowerCase());
        for (const genuine of ['FPDF 1.81', 'MuPDF 1.28.2']) expect(genuine.toLowerCase()).not.toContain(e);
      }
    });
  });

  describe('linearized files legitimately carry two of everything', () => {
    it('a linearized file with 2 %%EOF and one /Prev is not an incremental update', () => {
      expect(meta(mini({ info: '/Producer(FPDF 1.81)', linearized: true, eof: 2 })).outcome).toBe('pass');
    });
    it('but a third %%EOF on top is', () => {
      expect(meta(mini({ info: '/Producer(FPDF 1.81)', linearized: true, eof: 3 })).outcome).toBe('fail');
    });
  });

  describe('not_confirmed and not_applicable', () => {
    it('no bytes → not_confirmed for a PDF, not_applicable for an image', () => {
      expect(metadataCheck(null, 'pdf').outcome).toBe('not_confirmed');
      expect(metadataCheck(undefined, 'png').outcome).toBe('not_applicable');
      expect(metadataCheck(null, 'jpeg').outcome).toBe('not_applicable');
    });
    it('a truncated file (no %%EOF) and a non-PDF are not_confirmed, never a fail', () => {
      expect(meta(enc('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n')).outcome).toBe('not_confirmed');
      expect(meta(enc('not a pdf at all')).outcome).toBe('not_confirmed');
    });
    it('an encrypted file is not_confirmed', () => {
      expect(
        meta(
          mini({ info: '/Producer(X)', extra: '' }).length &&
            enc('%PDF-1.4\ntrailer\n<</Encrypt 5 0 R>>\nstartxref\n1\n%%EOF\n'),
        ).outcome,
      ).toBe('not_confirmed');
    });
  });
});

const evidence = (textLayer, renderOcr, extra = {}) => ({ textLayer, renderOcr, ...extra });
const TL = {
  name: 'ASHA RAMESH KULKARNI',
  course: 'Design Thinking - A Primer',
  assignment: 22.5,
  exam: 61.88,
};
const OCR = { ...TL, confidence: { name: 93, course: 94 }, errors: [] };

describe('layer_vs_render check', () => {
  const run = (tl, ocr) => layerVsRenderCheck(evidence(tl, ocr), 'pdf');

  it('passes when the render says what the text layer says (the genuine case: distance 0)', () => {
    expect(run(TL, OCR).outcome).toBe('pass');
  });
  it('FAILS when a mark on the render differs from the text layer', () => {
    const c = run({ ...TL, assignment: 25 }, OCR);
    expect(c.outcome).toBe('fail');
    expect(c.detail).toContain('assignment marks: text layer 25, render 22.5');
  });
  it('fails on the exam mark too, and names every difference', () => {
    const c = run({ ...TL, assignment: 25, exam: 75 }, OCR);
    expect(c.detail).toMatch(/assignment marks.*exam marks/);
  });
  it('marks within 0.01 are equal; beyond are not', () => {
    expect(run({ ...TL, assignment: 22.51 }, OCR).outcome).toBe('pass');
    expect(run({ ...TL, assignment: 22.52 }, OCR).outcome).toBe('fail');
  });
  it('FAILS on a clearly different, confidently read name', () => {
    const c = run({ ...TL, name: 'SOMEONE TOTALLY DIFFERENT' }, OCR);
    expect(c.outcome).toBe('fail');
    expect(c.detail).toContain('name: text layer "SOMEONE TOTALLY DIFFERENT", render "ASHA RAMESH KULKARNI"');
  });
  it('a one-character OCR slip in a name is NOT a mismatch', () => {
    const c = run(TL, { ...OCR, name: 'ASHA RAMESH KULKARN' });
    expect(c.outcome).toBe('pass'); // marks and course confirmed
    expect(c.detail).toMatch(/not confirmed: name/);
    const only = run({ name: TL.name }, { name: 'ASHA RAMESH KULKARN', confidence: { name: 93 } });
    expect(only.outcome).toBe('not_confirmed');
  });
  it('a clearly different name read at LOW confidence is not trusted', () => {
    const c = run({ name: TL.name }, { name: 'ZZZZ QQQQ WWWW', confidence: { name: 60 } });
    expect(c.outcome).toBe('not_confirmed');
  });
  it('the bounds are the ones in config.js', () => {
    expect(config.LAYER_TEXT_MIN_OCR_CONFIDENCE).toBe(85);
    expect(config.LAYER_TEXT_MIN_DIFFERENCE_RATIO).toBe(0.5);
    const atBound = (conf) => run({ name: 'AAAAAAAAAA' }, { name: 'AAAAABBBBB', confidence: { name: conf } }); // ratio exactly 0.5
    expect(atBound(85).outcome).toBe('fail');
    expect(atBound(84).outcome).toBe('not_confirmed');
    expect(run({ name: 'AAAAAAAAAA' }, { name: 'AAAAAABBBB', confidence: { name: 99 } }).outcome).toBe(
      'not_confirmed',
    ); // 0.4
  });
  it('unreadable OCR fields are not_confirmed, never a fail', () => {
    expect(run(TL, { ...OCR, assignment: null, exam: null, name: null, course: null }).outcome).toBe(
      'not_confirmed',
    );
    expect(
      run(TL, {
        assignment: null,
        exam: null,
        name: null,
        course: null,
        confidence: {},
        errors: [{ code: 'ocr_timeout' }],
      }).outcome,
    ).toBe('not_confirmed');
  });
  it('a difference elsewhere still fails even if other fields are unreadable', () => {
    expect(run({ ...TL, assignment: 25 }, { ...OCR, name: null, course: null, exam: null }).outcome).toBe(
      'fail',
    );
  });
  it('compares only what the text layer had', () => {
    expect(run({ name: null, course: null, assignment: 22.5, exam: null }, OCR).outcome).toBe('pass');
  });
  it('Devanagari names are compared Unicode-aware (NFC)', () => {
    const c = run({ name: 'ज़ीनत शेख' }, { name: 'ज़ीनत शेख', confidence: { name: 90 } });
    expect(c.outcome).toBe('pass');
  });
  it('not_applicable for images and for a PDF with no text layer', () => {
    expect(layerVsRenderCheck(null, 'png').outcome).toBe('not_applicable');
    expect(layerVsRenderCheck(evidence(TL, null, { renderOcrSkipped: 'no_text_layer' }), 'pdf').outcome).toBe(
      'not_applicable',
    );
  });
  it('not_confirmed when there is no evidence or no OCR', () => {
    expect(layerVsRenderCheck(null, 'pdf').outcome).toBe('not_confirmed');
    expect(layerVsRenderCheck(evidence(TL, null), 'pdf').outcome).toBe('not_confirmed');
  });
});

describe('differenceRatio', () => {
  it.each([
    ['abc', 'abc', 0],
    ['', '', 0],
    ['abc', 'abd', 1 / 3],
    ['abc', '', 1],
    ['kitten', 'sitting', 3 / 7],
  ])('%j vs %j', (a, b, want) => expect(differenceRatio(a, b)).toBeCloseTo(want, 5));
  it('counts code points, so combining marks and astral characters are not split', () => {
    expect(differenceRatio('😀', '😀')).toBe(0);
    expect(differenceRatio('😀a', '😀b')).toBeCloseTo(0.5);
  });
});

describe('id_match check', () => {
  const B = 'NPTEL25MG18S00000000100000007';
  it('/noc/E_Certificate: the ID must start with the printed roll number', () => {
    const base = { qr: { shape: 'e_certificate' }, certificateId: B, source: 'text_layer' };
    expect(idMatchCheck({ ...base, rollNo: 'NPTEL25MG18S000000001' }).outcome).toBe('pass');
    expect(idMatchCheck({ ...base, rollNo: 'nptel25mg18s000000001' }).outcome).toBe('pass');
    const bad = idMatchCheck({ ...base, rollNo: 'NPTEL25MG18S000000002' });
    expect(bad.outcome).toBe('fail');
    expect(bad.detail).toMatch(/does not start with the roll number/);
  });
  it('a mismatch from an OCR-read roll number is not_confirmed (OCR confuses S and 5)', () => {
    const c = idMatchCheck({
      qr: { shape: 'e_certificate' },
      certificateId: B,
      rollNo: 'NPTEL25MG185000000001',
      source: 'ocr',
    });
    expect(c.outcome).toBe('not_confirmed');
  });
  it('an OCR roll that matches still passes', () => {
    expect(
      idMatchCheck({
        qr: { shape: 'e_certificate' },
        certificateId: B,
        rollNo: 'NPTEL25MG18S000000001',
        source: 'ocr',
      }).outcome,
    ).toBe('pass');
  });
  it('no roll number read → not_confirmed', () => {
    expect(idMatchCheck({ qr: { shape: 'e_certificate' }, certificateId: B, source: 'ocr' }).outcome).toBe(
      'not_confirmed',
    );
  });
  it('/verify/<ID> is not_applicable: no observed relationship to the roll number', () => {
    const c = idMatchCheck({
      qr: { shape: 'verify' },
      certificateId: 'NOC-TEST-FIXT-URE01',
      rollNo: 'NPTEL26HS164S000000001',
    });
    expect(c.outcome).toBe('not_applicable');
    expect(c.detail).toMatch(/no observed relationship/);
  });
  it('no QR → not_confirmed', () => {
    expect(idMatchCheck({ certificateId: null, rollNo: 'X' }).outcome).toBe('not_confirmed');
  });
});

const SRC = {
  source: {
    name: 'ASHA RAMESH KULKARNI',
    course: 'Design Thinking - A Primer',
    assignment: 22.5,
    exam: 61.88,
    total: 84,
  },
};
const cert = (over = {}) => ({
  name: 'ASHA RAMESH KULKARNI',
  course: 'Design Thinking - A Primer',
  assignment: 22.5,
  exam: 61.88,
  source: 'text_layer',
  fileKind: 'pdf',
  qr: { shape: 'e_certificate', method: 'x', attempts: 1 },
  certificateId: 'NPTEL25MG18S00000000100000007',
  rollNo: 'NPTEL25MG18S000000001',
  evidence: { pdfBytes: bytes('synthetic-source-2025.pdf'), pdfInfo: null, textLayer: TL, renderOcr: OCR },
  ...over,
});
const assess = (extraction, result = SRC) =>
  assessTampering({ extraction, comparison: compareCertificate(extraction, result) });
const outcomes = (r) => Object.fromEntries(r.checks.map((c) => [c.id, c.outcome]));

describe('marks_match check', () => {
  it('pass / fail / not_confirmed from the comparison', () => {
    const pass = marksMatchCheck(compareCertificate(cert(), SRC));
    expect(pass.outcome).toBe('pass');
    const fail = marksMatchCheck(compareCertificate(cert({ assignment: 20, exam: 70 }), SRC));
    expect(fail.outcome).toBe('fail');
    expect(fail.detail).toMatch(
      /Assignment marks on the certificate are 20, NPTEL has 22\.5; Exam marks on the certificate are 70, NPTEL has 61\.88/,
    );
    expect(marksMatchCheck(compareCertificate(cert({ exam: null }), SRC)).outcome).toBe('not_confirmed');
    expect(
      marksMatchCheck(compareCertificate(cert(), { source: null, error: 'source_unreachable' })).outcome,
    ).toBe('not_confirmed');
  });
});

describe('the verdict', () => {
  it('a genuine-looking PDF: every check passes → No tampering detected', () => {
    const r = assess(cert());
    expect(outcomes(r)).toEqual({
      id_match: 'pass',
      name_match: 'pass',
      course_match: 'pass',
      marks_match: 'pass',
      layer_vs_render: 'pass',
      metadata: 'pass',
    });
    expect(r).toMatchObject({ verdict: 'No tampering detected', failing: [] });
  });

  it('a genuine-looking image: the PDF-only checks are not_applicable', () => {
    const r = assess(cert({ fileKind: 'png', source: 'ocr', evidence: undefined }));
    expect(outcomes(r)).toMatchObject({
      layer_vs_render: 'not_applicable',
      metadata: 'not_applicable',
      marks_match: 'pass',
    });
    expect(r.verdict).toBe('No tampering detected');
  });

  it('edited marks on a screenshot → Tampering detected, naming marks_match', () => {
    const r = assess(cert({ fileKind: 'png', source: 'ocr', evidence: undefined, assignment: 20, exam: 70 }));
    expect(r.verdict).toBe('Tampering detected');
    expect(r.failing).toEqual(['marks_match']);
    expect(r.reason).toMatch(/^marks_match: Assignment marks on the certificate are 20/);
  });

  it('tampered metadata alone (marks agree with NPTEL) → Tampering detected, naming metadata', () => {
    const r = assess(
      cert({ evidence: { ...cert().evidence, pdfBytes: bytes('synthetic-tampered-metadata.pdf') } }),
    );
    expect(r.verdict).toBe('Tampering detected');
    expect(r.failing).toEqual(['metadata']);
  });

  it('an edited text layer → Tampering detected, naming layer_vs_render, EVEN WITH NO SOURCE', () => {
    const edited = cert({
      assignment: 25,
      exam: 75,
      evidence: { ...cert().evidence, textLayer: { ...TL, assignment: 25, exam: 75 }, renderOcr: OCR },
    });
    const r = assess(edited, { source: null, error: 'source_unreachable' });
    expect(r.verdict).toBe('Tampering detected');
    expect(r.failing).toEqual(['layer_vs_render']);
  });

  it('several failures are all named', () => {
    const r = assess(
      cert({
        assignment: 25,
        exam: 75,
        evidence: {
          pdfBytes: bytes('synthetic-tampered-metadata.pdf'),
          pdfInfo: null,
          textLayer: { ...TL, assignment: 25, exam: 75 },
          renderOcr: OCR,
        },
      }),
    );
    expect(r.failing).toEqual(['marks_match', 'layer_vs_render', 'metadata']);
  });

  it('a wrong roll number from the text layer fails id_match; the same from OCR does not', () => {
    expect(assess(cert({ rollNo: 'NPTEL25MG18S000000009' })).failing).toEqual(['id_match']);
    const viaOcr = assess(
      cert({ fileKind: 'png', source: 'ocr', evidence: undefined, rollNo: 'NPTEL25MG18S000000009' }),
    );
    expect(viaOcr.verdict).toBe('No tampering detected');
    expect(outcomes(viaOcr).id_match).toBe('not_confirmed');
  });

  describe('Not checked', () => {
    it('NPTEL unavailable: name, course and marks cannot be compared', () => {
      const r = assess(cert(), { source: null, error: 'source_timeout', message: 'NPTEL did not answer' });
      expect(r.verdict).toBe('Not checked');
      expect(r.reason).toMatch(/could not be compared with NPTEL/);
      expect(r.reason).toContain('source_timeout');
      expect(r.failing).toEqual([]);
    });
    it('a source that is not live: Verification says Unsuccessful, tampering says Not checked', () => {
      const r = assess(cert(), { source: null, error: 'source_not_live', meta: { status: 'REVOKED' } });
      expect(r.verdict).toBe('Not checked');
    });
    it('a MAJORITY of not_confirmed checks (half or more) → Not checked', () => {
      // name/course differ by OCR (not_confirmed), id roll missing (not_confirmed), marks pass: 2 of 4 applicable
      const r = assess(
        cert({
          fileKind: 'png',
          source: 'ocr',
          evidence: undefined,
          name: 'XXXX',
          course: 'YYYY',
          rollNo: undefined,
        }),
      );
      expect(outcomes(r)).toMatchObject({
        id_match: 'not_confirmed',
        name_match: 'not_confirmed',
        course_match: 'not_confirmed',
        marks_match: 'pass',
      });
      expect(r.verdict).toBe('Not checked');
      expect(r.reason).toMatch(/3 of 4 checks could not be confirmed/);
    });
  });

  describe('a MINORITY of not_confirmed is tolerated', () => {
    it('only the OCR roll is missing', () => {
      const r = assess(cert({ fileKind: 'png', source: 'ocr', evidence: undefined, rollNo: undefined }));
      expect(outcomes(r).id_match).toBe('not_confirmed');
      expect(r).toMatchObject({
        verdict: 'No tampering detected',
        reason: 'Not confirmed (a minority): id_match',
      });
    });
    it('an unreadable render comparison on an otherwise clean PDF', () => {
      const r = assess(cert({ evidence: { ...cert().evidence, renderOcr: null } }));
      expect(outcomes(r).layer_vs_render).toBe('not_confirmed');
      expect(r.verdict).toBe('No tampering detected');
    });
  });

  it('only the three verdict strings exist (rule 6: no third state)', () => {
    const verdicts = new Set([
      assess(cert()).verdict,
      assess(cert({ assignment: 1 })).verdict,
      assess(cert(), { source: null, error: 'x' }).verdict,
    ]);
    expect([...verdicts].sort()).toEqual(['No tampering detected', 'Not checked', 'Tampering detected']);
  });

  it("the check ids and order are the plan's", () => {
    expect(assess(cert()).checks.map((c) => c.id)).toEqual([
      'id_match',
      'name_match',
      'course_match',
      'marks_match',
      'layer_vs_render',
      'metadata',
    ]);
    for (const c of assess(cert()).checks)
      expect(['pass', 'fail', 'not_confirmed', 'not_applicable']).toContain(c.outcome);
  });
});

describe('config.js and purity', () => {
  it('has no number or list used by the checks outside config.js', () => {
    const src = fs.readFileSync(path.resolve(import.meta.dirname, '../../src/lib/tamper/checks.js'), 'utf8');
    for (const banned of [/\b86400\b/, /\b0\.5\b/, /\b85\b/, /'sejda'|'ilovepdf'|'adobe acrobat'/])
      expect(src).not.toMatch(banned);
  });
  it('every exported config value is commented with its evidence', () => {
    const src = fs.readFileSync(path.resolve(import.meta.dirname, '../../src/lib/tamper/config.js'), 'utf8');
    for (const name of Object.keys(config)) {
      const idx = src.indexOf(`export const ${name}`);
      expect(idx, name).toBeGreaterThan(0);
      // a comment block must end before the export, with nothing but other one-line exports in between
      const before = src.slice(0, idx);
      const afterComment = before.slice(before.lastIndexOf('*/') + 2);
      expect(afterComment, name).toMatch(/^(\s*export const \w+ = [^;]+;)*\s*$/);
    }
    expect(src).toMatch(/G1/);
    expect(src).toMatch(/G2/);
  });
  it('the tamper modules use no browser APIs', () => {
    for (const f of ['checks.js', 'metadata.js', 'config.js']) {
      const src = fs.readFileSync(path.resolve(import.meta.dirname, '../../src/lib/tamper', f), 'utf8');
      expect(src, f).not.toMatch(
        /\b(window|document|navigator|OffscreenCanvas|Worker|performance)\b\s*[.[(]/,
      );
    }
  });
});
