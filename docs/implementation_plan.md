# Implementation Plan — VeriCert

Production website for bulk NPTEL certificate verification at PICT.
Stack: Next.js (JavaScript) on Vercel, MongoDB Atlas, Auth.js, Tailwind. See `CLAUDE.md` for
the rules, which apply to every phase.

**How to use this plan:** work one phase at a time, in order. Each phase lists its goal,
scope, data or API contracts, tests, and acceptance criteria. A phase is complete only
when every acceptance item is met and `docs/progress.md` has been updated. Then stop for
review.

**Critical path:** Phases 0 → 3 prove the core works (read a certificate, verify it against
NPTEL). If NPTEL can't be fetched reliably from a server (Phase 0/3), stop. That changes the
product design (see Contingency at the end).

---

## External accounts the user must set up (Claude Code guides, the user clicks)
| Service | Needed by | What |
|---|---|---|
| GitHub repo | Phase 1 | `VeriCert`, private to start |
| Vercel (Hobby) | Phase 1 | Import the repo; preview deploys on every push |
| MongoDB Atlas (M0, Mumbai) | Phase 1 | Cluster, database user, network access `0.0.0.0/0` (Vercel has no fixed IPs; access is protected by credentials and TLS) |
| Google Cloud OAuth client | Phase 5 | OAuth consent screen (internal or external), redirect URIs for localhost and Vercel |
| Resend | Phase 5 | API key; verify a sending domain, or use the Resend test domain until a domain exists |

Environment variables (all in `.env.example`, set in Vercel for Preview and Production):
`MONGODB_URI`, `MONGODB_DB`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_GOOGLE_ID`,
`AUTH_GOOGLE_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `ALLOWED_EMAIL_DOMAIN=pict.edu`,
`ADMIN_EMAILS` (comma-separated), `RATE_LIMIT_VERIFY_PER_MIN`, `RESULT_RETENTION_DAYS`.

---

## Data model (MongoDB, database `vericert`)

Auth.js adapter collections, managed by the adapter: `users`, `accounts`, `sessions`,
`verification_tokens`.

App-added fields on `users`: `passwordHash` (credentials users only), `role`
(`"user" | "admin"`, derived from `ADMIN_EMAILS` at sign-in), `disabled` (bool),
`createdAt`, `lastLoginAt`.

**`runs`**: one per verification batch.
```js
{ _id, userId, createdAt, completedAt, status: "running"|"completed"|"partial",
  counts: { total, successful, unsuccessful, error, tamperingDetected },
  durationMs, appVersion }
```
Indexes: `{ userId: 1, createdAt: -1 }`; TTL on `createdAt` (`RESULT_RETENTION_DAYS`,
default 180).

**`results`**: one per certificate.
```js
{ _id, runId, userId, fileName, certificateId, verifyUrl,
  candidateName, courseName, assignment, exam,            // from the uploaded certificate
  source: { name, course, assignment, exam, total },      // from NPTEL
  verification: "Successful"|"Unsuccessful"|"Error",
  tampering: "No tampering detected"|"Tampering detected"|"Not checked",
  checks: [{ id, outcome: "pass"|"fail"|"not_confirmed"|"not_applicable", detail }],
  remarks, createdAt }
```
Indexes: `{ runId: 1 }`, `{ userId: 1, createdAt: -1 }`, text index on `candidateName`;
TTL as above.

**`audit_logs`**: append-only. `{ userId, action, target, meta, ip, createdAt }`.
Actions: `login`, `login_rejected_domain`, `run_created`, `run_deleted`,
`csv_exported`, `admin_viewed_user`, `user_disabled`. TTL 365 days.

**`rate_limits`**: `{ key, windowStart, count }` with TTL. Used for fixed-window limiting.

No certificate files, images or OCR text are ever stored.

---

## Phase 0 — Specification check and samples
**Goal:** confirm that the known facts in CLAUDE.md still hold before writing app code.

**Scope**
- Inspect every file in `samples/`: text layer present? QR location? exact text patterns?
  PDF metadata (Producer, Creator, CreationDate, ModDate, `%%EOF` count, xref count)?
- Decode each QR code. Fetch each verification URL with a small Node script (browser
  headers, one retry). Save the raw responses: the HTML and the linked certificate PDF.
- Record where every field lives on the verification side, including the
  `E_Certificate` URL shape.
- Create anonymised fixtures in `tests/fixtures/`: extracted text, verification HTML and a
  verification PDF text dump. Include synthetic variants: decimal marks, a long name, a
  Devanagari name, a long course name, edited marks, and a tampered-metadata PDF.
- Write `NOTES.md`: findings, the URL shapes, genuine metadata values, and every
  assumption you couldn't confirm.

**Acceptance**
- `NOTES.md` covers every sample, with the observed (not assumed) values.
- Every fact in CLAUDE.md's "Known facts" section is marked confirmed, changed or
  unconfirmed in progress.md.
- **Gate:** if NPTEL can't be fetched from a script at all, stop and report. Don't start
  Phase 1.

---

## Phase 1 — Project foundation
**Goal:** a deployable, empty, well-structured app with a live database connection.

**Scope**
- Next.js App Router in JavaScript, Tailwind configured from `DESIGN.md` tokens, ESLint,
  Prettier.
- `.gitignore`: `node_modules/`, `.next/`, `.vercel/`, `coverage/`, `playwright-report/`,
  `test-results/`, `.env*` (but not `.env.example`), `samples/`, `tmp/`, `*.csv` (except
  `tests/fixtures/**`), OS and editor files. `.gitattributes`: `*.pdf binary`,
  `*.png binary`, `*.jpg binary`.
- `src/lib/db/client.js`: a cached MongoClient, failing loudly if `MONGODB_URI` is
  missing. `indexes.js`: an idempotent `ensureIndexes()` for every index in the data model,
  run via `npm run db:indexes`.
- `GET /api/health`: `{ ok, db: "up"|"down", version }`. Pings the database.
- Vitest and Playwright set up with one smoke test each. GitHub Actions CI runs lint, unit
  tests and build on every push.
- `.env.example`, a README skeleton, `docs/progress.md`, `docs/challenges-log.md`.
- Connect the repo to Vercel. A preview deploy succeeds and `/api/health` returns
  `db: "up"`.

**Acceptance**
- `npm run build` and `npm test` pass, and CI is green.
- The preview URL's `/api/health` reports the database as up, which proves Atlas network
  access works from Vercel.
- `git status` shows nothing from `samples/` or `.env`.

---

## Phase 2 — Certificate extraction engine (browser)
**Goal:** from an uploaded file, reliably get `{ name, course, assignment, exam, verifyUrl,
certificateId, rollNo? }`.

**Scope** (`src/lib/extract/`)
- `pdf.js`: load the PDF (copy the bytes first, because of the detached buffer), render
  page 1 at about 3x, and read the text layer.
- `qr.js`: try jsQR on the full page. If that fails, try zxing-wasm. If that fails, upscale
  the likely QR regions 2–3x with greyscale and thresholding, and retry. Return the URL or
  a specific failure reason.
- `ocr.js`: tesseract.js in a worker, loaded only when needed. Crops only: the name
  region, the marks region (character whitelist of digits and `/`), and the course region.
  Per-certificate budget of 8 seconds; exceeding it means "not confirmed (timeout)".
- `parse.js`: regex anchored on the `n/25` and `n/75` patterns. Normalise whitespace,
  case and Unicode (NFC). Tolerate OCR slips (O→0, l/I→1, S→5, spaces around `/`). Range
  checks: assignment 0–25, exam 0–75. A value outside the range is a parse error.
- Images (JPG/PNG): same pipeline, without a text layer, so OCR crops plus QR.

**Tests**
- Unit tests for `parse.js` against every fixture variant, including the OCR-slip and
  Devanagari cases.
- Playwright on a scratch page that runs extraction on the real samples in a real browser.
  This is the test that caught the detached-buffer bug.

**Acceptance**
- Both real samples extract correctly in the browser. The JPG either extracts or fails
  with a specific reason.
- Measured extraction time per sample is recorded.

---

## Phase 3 — Verification service (server) and comparison
**Goal:** given a QR URL, return NPTEL's authoritative values. Compare them with the
certificate.

**Scope**
- `POST /api/verify` with body `{ url }` returns
  `{ source: { name, course, assignment, exam, total }, error? }`.
  - Host allowlist, checked on every redirect hop (`redirect: "manual"`, follow up to 5
    hops yourself). Browser headers, one retry on 5xx, an 8-second timeout per attempt
    and 20 seconds in total.
  - Fetch the verification page, find the linked certificate PDF, fetch it, and extract
    its text **on the server** (unpdf). Parse it with the same `parse.js` rules (shared
    module). Return only the fields, never the PDF. This avoids Vercel's 4.5 MB response
    limit.
  - If the source PDF has no text layer, return `error: "source_unreadable"` (no
    server-side OCR in v1; log it in challenges-log if it happens).
  - Handle both the `verify/<ID>` and `noc/E_Certificate/…` shapes.
  - Set `export const maxDuration` to fit the Vercel Hobby limit, and record the value in
    progress.md.
  - **Temporarily unauthenticated in this phase**, but enabled only when
    `NODE_ENV !== "production"`. Phase 5 adds auth. Note this in progress.md.
- `src/lib/compare.js`: marks equal within 0.01 means `Successful`; otherwise
  `Unsuccessful`; any missing side means `Error` with a reason. Compare name and course
  after normalisation and record them as check results. They do not affect Verification.
- A small in-memory cache per request batch so the same URL isn't fetched twice.

**Tests**
- Unit tests with mocked `fetch`: allowlist rejection, redirect to a non-NPTEL host
  rejected, 500 then 200 retry, timeout, both URL shapes, and parsing the source PDF
  fixture.
- A live smoke script (`npm run smoke:nptel`, not part of CI) against the real sample
  URLs.

**Acceptance**
- The live smoke test gets correct values for both samples from a **Vercel preview
  deployment**, not just localhost, which proves NPTEL accepts requests from Vercel's IPs.
- Measured latency (p50 and max) is recorded.
- **Gate:** if NPTEL blocks Vercel, stop and report (see Contingency).

---

## Phase 4 — Tampering checks
**Goal:** a `Tampering` verdict independent of Verification, with no false alarms on
genuine certificates.

**Checks** (each returns `pass | fail | not_confirmed | not_applicable` plus a detail):
1. `id_match`: the certificate ID in the QR URL matches the ID or roll number printed on
   the certificate, where the format makes that comparable (otherwise `not_applicable`;
   document why).
2. `name_match` and `course_match`: certificate against the NPTEL source, after
   normalisation.
3. `marks_match`: certificate marks against the source.
4. `layer_vs_render` (PDF only): the text-layer values against OCR of the same crops. A
   mismatch counts only if the OCR output is well-formed and clearly different. Unreadable
   OCR is `not_confirmed`.
5. `metadata` (PDF only): ModDate meaningfully after CreationDate, a Producer or Creator
   on the known-editor denylist (from `config.js`), or more than one `%%EOF` or xref
   section (incremental update). An unknown Producer is noted, not flagged.

**Verdict:** any `fail` gives `Tampering detected`. If every check is `pass`,
`not_applicable` or a minority `not_confirmed`, the verdict is `No tampering detected`. If
the core checks (2 and 3) couldn't run, the verdict is `Not checked`.

**Acceptance**
- Both genuine samples give `No tampering detected`.
- A metadata-tampered fixture and an edited-text-layer fixture both give
  `Tampering detected`, naming the failing check.
- Every threshold is in `config.js`, with a comment citing the sample that justifies it.

---

## Phase 5 — Authentication
**Goal:** only verified `@pict.edu` users can sign in. Everything else is refused on the
server.

**Scope**
- Auth.js with the MongoDB adapter. Session strategy: database sessions (they can be
  revoked, and support "disable user").
- **Google provider:** `hd=pict.edu` as a hint only. In the `signIn` callback, require
  `profile.email_verified === true` and an email ending exactly in `@pict.edu`. Otherwise
  refuse, and write an `audit_logs` entry with action `login_rejected_domain`.
- **Credentials provider (email/password):**
  - Signup: check the domain, a password policy (10+ characters; check against a small
    common-password list), and hash with bcrypt (cost 12).
  - Send a verification email through Resend, with a single-use token that expires after
    24 hours, stored hashed.
  - Login is refused until the email is verified. Generic error messages, so the form
    doesn't reveal whether an account exists.
  - Password reset: a single-use reset token, valid for 1 hour, stored hashed.
  - Throttle signup, login and reset attempts per IP and per email using `rate_limits`.
- `middleware.js`: protects `/dashboard`, `/history`, `/admin` and `/api/*` (except
  `/api/auth/*` and `/api/health`).
- `src/lib/auth/guards.js`: `requireUser()` and `requireAdmin()` for route handlers. They
  re-check the domain and the `disabled` flag on every request (rule 2, defence in depth).
- `/api/verify` now requires `requireUser()`. Remove the Phase 3 dev-only exception.
- Pages: `/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password`,
  styled per DESIGN.md.
- Account linking: if a credentials user later signs in with Google using the same
  verified @pict.edu email, link the accounts. Never link across different emails.

**Tests**
- Unit tests for the domain check: valid address, uppercase, look-alikes, subdomains,
  leading and trailing spaces, and a `+` alias.
- Route tests: no session, wrong domain, disabled user and unverified email are all
  rejected with 401 or 403.
- Playwright for credentials signup, verification (read the token from a test mailbox or
  a dev-only stub), login, logout and password reset.

**Acceptance**
- A manual test on the preview URL: a @pict.edu Google account gets in, a Gmail account
  is refused, and the refusal is in `audit_logs`.
- `curl` to `/api/verify` without a session returns 401.

---

## Phase 6 — Persistence and history
**Goal:** every run is saved to the user's account and can be reopened and re-exported.

**Scope**
- `POST /api/runs` creates a run and returns its `runId`.
  `POST /api/runs/:id/results` saves results in batches of up to 50. The schema is
  validated server-side (reject unknown fields, enforce enums and ranges), and the run
  must belong to the user.
  `PATCH /api/runs/:id` completes a run and saves its counts.
- `GET /api/runs` (paginated) and `GET /api/runs/:id`, which returns the run and its
  results. `DELETE /api/runs/:id` deletes the run and its results, and is audited.
- `GET /api/runs/:id/csv` generates the CSV on the server from saved results, and is
  audited.
- A user manually enters marks for an unreadable certificate with `PATCH /api/results/:id`,
  which recomputes Verification and Tampering, sets `manualEntry: true`, and is audited.
- Repository functions in `src/lib/db/repos/` take `userId` as a required argument (rule
  4). There are no unscoped helpers.
- Retention: TTL indexes, with the period shown in the UI and the privacy notice.

**Tests**
- Repository tests against a test database (mongodb-memory-server, or a separate Atlas
  test database): user A can never read, delete or export user B's run.
- Validation tests for each endpoint.

**Acceptance**
- A run of the samples saves, reloads after a browser refresh, re-exports an identical
  CSV, and deletes cleanly.
- The cross-user access test passes.

---

## Phase 7 — Dashboard UI
**Goal:** the full user experience, per DESIGN.md.

**Scope**
- `/dashboard`:
  - Upload area: drag-and-drop a folder (`webkitdirectory`) or select multiple files.
    Accept PDF, JPG and PNG, and list skipped files with the reason.
  - "Start verification" processes 3–4 certificates at once, with an overall progress bar
    and per-row status (queued, extracting, verifying, checks, done). Results are saved to
    the database as they finish.
  - Summary cards: Total, Successful, Unsuccessful, Errors, Tampering detected.
  - Results table: Name, Course, Assignment /25, Exam /75, a Verification badge and a
    Tampering badge.
  - Filters for Verification and Tampering that combine with each other, plus a
    case-insensitive candidate-name search.
  - Row detail drawer: certificate values against NPTEL values, each check with its
    outcome, the file name, the NPTEL link, and the manual-entry form for Error rows.
  - Download the filtered view or all results as CSV.
  - A warning before leaving the page while a run is in progress.
- `/history`: a list of past runs (date, counts, duration), each opening the same results
  view. Delete has a confirmation step.
- Header: the user's email, links to History and (for admins) Admin, and Logout.
- Responsive from 1280 px laptops to projectors. Keyboard accessible. Badges never rely
  on colour alone.

**Tests**
- Playwright: log in, upload the samples, check the counts, filters, search, detail
  drawer, CSV contents (BOM and exact header), history reload and delete.
- Save screenshots for review in `tmp/shots/` (gitignored).

**Acceptance**
- The user reviews the screenshots against DESIGN.md and approves them.
- A measured end-to-end time for the sample batch is recorded.

---

## Phase 8 — Admin, security hardening, abuse protection
**Scope**
- `/admin` (`requireAdmin`): a user list (email, created, last login, number of runs,
  disabled flag) with disable and enable; site-wide totals (runs and certificates per
  week); an audit-log viewer with filters. Admins can see run metadata but not individual
  results, unless the action is audited as `admin_viewed_user`.
- Rate limiting: `/api/verify` is limited per user (`RATE_LIMIT_VERIFY_PER_MIN`, default
  60/min) and per IP. Return 429 with a `Retry-After` header. This protects NPTEL from
  being flooded through our site.
- Security headers via `next.config.js`: a strict CSP (allow pdf.js and tesseract workers
  and their wasm explicitly), HSTS, `X-Content-Type-Options`, `Referrer-Policy`,
  `frame-ancestors 'none'`.
- Input limits: maximum file size (e.g. 10 MB), maximum files per run (e.g. 500), and
  request body limits on every API route.
- Dependency audit (`npm audit`); fix high and critical issues or document why not.
- Error handling: one error format for all APIs, no stack traces in production
  responses, and structured server logs without personal data.

**Acceptance**
- A non-admin gets 403 on every admin route. A disabled user is signed out on their next
  request.
- A rate-limit test shows 429 after the threshold.
- securityheaders.com (or an equivalent check) gives the preview URL an A.

---

## Phase 9 — Public pages, privacy, accessibility
**Scope**
- `/`: a landing page explaining what the tool does, who can use it (PICT staff), how
  verification works, and a sign-in button.
- `/help`: how to use the tool, supported formats, what each verdict and check means,
  and what to do when a certificate shows Error.
- `/privacy`: covers the DPDP Act. It explains that certificates are processed in the
  browser and never uploaded, what is stored (extracted fields, verdicts, account
  information), the retention period, how users can delete their runs, and a contact
  email. Have PICT's administration review it; Claude drafts and the user approves.
- `/terms`: a short acceptable-use statement.
- Footer links, a 404 page, an error page.
- Accessibility pass: labels, focus order, contrast per DESIGN.md, screen-reader text on
  badges. Run axe through Playwright with no serious violations.

**Acceptance**
- The pages are reviewed by the user. axe reports no serious or critical issues.

---

## Phase 10 — Production launch
**Scope**
- Production environment variables in Vercel. Production Google OAuth redirect URIs.
  Resend sending domain verified (or the documented test-domain limitation accepted).
- Optional custom domain, such as `verify.pict.edu`. This requires a DNS record from PICT
  IT, so document the request.
- Atlas: check backup options on M0 (limited). Add `npm run db:export`, a script that
  dumps runs and results to JSON for manual backups, and document it in the runbook.
- Monitoring: Vercel logs and analytics, plus a free error tracker (e.g. Sentry free tier)
  with personal data scrubbed. Set up uptime checks on `/api/health`.
- Pilot: real staff use it with a real batch of 50+ certificates. Measure throughput, the
  error rate by reason, and the tampering false-positive rate. Fix anything found.
- README: setup, environment variables, deploy, architecture diagram, how to update the
  parsers if NPTEL changes its format. `docs/runbook.md`: rotating secrets, disabling a
  user, NPTEL format changes, database full, NPTEL down.

**Acceptance**
- The production URL works end to end for a real PICT user.
- Pilot measurements are recorded in progress.md.
- The runbook is reviewed by the user.

---

## Contingency: if NPTEL blocks server-side fetches
If Phase 0 or Phase 3 shows that NPTEL refuses requests from scripts or Vercel even with
normal browser headers, **don't work around it.** Switch to assisted verification:
1. The app still extracts everything and decodes the QR code.
2. Each row gets an "Open on NPTEL" button. The user views the page in their own browser
   and either confirms the marks match (one click) or uploads the NPTEL certificate PDF
   they downloaded, which the app parses in the browser.
3. The tampering checks that don't need the source (`metadata`, `layer_vs_render`) still
   run automatically.

This needs user approval before it replaces Phase 3.