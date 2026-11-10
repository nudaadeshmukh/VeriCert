# NOTES — Phase 0 findings

Observed on **2026-11-06** with Node v24.18.1 (pdfjs-dist 6.5.438, jsqr 1.4.0, zxing-wasm 3.1.6,
pngjs 7.0.0, @napi-rs/canvas; scratch scripts only, in the gitignored `tmp/phase0/`).
Everything below was observed, not assumed, unless it sits under "Unconfirmed".

The real samples contain a real person's name, roll number and certificate IDs, and live only in
the gitignored `samples/`. This file and `tests/fixtures/` use invented, shape-preserving
replacements (see `tests/fixtures/README.md`). Marks, course names and session labels are kept as
observed.

## 1. Samples

| File | Kind | What it is |
|---|---|---|
| `NPTEL Entrepreneurship and IP Strategies.pdf` | PDF, 1 page, 932,481 B | Genuine, Jul–Sep 2026, 8-week course, 91%. |
| `NPTEL.png` | PNG 1054×759 | Genuine screenshot of the Jan–Feb 2025 certificate "Design Thinking - A Primer" (4-week, 84%). No text layer. |
| `NPTEL_tampered.png` | PNG 1054×759 | Same screenshot with the marks edited. No text layer. |

**There is no JPG sample.** The plan assumed 1 PDF + 1 JPG; the real set is 1 PDF + 2 PNG. A JPG
path is therefore untested on real data.

### 1.1 PDF (Jul–Sep 2026)
- Page 842×595 pt, 16 text-layer items (10 non-empty), 8 image paint operations (JBIG2). pdf.js
  needs `wasmUrl` to render it (JBIG2 decoder); without it the images silently fail to decode.
- Text-layer order and positions (x,y in pt): name `311,398`; course `264,331`; total `91%`
  `487,295`; `25/25` `371,262`; `66/75` `569,262`; candidates certified `1910` `550,229`; session
  `JUL-SEP 2026`; `(8 week course)`; `No. of credits recommended: 3`; `Roll No: NPTEL26HS164S…`
  as **one** item `41,19`.
- **No labels** ("Online Assignments", "Proctored Exam") in the text layer. Marks parse from the
  `n/25` and `n/75` patterns.
- Name and course are **UPPERCASE** in the PDF; the verification page writes the course in title
  case ("Entrepreneurship and IP Strategy"). Name/course comparison must be case-insensitive.
- Structure: header `%PDF-1.7`, one classic `xref` table, one `startxref`, one `%%EOF`, no XRef
  streams, no XMP.
- Metadata: pdf.js `getMetadata()` reports **no Producer and no CreationDate**. The raw bytes
  contain `% Written by MuPDF 1.28.2` and `/Info<</Producer(MuPDF 1.28.2)>>` referenced from the
  **Catalog**, not the trailer (non-standard). So the Producer exists but pdf.js cannot see it.
  No Creator, CreationDate or ModDate. The trailer has `/ID` and no `/Info`.
- This file is **byte-identical** (same SHA-256) to what NPTEL serves at
  `/verify/<ID>/certificate.pdf`.
- QR: not a link annotation (no `/URI`); an embedded image. Decoded by jsQR from a render at **2×
  and 3×, not at 1×** (842 px wide): `https://nptel.ac.in/verify/<ID>` where `<ID>` is
  `NOC-xxxx-xxxx-xxxxx`.

### 1.2 PNG genuine (Jan–Feb 2025)
- Printed: name, course "Design Thinking - A Primer", consolidated score 84 %, "Online
  Assignments" `22.5/25`, "Proctored Exam" `61.88/75` (**decimal marks confirmed**), total
  certified 4745, "Jan-Feb 2025", "(4 week course)", Roll No `NPTEL25MG18S<9 digits>`.
- QR is about 54 px square (roughly 1.5 px per module) in the bottom bar, white quiet zone about
  2 px. Decoded value: `https://nptel.ac.in/noc/E_Certificate/<ID>` with `<ID>` = roll number +
  8 more digits (`NPTEL25MG18S` + 9 digits + 8 digits).
- QR decode results (jsQR 1.4.0 / zxing-wasm 3.1.6, `inversionAttempts: attemptBoth`,
  `tryHarder`):
  - jsQR on raw pixels: **fails at 1×, 2×, 3× with nearest-neighbour upscaling**.
  - jsQR succeeds after greyscale + binarise (threshold 140) **at 1×**, and with smoothed upscale
    from 3×.
  - zxing-wasm succeeds on the **unprocessed** full image at 1×, but fails on some binarised
    variants.
  - So a plain "upscale 2–3×" is not enough for jsQR on this image. The plan's order (jsQR, then
    zxing, then threshold/upscale crops) works, and zxing alone would have been enough here.

### 1.3 PNG tampered
- Same QR, decodes to the **same** E_Certificate URL as the genuine one.
- Printed values: assignment `20/25`, exam `70/75` (genuine: `22.5/25`, `61.88/75`). In the edited
  cells the slash/spacing is visibly different (`20 /25`, `70 /75`).
- Pixel diff against the genuine PNG (exact RGB compare): **1,056 of 799,986 pixels differ
  (0.13 %), all inside x 449–763, y 389–419**, i.e. only the marks row.
- Only this PNG carries an `iTXt` XMP chunk, containing just `tiff:Orientation=1` (typical of an
  image editor re-save). Genuine PNG has none. **Two samples are not enough to justify using this
  as a signal (rule 7).** It is not used.
- Phase 0 conclusion: for a screenshot with no text layer and no metadata, the only reliable
  signal is comparison with NPTEL's source (`marks_match`), plus OCR-vs-source. Expected
  Verification result is `Unsuccessful` (20≠22.5, 70≠61.88).

## 2. Verification side

All hosts involved: `nptel.ac.in`, `beta.nptel.ac.in`, `archive.nptel.ac.in`. All inside the
`nptel.ac.in` / `*.nptel.ac.in` allowlist. **The 302 `Location` header contains an explicit port**
(`https://beta.nptel.ac.in:443/…`); the allowlist check must use `URL.hostname` (not `host`) and
accept port 443 only.

### 2.1 Shape A: `https://nptel.ac.in/verify/<ID>` (2026 PDF)
```
GET nptel.ac.in/verify/<ID>                  302 -> https://beta.nptel.ac.in:443/verify/<ID>
GET beta.nptel.ac.in/verify/<ID>             200 text/html, 1,261 B
GET  .../verify/<ID>/certificate.pdf         302 -> beta..., 200 application/pdf, 932,481 B
GET  .../verify/<ID>/preview.png             302 -> beta..., 200 image/png 1920x1358, 614,677 B
```
- The HTML page shows an image only. The data is in a **visually hidden** `div.sr` block:
  `<h1>` = candidate name; `<p>` = `Course · SESSION · Institute`; a `<dl>` with `Certificate`
  (ID), `Course code` (`noc26-hs164`), `Cycle`, `Final score` (`91 / 100`), `Badge`, `Weeks /
  credits`, `Issued`, `Status` (`LIVE`). The `<a>` links to `<ID>/certificate.pdf`.
- **Assignment and exam marks are not in the HTML**, only in the PDF (`25/25`, `66/75`; 25+66 =
  91, matches the total). Confirmed.
- Because the data sits in a visually hidden block, this parser is the part most likely to break if
  NPTEL redesigns the page. Parse defensively and treat anything missing as `Error`.

### 2.2 Shape B: `https://nptel.ac.in/noc/E_Certificate/<ID>` (2025 PNG)
```
GET nptel.ac.in/noc/E_Certificate/<ID>       200 text/html, 530 B, an <iframe> to archive.nptel.ac.in
GET archive.nptel.ac.in/noc/E_Certificate/<ID>
                                             302 -> /noc/Ecertificate/?q=<ID>   (no 'beta', no port)
GET archive.nptel.ac.in/noc/Ecertificate/?q=<ID>
                                             200 text/html, 386 B, one link to a relative PDF path
GET archive.nptel.ac.in/content/noc/NOC25/SEM1/Ecertificates/110/noc25-mg18/Course/<ID>.pdf
                                             200 application/pdf, 1,561,898 B
```
- **None of the HTML pages in this chain contains the name, course or any marks.** Everything
  comes from the PDF. The PDF link is *relative* (`../../content/...`) and must be resolved
  against the final URL of the landing page; the path embeds the session (`NOC25/SEM1`), a number
  (`110`) and the course code (`noc25-mg18`), so it cannot be guessed from the ID alone.
- Shape B is a three-step chain (wrapper iframe, landing page, PDF), unlike shape A.
- Source PDF: `%PDF-1.4`, 1 page, **2552.25×1828.5 pt**, one `%%EOF`, one xref table, text layer
  with 10 items. Metadata: **Producer `FPDF 1.81`, CreationDate `D:20250331193315`**, no
  ModDate, no Creator. Text-layer values equal the printed screenshot (`22.5/25`, `61.88/75`).
- Text layer differs from the 2026 PDF: `Roll No:` and the roll number are **separate** items,
  and the total is `84` with no `%`.
- QR inside the 2025 PDF decodes at 1× to the same E_Certificate URL.

### 2.3 Reliability and timing (measured, from this machine)
- 10 sequential GETs of each verification-page URL, 1.5 s apart, browser headers:
  **0 of 20 needed a retry** (shape A final status always `302>200`, shape B always `200`).
  Page latency, min/median/max: shape A **101 / 135 / 238 ms**; shape B **56 / 77 / 102 ms**.
- PDF downloads: shape A 926 ms (after the 302), shape B 1,450 ms. One sample each, no
  statistics.
- A request with Node's default headers (no browser `User-Agent`) also got `302` (shape A) and
  `200` (shape B) on the first hop. Only the first hop was tried, so this does not show that
  default headers suffice for the PDF. Browser headers are still sent.
- **Gate result: NPTEL can be fetched from a script. Gate passed.** This only proves this
  machine's network. Whether Vercel's IP ranges are accepted is the Phase 3 gate.

## 3. Facts from CLAUDE.md, status
See the table in `docs/progress.md` (Phase 0 entry). Of the 10 bullets: 5 confirmed, 3 changed
(wholly or in part: the 2026 metadata, the verification page for URL shape B, and the QR-decoding
detail), 2 split into a confirmed and an unconfirmed half. Four statements stay unconfirmed
because they need a browser or OCR (Phase 2) or could not be reproduced.

## 4. Implications for later phases
- **Phase 2 (extract):** read page 1 of PDFs at ≥2× before QR decoding. Pass `wasmUrl` for pdf.js
  or JBIG2 images (QR codes) fail to render in some PDFs. Images: greyscale+threshold or zxing;
  budget to try both.
- **Phase 3 (verify):** implement both URL shapes, follow redirects manually with `URL.hostname`
  allowlisting, resolve the relative PDF link, and handle shape A's hidden `div.sr` block. The
  source PDF text layer has no labels; the same `n/25` / `n/75` parsing applies.
- **Phase 4 (tamper):** do **not** rely on pdf.js `getMetadata()` for Producer: read the raw bytes
  (the 2026 Producer lives in a Catalog-referenced `/Info`). Genuine values so far: FPDF 1.81 +
  CreationDate (2025), MuPDF 1.28.2 and no dates (2026). Neither MuPDF nor FPDF may be on the
  denylist. `id_match` is possible for shape B (ID starts with the printed roll number) and is
  `not_applicable` for shape A (`NOC-xxxx-…` vs roll number, no relationship observed).
  Two genuine samples are not enough to fix any threshold; the plan already lists collecting
  5–10 more.
- **Names:** `\p{L}`-only validation rejects Devanagari; allow `\p{M}`, and compare after NFC.

## 5. Unconfirmed (could not be checked in Phase 0)
- Whether NPTEL ever returns HTTP 500 on the first request (not reproduced in 20+ requests; not
  disproved either).
- pdf.js ArrayBuffer detachment (browser worker only; Node does not reproduce it). Phase 2's
  Playwright run tests it.
- OCR misreading names, and the ~30 s full-page OCR time. No OCR was run in Phase 0.
- Behaviour for other sessions and course codes, JPG input, certificates without a QR, expired or
  revoked certificates (`Status` values other than `LIVE`), and Gold/Silver/Elite+Gold layouts.
- Whether `archive.nptel.ac.in` accepts requests from Vercel IPs.

## 6. Phase 4 baseline: what the genuine samples look like (recorded BEFORE any threshold was set)

Observed 2026-11-08 by running `src/lib/tamper/metadata.js` (raw-byte reader) over every genuine PDF, and the
render-versus-text-layer OCR over the same files in Chromium. Genuine samples available:

| # | Sample | What it is |
|---|---|---|
| G1 | `samples/NPTEL Entrepreneurship and IP Strategies.pdf` | Jul–Sep 2026, NPTEL-served (byte-identical, §1.1) |
| G2 | `samples/derived/genuine-2025-nptel-served.pdf` | Jan–Feb 2025, the PDF NPTEL serves for the 2025 certificate. Fetched in Phase 0 and copied into `samples/` for this phase. It is the source of `NPTEL.png` |
| G3 | `samples/NPTEL.png` | screenshot of G2; no PDF structure, so no metadata to read |

`NPTEL_tampered.png` is the known-tampered sample, not a genuine one. There is **one genuine sample per layout**:
two PDFs from two sessions, and one screenshot.

### 6.1 PDF metadata of the genuine files (raw bytes)
| Field | G1 (2026) | G2 (2025) |
|---|---|---|
| Header, size | `%PDF-1.7`, 932,481 B | `%PDF-1.4`, 1,561,898 B |
| Producer | `MuPDF 1.28.2` (in a Catalog-level `/Info`; pdf.js reports none) | `FPDF 1.81` |
| Creator | none | none |
| CreationDate | none | `D:20250331193315` (2025-03-31 19:33:15) |
| ModDate | none | none |
| `%%EOF`, `startxref`, `xref` tables, XRef streams | 1, 1, 1, 0 | 1, 1, 1, 0 |
| `/Prev` (incremental update) | 0 | 0 |
| Linearized, encrypted, XMP | no, no, none | no, no, none |
| Producer history (`/Producer` occurrences) | 1 | 1 |

Observations that matter for the checks:
- The two genuine sessions use **different generators** (FPDF 1.81, then MuPDF 1.28.2): NPTEL changes its PDF tooling
  between sessions, so an allowlist of Producers would false-flag the next change. Only a denylist (flag known editors,
  note unknown ones) is workable.
- **Neither genuine file has a ModDate**, and G1 has no dates at all. There is no genuine "gap between CreationDate and
  ModDate" to calibrate against.
- Neither has a Creator, an incremental update, or more than one `%%EOF`.
- For the **synthetic** tampered file (`tests/fixtures/pdf/synthetic-tampered-metadata.pdf`) the same reader sees two
  Producers (`FPDF 1.81`, then `Adobe Acrobat Pro DC 23.1`), 2 `%%EOF`, 1 `/Prev` and a ModDate 172 days after
  CreationDate. It is invented by us, so it proves the reader can see these signals, not that real tampering looks like this.

### 6.2 The rendered page versus the text layer (genuine PDFs, Chromium, OCR of the same crops as Phase 2)
| | G1 text layer | G1 render OCR | G2 text layer | G2 render OCR |
|---|---|---|---|---|
| Name | identical | identical, confidence 93 | identical | identical, confidence 92–93 |
| Course | identical | identical, confidence 96 | identical | identical, confidence 94 |
| Assignment, exam | 25, 66 | 25, 66 | 22.5, 61.88 | 22.5, 61.88 |
Edit distance between OCR text and text layer: **0 on every field of both genuine PDFs.** No genuine sample has ever
shown an OCR difference.

### 6.3 What these samples can and cannot justify (rule 7)
- Justified (confirmed against genuine): a genuine file shows 1 `%%EOF`, no `/Prev`, no ModDate, and render OCR equal to the
  text layer. So an incremental update, or a render that differs clearly from the text layer, has not been seen in a genuine file.
- **Not** justified by any genuine sample, so set conservatively and flagged in `config.js` and `docs/progress.md`:
  the ModDate gap threshold; every entry of the editor denylist (only *absence* from genuine files is known); the OCR
  confidence and edit-distance bounds for names (no genuine difference exists to measure); the linearized-file baseline
  (no genuine linearized file); the ID rule for `/noc/E_Certificate/` (one genuine sample).
- `NPTEL_tampered.png` carries an XMP `tiff:Orientation` chunk the genuine PNG lacks (§1.3). Still **not** used: two PNGs
  are not enough, and any re-save by an image editor adds it.

### 6.4 OCR'd names and courses on genuine samples (measured 2026-11-10, before the OCR text thresholds were set)
6 reads each of 9 files, all derived from the two genuine certificates, with the identity crop read twice at different scales
(the agreement rule). Edit distance is to NPTEL's text after normalisation (NFC, case, punctuation).
| Genuine source | Reads | Name and course exact | Two reads agreed (name / course) | Lowest confidence (name / course) | Largest edit distance |
|---|---|---|---|---|---|
| G3 screenshot | 6 | 6 / 6 | 6 / 6 | 92 / 94 | 0 / 0 |
| tampered screenshot, name untouched | 6 | 6 / 6 | 6 / 6 | 92 / 94 | 0 / 0 |
| G3 as JPEG, quality 95, 85, 75 (3 files) | 18 | 18 / 18 | 18 / 18 | 92 / 94 | 0 / 0 |
| 2025 PDF rendered to a 1054 px image | 6 | 6 / 6 | 6 / 6 | 93 / 94 | 0 / 0 |
| 2026 PDF rendered to a 1054 px image | 6 | 6 / 6 | 6 / 6 | 92 / 95 | 0 / 0 |
| G1 PDF page render (evidence OCR) | 6 | 6 / 6 | 6 / 6 | 92 / 96 | 0 / 0 |
| G2 PDF page render (evidence OCR) | 6 | 6 / 6 | 6 / 6 | 92 / 94 | 0 / 0 |
**54 of 54 reads exact, 54 of 54 agreed, confidence never below 92 (names) or 94 (courses).** Honest limits: this is one name and two
course titles, and repeating identical bytes is not independent sampling (OCR is deterministic). The thresholds in `config.js`
(`OCR_TEXT_MIN_CONFIDENCE` 85, `OCR_TEXT_MIN_EDIT_DISTANCE` 3, `OCR_TEXT_MIN_DIFFERENCE_RATIO` 0.15) sit below every genuine read's
confidence and above every OCR error seen anywhere in the project (all single characters), but have never been tested against a genuine
difference, because none exists.
