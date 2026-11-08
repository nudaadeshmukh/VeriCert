// Small canvas helpers shared by the extraction modules. Browser only.

/**
 * @param {number} width
 * @param {number} height
 * @returns {HTMLCanvasElement}
 */
export function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** @param {HTMLCanvasElement} canvas */
export function getImageData(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * A rectangle as fractions of the source (0–1), so the same definition works for a 1054 px
 * screenshot and a 2552 px page render.
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 */

/**
 * Crop a fractional rectangle and scale it. The scale is lowered if the result would exceed
 * `maxSide` pixels, so a huge page render is never blown up further.
 * @param {HTMLCanvasElement} src
 * @param {Rect} rect
 * @param {number} scale
 * @param {{ maxSide?: number }} [opts]
 * @returns {HTMLCanvasElement}
 */
export function cropScaled(src, rect, scale, { maxSide = 3000 } = {}) {
  const sx = Math.max(0, Math.floor(rect.x * src.width));
  const sy = Math.max(0, Math.floor(rect.y * src.height));
  const sw = Math.min(src.width - sx, Math.ceil(rect.w * src.width));
  const sh = Math.min(src.height - sy, Math.ceil(rect.h * src.height));
  const s = Math.max(0.1, Math.min(scale, maxSide / Math.max(sw, sh)));
  const out = createCanvas(sw * s, sh * s);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out;
}

/**
 * Greyscale luminance (Rec. 601) per pixel.
 * @param {ImageData} img
 * @returns {Uint8ClampedArray}
 */
export function toGrey(img) {
  const { data, width, height } = img;
  const grey = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    grey[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return grey;
}

/**
 * Otsu's threshold for a greyscale image.
 * @param {Uint8ClampedArray} grey
 * @returns {number}
 */
export function otsuThreshold(grey) {
  const hist = new Array(256).fill(0);
  for (const v of grey) hist[v]++;
  const total = grey.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * Black/white RGBA image: pixels brighter than `threshold` become white, others black.
 * @param {ImageData} img
 * @param {number | 'otsu'} threshold
 * @returns {ImageData}
 */
export function binarise(img, threshold) {
  const grey = toGrey(img);
  const t = threshold === 'otsu' ? otsuThreshold(grey) : threshold;
  const out = new Uint8ClampedArray(img.data.length);
  for (let p = 0, i = 0; p < grey.length; p++, i += 4) {
    const v = grey[p] > t ? 255 : 0;
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  return new ImageData(out, img.width, img.height);
}

/**
 * Prepare a crop for OCR: greyscale, and inverted when the crop is mostly dark (NPTEL's bottom
 * bar is white text on dark red; tesseract reads dark-on-light far better). No binarising:
 * tesseract does its own, which keeps anti-aliased small text legible.
 * @param {HTMLCanvasElement} canvas
 * @returns {HTMLCanvasElement}
 */
export function toOcrCanvas(canvas) {
  const img = getImageData(canvas);
  const grey = toGrey(img);
  let sum = 0;
  for (const v of grey) sum += v;
  const invert = sum / grey.length < 128;
  const out = new Uint8ClampedArray(img.data.length);
  for (let p = 0, i = 0; p < grey.length; p++, i += 4) {
    const v = invert ? 255 - grey[p] : grey[p];
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  const result = createCanvas(img.width, img.height);
  result.getContext('2d').putImageData(new ImageData(out, img.width, img.height), 0, 0);
  return result;
}

/**
 * Crop an exact pixel rectangle, scale it, optionally threshold it (greyscale > threshold →
 * white, else black). Used for single table cells.
 * @param {HTMLCanvasElement} src
 * @param {{ x: number, y: number, w: number, h: number }} rect pixels
 * @param {number} scale
 * @param {number | null} threshold
 * @returns {HTMLCanvasElement}
 */
export function cropPixels(src, rect, scale, threshold) {
  const out = createCanvas(rect.w * scale, rect.h * scale);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, out.width, out.height);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const grey = toGrey(img);
  for (let p = 0, i = 0; p < grey.length; p++, i += 4) {
    const v = threshold === null ? grey[p] : grey[p] > threshold ? 255 : 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/**
 * Find the vertical borders of the marks table ("Online Assignments | n/25 | Proctored Exam |
 * n/75": five vertical lines of equal height) from the pixels alone.
 *
 * A column counts as a border if it holds a dark run at least 4 % of the image height; runs
 * that start and end at the same place (±4 px) form the table. Exactly five such lines are
 * required, anything else returns null: the caller then reports "not confirmed" instead of
 * guessing where the cells are.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {{ xs: number[], top: number, bottom: number } | null}
 */
export function findTableBorders(canvas) {
  const W = canvas.width;
  const H = canvas.height;
  const bx = Math.floor(0.15 * W);
  const by = Math.floor(0.4 * H);
  const bw = Math.floor(0.7 * W);
  const bh = Math.floor(0.32 * H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const grey = toGrey(ctx.getImageData(bx, by, bw, bh));
  const minRun = Math.max(8, Math.floor(0.04 * H));
  const DARK = 170;

  /** Longest dark run in a column: [start, end) in band coordinates. */
  const longestRun = (x) => {
    let best = [0, 0];
    let start = -1;
    for (let y = 0; y <= bh; y++) {
      const dark = y < bh && grey[y * bw + x] < DARK;
      if (dark && start < 0) start = y;
      if (!dark && start >= 0) {
        if (y - start > best[1] - best[0]) best = [start, y];
        start = -1;
      }
    }
    return best;
  };

  /** @type {{ x0: number, x1: number, top: number, bottom: number }[]} */
  const clusters = [];
  for (let x = 0; x < bw; x++) {
    const [s, e] = longestRun(x);
    if (e - s < minRun) continue;
    const last = clusters.at(-1);
    if (last && x - last.x1 <= 2) last.x1 = x;
    else clusters.push({ x0: x, x1: x, top: s, bottom: e });
  }
  // Group clusters whose vertical extent matches; take the biggest group.
  let bestGroup = [];
  for (const c of clusters) {
    const group = clusters.filter((d) => Math.abs(d.top - c.top) <= 4 && Math.abs(d.bottom - c.bottom) <= 4);
    if (group.length > bestGroup.length) bestGroup = group;
  }
  if (bestGroup.length !== 5) return null;
  return {
    xs: bestGroup.map((c) => bx + Math.round((c.x0 + c.x1) / 2)),
    top: by + bestGroup[0].top,
    bottom: by + bestGroup[0].bottom,
  };
}
