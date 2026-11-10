// Shared wrapper of the credentials routes (app/api/auth/account/*): cross-site check, small JSON body, database, client IP,
// the flow, and (for sign-in) the session cookie. Any unexpected failure is a generic 503 (rule 5), never a pass, never a stack trace.
import { getDb } from '../db/client.js';
import { clientIp } from './audit.js';
import { json, jsonError, readJsonBody, rejectCrossSite } from './http.js';
import { sessionCookieName, sessionCookieOptions } from './session.js';

/**
 * @param {Request} request
 * @param {(c: { db: import('mongodb').Db, ip: string, body: Record<string, unknown> }) => Promise<import('./flows.js').FlowResult>} run
 */
export async function handleAccountPost(request, run) {
  const cross = rejectCrossSite(request);
  if (cross) return cross;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  try {
    const db = await getDb();
    const result = await run({ db, ip: clientIp(request.headers), body: parsed.body });
    const response = json(result.body, result.status, result.headers);
    if (result.session) {
      response.cookies.set(
        sessionCookieName(),
        result.session.sessionToken,
        sessionCookieOptions(result.session.expires),
      );
    }
    return response;
  } catch (err) {
    console.error(JSON.stringify({ event: 'account_route_failed', error: err?.name ?? 'Error' }));
    return jsonError('unavailable', 'The service is not available right now. Please try again later.', 503);
  }
}
