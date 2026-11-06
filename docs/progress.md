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
| **Current phase** | Phase 0 complete, awaiting user approval. |
| **Next phase** | Phase 1: Project foundation (needs the user's GitHub, Vercel and MongoDB Atlas setup) |
| **Production URL** | — |
| **Preview URL** | — |
| **Does it run?** | No app yet. Only repo hygiene, fixtures and findings (`NOTES.md`). |
| **Latest measured results** | NPTEL verification pages: 0/20 retries needed; median 135 ms (shape A), 77 ms (shape B), from the dev machine. Not yet measured from Vercel. |

| Phase | Status |
|---|---|
| 0 — Specification check and samples | ✅ complete (gate passed from a local script) |
| 1 — Project foundation | ⏳ not started |
| 2 — Certificate extraction engine | ⏳ not started |
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