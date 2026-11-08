# Project Progress Log

**Purpose:** this file is the running state of the project across working sessions. Read it
first at the start of any new session, before anything else, to know exactly what already
exists. Update it last, at the end of every phase, after the phase's code actually works.

**Rules for updating this file:**
- Append a new entry per phase. Never edit or delete a previous phase's entry, even if
  something built in that phase is changed later. Add a note in the *current* phase's
  entry instead ("Phase 3's `/api/verify` timeout was raised here because...").
- Be concrete: file paths, not vague descriptions. Write "Added `decodeQr()` in
  `src/lib/extract/qr.js` with a 3x-upscale fallback", not "improved QR".
- "Known issues / TODOs" is not optional, even if a phase felt complete. Note anything
  deferred, simplified or assumed, however small. This is what stops small gaps from
  silently compounding across phases.
- Record measured numbers when a phase produces them: timings, counts, accuracy on
  samples. Never record a number you didn't actually measure.
- Record pinned dependency versions when they're added or changed.
- Errors and challenges go in `docs/challenges-log.md` (entries `C-001`, `C-002`, …),
  logged as they happen, not here. This file is state; that file is history.

---

## Current state

| | |
|---|---|
| **Current phase** | Phase 2 complete, awaiting user review. |
| **Next phase** | Phase 3: Verification service and comparison (not started; waits for approval) |
| **Production URL** | https://veri-cert-bay.vercel.app (`/api/health` → `{"ok":true,"db":"up"}`). Still running Phase 1 code (`0.1.0+107e806`); Phase 2 is not deployed |
| **Preview URL** | None. No Preview deployment exists (see Phase 1 deviation). |
| **Does it run?** | Locally: yes. `extractCertificate(file)` reads PDF, PNG and JPG in Chromium (dev scratch page `/dev/extract`). On Vercel: only the Phase 1 shell. No sign-in, upload page or verification yet. |
| **Latest measured results** | Extraction in Chromium (dev server, this machine), median: 2026 PDF 624 ms warm / 741 ms cold; `NPTEL.png` 1,101 / 1,858 ms; tampered PNG 1,022 / 1,763 ms. All 3 real samples extract to the NOTES.md values. Not measured from Vercel or on a slower device. NPTEL page fetch (Phase 0): 0 of 20 retries, median 135 / 77 ms. |

| Phase | Status |
|---|---|
| 0 — Specification check and samples | ✅ complete (gate passed from a local script) |
| 1 — Project foundation | ✅ complete (verified on Production, not Preview) |
| 2 — Certificate extraction engine | ✅ complete (verified in local Chromium; not deployed) |
| 3 — Verification service and comparison | ⏳ not started |
| 4 — Tampering checks | ⏳ not started |
| 5 — Authentication | ⏳ not started |
| 6 — Persistence and history | ⏳ not started |
| 7 — Dashboard UI | ⏳ not started |
| 8 — Admin, security hardening, abuse protection | ⏳ not started |
| 9 — Public pages, privacy, accessibility | ⏳ not started |
| 10 — Production launch | ⏳ not started |

Status values: ⏳ not started · 🔄 in progress · ✅ complete · ⛔ blocked (say why)

---

## Planning — Documents and decisions

**Status:** complete

**Decisions made (by the user):**
- Project name: **VeriCert** (new repo `VeriCert`).
- Restarted from scratch with a phased plan. The earlier Netlify + Firebase build is
  superseded; lessons carried over are in CLAUDE.md, "Known facts".
- Hosting: Vercel. Database: MongoDB Atlas (M0, Mumbai). Language: JavaScript only.
- Access: verified `@pict.edu` accounts only, via Google or email/password.
- Output columns: Candidate Name, Course Name, Assignment Marks (/25), Exam Marks (/75),
  Verification, Tampering, Remarks.

**Files created:**
```
CLAUDE.md
docs/implementation_plan.md
docs/progress.md
```
`DESIGN.md` and `samples/` were provided by the user.

**Known issues / TODOs:**
| # | Item | Priority | Blocking |
|---|---|---|---|
| 1 | Only 2 sample certificates (1 PDF, 1 JPG). Collect 5–10 more from different sessions and courses before Phase 4's heuristics are finalised | High | Phase 4 |
| 2 | Whether NPTEL accepts requests from Vercel's servers is unproven | High | Phase 3 gate |
| 3 | Resend needs a verified sending domain for real users; without one, only the test domain works | Medium | Phase 10 |
| 4 | A custom domain (e.g. `verify.pict.edu`) needs PICT IT | Low | Phase 10 |

---

## Phase 0 — Specification check and samples

**Status:** complete. Gate passed: NPTEL could be fetched from a Node script (this machine only).

**Completed features:**
- **Repo hygiene, built early, per instruction (Step A, before Phase 0):** `git init` on `main`;
  `.gitignore`, `.gitattributes`, `.env.example` (all 12 variables, each commented); local
  `.env` (gitignored) with a generated `AUTH_SECRET`, `AUTH_URL=http://localhost:3000`,
  `EMAIL_FROM` set to Resend's test sender, and the MongoDB, Google and Resend secrets empty.
  `git status` confirmed that `samples/` and `.env` are not tracked. Commit `23de463`
  "chore: repo hygiene and planning docs".
- `NOTES.md`: observed values for all 3 samples, both URL shapes with every hop, genuine metadata,
  timings, implications per phase, and the unconfirmed list.
- `tests/fixtures/`: anonymised text-layer dumps and verification HTML from the real samples; 9
  synthetic text variants (decimal, long name, Devanagari, decomposed nukta, long course, zero,
  out-of-range, OCR slips, edited marks) with `expected` values; a synthetic NPTEL-side source
  for the edited-marks case; 2 synthetic PDFs (genuine-style, tampered-metadata with an
  incremental update and 2 `%%EOF`); `generate-synthetic.mjs`; `README.md`.
- Scratch tooling (not committed, `tmp/phase0/`, gitignored): PDF inspector, QR decoders, NPTEL
  fetcher with browser headers, manual redirects, hostname allowlist and one retry.

**Files modified:** `docs/progress.md`, `docs/challenges-log.md` (C-001 to C-005).

**Dependencies added (exact versions):** none in the project (no `package.json` yet). Scratch
only, in `tmp/phase0/`: pdfjs-dist@6.5.438, jsqr@1.4.0, zxing-wasm@3.1.6, pngjs@7.0.0,
@napi-rs/canvas@1.1.0. Node v24.18.1.

**Tests:** none exist yet (no test runner until Phase 1). Fixture PDFs were checked by loading
them in pdf.js: the genuine-style one shows 1 `%%EOF`, the tampered one 2.

**Known facts from CLAUDE.md, re-verified:**
| # | Fact | Status | Evidence |
|---|---|---|---|
| 1 | PDF text layer has name, course, `n/25`, `n/75`, roll no; no labels | **Confirmed** (both PDFs) | 2025 splits `Roll No:` from the number and has no `%` after the total |
| 2a | QR points to `nptel.ac.in/verify/<ID>` → `beta.nptel.ac.in/verify/<ID>` | **Confirmed** (2026 PDF); **changed** for the 2025 PDF, whose QR is the `noc/E_Certificate/<ID>` shape | `Location` carries `:443` |
| 2b | First request sometimes HTTP 500; a retry with browser headers gives 200 | **Unconfirmed** | 0 of 20 spaced requests needed a retry |
| 3 | Verification page shows only name, course, total; marks only in the linked PDF | **Confirmed** for shape A (hidden `div.sr` block); **changed** for shape B (no name, course or marks in any HTML page; three hops to the PDF) | NOTES §2 |
| 4 | QR can be ~55 px; needs a 2–3× upscale | **Confirmed, with a change**: ~54 px; plain upscaling failed in jsQR; binarising (or zxing) is what worked | C-002 |
| 5 | Alternate shape `nptel.ac.in/noc/E_Certificate/…` exists | **Confirmed** (it is the 2025 certificate's only shape) | NOTES §2.2 |
| 6a | Jan–Apr 2025 sample: Producer `FPDF 1.81` + CreationDate, one `%%EOF` | **Confirmed** (value `D:20250331193315`; the session is labelled Jan–Feb 2025) | |
| 6b | Jul–Sep 2026 sample has neither Producer nor CreationDate; one `%%EOF` | **Changed**: no CreationDate, but Producer `MuPDF 1.28.2` exists in a Catalog-level `/Info` that pdf.js cannot see; one `%%EOF` confirmed | C-001 |
| 7 | pdf.js detaches the ArrayBuffer | **Unconfirmed** (browser worker only; Phase 2 Playwright) | |
| 8 | OCR misreads names | **Unconfirmed** (no OCR run) | |
| 9 | Devanagari vowel signs are combining marks | **Confirmed** by measurement: letters-only regex rejects the name, `\p{L}\p{M}` accepts it, NFC equates both nukta forms | |
| 10 | Full-page OCR on near-blank PDFs ~30 s | **Unconfirmed** (no OCR run) | |

**Measured results:**
| Metric | Value | How measured |
|---|---|---|
| Verification page fetch, shape A (`verify/<ID>`, includes 302 hop) | min 101, median 135, max 238 ms | 10 sequential GETs, 1.5 s apart, dev machine, Node `fetch` |
| Verification page fetch, shape B (`E_Certificate/<ID>`) | min 56, median 77, max 102 ms | same |
| Requests needing the retry | 0 of 20 | same |
| Source PDF download | shape A 926 ms (932,481 B); shape B 1,450 ms (1,561,898 B) | 1 request each; not a statistic |
| QR decode: 2026 PDF | fails at 1×, decodes at 2× and 3× | jsQR on a pdf.js render |
| QR decode: PNG QR | jsQR 1× fails, 1× + threshold 140 works; zxing 1× works | `tmp/phase0/qr-img.mjs` |
| Tampered vs genuine PNG | 1,056 / 799,986 px differ (0.13 %), box 449–763 × 389–419 | exact RGB compare |
| Sample PDF vs NPTEL's served PDF | byte-identical (same SHA-256) | `sha256sum` |

**Changes to earlier phases:** none. (Step A was approved early and is logged above.)

**Remaining work:** Phase 1 needs the user to create the GitHub repo, import it in Vercel, and
create the MongoDB Atlas M0 cluster (Mumbai) with a database user and network access
`0.0.0.0/0`; then put `MONGODB_URI` in `.env` and Vercel.

**Known issues / TODOs:**
| # | Item | Priority | Blocking |
|---|---|---|---|
| 1 | No JPG sample; the real set is 1 PDF + 2 PNG. JPG input untested on real data | Medium | Phase 2 acceptance wording |
| 2 | Only 2 genuine certificates (1 PDF, 1 PNG screenshot of a PDF). More sessions and courses needed before any tampering threshold is set | High | Phase 4 |
| 3 | Real-derived fixtures keep the observed marks, course names and session labels (name, roll number and IDs replaced). The user may want marks changed too | Low | None |
| 4 | Fixture PDFs are synthetic. No fixture reproduces the genuine 2026 Catalog-level `/Info` layout (the real file is private) | Medium | Phase 4 |
| 5 | Shape A's data sits in a visually hidden block; parser is fragile to redesign | Medium | Phase 3 |
| 6 | NPTEL fetch proven from this machine only; Vercel IPs unproven (Phase 3 gate) | High | Phase 3 |
| 7 | The scratch scripts in `tmp/phase0/` are not in git. Their findings are in `NOTES.md` | Low | None |
| 8 | The `.env` file has `EMAIL_FROM` set to Resend's test sender (`onboarding@resend.dev`); the test sender can only mail the Resend account owner | Low | Phase 5 |

---

## Phase 1 — Project foundation

**Status:** complete, with one deviation: the live check was done on the **Production** deployment
of `main`, not on a Preview deployment.

**Deviation from the plan (recorded at the user's request):** the plan says "a preview deploy
succeeds and `/api/health` returns `db: "up"`". The user imported the project into Vercel after
pushing, so no Preview deployment of branch `phase-1-check` was created. The check was done on the
Production deployment of `main` (commit `107e806`) at https://veri-cert-bay.vercel.app. That still
proves Atlas network access from Vercel's servers (the acceptance reason), but the **Preview**
environment's variable scope (`MONGODB_URI`, `MONGODB_DB` ticked for Preview) has not been
exercised by a deployment. Re-check with the first real Preview deployment (Phase 5 at the latest).

**Completed features:**
- `package.json`: JavaScript ES-module app, `engines.node` `24.x`, scripts `dev`, `build`, `start`,
  `test`, `test:e2e`, `lint`, `format`, `db:indexes`. All versions exact.
- `app/layout.js`, `app/page.js`: placeholder home page ("This site is being set up…"), Inter +
  IBM Plex Mono via `next/font`, no sign-in and no claims about features that do not exist.
- `app/globals.css`: Tailwind v4 `@theme` built from DESIGN.md: all 23 colours, the 17-step type
  scale (size, line-height, tracking), the radii and the breakpoints. Spacing needs no tokens
  (DESIGN.md's scale equals Tailwind's default; see C-006). `waldenburgNormal` is proprietary,
  so Inter is used as DESIGN.md's "Note on Font Substitutes" prescribes, with display tracking
  0.5 px tighter.
- `src/lib/db/client.js`: one `MongoClient` cached on `globalThis._mongoClientPromise`; `getDb()`
  requires both `MONGODB_URI` and `MONGODB_DB` and throws if either is missing or blank (no
  defaults); 5 s connect/selection timeouts; a failed connect is not cached.
- `src/lib/db/indexes.js` and `scripts/db-indexes.mjs` (`npm run db:indexes`): idempotent
  `ensureIndexes()` for every index in the plan's data model; a changed TTL is applied with
  `collMod`; `RESULT_RETENTION_DAYS` is validated (1–3650, default 180, never a silent fallback).
- `app/api/health/route.js`: `GET /api/health` → `{ ok, db: "up"|"down", version }`, pings Atlas;
  503 and `db:"down"` on any failure; no error text in the response; `Cache-Control: no-store`.
- `src/lib/version.js`: `0.1.0+<7-char commit SHA>` (`+dev` locally).
- `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `vitest.config.js`,
  `playwright.config.js`, `jsconfig.json`, `postcss.config.mjs`, `next.config.js`
  (`poweredByHeader: false`, `agentRules: false`).
- `.github/workflows/ci.yml`: lint, unit tests, build on every push and pull request; no secrets.
- `README.md` skeleton: setup, environment table, commands, layout.
- `CLAUDE.md`: new rule 13 and a changed end-of-phase step 5 (see "Changes to earlier phases").

**Indexes created in Atlas database `vericert`** (via `npm run db:indexes`, run against the real
cluster; collections `runs`, `results`, `audit_logs`, `rate_limits` now exist, empty):
`runs`: `userId_createdAt`, `createdAt_ttl` (180 d). `results`: `runId`, `userId_createdAt`,
`candidateName_text` (`default_language: none`), `createdAt_ttl` (180 d). `audit_logs`:
`createdAt_ttl` (365 d). `rate_limits`: `windowStart_ttl` (1 h).

**Files modified:** `CLAUDE.md`, `docs/progress.md`, `docs/challenges-log.md` (C-006 to C-008).

**Dependencies added (exact versions):**
- Runtime: next@16.4.5, react@19.3.1, react-dom@19.3.1, mongodb@7.8.0
- Dev: tailwindcss@4.3.4, @tailwindcss/postcss@4.3.4, postcss@8.5.32, eslint@10.14.0,
  eslint-config-next@16.4.5, prettier@3.9.10, prettier-plugin-tailwindcss@0.8.1, vitest@5.1.0,
  @playwright/test@1.65.0
- Node v24.18.1 locally; Playwright Chromium Headless Shell 158.0.8127.18.

**Tests:**
- Vitest: 23 passed in 3 files (was 0): env fail-closed behaviour, index specs, TTL `collMod`
  path, retention parsing, health route (up, down without error leak, missing config).
- Playwright: 4 passed (placeholder renders, dark canvas token, paragraph not squeezed,
  `/api/health` shape and headers), against `next dev` with the real Atlas database.
- Lint: clean · Build: passes, also with `MONGODB_URI` and `MONGODB_DB` empty.
- CI (GitHub Actions, workflow "CI"): completed with conclusion `success` on `main` and on
  `phase-1-check`, both at commit `107e806` (read from the public GitHub API).

**Measured results:**
| Metric | Value | How measured |
|---|---|---|
| Local `/api/health`, first call after server start | HTTP 200, `db:"up"`, 1,002 ms (816 ms application code, includes the Atlas connect) | one `curl` against `next dev`, Atlas M0 Mumbai |
| Production `/api/health` | 5 × HTTP 200, `{"ok":true,"db":"up","version":"0.1.0+107e806"}`; 0.49, 0.49, 0.51, 0.52 s warm and 2.47 s on the first call | 5 sequential `curl` calls from the dev machine; includes network round trip from this machine, not server time |
| Production headers | `Cache-Control: no-store`; no `X-Powered-By` | `curl -I` |
| Production `/` | HTTP 200 | `curl` |
| `npm audit --omit=dev` | 0 vulnerabilities | `npm audit` |
| `npm audit` (all) | 10 moderate, all via `minimatch` in the lint toolchain | `npm audit`; see Known issues #1 |

**Changes to earlier phases:**
- `CLAUDE.md` (a planning document, not a phase entry): added rule 13 ("Never commit or push",
  the user does all commits and pushes) and changed step 5 of the end-of-phase routine to "Run
  `git status`, confirm that `samples/`, `.env` and real data are not staged, and suggest a commit
  message. Do not commit." The earlier commits `23de463`, `dd9479c` and `107e806` were made
  by Claude before this rule existed.
- Phase 0's entry is unchanged. Its Known issue #3 about the `.env` `EMAIL_FROM` is still open (Phase 5).

**Phase 0 items handled here:** the `.gitignore`/`.gitattributes` protections were exercised: `git
status` shows nothing from `samples/`, `tmp/` or `.env`. Fixtures and `*.md` are excluded from
Prettier so byte-exact fixtures are never reformatted. Phase 0 issues #1, #2, #4, #5, #6 belong to
Phases 2–4 and were not touched (rule 8).

**Remaining work:** Phase 2 (certificate extraction engine, in the browser). Not started.

**Known issues / TODOs:**
| # | Item | Priority | Blocking |
|---|---|---|---|
| 1 | `npm audit` reports 10 moderate findings (ReDoS in `minimatch` 7–11 inside `eslint@10` and `typescript-eslint` via `eslint-config-next`). Dev-only: not in the production bundle, lint only reads our own code. `npm audit fix --force` would only downgrade ESLint to 9 and would not remove the `typescript-eslint` chain, so not applied. Revisit in Phase 8 | Low | Phase 8 audit |
| 2 | No Preview deployment has been verified (deviation above). Preview variable scope untested | Medium | First Preview use |
| 3 | GitHub Actions are pinned to major tags (`actions/checkout@v4`, `actions/setup-node@v4`), not commit SHAs | Low | Phase 8 |
| 4 | Auth.js adapter collections (`users`, `accounts`, `sessions`, `verification_tokens`) and their indexes (for example a unique `users.email`) are not created; they belong to Phase 5. A unique email index must exist before accounts are created | High | Phase 5 |
| 5 | `rate_limits` has only its TTL index; a unique `{key, windowStart}` index for atomic upserts is not in the plan's list and is left for Phase 8 | Medium | Phase 8 |
| 6 | `/api/health` is public and unthrottled; it does one Atlas ping per call. Rate limiting is Phase 8 | Low | Phase 8 |
| 7 | Security headers (CSP, HSTS and others) are not set; Phase 8 | Medium | Phase 8 |
| 8 | Phase 1 deliberately has no layout chrome, 404 or error page (Phase 9). Next's defaults apply | Low | Phase 9 |
| 9 | The local `.env` has two extra variables (`MONGODB_USERNAME`, `MONGODB_PASSWORD`) and a quoted `MONGODB_URI`. Nothing reads the extras. In Vercel the URI was entered without quotes | Low | None |
| 10 | The e2e suite runs locally only; CI does not run Playwright (plan: lint, unit tests, build) | Low | None |
| 11 | The `db:indexes` script ran against the same Atlas database that Production uses (there is one `vericert` database; no separate dev database) | Medium | Phase 6 tests need a separate test database |

---

## Phase 2 — Certificate extraction engine (browser)

**Status:** complete. Both real samples, the tampered screenshot and six JPEG re-encodes extract
correctly in a real browser (Chromium), or fail closed with a specific reason. Not deployed.

**Branch:** work was done on `temp` (rule 14, added at the start of this phase).

**Completed features** (`src/lib/extract/`):
- `parse.js`: pure, no imports or browser APIs (a test enforces it), so Phase 3's server code can reuse
  it. `parseMarks()` anchors on `n/25` and `n/75`; strict for the text layer, `tolerant` for OCR
  (O→0, l/I/|→1, S→5, `2S`/`7S` denominators, spaces around `/`, comma decimals; a token with no
  real digit is noise). Ranges 0–25 and 0–75: out of range is an error, not clamped. Two different
  values for one field is `ambiguous_marks`. `parseCertificateText()` finds the name and course by
  position above the marks row (not item order: the 2025 and 2026 PDFs order items differently),
  joins wrapped course lines, ignores the bare total (`91%`, `84`). `normalizeText()` = NFC,
  whitespace collapse, keeps ZWJ/ZWNJ. `isPlausibleName()` allows letters plus combining marks
  (Devanagari) and rejects `7` and `|||`; `findRollNo()`; `parseVerifyUrl()` accepts only https on
  `nptel.ac.in` or `*.nptel.ac.in` (hostname, so look-alikes and `user@` tricks fail), both shapes
  (`/verify/<ID>`, `/noc/E_Certificate/<ID>`), `:443` allowed.
- `pdf.js`: `readPdf()` hands pdf.js a COPY (`bytes.slice()`) and keeps the original `bytes` whole;
  renders page 1 at 3x capped at 3,200 px on the longest side (the 2025 PDF is already 2,552 pt wide,
  3x would be 168 MB of pixels); reads the text layer; wasm and fonts self-hosted; load and render
  timeouts (10 s / 15 s, unproven: no sample ever hung pdf.js).
- `qr.js`: `decodeQr()`: jsQR on the full page, then zxing-wasm, then crops (bottom strip, bottom-right,
  bottom-left, whole page) at 2x and 3x with greyscale thresholds 140 and Otsu, each with both
  decoders. A decoded payload only counts if `parseVerifyUrl` accepts it; otherwise the specific reason
  (`qr_not_url`, `qr_unsupported_scheme`, `qr_not_nptel`, `qr_unknown_shape`, `qr_not_found`) is kept.
  4 s search budget.
- `ocr.js`: tesseract.js worker created on first use only, cached, single job queue. Crops only, never
  a full page. 8 s per-certificate budget including worker start-up; exceeding it gives
  `ocr_timeout` / "not confirmed (timeout)", fields null, worker recreated for the next job.
  Name and course: OCR of one identity crop, located by the certificate's printed boilerplate
  ("awarded to", "successfully completing the course", "consolidated score"); no anchor, no value.
  Marks: `findTableBorders()` (`image.js`) finds the table's five equal-height vertical borders in
  the pixels, then each value cell is OCR'd alone (PSM 7, digits `/ .`) in 8 passes (scales 2 to 5,
  threshold 140 or none); accepted only if at least two well-formed readings agree and none
  disagrees. Roll number: optional, two crops at 2x must agree and match the strict pattern; no error if not.
- `index.js`: `extractCertificate(file, { ocrBudgetMs, debug })` returns `{ name, course, assignment,
  exam, verifyUrl, certificateId, rollNo?, source: "text_layer"|"ocr", qr, ocrConfidence?, timings,
  errors[] }`. Never throws. Sniffs the type from the first bytes. PDF: OCR only for fields the text
  layer could not give (not for out-of-range or ambiguous values). Images: always `source: "ocr"`.
- `image.js`, `vendor.js`: canvas helpers; absolute URLs of the self-hosted assets.
- `scripts/copy-vendor.mjs` (run by `predev` and `prebuild`): copies the pdf.js worker, wasm and fonts,
  zxing's wasm, and tesseract's worker, 3 LSTM core variants and English data into `public/vendor/`
  (gitignored; 19 MB: pdfjs 3.4, tesseract 15, zxing 0.9). No third-party CDN is contacted (the e2e
  tests assert no non-localhost request while reading a certificate).
- `app/dev/extract/` (page + `ExtractScratch.js`): dev-only scratch page, 404 when `NODE_ENV` is
  production (verified against `next start`). `?budget=<ms>` sets the OCR budget. For PDFs it also
  reports the detached-buffer checks. `debug` shows raw OCR text and is only used on this page.

**Files modified:** `CLAUDE.md` (rule 14), `.gitignore` (`public/vendor/`, `*.traineddata`),
`package.json` (`predev`, `prebuild`), `playwright.config.js` (60 s timeout), `README.md`,
`docs/challenges-log.md` (C-009 to C-014).

**Dependencies added (exact versions):**
- pdfjs-dist@6.5.438, jsqr@1.4.0, zxing-wasm@3.1.6, tesseract.js@7.0.0 (pulls tesseract.js-core@7.0.0),
  @tesseract.js-data/eng@1.0.0 (English `4.0.0_best_int` data)
- Chromium Headless Shell 158.0.8127.18 (unchanged); Node v24.18.1.

**Tests:**
- Vitest: 96 passed in 5 files (was 23 in 3): `parse.test.js` 70 (every Phase 0 text fixture including both
  genuine layouts, decimal, long name and course, Devanagari, decomposed nukta, zero, out-of-range,
  OCR slips strict vs tolerant, wrapped course, junk names, URL allowlist look-alikes, purity),
  `sniff.test.js` 3.
- Playwright: 16 passed in 43.2 s (was 4): 12 new in `e2e/extract.spec.js`: 3 real samples with exact
  values, tampered vs genuine PNG, OCR timeout then recovery, JPEG re-encodes at quality 92 and 75,
  detached-buffer control, and 5 on committed or generated inputs (synthetic PDF without a QR,
  tampered-metadata PDF, non-image file, corrupt PDF, blank image). The real-sample tests read the
  gitignored `samples/` and `samples/expected.local.json` and skip if absent; nothing real is committed.
- Lint: clean. Build: passes with `MONGODB_URI` and `MONGODB_DB` empty. `npm audit --omit=dev`: 0.
- Production check (`next build` + `next start`): `/dev/extract` returns 404; every `/vendor/` asset
  is served with the right type (`application/wasm`, `application/javascript`, `application/gzip`).

**Known facts from CLAUDE.md, status after Phase 2:**
| # | Fact | Status |
|---|---|---|
| 4 | QR ~55 px needs upscaling | **Confirmed again.** `NPTEL.png`: jsQR on the raw full image failed, zxing-wasm on the full image decoded it (attempt 2). The PNG render of the 2025 PDF needed jsQR on the bottom strip at 2x, grey 140. The 2026 PDF decoded with jsQR on the full 3x render |
| 7 | pdf.js detaches the ArrayBuffer | **Confirmed** in Chromium: handing pdf.js the original buffer leaves `byteLength` 0 (was the full file size); `readPdf`'s copy keeps the full size and starts `%PDF-` |
| 8 | OCR misreads names ("7") | **Not reproduced**: the name was read correctly on every image run (OCR confidence 92 to 93). Other misreads were real: C-010 (marks dropped `.` and `/`) and C-011 (roll S read as 5) |
| 9 | Devanagari combining marks | Confirmed at parse level (fixtures). **OCR is English-only**: a Devanagari name on an image would come back "not confirmed". Untested on a real Devanagari certificate |
| 10 | Full-page OCR ~30 s | **Not tested**: by design nothing OCRs a full page |

**Measured results** (Chromium 158 headless, `next dev`, this machine; `totalMs` is `extractCertificate` only,
not page load; cold = new browser context each time, n = 3; warm = same page with workers running, n = 5;
min / median / max):
| Sample | Source | Cold ms | Warm ms | Warm breakdown (ms) |
|---|---|---|---|---|
| `NPTEL Entrepreneurship and IP Strategies.pdf` (2026) | text layer | 737 / 741 / 745 | 605 / 624 / 641 | load 135, render 130, parse 0, QR 336 |
| `NPTEL.png` (2025 screenshot) | OCR | 1,845 / 1,858 / 1,869 | 1,071 / 1,101 / 1,129 | QR 196, OCR 891 (identity 325, marks 391, roll 175) |
| `NPTEL_tampered.png` | OCR | 1,761 / 1,763 / 1,790 | 1,003 / 1,022 / 1,065 | QR 192, OCR 817 |
| 2026 PDF rendered to a 1054 px PNG (local only) | OCR | 1,603 / 1,629 / 1,656 | 977 / 988 / 1,001 | QR 76, OCR 903 |
| 2025 PDF rendered to a 1054 px PNG (local only) | OCR | 1,967 / 1,970 / 1,979 | 1,182 / 1,193 / 1,233 | QR 249, OCR 933 |
| Page with no QR (synthetic PDF) | text layer | n/a | total 4,601, 5,023, 4,911 ms (3 runs; QR search cut off by its 4 s budget after 18 to 24 attempts) | |

OCR worker start, first image after load: about 0.5 s (`ocr_workerMs` 503 to 537 in three runs).

Accuracy, counts only (small samples, not an accuracy rate):
- 3 of 3 real samples exact on every field and on `source`.
- 2 of 2 PDF-to-PNG renders exact except the roll number (not read; it is optional).
- 6 JPEG re-encodes of the two PNGs (quality 95, 85, 75): 4 of 6 exact before the final marks rule. With
  the final rule: first run 5 exact and 1 `ocr_timeout`; two reruns 6 of 6 exact (see C-014).
- In the first 19 image runs after the final rule: 1 timeout and 0 wrong values. Every failure so far
  gave null plus a specific code, never a wrong value.
- Roll number from OCR: read on 7 of 8 images derived from the two real PNGs in the first run (the
  eighth timed out) and on 8 of 8 in the rerun; 0 of 2 PDF renders.

**Changes to earlier phases:** `CLAUDE.md` gained rule 14 (work only on `temp`; the user merges via PR) at
the start of this phase. Phase 0 and Phase 1 entries are unchanged.

**Remaining work:** Phase 3 (verification service and comparison). Phase 4 will need the raw PDF bytes
that `readPdf()` already returns, and `ocrConfidence`, `source` and `rollNo` from this phase.

**Known issues / TODOs:**
| # | Item | Priority | Blocking |
|---|---|---|---|
| 1 | No real JPG sample. The JPEG path is tested only on JPEG re-encodes of the PNG samples (lossy, from a screenshot). Photos of printed certificates are not supported: the OCR layout logic needs the flat layout and the table borders | Medium | Phase 10 pilot |
| 2 | OCR name/course rely on printed boilerplate phrases and the marks table on its five vertical borders. Tuned on the 2025 template; it also worked on the 2026 template rendered to PNG. Any other NPTEL layout fails closed with a specific code; not seen yet | Medium | Phase 10 pilot |
| 3 | The marks passes (scales, thresholds, "two must agree, none may disagree") were chosen on 3 real images and 6 JPEG copies of them: small-sample tuning (rule 7 in spirit). More samples needed | High | Phase 4 |
| 4 | OCR roll number is optional and no error is raised when absent. Phase 4's `id_match` cannot depend on it for images | Low | Phase 4 |
| 5 | English-only OCR; Devanagari names on images come back "not confirmed" | Low | None |
| 6 | One unexplained `ocr_timeout` in 19 runs and two harness timeouts on a cold dev server (C-014). OneDrive suspected, unverified | Medium | Phase 7 batch runs |
| 7 | A certificate with no readable QR spends 4 s in the QR search before failing; adds up in a bulk run | Low | Phase 7 |
| 8 | `extractCertificate` runs on the main thread (canvas, jsQR, zxing; OCR in a worker). Phase 7's 3 to 4 parallel certificates is not designed or measured. The OCR worker is a single queue | Medium | Phase 7 |
| 9 | Multi-page PDFs: only page 1 is read, with no warning | Low | None |
| 10 | A QR on plain `http://nptel.ac.in/...` is rejected (`qr_unsupported_scheme`) instead of upgraded. None observed. Rule 11: ask before changing | Low | None |
| 11 | `public/vendor/` is regenerated by `predev`/`prebuild`; it adds 19 MB of static assets to each deploy and has not been deployed yet. Phase 8's CSP must allow these workers, wasm, and `blob:` workers for tesseract | Medium | Phase 8 |
| 12 | The e2e tests need the gitignored `samples/` and `expected.local.json`; CI does not run Playwright | Low | None |
| 13 | The scratch page ships in the production bundle (always 404 at runtime). It can be moved out of `app/` or removed if preferred | Low | None |
| 14 | pdf.js load/render timeouts (10 s, 15 s) are untested guards | Low | None |

---

<!--
TEMPLATE: copy this block for each phase. Don't delete it.

## Phase N — <Name>

**Status:** complete | partial (explain) | blocked (explain)

**Completed features:**
- `path/to/file.js`: what it does, concretely
- ...

**Files modified:**
```
path/a.js
path/b.jsx
```

**Dependencies added (exact versions):**
- package@x.y.z

**Tests:**
- Vitest: N passed (was M)
- Playwright: N passed
- Lint: clean · Build: passes

**Measured results:**
| Metric | Value | How measured |
|---|---|---|

**Changes to earlier phases:** (note here; never edit the earlier entry)
- ...

**Remaining work:**
What's next, and anything this phase handed forward.

**Known issues / TODOs:**
| # | Item | Priority | Blocking |
|---|---|---|---|
-->