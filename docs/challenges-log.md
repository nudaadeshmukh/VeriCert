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

## C-006 — Custom spacing tokens broke Tailwind size keywords (`max-w-xl` collapsed to a sliver)
**Phase:** 1 · **Date:** 2026-11-06
**Symptom:** The placeholder page's lead paragraph rendered one word per line, about 50 px wide.
Unit tests, lint, build and all three first Playwright tests passed; a screenshot showed it.
**Root cause:** `app/globals.css` defined DESIGN.md's spacing names as `--spacing-xs … --spacing-xl`
in Tailwind v4's `@theme`. Those names are also the size keywords used by `max-w-xl`, `w-md` etc.,
so the 32 px spacing value was used as a max-width.
**Fix:** removed the custom spacing tokens. DESIGN.md's scale (4, 8, 12, 16, 24, 32, 48, 64, 96 px)
equals Tailwind's default numeric scale (1, 2, 3, 4, 6, 8, 12, 16, 24), so the mapping is documented in
`app/globals.css` and pages use `p-4`, `mt-16` etc.
**Guard:** `e2e/smoke.spec.js` "lead paragraph is not squeezed" checks the paragraph's rendered
width (> 400 px) and height (< 120 px) in a real browser. Visual review before approving any UI
phase is also required: assertions on colours alone did not catch this.

## C-007 — Next.js 16 wrote an unrequested `AGENTS.md` into the repo
**Phase:** 1 · **Date:** 2026-11-06
**Symptom:** the first `next dev` printed "Generated AGENTS.md for AI agents" and created
`AGENTS.md` telling agents to read `node_modules/next/dist/docs/` first.
**Root cause:** a default feature (`agentRules`) of this Next version.
**Fix:** deleted the file and set `agentRules: false` in `next.config.js`. `CLAUDE.md` stays the single
source of project instructions.
**Guard:** `next.config.js` comment; `git status` is checked before each commit.

## C-008 — A long `npm install` was cut off by the tool timeout and left `package.json` without devDependencies
**Phase:** 1 · **Date:** 2026-11-06
**Symptom:** after a two-command install exceeded 120 s, `package.json` listed only the four
runtime dependencies; `node_modules` was partly populated.
**Root cause:** the shell call was moved to the background mid-install.
**Fix:** re-ran the devDependencies install on its own in the background (exit 0); verified every
version in `package.json` is exact (no `^` or `~`).
**Guard:** none needed; `npm ci` in CI fails if the lockfile and `package.json` disagree.

## C-009 — pdf.js 6: `doc.destroy()` does not exist, and a throwing `finally` discarded a good result
**Phase:** 2 · **Date:** 2026-11-06
**Symptom:** the first browser run of `extractCertificate` on the genuine 2026 PDF returned only
`pdf_unreadable` ("TypeError: doc.destroy is not a function") although the PDF had loaded and
parsed fine. Node unit tests of `parse.js` could not see it.
**Root cause:** in pdf.js 6.x the loading task owns `destroy()`; `PDFDocumentProxy` has no such method.
The call sat in a `finally`, and an exception thrown from `finally` replaces the `return`.
**Fix:** `src/lib/extract/pdf.js` now calls `task.destroy()`.
**Guard:** `e2e/extract.spec.js` runs the real PDF in Chromium (this is the "real browser" rule
doing its job again).

## C-010 — OCR of the whole marks row drops the "." and "/" ("22.5/25" read as "22525")
**Phase:** 2 · **Date:** 2026-11-06
**Symptom:** with the planned digits-and-slash whitelist on a crop of the marks row,
`NPTEL.png` gave `04 / 0 / 4745` (the big "84" and "4745", but not the cells), and a
tighter row crop gave `22525` / `225125` for the first cell, at 2x and 3x, PSM 6/7/11.
**Root cause:** by measurement (a grid of crop, scale, PSM and whitelist, run in Node with the
same tesseract.js and language data): the cell text is small and sits against vertical borders;
only the "61.88/75" cell survived whole-row crops. Reading each cell on its own with PSM 7
returned `22.5/25`, `61.88/75`, `20/25`, `70/75` exactly (3-4x upscale, threshold 140 or none).
**Fix:** `src/lib/extract/image.js` `findTableBorders()` locates the table's five vertical
borders from the pixels (equal-height dark runs); `ocr.js` `readMarksTable()` reads the two value
cells separately. If the table cannot be found the marks are "not confirmed".
**Guard:** e2e tests on `NPTEL.png` and `NPTEL_tampered.png` (exact values); a mark is accepted
only when two different scale/threshold passes agree (tesseract's own confidence was 0–30 on the
correct reads of the edited cells, so it cannot be the gate).

## C-011 — Roll number OCR: the letter S read as the digit 5 at 3x and 4x
**Phase:** 2 · **Date:** 2026-11-06
**Symptom:** A roll number of the form `NPTEL25MG18S<9 digits>` was read as `NPTEL25MG185<9 digits>` (the real
value is only in the gitignored sample).
**Root cause:** measured: exact at 2x, wrong at 3x and 4x, on the same crop. S/5 is a known OCR
confusion and cannot be corrected without guessing (the plan's S→5 slip tolerance is for marks).
**Fix:** the roll is optional; it is read at 2x from two different crops and accepted only if
both give the same string that also matches the strict roll pattern.
**Guard:** e2e on the PNG samples. Result: read for `NPTEL.png` and its tampered copy, not for
the two PDF renders turned into PNGs (no error is raised; see progress.md known issues).

## C-012 — A no-QR page ran the full QR search: 38 of 50 attempts in the 6 s budget
**Phase:** 2 · **Date:** 2026-11-06
**Symptom:** the synthetic PDFs (no QR code) took about 6.3 s to report `qr_not_found`; the
full search would take about 8 s.
**Root cause:** the search is 2 full-page decodes plus 4 regions x 2 scales x 3 filters x 2
decoders, about 160 ms each. Successful decodes took 0.1–0.35 s.
**Fix:** dropped the grey-110 filter (no measured sample needed it) and capped the search at 4 s
(`QR_BUDGET_MS` in `src/lib/extract/qr.js`).
**Guard:** e2e asserts the specific `qr_not_found` code; measured duration is in progress.md.

## C-013 — My own test harness hung on a corrupt PDF (not the engine)
**Phase:** 2 · **Date:** 2026-11-06
**Symptom:** the corrupt-PDF e2e test timed out waiting for "done". It looked like pdf.js hanging.
**Root cause:** `extractCertificate` had returned `pdf_unreadable` correctly; the scratch page's
extra `pdfChecks()` then called `readPdf` on the same corrupt file, threw, and left the status on
"running". Found by checking where the status stopped, not by assuming the library.
**Fix:** `app/dev/extract/ExtractScratch.js` catches errors from `pdfChecks`. The new PDF
load/render timeouts in `pdf.js` were added while chasing this; no sample has actually reproduced
a pdf.js hang, so those timeouts are unproven guards.
**Guard:** the corrupt-PDF e2e test (now 1.5 s).

## C-014 — Two unexplained timing events (not reproduced); stray tesseract cache file
**Phase:** 2 · **Date:** 2026-11-06
**Symptom:** (a) a measurement script waited 120 s for a page to finish and failed; on rerun, the
same samples all completed (6 files in one page took about 6 s each time). (b) In the first run
after changing the marks logic, one of 19 image extractions (`t-q85.jpg`) returned `ocr_timeout`
after the 8 s budget; 3 solo reruns (about 1.7 s each) and a full 6-image rerun were all fine.
(c) The first full Playwright run on a cold `next dev` failed 2 of 15 tests (30 s timeouts on the
first hit of a route); the next run passed 15/15 in 38.8 s.
**Root cause:** not found. All three happened right after file edits or a cold dev-server start;
the project folder is inside OneDrive, which may slow `.next`/`node_modules` I/O. Unverified.
**Fix:** Playwright's per-test timeout raised to 60 s (`playwright.config.js`). The OCR budget is
wall-clock by design, so a stalled machine fails closed with "not confirmed (timeout)" instead of
returning anything wrong.
**Guard:** none for the cause. Watch for `ocr_timeout` in Phase 7's batch runs and in the Phase 10 pilot.
**Also:** running tesseract.js in Node from the repo root wrote `eng.traineddata` there; deleted it
and added `*.traineddata` to `.gitignore`.

## C-015 — Investigating Phase 2's OCR timeouts and the 4 s no-QR search (Phase 3 side task)
**Phase:** 3 · **Date:** 2026-11-08
**Symptom:** C-014: one unexplained `ocr_timeout` in 19 runs, plus harness timeouts on a cold dev server.
**What was measured:** (1) 60 consecutive extractions in one page (5 images, repeated): 60 of 60 ok, OCR
median 1,637 ms, max 2,753 ms, 0 timeouts. Two more 30-image runs, one of them touching a source file
mid-run (Fast Refresh): 30 of 30 each, no timeout, no reload. About 120 runs since the original timeout,
none timed out. (2) While stress-testing I found my own dev-server log redirected into `tmp/` (inside the
watched project folder) had set off a runaway loop: each "Compiled" line was a file change that triggered
another compile, 17,388 log lines, and the browser page reloaded about 8,700 times, so 0 of 60 completed.
Writing the log outside the project removed it. **I could not make the loop start again on demand** (a
rerun with the log back inside `tmp/` stayed quiet), so I cannot prove it caused C-014's incidents. It
would explain the harness timeouts (page reloads) and is a plausible CPU-starvation cause for the single
`ocr_timeout`, but that is a hypothesis.
**Root cause:** not established. **Fix:** none to the engine. Instrumentation only: an `ocr_timeout` error now
carries `stage` (`worker`, `identity`, `marks`, `roll`) so the next occurrence says where it stalled.
**Guard:** do not redirect dev-server output into the project folder (use a path outside it). Watch for
`ocr_timeout` in Phase 7 and the Phase 10 pilot.

**The 4 s no-QR search, profiled** (new off-by-default `trace` option of `decodeQr`, shown via `debug`):
a page with no QR, one run, 38 timed steps, 4,684 ms (stopped by the 4 s budget): jsQR 11 calls, 2,609 ms
(median 196, max 467 ms); zxing-wasm 11 calls, 540 ms (median 33); crop + scale 6 calls, 860 ms; threshold
10 calls, 671 ms. A first trace agreed (jsQR 2,726 ms of 4,477 ms). So **jsQR on the upscaled crops is about
55 to 60 % of the cost**, and crop preparation about 30 %.
Tried: single-polarity jsQR (`dontInvert`) on the binarised crops, since zxing already tries inverted
images. Result: individual jsQR calls got about 25 % cheaper (636 to 467 ms at worst), but the failing
search still took 4.1 to 4.7 s (3 runs) because jsQR's cost is mostly its pixel-proportional search, not
the inversion. **Reverted**: no measurable gain. Dropping jsQR on crops would lose measured successes
(jsQR on the bottom strip found 2 of my 8 test images where zxing did not), and shrinking the search or
the 4 s budget has no data behind it. **Left as a Known Issue** with this profile.
