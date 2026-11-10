// EVERY threshold, list and tolerance used by the tampering checks (CLAUDE.md rule 7).
//
// Rule 7: never flag a signal that has not been confirmed against a known-genuine certificate. The
// evidence behind each value is cited by sample label; the samples themselves and the raw numbers are in
// NOTES.md §6. Samples:
//   G1  genuine Jul–Sep 2026 PDF, NPTEL-served (Producer MuPDF 1.28.2, no dates, 1 %%EOF)
//   G2  genuine Jan–Feb 2025 PDF, NPTEL-served (Producer FPDF 1.81, CreationDate only, 1 %%EOF)
//   G3  genuine 2025 screenshot (NPTEL.png): no PDF structure
// and the known-tampered NPTEL_tampered.png (marks edited), plus synthetic fixtures made by us.
//
// Where a value could not be calibrated on a genuine sample it says so and errs on the side of NOT flagging.
// Two genuine PDFs and one screenshot is a small basis: docs/progress.md lists what to revisit.

// ------------------------------------------------------------------------------------------ metadata

/**
 * Producer / Creator substrings (case-insensitive) of tools whose purpose is to EDIT a PDF or of online
 * editing services. A match in the current Producer/Creator, or in ANY earlier Producer left behind by an
 * incremental update, fails the `metadata` check.
 *
 * Evidence: G1 and G2 show only `MuPDF 1.28.2` and `FPDF 1.81`; none of these appears in a genuine file. That is
 * all the evidence there is (absence), so the list is short and limited to dedicated editors. Deliberately NOT
 * listed: generators that also make legitimate PDFs ("Adobe PDF Library", "Acrobat Distiller", Microsoft Word,
 * "Microsoft: Print To PDF", Chrome's "Skia/PDF", LibreOffice Writer), because NPTEL has changed generator
 * between sessions (G2 to G1) and a post-processing step in its pipeline is plausible (G1 is a MuPDF rewrite).
 * An unknown Producer is NOTED in the check's detail and never flags.
 */
export const EDITOR_DENYLIST = Object.freeze([
  'adobe acrobat', // the interactive editor ("Adobe Acrobat Pro DC ..."), not the PDF Library or Distiller
  'foxit phantom',
  'foxit pdf editor',
  'pdf-xchange editor',
  'nitro pro',
  'nitro pdf',
  'sejda',
  'ilovepdf',
  'smallpdf',
  'pdfescape',
  'pdffiller',
  'soda pdf',
  'pdfelement',
  'master pdf editor',
]);

/**
 * ModDate must be this many seconds after CreationDate to count as "meaningfully after".
 *
 * NOT calibrated on a genuine sample: neither G1 (no dates) nor G2 (CreationDate only) has a ModDate. One day is
 * chosen so that a generator stamping both dates within seconds, or across a timezone rounding, can never trip it.
 * Revisit when a genuine certificate that carries a ModDate is collected.
 */
export const MODDATE_MIN_GAP_SECONDS = 24 * 60 * 60;

/**
 * Structure of an untouched file. G1 and G2 both have exactly 1 `%%EOF`, 1 `startxref`, 1 xref section and no
 * `/Prev`. Anything above that is an incremental update (the way an editor appends changes), which fails.
 *
 * A LINEARIZED file legitimately has 2 of each and one `/Prev` by construction of the format; no genuine
 * linearized file has been seen (G1, G2: not linearized), so that allowance comes from the PDF specification and is
 * untested. It only ever loosens the check.
 */
export const BASELINE_STRUCTURE = Object.freeze({
  plain: Object.freeze({ eof: 1, startxref: 1, xrefSections: 1, prev: 0 }),
  linearized: Object.freeze({ eof: 2, startxref: 2, xrefSections: 2, prev: 1 }),
});

// -------------------------------------------------------------------------------------- layer_vs_render

/**
 * Marks read from the rendered page (OCR) must equal the text layer within this. Same tolerance as the
 * verification verdict (CLAUDE.md: 0.01). G1 and G2: render OCR equal to the text layer exactly on all four marks.
 * The OCR values only count when Phase 2's agreement rule accepted them (two passes agree, none disagree).
 */
export const LAYER_MARK_TOLERANCE = 0.01;

// ------------------------------------------------------------------------- OCR'd names and courses

/**
 * When is a NAME or COURSE read by OCR allowed to CONTRADICT another source (NPTEL's value for `name_match` and
 * `course_match`, or the PDF text layer for `layer_vs_render`)? Only if ALL of these hold; otherwise the check is
 * `not_confirmed` ("could not be confirmed - check manually"), never a fail (CLAUDE.md rule 6):
 *
 *   1. AGREEMENT: two independent OCR reads of the identity crop (different scale, Phase 2/4) gave the same text.
 *   2. CONFIDENCE: the lower of the two reads' line confidences is at least OCR_TEXT_MIN_CONFIDENCE.
 *   3. CLEARLY DIFFERENT: after normalisation (NFC, case, punctuation) BOTH the edit distance is at least
 *      OCR_TEXT_MIN_EDIT_DISTANCE characters AND edit distance / longer length is at least
 *      OCR_TEXT_MIN_DIFFERENCE_RATIO. Equivalently the texts are less than 85 % similar (1 minus the ratio) and differ by
 *      three or more characters.
 *
 * EVIDENCE (measured 2026-11-10, NOTES.md §6 and docs/progress.md Phase 4 follow-up): 54 genuine OCR reads, 6 each of 9
 * files derived from the two genuine certificates (G3 screenshot, its JPEG copies at quality 95, 85 and 75, the tampered
 * screenshot's untouched name, the 2025 and 2026 PDFs rendered to 1054 px images, and the render OCR of the G1 and G2 PDF
 * pages). Every name and course was read EXACTLY (edit distance 0 in 54 of 54), the two reads agreed in 54 of 54, and the lowest
 * confidence was 92 for names and 94 for courses. Caveat: that is one name and two courses, and repeated reads of identical
 * bytes are not independent samples; no genuine certificate has ever produced an OCR name or course with any error.
 *
 * - CONFIDENCE 85: below every genuine read (92 to 96), so a genuine line always clears it, and a line OCR itself doubts never
 *   accuses a student.
 * - EDIT DISTANCE 3: the OCR errors seen anywhere in this project are one character (the S read as a 5 in the roll number, a
 *   dropped "/" in a mark, C-010, C-011), and none has appeared in a name or course at all. Three characters sits two beyond
 *   the largest slip ever seen, so a one- or two-letter difference (an OCR slip, or a one-letter forgery) stays
 *   `not_confirmed` and is left for a manual check.
 * - RATIO 0.15: three characters in a 20-character name is exactly 0.15, so an ordinary name change clears it; in a 60-character
 *   course title three characters is 0.05 and does not, because longer text is more likely to carry two or three OCR slips.
 *
 * None of the three bounds has been measured against a genuine DIFFERENCE (none exists); they are anchored to the absence of
 * any OCR error in the genuine samples and to the size of the errors seen elsewhere. Revisit with more genuine certificates.
 */
export const OCR_TEXT_MIN_CONFIDENCE = 85;
export const OCR_TEXT_MIN_EDIT_DISTANCE = 3;
export const OCR_TEXT_MIN_DIFFERENCE_RATIO = 0.15;

// ------------------------------------------------------------------------------------------- verdict

/**
 * If at least this fraction of the applicable checks are `not_confirmed`, the verdict is `Not checked` instead of
 * `No tampering detected` (the plan: a MINORITY of not_confirmed is tolerated). No genuine-sample basis: it is the
 * plan's word "minority" made concrete as "strictly less than half".
 */
export const NOT_CONFIRMED_LIMIT = 0.5;

/** The core checks (plan, Phase 4, items 2 and 3). If none of them could run the verdict is `Not checked`. */
export const CORE_CHECKS = Object.freeze(['name_match', 'course_match', 'marks_match']);
