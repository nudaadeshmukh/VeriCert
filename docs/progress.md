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
| **Current phase** | Phase 4 complete, awaiting user review. |
| **Next phase** | Phase 5: Authentication (not started; waits for approval). It must remove the temporary `/api/verify` guard (Phase 3 known issue 2) |
| **Production URL** | https://veri-cert-bay.vercel.app (`/api/health` → `{"ok":true,"db":"up"}`). Still running Phase 1 code (`0.1.0+107e806`); Phase 2 is not deployed |
| **Preview URL** | None. No Preview deployment exists (see Phase 1 deviation). |
| **Does it run?** | Locally: yes. The browser reads PDF, PNG and JPG, runs the six tampering checks and gives a tampering verdict (dev pages `/dev/extract`, `/dev/tamper`, 404 in production). `POST /api/verify` works on Vercel Preview only. Production runs an older shell. No sign-in or upload page yet. |
| **Latest measured results** | Tampering checks add about 0.6 to 0.7 s per PDF warm (medians 573 and 731 ms), about 0.8 to 1.1 s cold, about nothing for images. All genuine samples give "No tampering detected"; the tampered PNG and the synthetic tampered-metadata and edited-text-layer fixtures give "Tampering detected". Phase 3 gate, from Vercel `bom1`: 10 of 10 verifications exact, p50 586 ms, max 1,944 ms. |

| Phase | Status |
|---|---|
| 0 — Specification check and samples | ✅ complete (gate passed from a local script) |
| 1 — Project foundation | ✅ complete (verified on Production, not Preview) |
| 2 — Certificate extraction engine | ✅ complete (verified in local Chromium; not deployed) |
| 3 — Verification service and comparison | ✅ complete (gate passed: live smoke from a Vercel Preview, region bom1) |
| 4 — Tampering checks | ✅ complete (verified in local Chromium; not deployed) |
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

## Phase 3 — Verification service (server) and comparison

**Status:** complete. **The Phase 3 gate passed:** the live smoke test against the Vercel Preview deployment
(`0.1.0+af1443a`, function region `bom1`) got the correct values for both real certificates on all 10 runs. NPTEL
accepts requests from Vercel's servers.

**Branch:** `temp` (rule 14).

**Completed features:**
- `src/lib/verify/fetchSource.js`: `fetchNptel()`. Allowlist (`isAllowedNptelUrl`: https, port 443 only,
  no credentials, hostname `nptel.ac.in` or `*.nptel.ac.in`) checked on the first URL and again on EVERY
  redirect hop; redirects followed by hand (`redirect: "manual"`), at most 5; relative `Location` resolved;
  browser headers only (User-Agent, Accept, Accept-Language, nothing else); one retry on a 5xx, a network
  error or an attempt timeout; 8 s per attempt and 20 s overall (`LIMITS`); response bodies capped while
  streaming (256 KB for HTML, 8 MB for PDFs). 404/410 is `source_not_found`, other 4xx is
  `source_http_error` (reported, never worked around), none of them retried.
- `src/lib/verify/parseSource.js`: pure parsers. Shape A: the hidden `div.sr` block (name, course, total,
  status) and the `certificate.pdf` link. Shape B: wrapper iframe, then the archive landing page's relative PDF
  link. Every link must be allowlisted, match the expected path pattern, and **carry the same certificate ID as
  the QR code** (`source_mismatch` otherwise), so a swapped link cannot substitute another person's PDF.
  Anything missing is `source_format_changed`, never a guess.
- `src/lib/verify/readPdf.js`: text layer of NPTEL's PDF on the server with `unpdf` (positioned items).
- `src/lib/verify/index.js`: `verifySource(url, { cache })`. Chain for shape A: page, then PDF. Shape B:
  wrapper, archive (302), landing, PDF. The PDF text goes through **`parseCertificateText` from
  `src/lib/extract/parse.js`**, the same function that reads an uploaded certificate (no second parser). Returns
  `{ source: { name, course, assignment, exam, total } | null, error?, message?, meta: { shape, ms, requests } }`.
  The PDF is never returned. Error codes: `invalid_url`, `url_not_allowed`, `unsupported_url_shape`,
  `source_unreachable`, `source_timeout`, `source_not_found`, `source_http_error`, `too_many_redirects`,
  `bad_redirect`, `source_too_large`, `source_format_changed`, `source_mismatch`, `source_not_live`,
  `source_unreadable` (no text layer or unopenable PDF, no server OCR in v1), `source_parse_failed` (marks not
  read; the partial source is still returned), `internal_error`.
- `src/lib/verify/dedupe.js`: `createDeduper()`, per-batch de-duplication (concurrent and repeated requests for
  one URL share one result; a failed computation is forgotten). Deliberately NOT a process-wide cache, so one
  user's results are never served to another user's request. The browser (Phase 7) creates one per run.
- `src/lib/compare.js`: `compareCertificate(certificate, sourceResult)` returns `{ verification, reason, marks,
  checks }`. Successful: both marks within 0.01 (22.5 vs 22.51 counts, 22.52 does not). **Unsuccessful: any mark
  present on both sides differs** (even if the other is missing), **or the source status is not live** (reason
  exactly `Certificate not live on NPTEL (status: <status>)`). **Error: only when nothing differs and a value is
  missing**, with the reason (certificate mark unread, source unavailable or unparsed). Precedence: not live,
  difference, missing, success (user decisions 1 and 2 of the Phase 3 review; `CLAUDE.md` Result semantics updated
  to match). `name_match` and `course_match` are checks only (NFC, case-folded, punctuation as
  spaces, Unicode-aware) and never change the verdict.
- `app/api/verify/route.js`: `POST /api/verify { url }`. `runtime = nodejs`, `maxDuration = 30` (the
  verification budget is 20 s; 30 s is inside Vercel Hobby's configurable maximum as I understand Vercel's
  documented limits (60 s, or 300 s with Fluid compute); this is **to be confirmed by the real deployment**).
  400 for bad bodies and request problems (`invalid_url`, `url_not_allowed`, `unsupported_url_shape`), 413 for
  bodies over 2 KB, 405 for GET; a problem with NPTEL is HTTP 200 with an `error` code. `Cache-Control:
  no-store`. Structured log with no URL, certificate ID or name.
- `src/lib/verify/guard.js` + the route: **TEMPORARILY UNAUTHENTICATED.** `isVerifyEndpointEnabled()`: enabled
  when `NODE_ENV !== "production"`; on Vercel Preview (which builds with `NODE_ENV=production`) only with
  `VERIFY_DEV_ENDPOINT=1` AND `VERCEL_ENV=preview`; never on Production, even if the variable is set there by
  mistake. Disabled means HTTP 404. **Phase 5 MUST: delete `guard.js` and the guard call in the route, add
  `requireUser()`, remove `VERIFY_DEV_ENDPOINT` from Vercel and from `.env.example`, and delete the Phase 3
  tests of the guard.**
- `scripts/smoke-nptel.mjs` (`npm run smoke:nptel`): LIVE test, not in CI. Direct mode, or `--base-url=` to
  POST to a deployment; sends `VERCEL_AUTOMATION_BYPASS_SECRET` as `x-vercel-protection-bypass` if set; reads the
  real URLs and expected values from the gitignored `samples/smoke.expected.local.json`; prints labels, marks and
  timings only (never names or URLs); reports p50 and max (nearest rank), the function region from
  `x-vercel-id`, and detects a Deployment Protection redirect or a disabled endpoint.
- `src/lib/extract/parse.js` (shared module, extended; Phase 2 behaviour unchanged): exported
  `isNptelHostname` and `isAllowedNptelUrl` (the single allowlist, now used by `parseVerifyUrl` and the fetcher),
  and `parseCertificateText` now also returns `total` (the bare number above the marks row, 0 to 100, null and
  not an error when absent). Phase 2's own results do not use `total` yet.
- Phase 2 side task (see C-015): `ocr_timeout` errors now carry the `stage`; `decodeQr` has an off-by-default
  `trace`; one experiment tried and reverted.

**Files modified:** `src/lib/extract/parse.js`, `src/lib/extract/ocr.js`, `src/lib/extract/qr.js`,
`src/lib/extract/index.js`, `tests/unit/parse.test.js`, `tests/fixtures/generate-synthetic.mjs`,
`package.json`, `package-lock.json`, `.env.example`, `README.md`, `CLAUDE.md` (Result semantics), `vercel.json` (new, region bom1), `docs/challenges-log.md` (C-015, C-016), `.gitattributes` (`* text=auto eol=lf`, binary rules kept), `.prettierrc.json` (`endOfLine: "lf"`).
New: `src/lib/verify/*`, `src/lib/compare.js`, `app/api/verify/route.js`, `scripts/smoke-nptel.mjs`,
`e2e/verify.spec.js`, `tests/unit/{fetchSource,verify,compare,verifyRoute}.test.js`, `tests/unit/helpers/mockFetch.js`,
`tests/fixtures/pdf/synthetic-source-2026.pdf`, `synthetic-source-2025.pdf`, `synthetic-no-text-layer.pdf`.

**Dependencies added (exact versions):** unpdf@2.1.0. (pdfjs-dist@6.5.438 is unchanged; `unpdf` bundles its own
serverless pdf.js build.)

**Tests:**
- Vitest: 245 passed in 10 files (was 96 in 5): `fetchSource` 36 (allowlist incl. look-alikes, link-local and
  non-https, redirects to non-NPTEL hosts never requested, 5-hop limit, 500 then 200, 500 twice, 404, 403,
  per-attempt and overall timeout, shared deadline, request headers, size caps), `verify` 35 (both URL shapes end
  to end with mocked fetch and the real `unpdf`, `source_unreadable`, mismatch and swapped links, non-LIVE
  status flowing through `compareCertificate`, corrupt PDF, de-duplication), `compare` 42 (precedence: not live,
  difference beats missing, missing alone is Error), `verifyRoute` 19 (guard matrix, bodies, status codes, log has
  no personal data), `smokeScript` 3 (the bypass secret only ever goes into the request header and never to
  console output), `parse` 84 (was 70), others unchanged.
- Playwright: 20 passed in 56.3 s (was 16): 4 new in `e2e/verify.spec.js` (refusals only, no NPTEL traffic).
- Lint: clean. Build: passes with `MONGODB_URI` and `MONGODB_DB` empty.
- Production-build checks (`next build` then `next start`): POST `/api/verify` returns 404 with no flags, 404 with
  `VERIFY_DEV_ENDPOINT=1 VERCEL_ENV=production`, 400 (so reachable) with `VERIFY_DEV_ENDPOINT=1 VERCEL_ENV=preview`.
  The live smoke through that production build passed (this proves `unpdf` works in the real bundle).

**Live results so far (this machine, NOT Vercel):**
| Run | Result |
|---|---|
| `npm run smoke:nptel`, direct, 3 runs per certificate, 2 s apart | 6 of 6 exact (name, course, marks, total) for shape A (2026 PDF) and shape B (2025 PNG) |
| Same through `next dev` `/api/verify` | 6 of 6 exact |
| Same through the production build (`next start`, simulated Preview) | 4 of 4 exact (2 runs each) |

**Measured results** (this machine to NPTEL, Mumbai-area network unknown; NOT from Vercel):
| Metric | Value | How measured |
|---|---|---|
| Whole verification, direct, shape A | 808, 410, 479 ms (2 fetch attempts) | 3 runs |
| Whole verification, direct, shape B | 2,944, 587, 1,240 ms (3 fetch attempts) | 3 runs |
| All direct runs together | p50 587 ms, max 2,944 ms | n = 6, nearest-rank p50 |
| Through the production build | p50 909 ms, max 2,133 ms | n = 4 |
| NPTEL first request needing the retry | 0 in all smoke runs (every verification used the minimum fetches: 2 for A, 3 for B) | from `meta.requests` |

**THE GATE, measured from Vercel** (Preview deployment of commit `af1443a`, `https://veri-cert-ghwqzoftl-…vercel.app`,
`npm run smoke:nptel -- --base-url=<preview> --runs=5 --gap=2000`, run from the dev machine with the automation
bypass secret; real NPTEL, both certificates):
| Metric | Value |
|---|---|
| Verifications correct (every field exact: name, course, both marks, total) | **10 of 10** (shape A 5 of 5, shape B 5 of 5), 0 failures, 0 blocked |
| Function region (`x-vercel-id`) | **`bom1`**, edge and function, on all 10 runs (`vercel.json` took effect) |
| Round trip, all 10 | **p50 586 ms, max 1,944 ms** (nearest rank; includes the dev machine's network to Vercel) |
| Round trip, shape A (2026 PDF), 5 runs | p50 409 ms, max 919 ms (first request 919 ms; 2 fetch attempts each) |
| Round trip, shape B (2025 PNG), 5 runs | p50 1,194 ms, max 1,944 ms (first 1,944 ms; 3 fetch attempts each) |
| Inside `verifySource` (server time to NPTEL and back, all 10) | p50 284 ms, max 1,886 ms |
| Shape B inside `verifySource`, 5 runs | 1,886, 235, 1,520, 539, 1,143 ms (varies a lot from run to run: the `archive.nptel.ac.in` hop and PDF) |
| Retries needed | 0 (every verification used the minimum number of fetch attempts) |
Other deployment checks: `/api/health` on the Preview: `{"ok":true,"db":"up","version":"0.1.0+af1443a"}` (Atlas reachable
from `bom1`); `POST /api/verify` with a non-NPTEL URL: HTTP 400 `url_not_allowed`; Production
(`veri-cert-bay.vercel.app`, `main` at `3896a89`) `POST /api/verify`: HTTP 404.
**`maxDuration = 30`:** the Preview deployed and is Ready with the route's `maxDuration = 30`, so Vercel accepted it. I
cannot read Vercel's build log or function settings from here, so that is the evidence: the deployment succeeded.
No verification took longer than 1.9 s, so the 20 s budget was never approached; the timeout path was only exercised
by unit tests.

**Phase 2 investigations (C-015):** OCR timeouts: not reproduced in about 120 further runs; cause not
established; instrumentation added; left in Known Issues. No-QR search: profiled (jsQR on crops about 55 to
60 % of the 4.6 s, crop preparation about 30 %); one change tried and reverted (no gain); left in Known Issues.
Also found: a runaway dev-server compile loop caused by logging into the project folder (not reproducible on demand).

**Decided by the user (Phase 3 review):**
1. A mark present on both sides that differs gives **Unsuccessful**, even if the other mark is missing; **Error**
   only when nothing differs and a value is missing.
2. A source whose status is not `LIVE` gives **Unsuccessful** with Remarks `Certificate not live on NPTEL (status:
   <status>)`, not Error. (`verifySource` returns `error: "source_not_live"` and `meta.status`; the PDF is not fetched.)
3. `vercel.json` sets `{"regions": ["bom1"]}`; the gate is measured from bom1.
4. The Preview's automation bypass secret is in the local `.env` as `VERCEL_AUTOMATION_BYPASS_SECRET`;
   `smoke:nptel` sends it only as the `x-vercel-protection-bypass` header and never prints it.
5. `VERIFY_DEV_ENDPOINT=1` is set on Vercel Preview only.

**Still open for review (rule 11):**
1. A name or course read by OCR that differs from NPTEL's is `not_confirmed`, not `fail` (OCR can misread names).
   Phase 4 decides how OCR confidence feeds the tampering verdict.
2. Source `name`/`course`/`total` come from NPTEL's PDF, falling back to the page's hidden block (shape A only)
   if the PDF's own value could not be read.
3. `maxDuration = 30` (see above); to be confirmed by the real deployment.
4. HTTP: request problems are 400, NPTEL problems are HTTP 200 with an `error` code.

**Changes to earlier phases:** `parse.js` gained `total`, `isNptelHostname`, `isAllowedNptelUrl`; the two Phase 2
tests that compare whole parse results now include `total` (91 and 84). Phase 2 files `ocr.js`, `qr.js`,
`index.js` gained diagnostics only (stage in timeout errors, QR trace). No earlier entry is edited.

**Remaining work:** none for Phase 3. Phase 4 (tampering) will consume `compareCertificate`'s checks, `source`, `ocrConfidence` and the raw PDF bytes from Phase 2.

**Known issues / TODOs:**
| # | Item | Priority | Blocking |
|---|---|---|---|
| 1 | ~~Gate not run~~ **Done:** the live smoke from a Vercel Preview passed 10 of 10 from `bom1`. Not yet seen: NPTEL blocking or rate-limiting under heavier use (only 10 verifications of 2 certificates were run) | Low | None |
| 2 | `/api/verify` is unauthenticated outside dev/Preview-with-flag. Phase 5 MUST remove `guard.js` and `VERIFY_DEV_ENDPOINT`, and add `requireUser()` | High | Phase 5 |
| 3 | ~~Region iad1~~ **Fixed:** `vercel.json` pins `bom1` and the gate confirmed the function ran in `bom1` on all 10 runs. Production gets the same region when this reaches `main` (not yet) | Low | None |
| 4 | Vercel Preview deployments are behind Vercel Authentication; the automation bypass secret (local `.env`) worked on the real Preview. Anyone else running `smoke:nptel` against a Preview needs their own | Low | None |
| 5 | Shape A's hidden `div.sr` block is the fragile part; a redesign yields `source_format_changed`. Only 2 sessions of real certificates seen | Medium | Phase 10 pilot |
| 6 | Only `LIVE` status observed; revoked or expired certificates are untested against real NPTEL | Medium | Phase 10 pilot |
| 7 | No server OCR: an NPTEL PDF without a text layer is `source_unreadable` (none seen yet) | Low | None |
| 8 | No rate limiting on `/api/verify`: a loop of requests hits NPTEL at full speed. Phase 8; the dev-only guard keeps it closed meanwhile | High | Phase 8 |
| 9 | The smoke test and these latency numbers use 2 real certificates; NPTEL's "first request sometimes 500" has still never been seen | Low | None |
| 10 | Phase 2 issues carried: unexplained single OCR timeout (C-014, C-015); a no-QR certificate spends 4 s searching (profile in C-015) | Medium / Low | Phase 7 |
| 11 | `compareCertificate` is not yet wired to anything (the dashboard is Phase 7); its checks feed Phase 4 | Low | None |
| 12 | Plain `http://` QR URLs are rejected (carried from Phase 2 issue 10) | Low | None |

---

## Phase 4 — Tampering checks

**Status:** complete. Every genuine sample gives "No tampering detected"; the known-tampered PNG and the synthetic
tampered-metadata and edited-text-layer fixtures give "Tampering detected" and name the failing check. Verified in
Chromium on the real samples. Not deployed (the checks run in the browser and nothing calls them from a page yet).

**Branch:** `temp` (rule 14).

**Order of work (as requested):** the genuine samples were surveyed FIRST, their metadata and render-versus-text-layer
behaviour recorded in `NOTES.md` §6, and only then were thresholds written into `config.js`.

**Completed features** (`src/lib/tamper/`, all pure: no browser APIs, a test enforces it):
- `metadata.js`: `readPdfMetadata(bytes, pdfjsInfo)` reads the RAW bytes: Producer, Creator, CreationDate, ModDate (all
  occurrences, so a rewritten Info dictionary shows its history; literal, hex, UTF-16BE and indirect strings), XMP tool names,
  counts of `%%EOF`, `startxref`, xref tables, XRef streams and `/Prev`, linearized and encrypted flags. pdf.js' own `info` is a
  fallback only (the 2026 genuine file keeps its Producer in a Catalog-level `/Info` that pdf.js does not see). No thresholds in it.
- `config.js`: every bound, each with a comment citing the samples (G1, G2, G3) or saying plainly that none exists:
  `EDITOR_DENYLIST` (14 dedicated editors and online editing services; generators such as "Adobe PDF Library", Word, Skia/PDF
  and LibreOffice are deliberately NOT listed), `MODDATE_MIN_GAP_SECONDS` = 1 day (uncalibrated: no genuine ModDate exists),
  `BASELINE_STRUCTURE` (plain: 1 `%%EOF`, 0 `/Prev`; linearized: 2 and 1, untested), `LAYER_MARK_TOLERANCE` 0.01,
  `LAYER_TEXT_MIN_OCR_CONFIDENCE` 85 (genuine names read at 92 to 93, courses 94 to 96), `LAYER_TEXT_MIN_DIFFERENCE_RATIO` 0.5,
  `NOT_CONFIRMED_LIMIT` 0.5, `CORE_CHECKS`. A test checks that nothing numeric is hardcoded in `checks.js` and that every config
  value has a comment block.
- `checks.js`: the six checks, each `pass | fail | not_confirmed | not_applicable` plus a detail:
  `id_match` (`/noc/E_Certificate/<ID>`: the ID must start with the printed roll number; `/verify/<ID>`: `not_applicable`, no
  relationship observed; an OCR-read roll that mismatches is `not_confirmed`, only a text-layer roll can fail),
  `name_match` / `course_match` (from `compareCertificate`; a text-layer difference fails, an OCR difference is `not_confirmed`),
  `marks_match` (a mark present on both sides that differs fails; missing is `not_confirmed`),
  `layer_vs_render` (PDF only: text layer against the OCR of the rendered crops; marks fail on any difference above 0.01, name and
  course fail only if the OCR line has confidence of at least 85 AND at least half the characters differ; anything unreadable is
  `not_confirmed`), `metadata` (PDF only: fails on an editor Producer/Creator, current or left by an earlier save, a ModDate more
  than 1 day after CreationDate, or an incremental update; an unknown Producer is noted in the detail and never flags).
  `assessTampering({ extraction, comparison })` gives the verdict exactly as the plan says: any `fail` is **Tampering detected**
  (failing checks named); if none of name, course and marks produced a pass or fail it is **Not checked**; if at least half of the
  applicable checks are `not_confirmed` it is **Not checked**; otherwise **No tampering detected** (a minority of `not_confirmed`
  is listed in the reason). A fail wins over everything, so an edited text layer is caught even with NPTEL unreachable.
- Extractor (`src/lib/extract`, additive): `extractCertificate(file, { evidence: true })` adds `evidence` for PDFs (retained
  bytes, pdf.js metadata, the text-layer values captured before any OCR fallback, and an OCR of the rendered page's name, course and
  marks crops, reusing Phase 2's OCR including its two-passes-must-agree rule); the result now has `fileKind`; `readPdf` returns pdf.js'
  `info`. Without the option nothing changes.
- `app/dev/tamper/` (page + `TamperScratch.js`): dev-only scratch page running extraction, the NPTEL source (a source map box, or `?live=1`
  against the real `/api/verify`), `compareCertificate` and `assessTampering`; `?measure=1` times the extraction without evidence first.
  404 in production (checked against `next start`). The PDF bytes are never put into the page.
- `e2e/helpers/syntheticCertificate.js`: draws a synthetic NPTEL-style certificate on a canvas in the browser and wraps it in a PDF
  with an INVISIBLE text layer (render mode 3) that the test controls: the "edited text layer" fixture. Nothing real, nothing committed as a binary.

**Files modified:** `src/lib/extract/index.js`, `pdf.js`, `ocr.js` (see "Changes to earlier phases"), `playwright.config.js`
(`workers: 1`), `NOTES.md` (§6), `docs/challenges-log.md` (C-017, C-018), `README.md`.
New: `src/lib/tamper/*`, `app/dev/tamper/*`, `tests/unit/tamper.test.js`, `e2e/tamper.spec.js`, `e2e/helpers/syntheticCertificate.js`.

**Dependencies added:** none.

**Results on the genuine and tampered samples** (Chromium, NPTEL's source stubbed with the values NPTEL serves, which Phase 3's smoke
test proved; one test also runs the full chain against the real `/api/verify`):
| Sample | id | name | course | marks | layer vs render | metadata | Tampering verdict | Verification |
|---|---|---|---|---|---|---|---|---|
| G1 genuine 2026 PDF (MuPDF 1.28.2) | n/a | pass | pass | pass | pass | pass | **No tampering detected** | Successful |
| G2 genuine 2025 PDF (FPDF 1.81) | pass | pass | pass | pass | pass | pass | **No tampering detected** | Successful |
| G3 genuine 2025 screenshot | pass | pass | pass | pass | n/a | n/a | **No tampering detected** | Successful |
| JPEG copies of G3 (quality 92 and 75) | | | | | | | **No tampering detected** (both) | |
| `NPTEL_tampered.png` (marks 20 and 70) | pass | pass | pass | **FAIL** | n/a | n/a | **Tampering detected (marks_match)** | Unsuccessful |
| JPEG copy of the tampered PNG (quality 85) | | | | | | | **Tampering detected** (names marks_match) | |
| LIVE chain on G1 with the real NPTEL | | | | | | | No tampering detected | Successful |
**No genuine sample was flagged, so no threshold had to be adjusted.** Synthetic fixtures:
| Fixture | Verdict | Failing check |
|---|---|---|
| `synthetic-tampered-metadata.pdf` (Acrobat Producer, ModDate 172 days later, incremental update; NPTEL agrees with its text) | Tampering detected | `metadata` only (the detail names all three signals) |
| Generated image PDF, hidden text edited to 25/25 and 75/75 (picture says 12.25 and 40.5), NPTEL agrees with the edited text | Tampering detected | `layer_vs_render` only |
| Same, against NPTEL's real values | Tampering detected | `marks_match`, `layer_vs_render` |
| Same, NPTEL unreachable | Tampering detected | `layer_vs_render` (a fail beats "Not checked") |
| Hidden NAME edited to a clearly different name | Tampering detected | `layer_vs_render` |
| Same file with a `Sejda` Producer | Tampering detected | `metadata` |
| Control: hidden text matches the picture | No tampering detected | none (`layer_vs_render` pass) |
| `synthetic-genuine-style.pdf` (FPDF Producer, no QR, plain layout the render OCR cannot read) | No tampering detected | none (`id_match` and `layer_vs_render` are `not_confirmed`: a tolerated minority, 2 of 6) |
| Genuine-style PDF with no NPTEL source | Not checked | none |
| A file that is not an image | Not checked | none |

**Tests:**
- Vitest: 333 passed in 11 files (was 245 in 10): `tamper.test.js` 88 (the raw reader on escapes, hex, UTF-16 and indirect strings, the
  ModDate threshold exactly at the limit and one second over, every signal in isolation, the denylist not matching any genuine
  Producer, linearized baseline, each check's boundaries including name confidence 85 vs 84 and difference ratio 0.5 vs 0.4, every
  verdict path, only three verdict strings exist, config comments and purity).
- Playwright: 37 passed in 2.2 min (was 20): 17 new in `e2e/tamper.spec.js`. With `workers: 1`. In a parallel run with 3 workers 6 tests failed
  on the OCR time budget (C-018).
- Lint: clean. Build: passes. Production build: `/dev/tamper` and `/dev/extract` return 404.

**Measured results** (Chromium 158 headless, `next dev`, this machine; added time = extraction with evidence minus extraction
without, plus the assessment; cold = a new browser context each time, n = 3; warm = same page, workers running, n = 5;
min / median / max in ms):
| Sample | Cold added | Warm added | Warm extraction without, then with evidence | Assessment itself (median) |
|---|---|---|---|---|
| G1 2026 PDF | 782 / 804 / 893 | 318 / 573 / 1,348 | 612, then 1,152 | 27.6 ms |
| G2 2025 PDF | 1,124 / 1,142 / 1,302 | 696 / 731 / 854 | 883, then 1,572 | 42.9 ms |
| G3 screenshot | about 0 | -100 / -8 / 90 (noise around zero) | 934, then 922 | 0.1 ms |
| Tampered screenshot | about 0 | -225 / 33 / 124 (noise around zero) | 792, then 793 | 0.2 ms |
So the tampering checks add **about 0.6 to 0.7 s per PDF warm (medians 573 and 731 ms) and about 0.8 to 1.1 s cold**, nearly all of it the OCR of the rendered
page; **about nothing for images** (the assessment takes 0.1 to 0.2 ms; the negative figures are noise, and the cold negatives are an ordering
artefact: in measure mode the extraction without evidence runs first and pays the OCR engine start-up). A 100-PDF batch would take roughly 1 to 1.2 minutes longer.
OCR crop-size change (C-017), same machine: render OCR on a PDF warm 1.5 to 2.0 s before, 0.44 to 1.4 s after.

**Changes to earlier phases (Phase 2 code; no earlier entry is edited):**
- `ocr.js`: crops are scaled to the pixel sizes the OCR was tuned at instead of fixed zoom factors (C-017); on a 1054 px image nothing changes.
- `ocr.js`: the 8 s per-certificate budget NO LONGER includes the one-time engine start-up, which has its own 30 s limit
  (`OCR_WORKER_START_BUDGET_MS`) (C-018). Phase 2's progress entry says the budget includes start-up; that is superseded here.
- `index.js`/`pdf.js`: `evidence` option, `fileKind`, `info` (all additive).
- `playwright.config.js`: `workers: 1` and the 60 s timeout.

**Decisions to review (rule 11):**
1. **Name and course edits on a SCREENSHOT are not flagged** (OCR text is never a mismatch, rule 6): such a certificate gets at worst a tolerated
   `not_confirmed`. Marks edits are caught (`marks_match`); a changed name with the same marks is not. See Known issue 3.
2. An OCR-read roll number that does not match the QR ID is `not_confirmed`, not `fail` (OCR turns S into 5, C-011).
3. "Not checked" when none of name, course and marks could be compared, or when at least half of the applicable checks are `not_confirmed`
   (the plan only says "a minority" is tolerated; "at least half" is my reading).
4. Any `fail` wins, even with NPTEL unreachable (an edited text layer is detected without NPTEL).
5. `metadata` fails if ANY earlier Producer left behind by an incremental update is on the denylist, not only the current one.
6. The ModDate threshold (1 day) and the name/course bounds are uncalibrated (no genuine ModDate or genuine OCR difference exists).

**Remaining work:** none for Phase 4. Nothing calls `assessTampering` outside the dev page yet: wiring it into the run (Phase 7), the
saved results and counts (Phase 6) and the CSV mapping (`Not checked` is written as `No tampering detected`, with the reason in Remarks) come later.

**Known issues / TODOs:**
| # | Item | Priority | Blocking |
|---|---|---|---|
| 1 | The basis is small: 2 genuine PDFs (2 sessions, 2 generators) and 1 genuine screenshot. Thresholds not calibrated on a genuine sample: ModDate gap, every denylist entry (only absence from G1 and G2 is known), the name/course OCR bounds, the linearized baseline, and the `/noc/E_Certificate/` roll-prefix rule (one genuine sample). Collect 5 to 10 more genuine certificates, with at least one carrying a ModDate | High | Phase 10 pilot |
| 2 | False-positive risks that no sample can rule out: NPTEL changes generator between sessions and its 2026 file looks post-processed, so a future genuine file could carry a denylisted tool (for example Acrobat) or be digitally signed (a signature is an incremental update). Unknown Producers never flag, so a NEW editor evades the denylist | High | Phase 10 pilot |
| 3 | A changed NAME or COURSE on a screenshot or JPG is not flagged (decision 1), and Verification only compares marks. A forged image with the right marks and another name passes every check | High | Phase 10 pilot |
| 4 | Each PDF costs about 0.6 to 0.7 s warm (0.8 to 1.1 s cold) for the render OCR. In a 100-PDF batch that is over a minute | Medium | Phase 7 |
| 5 | `layer_vs_render` needs the page layout the OCR understands (printed boilerplate and the 4-cell table with borders). Other layouts give `not_confirmed`, so they are not checked, never flagged | Medium | Phase 10 pilot |
| 6 | The OCR time budget is wall-clock: on a slow or busy device it fires (C-018, reproduced by running 3 browsers in parallel). Phase 7's 3 to 4 certificates at once must be measured; the budget or the concurrency may have to adapt | Medium | Phase 7 |
| 7 | The raw metadata scan reads the file as a Latin-1 string (27 to 43 ms for 0.9 to 1.5 MB). An Info dictionary inside a compressed object stream is only seen through the pdf.js fallback, which has not been exercised on a real file | Low | None |
| 8 | A PDF with an incremental update, or a Producer on the denylist, is flagged even if the content is untouched. By design, but an honest edit (for example adding an annotation) would be flagged too | Low | None |
| 9 | The e2e suite needs the gitignored `samples/` and the NPTEL-served 2025 PDF in `samples/derived/`, and runs with one worker (about 2 minutes) | Low | None |
| 10 | The OCR crop-size change was verified on the two genuine PDFs at 3,200 px and on the 1054 px images, not on large phone photos | Low | Phase 10 pilot |
| 11 | `CLAUDE.md` "Known facts" still says the Jul to Sep 2026 sample has no Producer; NOTES.md §1.1 and §6 record that it has `MuPDF 1.28.2` in a Catalog-level Info dictionary | Low | None |

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