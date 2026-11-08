import { describe, expect, it } from 'vitest';
import { compareCertificate, marksEqual, normalizeForCompare } from '../../src/lib/compare.js';

const src = (over = {}) => ({
  source: {
    name: 'ASHA RAMESH KULKARNI',
    course: 'Design Thinking - A Primer',
    assignment: 22.5,
    exam: 61.88,
    total: 84,
    ...over,
  },
});
const cert = (over = {}) => ({
  name: 'ASHA RAMESH KULKARNI',
  course: 'Design Thinking - A Primer',
  assignment: 22.5,
  exam: 61.88,
  source: 'text_layer',
  ...over,
});

describe('marksEqual: tolerance 0.01, decimals allowed', () => {
  it.each([
    [22.5, 22.5, true],
    [22.5, 22.51, true], // exactly 0.01 apart (floating point makes it 0.010000000000001563)
    [22.51, 22.5, true],
    [22.5, 22.52, false],
    [61.88, 61.88, true],
    [61.88, 61.9, false],
    [0, 0, true],
    [25, 24.99, true],
    [25, 24.98, false],
  ])('%s vs %s → %s', (a, b, want) => expect(marksEqual(a, b)).toBe(want));
});

describe('Verification verdict', () => {
  it('Successful when both marks match', () => {
    const r = compareCertificate(cert(), src());
    expect(r).toMatchObject({ verification: 'Successful', reason: null });
    expect(r.marks.assignment.outcome).toBe('match');
  });
  it('Successful within the tolerance', () => {
    expect(compareCertificate(cert({ assignment: 22.51, exam: 61.87 }), src()).verification).toBe(
      'Successful',
    );
  });
  it('Unsuccessful when a mark differs, and the reason names both values', () => {
    const r = compareCertificate(cert({ assignment: 20, exam: 70 }), src());
    expect(r.verification).toBe('Unsuccessful');
    expect(r.reason).toContain('Assignment marks differ (certificate 20, NPTEL 22.5)');
    expect(r.reason).toContain('Exam marks differ (certificate 70, NPTEL 61.88)');
  });
  it('Unsuccessful when only one mark differs', () => {
    expect(compareCertificate(cert({ exam: 62 }), src()).verification).toBe('Unsuccessful');
  });

  describe('any missing side is an Error with a reason (never a match, never a mismatch)', () => {
    it('certificate marks not read', () => {
      const r = compareCertificate(cert({ assignment: null }), src());
      expect(r.verification).toBe('Error');
      expect(r.reason).toMatch(/Assignment marks could not be read from the certificate/);
    });
    it('both certificate marks missing (undefined)', () => {
      const r = compareCertificate({ name: 'X' }, src());
      expect(r.verification).toBe('Error');
      expect(r.reason).toMatch(/Assignment.*certificate.*Exam.*certificate/s);
    });
    it('source unavailable, with the error code in the reason', () => {
      const r = compareCertificate(cert(), {
        source: null,
        error: 'source_timeout',
        message: 'NPTEL did not answer',
      });
      expect(r.verification).toBe('Error');
      expect(r.reason).toContain('source_timeout');
      expect(r.reason).toContain('not available from NPTEL');
    });
    it('source present but its marks could not be parsed', () => {
      const r = compareCertificate(cert(), {
        ...src({ assignment: null, exam: null }),
        error: 'source_parse_failed',
      });
      expect(r.verification).toBe('Error');
      expect(r.reason).toContain('source_parse_failed');
    });
    it('no result at all', () => {
      expect(compareCertificate(cert(), null).verification).toBe('Error');
      expect(compareCertificate(cert(), undefined).verification).toBe('Error');
    });
    it('nothing differs and a value is missing: Error (a missing mark alone never proves a mismatch)', () => {
      const r = compareCertificate(cert({ assignment: 22.5, exam: null }), src());
      expect(r.verification).toBe('Error');
      expect(r.reason).toContain('Exam marks could not be read');
      expect(r.reason).not.toContain('differ');
    });
    it.each([NaN, Infinity, '22.5', {}])('a non-number mark (%s) is missing, not zero', (bad) => {
      expect(compareCertificate(cert({ assignment: bad }), src()).verification).toBe('Error');
    });
    it('a zero mark is a real value, not missing', () => {
      const r = compareCertificate(cert({ assignment: 0, exam: 0 }), src({ assignment: 0, exam: 0 }));
      expect(r.verification).toBe('Successful');
    });
  });
});

describe('a differing mark beats a missing one (decided by the user in the Phase 3 review)', () => {
  it('one mark differs and the other is unread on the certificate: Unsuccessful, both named', () => {
    const r = compareCertificate(cert({ assignment: 20, exam: null }), src());
    expect(r.verification).toBe('Unsuccessful');
    expect(r.reason).toContain('Assignment marks differ (certificate 20, NPTEL 22.5)');
    expect(r.reason).toContain('Exam marks could not be read from the certificate');
    expect(r.marks.assignment.outcome).toBe('differ');
    expect(r.marks.exam.outcome).toBe('missing');
  });
  it('one mark differs and the other is missing on the NPTEL side: Unsuccessful', () => {
    const r = compareCertificate(cert({ assignment: 20 }), {
      ...src({ exam: null }),
      error: 'source_parse_failed',
    });
    expect(r.verification).toBe('Unsuccessful');
    expect(r.reason).toContain('Assignment marks differ (certificate 20, NPTEL 22.5)');
    expect(r.reason).toContain('Exam marks are not available from NPTEL');
    expect(r.reason).toContain('source_parse_failed');
  });
  it('the mismatch is on the second mark and the first is unread: still Unsuccessful', () => {
    expect(compareCertificate(cert({ assignment: null, exam: 70 }), src()).verification).toBe('Unsuccessful');
  });
  it('a match on one mark plus a missing other is still just Error', () => {
    expect(compareCertificate(cert({ exam: null }), src()).verification).toBe('Error');
  });
  it('with the source entirely unavailable nothing can differ, so it stays Error', () => {
    const r = compareCertificate(cert({ assignment: 20 }), { source: null, error: 'source_unreachable' });
    expect(r.verification).toBe('Error');
  });
});

describe('a certificate NPTEL says is not live is Unsuccessful, not Error', () => {
  const notLive = (status) => ({
    source: null,
    error: 'source_not_live',
    message: `NPTEL reports this certificate's status as "${status}"`,
    meta: { status },
  });
  it('uses the exact remark', () => {
    const r = compareCertificate(cert(), notLive('REVOKED'));
    expect(r.verification).toBe('Unsuccessful');
    expect(r.reason).toBe('Certificate not live on NPTEL (status: REVOKED)');
  });
  it('even when the certificate marks are missing or would otherwise match', () => {
    expect(compareCertificate(cert(), notLive('EXPIRED')).verification).toBe('Unsuccessful');
    expect(compareCertificate({ name: 'X' }, notLive('EXPIRED')).verification).toBe('Unsuccessful');
  });
  it('names and courses are not_confirmed (the source was not read)', () => {
    expect(compareCertificate(cert(), notLive('REVOKED')).checks.map((c) => c.outcome)).toEqual([
      'not_confirmed',
      'not_confirmed',
    ]);
  });
  it('says "unknown" rather than inventing a status if the status text is absent', () => {
    const r = compareCertificate(cert(), { source: null, error: 'source_not_live' });
    expect(r.reason).toBe('Certificate not live on NPTEL (status: unknown)');
  });
});

describe('name and course are CHECKS and never change the Verification verdict', () => {
  it('different name and course, marks equal: still Successful, with failing checks', () => {
    const r = compareCertificate(cert({ name: 'SOMEONE ELSE', course: 'Other Course' }), src());
    expect(r.verification).toBe('Successful');
    expect(r.checks.map((c) => [c.id, c.outcome])).toEqual([
      ['name_match', 'fail'],
      ['course_match', 'fail'],
    ]);
  });
  it('equal after normalisation: case, spacing and punctuation do not matter', () => {
    const r = compareCertificate(
      cert({ name: '  asha   ramesh kulkarni ', course: 'DESIGN THINKING – A PRIMER' }),
      src(),
    );
    expect(r.checks.every((c) => c.outcome === 'pass')).toBe(true);
  });
  it('a missing name is not_confirmed, never fail', () => {
    const r = compareCertificate(cert({ name: null }), src());
    expect(r.checks[0]).toMatchObject({ id: 'name_match', outcome: 'not_confirmed' });
    const r2 = compareCertificate(cert(), src({ course: null }));
    expect(r2.checks[1]).toMatchObject({ id: 'course_match', outcome: 'not_confirmed' });
  });
  it('an OCR-read name that differs is not_confirmed, not a mismatch (OCR can misread names)', () => {
    const r = compareCertificate(cert({ name: 'ASHA RAMESH KULKARN', source: 'ocr' }), src());
    expect(r.checks[0].outcome).toBe('not_confirmed');
    expect(r.checks[0].detail).toMatch(/OCR/);
    // ...but an OCR value that matches still passes.
    expect(compareCertificate(cert({ source: 'ocr' }), src()).checks[0].outcome).toBe('pass');
  });
  it('with the source unavailable both checks are not_confirmed', () => {
    const r = compareCertificate(cert(), { source: null, error: 'source_unreachable' });
    expect(r.checks.map((c) => c.outcome)).toEqual(['not_confirmed', 'not_confirmed']);
  });
});

describe('normalizeForCompare (Unicode)', () => {
  it('NFC and case-folding', () => {
    expect(normalizeForCompare('ज़')).toBe(normalizeForCompare('ज़')); // nukta, both forms
    expect(normalizeForCompare('ÉCOLE')).toBe(normalizeForCompare('école'));
  });
  it('keeps Devanagari combining marks', () => {
    expect(normalizeForCompare('आशा रमेश कुलकर्णी')).toBe('आशा रमेश कुलकर्णी');
    expect(normalizeForCompare('आशा रमेश')).not.toBe(normalizeForCompare('आश रमश')); // vowel signs matter
  });
  it('treats punctuation and dashes as spaces and collapses whitespace', () => {
    expect(normalizeForCompare('Data-Structures & Algorithms (Part 2)')).toBe(
      'data structures algorithms part 2',
    );
  });
  it('different names stay different', () => {
    expect(normalizeForCompare('ASHA KULKARNI')).not.toBe(normalizeForCompare('ASHA KULKARN'));
  });
});
