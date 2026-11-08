// `npm run smoke:nptel` — LIVE test against NPTEL. Not part of CI (it needs the network and the
// private sample URLs).
//
//   npm run smoke:nptel                                   verify directly from THIS machine
//   npm run smoke:nptel -- --base-url=https://<deployment>.vercel.app
//                                                          POST to that deployment's /api/verify
//   options: --runs=5 (per certificate)  --gap=1500 (ms between requests, be polite to NPTEL)
//
// The Phase 3 gate is the second form, run against a Vercel Preview: it proves that NPTEL accepts
// requests from Vercel's servers. If NPTEL blocks them, this reports it and exits non-zero; it does
// not retry differently or work around the block (see the plan's Contingency).
//
// Targets and expected values come from `samples/smoke.expected.local.json` (gitignored: real
// certificate URLs and marks). Output never prints names or URLs, only labels, marks and timings.
//
// A Preview is protected by Vercel Authentication. Put the deployment's "Protection Bypass for
// Automation" secret in `.env` as VERCEL_AUTOMATION_BYPASS_SECRET and it is sent as a header.
import fs from 'node:fs';
import path from 'node:path';
import { verifySource } from '../src/lib/verify/index.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);
const runs = Number(args.runs ?? 5);
const gapMs = Number(args.gap ?? 1500);
const baseUrl = args['base-url']?.replace(/\/+$/, '');
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

const file = path.resolve(import.meta.dirname, '../samples/smoke.expected.local.json');
if (!fs.existsSync(file)) {
  console.error('Missing samples/smoke.expected.local.json (gitignored; it holds the real sample URLs).');
  process.exit(2);
}
const { targets } = JSON.parse(fs.readFileSync(file, 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Nearest-rank percentile of a numeric array. */
const pct = (arr, p) => [...arr].sort((a, b) => a - b)[Math.max(0, Math.ceil((p / 100) * arr.length) - 1)];

/** One verification, either directly or through a deployment. */
async function verifyOnce(url) {
  const t0 = performance.now();
  if (!baseUrl) {
    const result = await verifySource(url);
    return { result, clientMs: performance.now() - t0, region: 'local', http: 200 };
  }
  const res = await fetch(`${baseUrl}/api/verify`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
    },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(40_000),
  });
  const clientMs = performance.now() - t0;
  // x-vercel-id is "<edge>::<function region>::<id>" (or "<region>::<id>" when they are the same):
  // the second-to-last part is the region the FUNCTION ran in, which is what the Phase 3 gate records.
  const idParts = (res.headers.get('x-vercel-id') ?? '').split('::');
  const region = idParts.length >= 2 ? idParts[idParts.length - 2] : 'unknown';
  if (
    [301, 302, 307, 308, 401, 403].includes(res.status) &&
    !(res.headers.get('content-type') ?? '').includes('json')
  ) {
    return {
      result: null,
      clientMs,
      region,
      http: res.status,
      blockedBy: 'Vercel Deployment Protection (no valid bypass secret)',
    };
  }
  if (res.status === 404)
    return {
      result: null,
      clientMs,
      region,
      http: 404,
      blockedBy: 'the endpoint is disabled (VERIFY_DEV_ENDPOINT / VERCEL_ENV)',
    };
  let result = null;
  try {
    result = await res.json();
  } catch {
    /* not JSON */
  }
  return { result, clientMs, region, http: res.status };
}

const FIELDS = ['name', 'course', 'assignment', 'exam', 'total'];
let failures = 0;
const allClient = [];
const allServer = [];
const regions = new Set(); // regions the function ran in
console.log(
  `mode: ${baseUrl ? `deployment ${new URL(baseUrl).hostname.replace(/^(.{6}).*(\..*)$/, '$1…$2')}` : 'local (direct from this machine)'}, ${runs} runs per certificate, ${gapMs} ms apart\n`,
);

for (const t of targets) {
  const client = [];
  const server = [];
  let bad = 0;
  let firstMs = null;
  for (let i = 0; i < runs; i++) {
    if (i > 0 || t !== targets[0]) await sleep(gapMs);
    let r;
    try {
      r = await verifyOnce(t.url);
    } catch (err) {
      console.log(`  ${t.label} #${i + 1}: FAIL request error (${err?.name})`);
      bad++;
      continue;
    }
    regions.add(r.region);
    if (r.blockedBy) {
      console.log(`  ${t.label} #${i + 1}: BLOCKED HTTP ${r.http}: ${r.blockedBy}`);
      bad++;
      continue;
    }
    const res = r.result;
    if (!res || res.error || !res.source) {
      console.log(
        `  ${t.label} #${i + 1}: FAIL HTTP ${r.http} error=${res?.error ?? 'no JSON'} (${res?.message ?? ''})`,
      );
      bad++;
      continue;
    }
    const wrong = FIELDS.filter((f) => res.source[f] !== t.expect[f]);
    if (wrong.length) {
      console.log(
        `  ${t.label} #${i + 1}: MISMATCH in ${wrong.join(', ')}` +
          wrong
            .filter((f) => typeof t.expect[f] === 'number')
            .map((f) => ` (${f}: got ${res.source[f]}, want ${t.expect[f]})`)
            .join(''),
      );
      bad++;
      continue;
    }
    firstMs ??= r.clientMs;
    client.push(r.clientMs);
    if (res.meta?.ms !== undefined) server.push(res.meta.ms);
    console.log(
      `  ${t.label} #${i + 1}: ok  ${Math.round(r.clientMs)} ms round trip` +
        (res.meta?.ms !== undefined
          ? `, ${res.meta.ms} ms in verifySource, ${res.meta.requests} fetch attempts`
          : '') +
        `  [${res.meta?.shape}, ${r.region}]`,
    );
  }
  failures += bad;
  allClient.push(...client);
  allServer.push(...server);
  if (client.length) {
    console.log(
      `  → ${t.label}: ${client.length}/${runs} ok. round trip p50 ${Math.round(pct(client, 50))} ms, max ${Math.round(Math.max(...client))} ms, first ${Math.round(firstMs)} ms\n`,
    );
  } else {
    console.log(`  → ${t.label}: 0/${runs} ok\n`);
  }
}

console.log(`function region(s): ${[...regions].join(', ')}`);
if (allClient.length) {
  console.log(
    `ALL: ${allClient.length} ok / ${failures} failed. round trip p50 ${Math.round(pct(allClient, 50))} ms, max ${Math.round(Math.max(...allClient))} ms` +
      (allServer.length
        ? `; inside verifySource p50 ${Math.round(pct(allServer, 50))} ms, max ${Math.round(Math.max(...allServer))} ms`
        : ''),
  );
}
if (failures > 0) {
  console.log(`\nSMOKE FAILED: ${failures} failure(s).`);
  process.exit(1);
}
console.log('\nSMOKE PASSED');
