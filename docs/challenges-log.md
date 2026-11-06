# Challenges Log

History of everything that broke, surprised us, or forced a decision. Log entries **as they
happen**, not at the end of a phase. `docs/progress.md` is the current state; this file is
how we got there.

**Entry format:**
```
## C-00N — <short title>
**Phase:** N · **Date:** YYYY-MM-DD
**Symptom:** what was observed (exact error or measured numbers)
**Root cause:** what was actually wrong, found by measuring rather than guessing
**Fix:** what changed (file paths)
**Guard:** the test or check that now stops it recurring
```

---

## Carried over from the previous build (not yet re-verified)
- **pdf.js detached ArrayBuffer.** The metadata scan read a buffer pdf.js had already
  transferred to its worker, so every PDF failed in the browser while unit tests passed.
  Guard: copy the bytes, and run a Playwright test on real samples.
- **OCR false-positive tampering.** OCR read a name as "7", and that was flagged as a
  mismatch. Guard: malformed OCR output is `not_confirmed`.
- **Devanagari names rejected.** Vowel signs are combining marks. Guard: Unicode-aware
  normalisation, with a test fixture.
- **Windows line endings corrupted PDF fixtures.** Guard: `.gitattributes` with
  `*.pdf binary`.
- **NPTEL returned 500 on the first request.** It redirects from `nptel.ac.in` to
  `beta.nptel.ac.in`, and a retry with browser headers succeeds.
- **Near-blank PDFs took about 30 s of OCR each.** Guard: OCR crops only, with an 8 s
  budget per certificate.

---

## C-001 — pdf.js does not report the Producer of the 2026 sample
**Phase:** 0 · **Date:** 2026-11-06
**Symptom:** `getMetadata().info` for the Jul–Sep 2026 PDF had no Producer, which matched the
"neither Producer nor CreationDate" known fact. A raw-bytes scan found `/Producer(MuPDF 1.28.2)`.
**Root cause:** the PDF puts `/Info<</Producer(...)>>` inside the **Catalog** object, not in the
trailer where PDF readers look for it, so pdf.js ignores it.
**Fix:** none yet (nothing built). Recorded in NOTES.md; Phase 4's `metadata` check must scan the
raw bytes for Producer/Creator/dates instead of trusting pdf.js.
**Guard:** to add in Phase 4: a unit test over this layout. `tests/fixtures/` does not yet hold a
PDF with Info-in-Catalog (the real one is private); add a synthetic one then.

## C-002 — jsQR fails on the small PNG QR with a plain upscale
**Phase:** 0 · **Date:** 2026-11-06
**Symptom:** the ~54 px QR in `NPTEL.png` was not decoded by jsQR at 1×, 2× or 3× with
nearest-neighbour upscaling (`null` each time), although the known fact says a 2–3× upscale is
enough.
**Root cause:** by measurement, binarising was what mattered. Greyscale + threshold 140 decoded it
at 1×; smoothed upscaling decoded it from 3×; zxing-wasm decoded the untouched image at 1×.
**Fix:** none yet. Recorded in NOTES.md §1.2 for Phase 2 (`qr.js` must include a binarise step and
the zxing fallback, not only an upscale).
**Guard:** Phase 2 Playwright run on the real PNG samples.

## C-003 — pdf.js in Node: JBIG2 images need `wasmUrl`, and it must be a file URL with a trailing slash
**Phase:** 0 · **Date:** 2026-11-06
**Symptom:** `Unable to decode image ... Jbig2Error: JBig2 failed to initialize` and the QR never
decoded; then `Invalid factory url ... must include trailing slash` when a Windows path was passed.
**Root cause:** the 2026 PDF stores its images as JBIG2; pdf.js 6.x loads the decoder from
`pdfjs-dist/wasm/` and needs `wasmUrl`. A plain Windows path is rejected.
**Fix:** `pathToFileURL(dir).href + '/'` in the scratch scripts. In the real app (Phase 2) the
wasm files must be served as static assets and referenced in `getDocument`.
**Guard:** Phase 2 Playwright test on the 2026 PDF; Phase 8 CSP must allow the wasm.

## C-004 — Plan and facts did not match the real samples and URL shapes
**Phase:** 0 · **Date:** 2026-11-06
**Symptom:** (a) the plan says "1 PDF + 1 JPG"; the real set is 1 PDF + 2 PNG (one tampered);
(b) the verification page for the 2025 certificate (URL shape B) contains no name, course or
marks at all, and takes three hops to reach the PDF; (c) the 302 `Location` header contains an
explicit port (`beta.nptel.ac.in:443`); (d) the "Jan–Apr 2025" sample is labelled Jan–Feb 2025.
**Root cause:** the plan was written from memory of the previous build.
**Fix:** documented in NOTES.md; the known-facts table in progress.md marks each as changed.
**Guard:** Phase 3 tests must cover shape B's chain, a `Location` with `:443`, and hostname (not
`host`) allowlisting.

## C-005 — Backslashes lost in a shell heredoc while generating a fixture script
**Phase:** 0 · **Date:** 2026-11-06
**Symptom:** `SyntaxError: Invalid regular expression: missing /` running
`tests/fixtures/generate-synthetic.mjs`.
**Root cause:** a double backslash inside the heredoc was collapsed to a single one by the shell, producing a broken regex.
**Fix:** the line was rewritten with the editor tool, without a backslash-heavy regex.
**Guard:** none needed beyond running the script; it now exits cleanly and both PDFs load in pdf.js.
