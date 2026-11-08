// Absolute URLs of the self-hosted assets in `public/vendor/` (see scripts/copy-vendor.mjs).
// Absolute, because tesseract.js starts its worker from a blob: URL, where a relative path
// cannot be resolved.
/** @param {string} path e.g. `tesseract/worker.min.js` */
export function vendorUrl(path) {
  return new URL(`/vendor/${path}`, globalThis.location.origin).href;
}
