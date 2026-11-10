// Where to go after signing in. PURE. The `next` value comes from the URL, i.e. from anyone, so it is only ever followed if it is a
// path on THIS site: it must start with a single "/", and may not be protocol-relative (`//evil.com`), use a backslash (some browsers
// treat `/\evil.com` like `//evil.com`), contain control characters, or point back at an auth page (a redirect loop).
export const DEFAULT_AFTER_LOGIN = '/dashboard';

/**
 * @param {unknown} next
 * @param {string} [fallback]
 * @returns {string}
 */
export function safeNext(next, fallback = DEFAULT_AFTER_LOGIN) {
  if (typeof next !== 'string' || next.length === 0 || next.length > 512) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  const path = next.split(/[?#]/)[0].toLowerCase();
  if (
    ['/login', '/signup', '/verify-email', '/forgot-password', '/reset-password'].includes(path) ||
    path.startsWith('/api/auth')
  ) {
    return fallback;
  }
  return next;
}
