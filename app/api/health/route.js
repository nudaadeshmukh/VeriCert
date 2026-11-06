// GET /api/health -> { ok, db: "up" | "down", version }
// Public on purpose (uptime checks, deploy verification). It reveals nothing but the
// up/down state and the build version, and it never echoes error text.
import { NextResponse } from 'next/server';
import { getDb } from '../../../src/lib/db/client.js';
import { APP_VERSION_FULL } from '../../../src/lib/version.js';

// Never cache or prerender: this must reflect the database right now.
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET() {
  let db = 'down';
  try {
    const database = await getDb();
    await database.command({ ping: 1 });
    db = 'up';
  } catch (err) {
    // Fail closed: any problem (missing env var, bad credentials, network, timeout) reports
    // "down". Log the error class only; messages can carry host names.
    console.error(
      JSON.stringify({ event: 'health_db_down', error: err?.name ?? 'Error', code: err?.code ?? null }),
    );
  }
  const ok = db === 'up';
  return NextResponse.json(
    { ok, db, version: APP_VERSION_FULL },
    { status: ok ? 200 : 503, headers: NO_STORE },
  );
}
