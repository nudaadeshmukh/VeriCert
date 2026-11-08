// OCR of small crops with tesseract.js (browser only).
//
// Rules (CLAUDE.md known facts + plan):
//  - NEVER OCR a full page: full-page OCR of near-blank PDFs took about 30 s each. Only crops.
//  - A per-certificate budget (default 8 s, including worker start-up). Running out of time
//    gives `ocr_timeout` ("not confirmed (timeout)"): the field is null, never a guess.
//  - Malformed OCR output ("7" for a name) is "not confirmed", never a mismatch (rule 6).
//  - tesseract.js is imported only when OCR is actually needed, and everything it would
//    normally download from a CDN is self-hosted (scripts/copy-vendor.mjs).
//
// Reading the name and the course uses the certificate's own printed boilerplate as anchors:
//   "This certificate is awarded to"  → NAME → "for successfully completing the course"
//   → COURSE → "with a consolidated score of …" → marks row
// Observed on the Jan–Feb 2025 template (NOTES.md §1.2). If an anchor cannot be found the
// name/course are reported as not confirmed instead of being guessed from a fixed position.
import { cropPixels, cropScaled, findTableBorders, toOcrCanvas } from './image.js';
import { isPlausibleCourse, isPlausibleName, findRollNo, normalizeText, parseMarks } from './parse.js';
import { vendorUrl } from './vendor.js';

export const OCR_BUDGET_MS = 8000;

/** Crops as fractions of the page. Wide and short: a few lines each, never the page. */
export const OCR_CROPS = {
  // from just under the title to the consolidated-score line
  identity: { x: 0.18, y: 0.19, w: 0.64, h: 0.31 },
  // bottom-left: "Roll No: NPTEL…" (read twice, with and without the label, which must agree)
  roll: { x: 0, y: 0.9, w: 0.5, h: 0.1 },
  rollValue: { x: 0.08, y: 0.915, w: 0.25, h: 0.07 },
  // The marks cells are found from the table borders in the pixels (see readMarksTable); there
  // is no fixed marks rectangle.
};

/**
 * @typedef {{ code: string, field?: string, message: string }} OcrError
 * @typedef {{ name: string | null, course: string | null, assignment: number | null, exam: number | null,
 *   rollNo?: string, confidence: { name?: number, course?: number, marks?: number },
 *   errors: OcrError[], timings: Record<string, number> }} OcrResult
 */

class OcrTimeout extends Error {}

/** @type {Promise<import('tesseract.js').Worker> | undefined} */
let workerPromise;
/** Serialises jobs: one worker, and parameters (whitelist) are per worker. */
let queue = Promise.resolve();

async function getWorker() {
  workerPromise ??= (async () => {
    const mod = await import('tesseract.js');
    const createWorker = mod.createWorker ?? mod.default.createWorker;
    return createWorker('eng', 1, {
      workerPath: vendorUrl('tesseract/worker.min.js'),
      corePath: vendorUrl('tesseract/core'),
      langPath: vendorUrl('tesseract/lang'),
      gzip: true,
    });
  })();
  try {
    return await workerPromise;
  } catch (err) {
    workerPromise = undefined; // allow a later retry
    throw err;
  }
}

/** Kill the cached worker (after a timeout, or when a page is done with OCR). */
export async function shutdownOcr() {
  const p = workerPromise;
  workerPromise = undefined;
  if (p) {
    try {
      await (await p).terminate();
    } catch {
      /* already gone */
    }
  }
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} deadline `performance.now()` value
 * @returns {Promise<T>}
 */
function withDeadline(promise, deadline) {
  const remaining = deadline - performance.now();
  if (remaining <= 0) return Promise.reject(new OcrTimeout());
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new OcrTimeout()), remaining);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {import('tesseract.js').Worker} worker
 * @param {HTMLCanvasElement} crop
 * @param {Record<string, string>} params
 * @param {number} deadline
 */
async function recognise(worker, crop, params, deadline) {
  await withDeadline(worker.setParameters(params), deadline);
  const { data } = await withDeadline(worker.recognize(crop, {}, { text: true, blocks: true }), deadline);
  /** @type {{ text: string, confidence: number }[]} */
  const lines = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? [])
        lines.push({ text: normalizeText(line.text), confidence: line.confidence });
    }
  }
  return { text: data.text ?? '', lines: lines.filter((l) => l.text !== '') };
}

/** Pick the crop's scale so its width is about 1400 px (text ≥ ~30 px tall), within 1x–3x. */
function ocrScale(page, rect) {
  return Math.min(3, Math.max(1, 1400 / (rect.w * page.width)));
}

const ANCHOR = {
  awardedTo: /awarded|certificate is/i,
  completing: /successfully|completing|the course/i,
  score: /consolidated|score of|with a/i,
};

/**
 * Name and course from the identity crop's lines, using the printed phrases as anchors.
 * @param {{ text: string, confidence: number }[]} lines
 */
export function readIdentity(lines) {
  /** @type {OcrError[]} */
  const errors = [];
  const idx = {
    awarded: lines.findIndex((l) => ANCHOR.awardedTo.test(l.text)),
    completing: lines.findIndex((l) => ANCHOR.completing.test(l.text)),
    score: lines.findIndex((l) => ANCHOR.score.test(l.text)),
  };
  /** @type {string | null} */
  let name = null;
  /** @type {string | null} */
  let course = null;
  /** @type {{ name?: number, course?: number }} */
  const confidence = {};

  if (idx.awarded < 0 || idx.completing <= idx.awarded) {
    errors.push({
      code: 'name_not_confirmed',
      field: 'name',
      message: 'Could not locate the name between the printed "awarded to" and "completing the course" lines',
    });
  } else {
    const between = lines.slice(idx.awarded + 1, idx.completing);
    const candidate = normalizeText(between.map((l) => l.text).join(' '));
    if (between.length > 0 && isPlausibleName(candidate)) {
      name = candidate;
      confidence.name = Math.min(...between.map((l) => l.confidence));
    } else {
      errors.push({
        code: 'name_not_confirmed',
        field: 'name',
        message: 'OCR of the name was empty or malformed',
      });
    }
  }

  if (idx.completing < 0 || idx.score <= idx.completing) {
    errors.push({
      code: 'course_not_confirmed',
      field: 'course',
      message:
        'Could not locate the course between the printed "completing the course" and "consolidated score" lines',
    });
  } else {
    const between = lines.slice(idx.completing + 1, idx.score);
    const candidate = normalizeText(between.map((l) => l.text).join(' '));
    if (between.length > 0 && isPlausibleCourse(candidate)) {
      course = candidate;
      confidence.course = Math.min(...between.map((l) => l.confidence));
    } else {
      errors.push({
        code: 'course_not_confirmed',
        field: 'course',
        message: 'OCR of the course was empty or malformed',
      });
    }
  }
  return { name, course, confidence, errors };
}

/**
 * A mark is accepted only if at least two OCR passes agree on it AND no pass produced a
 * different well-formed value. Measured on the PNG/JPEG samples (Phase 2): tesseract's own
 * confidence is useless here (0–30 on correct reads of the edited cells, 96 on correct reads of
 * the genuine ones), and a wrong-but-well-formed value such as "22.8/25" would look like a
 * tampering mismatch downstream. Passes are cheap (about 30 ms each), so all of them are run.
 * Malformed reads ("22.5125": the slash read as a 1) are simply not votes.
 */
const CELL_PASSES = [2, 3, 4, 5].flatMap((scale) => [
  { scale, threshold: 140 },
  { scale, threshold: null },
]);

/**
 * Read the two value cells of the marks table on their own (PSM 7, single line, digits / .).
 * The whole-row crops were measured to drop the "." and "/" ("22.5/25" read as "22525"),
 * so the cells are located from the table's borders in the pixels.
 *
 * @param {import('tesseract.js').Worker} worker
 * @param {HTMLCanvasElement} canvas
 * @param {number} deadline
 * @param {Record<string, unknown>} raw
 * @returns {Promise<{ assignment: number | null, exam: number | null, errors: OcrError[] }>}
 */
async function readMarksTable(worker, canvas, deadline, raw) {
  /** @type {OcrError[]} */
  const errors = [];
  const out = {
    assignment: /** @type {number | null} */ (null),
    exam: /** @type {number | null} */ (null),
    errors,
  };
  const table = findTableBorders(canvas);
  if (!table) {
    for (const field of ['assignment', 'exam']) {
      errors.push({
        code: 'marks_not_confirmed',
        field,
        message: 'Could not locate the marks table in the image',
      });
    }
    return out;
  }
  const { xs, top, bottom } = table;
  const inset = 4;
  const cells = /** @type {const} */ ([
    ['assignment', xs[1], xs[2]],
    ['exam', xs[3], xs[4]],
  ]);
  for (const [field, left, right] of cells) {
    const rect = { x: left + inset, y: top + 3, w: right - left - 2 * inset, h: bottom - top - 6 };
    /** @type {Map<string, { n: number, value: number | null, error?: OcrError }>} */
    const votes = new Map();
    const readings = [];
    for (const pass of CELL_PASSES) {
      const crop = cropPixels(canvas, rect, pass.scale, pass.threshold);
      const { text } = await recognise(
        worker,
        crop,
        { tessedit_char_whitelist: '0123456789/.', tessedit_pageseg_mode: '7' },
        deadline,
      );
      readings.push(text.trim());
      const parsed = parseMarks(text, { tolerant: true });
      const value = parsed[field];
      const rangeError = parsed.errors.find((e) => e.field === field && e.code === 'marks_out_of_range');
      // Only a well-formed reading whose denominator matches the cell counts (n/25 first, n/75 second).
      const key = value !== null ? `v:${value}` : rangeError ? 'range' : null;
      if (key === null) continue;
      const vote = votes.get(key) ?? { n: 0, value, error: rangeError };
      vote.n++;
      votes.set(key, vote);
    }
    const ranked = [...votes.values()].sort((x, y) => y.n - x.n);
    const accepted = ranked.length === 1 && ranked[0].n >= 2 ? ranked[0] : null;
    raw[`marks_${field}`] = readings;
    if (accepted?.error) errors.push({ ...accepted.error, field });
    else if (accepted) out[field] = accepted.value;
    else {
      errors.push({
        code: 'marks_not_confirmed',
        field,
        message:
          ranked.length > 1
            ? `OCR passes disagreed on the ${field} cell`
            : `OCR of the ${field} cell was unreadable or inconsistent between passes`,
      });
    }
  }
  return out;
}

/**
 * Roll number (optional). Measured: at 2x the roll reads exactly; at 3x/4x tesseract reads the
 * letter S of "…18S640…" as 5. So two different crops are read at 2x and must give the same
 * string, which must also match the strict roll-number pattern.
 *
 * @param {import('tesseract.js').Worker} worker
 * @param {HTMLCanvasElement} canvas
 * @param {number} deadline
 * @param {Record<string, unknown>} raw
 * @returns {Promise<string | undefined>}
 */
async function readRollNo(worker, canvas, deadline, raw) {
  const crops = [OCR_CROPS.roll, OCR_CROPS.rollValue];
  const found = [];
  for (const rect of crops) {
    // Fixed 2x (not ocrScale): see above.
    const crop = toOcrCanvas(cropScaled(canvas, rect, 2));
    try {
      const { text } = await recognise(
        worker,
        crop,
        { tessedit_char_whitelist: '', tessedit_pageseg_mode: '7' },
        deadline,
      );
      found.push(findRollNo(text));
    } catch (err) {
      if (err instanceof OcrTimeout) throw err;
      found.push(undefined);
    }
  }
  raw.roll = found;
  return found[0] && found[0] === found[1] ? found[0] : undefined;
}

/**
 * OCR the crops of a rendered page or an image.
 *
 * @param {HTMLCanvasElement} canvas the page render or the image
 * @param {{ budgetMs?: number, need?: { identity?: boolean, marks?: boolean, roll?: boolean } }} [opts]
 *   `need` limits which crops are read (a PDF with a text layer only needs what is missing)
 * @returns {Promise<OcrResult>}
 */
export function ocrCertificate(canvas, { budgetMs = OCR_BUDGET_MS, need = {}, debug = false } = {}) {
  const job = queue.then(() =>
    run(canvas, budgetMs, { identity: true, marks: true, roll: true, ...need }, debug),
  );
  queue = job.catch(() => {});
  return job;
}

/** @returns {Promise<OcrResult>} */
async function run(canvas, budgetMs, need, debug) {
  const t0 = performance.now();
  const deadline = t0 + budgetMs;
  /** @type {OcrResult} */
  const result = {
    name: null,
    course: null,
    assignment: null,
    exam: null,
    confidence: {},
    errors: [],
    timings: {},
  };
  const page = { width: canvas.width, height: canvas.height };
  /** Raw OCR text per crop, only when `debug` is set (it can contain personal data). */
  const raw = {};
  if (debug) result.debug = raw;
  // Which step was running, so a timeout says where it stalled (Phase 2 saw one unexplained
  // timeout; see docs/challenges-log.md C-014/C-015).
  let stage = 'worker';
  const timeoutErrors = () => [{ code: 'ocr_timeout', message: 'not confirmed (timeout)', stage }];

  try {
    const w0 = performance.now();
    const worker = await withDeadline(getWorker(), deadline);
    result.timings.workerMs = performance.now() - w0;

    if (need.identity) {
      stage = 'identity';
      const s = performance.now();
      const crop = toOcrCanvas(cropScaled(canvas, OCR_CROPS.identity, ocrScale(page, OCR_CROPS.identity)));
      const { lines } = await recognise(
        worker,
        crop,
        { tessedit_char_whitelist: '', tessedit_pageseg_mode: '6' },
        deadline,
      );
      if (debug) raw.identity = lines.map((l) => `${Math.round(l.confidence)}|${l.text}`);
      const id = readIdentity(lines);
      result.name = id.name;
      result.course = id.course;
      Object.assign(result.confidence, id.confidence);
      result.errors.push(...id.errors);
      result.timings.identityMs = performance.now() - s;
    }

    if (need.marks) {
      stage = 'marks';
      const s = performance.now();
      const marks = await readMarksTable(worker, canvas, deadline, raw);
      result.assignment = marks.assignment;
      result.exam = marks.exam;
      result.errors.push(...marks.errors);
      result.timings.marksMs = performance.now() - s;
    }

    // The roll number is optional and only read if there is time left; it never adds an error.
    if (need.roll && deadline - performance.now() > 1500) {
      stage = 'roll';
      const s = performance.now();
      const roll = await readRollNo(worker, canvas, deadline, raw);
      if (roll) result.rollNo = roll;
      result.timings.rollMs = performance.now() - s;
    }
  } catch (err) {
    if (err instanceof OcrTimeout) {
      // The recognise call cannot be cancelled: drop the worker so the next job starts clean.
      await shutdownOcr();
      result.errors.push(...timeoutErrors());
    } else {
      await shutdownOcr();
      result.errors.push({ code: 'ocr_unavailable', message: `OCR could not run: ${err?.message ?? err}` });
    }
  }
  result.timings.totalMs = performance.now() - t0;
  return result;
}
