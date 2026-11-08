// A scriptable fake `fetch` for the server-side verification tests. No network is ever touched.
import fs from 'node:fs';
import path from 'node:path';

const FIX = path.resolve(import.meta.dirname, '../../fixtures');
export const fixture = (rel) => fs.readFileSync(path.join(FIX, rel));
export const fixtureText = (rel) => fixture(rel).toString('utf8');

export const html = (body, init = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });
export const pdf = (bytes, init = {}) =>
  new Response(bytes, { status: 200, headers: { 'content-type': 'application/pdf' }, ...init });
export const redirect = (location, status = 302) => new Response(null, { status, headers: { location } });
export const status = (code) => new Response(code === 404 ? 'not found' : 'error', { status: code });

/** Never answers; rejects when the caller's AbortSignal fires (what a real fetch does). */
export const hang = (init) =>
  new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  });

/**
 * @param {Record<string, any>} routes URL → Response | () => Response | Promise | Error | (init)=>…
 *   or an array of those, used in order (the last repeats).
 * @returns {typeof fetch & { calls: { url: string, init: RequestInit }[] }}
 */
export function mockFetch(routes) {
  const calls = [];
  const seen = new Map();
  const fn = async (url, init = {}) => {
    const key = String(url);
    calls.push({ url: key, init });
    if (!(key in routes)) throw new TypeError(`mockFetch: no route for ${key}`);
    let route = routes[key];
    if (Array.isArray(route)) {
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      route = route[Math.min(n, route.length - 1)];
    }
    if (typeof route === 'function') route = route(init);
    route = await route;
    if (route instanceof Error) throw route;
    return route;
  };
  fn.calls = calls;
  return fn;
}
