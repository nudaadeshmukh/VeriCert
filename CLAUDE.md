# CLAUDE.md — VeriCert

Standing context for Claude Code. Read this at the start of every session, in this order:
1. `docs/progress.md`: what already exists and which phase is next.
2. This file: the rules.
3. `docs/implementation_plan.md`: the section for the current phase only.
4. `DESIGN.md`: before any UI work.

## What this is
**VeriCert** (repo: `VeriCert`): PICT · NPTEL Certificate Verification.
A production website used by PICT staff to verify NPTEL certificates in bulk. A signed-in
user uploads a folder of certificates (PDF, JPG, PNG). For each certificate the app:
- reads the candidate name, course, assignment marks (/25) and exam marks (/75);
- decodes the verification QR code and fetches NPTEL's verification source;
- compares the marks;
- runs tampering checks.

The results show on a dashboard, are saved to the user's history, and can be exported as
CSV. Only verified `@pict.edu` accounts can use it.

**This is a real site with real users and real student data.** Correctness, security and
privacy outrank speed of delivery.

## Stack (fixed; do not change without asking)
- **Language: JavaScript only.** No TypeScript, no `.ts`/`.tsx` files, no tsconfig. Use
  `.js`/`.jsx` (ES modules), with JSDoc comments where types help.
- **Framework:** Next.js (App Router), deployed on **Vercel**. Pages, API route handlers
  and middleware all live in one app.
- **Database:** **MongoDB Atlas** (free M0 cluster, region Mumbai `ap-south-1`) through the
  official `mongodb` driver. Cache one client across invocations (the standard Next.js
  `global._mongoClientPromise` pattern). No Mongoose unless the plan says so.
- **Auth:** Auth.js (NextAuth) with the MongoDB adapter: a Google provider, plus an
  email/password provider (bcrypt) with email verification. Send transactional email
  through Resend (free tier).
- **Styling:** Tailwind CSS, following `DESIGN.md`.
- **Certificate processing** (in the browser): `pdfjs-dist`, `jsQR` with `zxing-wasm` as a
  fallback, and `tesseract.js` for OCR fallback.
- **Server-side PDF text** (for NPTEL's own certificate PDF): `unpdf` or the pdfjs legacy
  Node build.
- **Tests:** Vitest (unit), Playwright (browser end to end).
- **CSV:** `papaparse`.

Pin every dependency to an exact version. Record the versions in `docs/progress.md`.

## Non-negotiable rules
1. **Uploaded certificate files never leave the browser.** Only the verification URL,
   extracted fields and check results reach the server. Never store certificate files or
   images in MongoDB or in logs.
2. **Domain enforcement is done on the server.** Every API route and protected page checks
   the session server-side: the email must end in exactly `@pict.edu` (case-insensitive)
   and be verified. Reject look-alikes (`@pict.edu.x.com`, `@notpict.edu`). Client-side
   checks are only for UX.
3. **The outbound fetch is allowlisted.** The server fetches only `nptel.ac.in` and
   `*.nptel.ac.in`, and re-checks the host on every redirect hop. Use browser headers, a
   retry and timeouts. Never add captcha solving, proxies or other evasion.
4. **Users see only their own data.** Every database query for runs or results filters by
   the session's user ID. Admin access is a separate, explicitly checked code path.
5. **Fail closed.** Missing environment variables, an unverifiable session or a database
   error result in a refusal, never a silent pass.
6. **No third state for verdicts.** Verification is `Successful`, `Unsuccessful` or
   `Error` (with a reason). Tampering is `No tampering detected`, `Tampering detected` or
   `Not checked` (with a reason). An unreadable value is never treated as a match or as
   tampering. It is "not confirmed", and the row says why.
7. **Tampering heuristics must be justified by genuine samples.** Never flag a signal you
   haven't confirmed against a known-genuine certificate. Put every threshold in
   `src/lib/tamper/config.js` with a comment explaining it.
8. **Don't build ahead.** Implement only the current phase's scope. If something from a
   later phase is genuinely needed early, build the narrowest piece and log why in
   `docs/progress.md`.
9. **Never commit secrets or real student data.** `.env*` (except `.env.example`),
   `samples/` and exported CSVs are gitignored. Test fixtures are anonymised. PDFs are
   marked binary in `.gitattributes`.
10. **Measured numbers only.** Never record a timing, count or accuracy figure in the docs
    that you didn't actually measure.
11. **Ask, don't guess.** If the plan is ambiguous or contradicts what you observe (for
    example, NPTEL's format has changed), stop and ask. Don't decide silently.
12. **Test in a real browser.** Node unit tests can't catch browser-only bugs (see Known
    facts). Every phase that touches browser code ends with a Playwright run.
13. **Never commit or push.** Do not run `git commit`, `git push`, or any command that
    changes the remote (including creating or deleting remote branches or tags, and
    `gh`/API calls that write to GitHub). The user makes all commits and pushes. Read-only
    git commands (`status`, `diff`, `log`, `ls-remote`) are fine. Instead, suggest a commit message at the
    end of each phase.
14. **Work only on the `temp` branch.** The user merges to `main` through a pull request
    after approving a phase. At the start of every session, and before starting any work, run
    `git branch --show-current`. If it is not `temp`, stop and tell the user. Never switch,
    create or delete branches yourself.

## Result semantics
- **Verification:** `Successful` when both marks equal the verification source (tolerance
  0.01; decimals allowed). `Unsuccessful` when they differ. `Error` when the QR can't be
  decoded, the source can't be reached or the marks can't be parsed.
- **Tampering:** independent of Verification. The checks are listed in the plan (Phase 4).
- **CSV columns, in this order:**
  `Candidate Name, Course Name, Assignment Marks (/25), Exam Marks (/75), Verification, Tampering, Remarks`
  - Marks are the values printed on the uploaded certificate.
  - CSV-only mapping: `Error` rows are written as `Unsuccessful`, and `Not checked` as
    `No tampering detected`, with the reason in Remarks in both cases.
  - UTF-8 with a BOM; formula-injection guard (prefix `'` to cells starting with
    `= + - @`).

## Known facts from the previous build (re-verify in Phase 0; NPTEL may have changed)
- The PDF's text layer has the name, course, `n/25`, `n/75` and roll number, but **no
  labels** such as "Online Assignments". Parse the marks from the `n/25` and `n/75`
  patterns.
- The QR code in the PDF points to `nptel.ac.in/verify/<ID>`, which redirects to
  `beta.nptel.ac.in/verify/<ID>`. The first request sometimes returns HTTP 500; a retry
  with browser headers returns 200.
- The verification page shows only the name, course and total (e.g. 91/100). **The
  assignment and exam marks are only in the certificate PDF the page links to.**
- QR codes on images can be small (around 55 px). Decoding needs a 2–3x upscale.
- An older or alternate URL shape exists: `nptel.ac.in/noc/E_Certificate/…`.
- Genuine PDF metadata: the Jan–Apr 2025 sample has Producer `FPDF 1.81` and a
  CreationDate. The Jul–Sep 2026 sample has neither. Each has exactly one `%%EOF`.
- **pdf.js detaches the ArrayBuffer** when it hands it to its worker. Copy the bytes
  (`bytes.slice()`) before any second use, such as the metadata scan.
- OCR misreads names (a name came out as "7"). Treat malformed OCR output as "not
  confirmed", never as a mismatch.
- Devanagari vowel signs are combining marks. Name normalisation and "is this a real
  name" checks must handle Unicode properly.
- Full-page OCR on near-blank PDFs took about 30 seconds each. OCR only small crops, under
  a per-certificate time budget.

## Repository layout (target)
```
app/                      Next.js routes (pages, api/, (auth)/, dashboard/, admin/)
src/lib/extract/          pdf.js, qr.js, ocr.js, parse.js        (browser)
src/lib/verify/           fetchSource.js, parseSource.js         (server)
src/lib/tamper/           checks.js, config.js
src/lib/compare.js, csv.js
src/lib/auth/             auth config, domain check, session guards
src/lib/db/               client.js, collections.js, indexes.js, repos/*.js
src/components/           UI components
tests/unit/, tests/fixtures/, e2e/
docs/progress.md, docs/challenges-log.md, docs/implementation_plan.md, NOTES.md
DESIGN.md, CLAUDE.md, README.md, .env.example
```

## Commands
- `npm run dev`: local dev server
- `npm test`: Vitest
- `npm run test:e2e`: Playwright
- `npm run lint`: ESLint and Prettier check
- `npm run build`: production build (must pass before any phase is marked complete)
- `vercel` / `vercel --prod`: deploy (only when the plan's phase says so)

## End-of-phase routine (every phase)
1. All tests pass (unit, plus e2e where relevant), and lint and build are clean.
2. Run the phase's acceptance checks from the plan, with real data where possible.
3. Append the phase entry to `docs/progress.md` (format defined in that file) and update
   its "Current state" table.
4. Log anything that broke or surprised you in `docs/challenges-log.md` as you go, not at
   the end.
5. Run `git status`, confirm that `samples/`, `.env` and real data are not staged, and
   suggest a commit message. Do not commit.
6. **Stop, and give the user a short status:** done, measured, known issues, next phase.
   Wait for approval before starting the next phase.