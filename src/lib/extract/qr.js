// QR decoding (browser only).
//
// Order (plan, Phase 2): jsQR on the full page → zxing-wasm on the full page → upscaled,
// greyscaled and thresholded crops of the likely QR regions, each tried with both decoders.
// Phase 0 measured why all three exist (NOTES.md §1.2): on the ~54 px PNG QR, jsQR failed on raw
// pixels at 1x/2x/3x but succeeded after binarising; zxing-wasm decoded the untouched image.
//
// A decoded payload only counts if it is an NPTEL certificate URL (`parseVerifyUrl`). A QR that
// decodes to something else is remembered as the failure reason and the search continues, so a
// stray second QR on a page cannot hide the real one, and a non-NPTEL URL is never passed on.
import jsQR from 'jsqr';
import { binarise, cropScaled, getImageData } from './image.js';
import { parseVerifyUrl } from './parse.js';
import { vendorUrl } from './vendor.js';

/** @type {Promise<typeof import('zxing-wasm/reader')> | undefined} */
let zxingPromise;
/** zxing-wasm is loaded on first use, with its wasm self-hosted (the default is a CDN). */
function loadZxing() {
  zxingPromise ??= import('zxing-wasm/reader').then((mod) => {
    mod.prepareZXingModule({
      overrides: {
        locateFile: (path, prefix) =>
          path.endsWith('.wasm') ? vendorUrl('zxing/zxing_reader.wasm') : prefix + path,
      },
      fireImmediately: true,
    });
    return mod;
  });
  return zxingPromise;
}

/**
 * Likely QR locations as fractions of the page. NPTEL puts the QR in the bottom bar (both
 * observed layouts); the rest of the list is a safety net, tried last.
 * @type {{ name: string, rect: import('./image.js').Rect }[]}
 */
export const QR_REGIONS = [
  { name: 'bottom-strip', rect: { x: 0, y: 0.72, w: 1, h: 0.28 } },
  { name: 'bottom-right', rect: { x: 0.5, y: 0.6, w: 0.5, h: 0.4 } },
  { name: 'bottom-left', rect: { x: 0, y: 0.6, w: 0.5, h: 0.4 } },
  { name: 'whole-page', rect: { x: 0, y: 0, w: 1, h: 1 } },
];
const SCALES = [2, 3];
/**
 * Upper bound for the whole QR search. Measured (Phase 2): successful decodes take 0.1–0.35 s;
 * a page with no QR at all runs the full 50-attempt search, about 8 s, so it is cut off here.
 * The 110 grey threshold was dropped: no measured sample needed it (raw, 140 and Otsu cover them).
 */
export const QR_BUDGET_MS = 4000;
/** 'raw' keeps colour; the numbers and 'otsu' binarise (140 is what worked on the PNG sample). */
const FILTERS = /** @type {const} */ (['grey-140', 'otsu']);

/** @param {ImageData} img */
function decodeJsQr(img) {
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

/** @param {ImageData} img */
async function decodeZxing(img) {
  const { readBarcodes } = await loadZxing();
  const results = await readBarcodes(img, {
    formats: ['QRCode'],
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    maxNumberOfSymbols: 1,
  });
  return results.find((r) => r.isValid)?.text ?? null;
}

/**
 * @typedef {{ url: string, shape: 'verify' | 'e_certificate', certificateId: string, method: string, attempts: number }} QrFound
 * @typedef {{ error: { code: string, message: string }, attempts: number }} QrFailed
 */

/**
 * Find the NPTEL verification URL in a rendered page or an image.
 *
 * Failure codes: `qr_not_found` (nothing decoded), `qr_not_url`, `qr_unsupported_scheme`,
 * `qr_not_nptel`, `qr_unknown_shape` (a QR was decoded but is not an NPTEL certificate URL).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ budgetMs?: number }} [opts]
 * @returns {Promise<QrFound | QrFailed>}
 */
export async function decodeQr(canvas, { budgetMs = QR_BUDGET_MS } = {}) {
  const start = performance.now();
  let attempts = 0;
  /** @type {{ code: string, message: string } | undefined} */
  let seenError;

  /** @param {string | null} text @param {string} method */
  const accept = (text, method) => {
    if (text === null) return null;
    const parsed = parseVerifyUrl(text);
    if (parsed.error) {
      seenError ??= parsed.error;
      return null;
    }
    return { url: parsed.url, shape: parsed.shape, certificateId: parsed.certificateId, method, attempts };
  };
  const outOfTime = () => performance.now() - start > budgetMs;

  // 1 + 2: the page as rendered, both decoders.
  const full = getImageData(canvas);
  attempts++;
  let hit = accept(decodeJsQr(full), 'jsqr:full');
  if (hit) return hit;
  attempts++;
  hit = accept(await decodeZxing(full), 'zxing:full');
  if (hit) return hit;

  // 3: crops, upscaled 2x/3x, greyscale + threshold.
  for (const { name, rect } of QR_REGIONS) {
    for (const scale of SCALES) {
      const crop = cropScaled(canvas, rect, scale);
      const cropData = getImageData(crop);
      for (const filter of FILTERS) {
        if (outOfTime()) {
          return {
            error: seenError ?? {
              code: 'qr_not_found',
              message: 'No QR code could be decoded (search time limit reached)',
            },
            attempts,
          };
        }
        const img = binarise(cropData, filter === 'otsu' ? 'otsu' : Number(filter.split('-')[1]));
        const method = `${name}@${scale}x/${filter}`;
        attempts++;
        hit = accept(decodeJsQr(img), `jsqr:${method}`);
        if (hit) return hit;
        attempts++;
        hit = accept(await decodeZxing(img), `zxing:${method}`);
        if (hit) return hit;
      }
    }
  }
  return { error: seenError ?? { code: 'qr_not_found', message: 'No QR code could be decoded' }, attempts };
}
