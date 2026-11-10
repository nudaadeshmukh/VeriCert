// Request proxy (Next.js 16's name for "middleware"; the plan says middleware.js).
//
// A deliberately small FIRST gate: it protects /dashboard, /history, /admin and /api/* (except /api/auth/* and /api/health) by
// refusing requests that carry no session cookie at all: 401 for the API, a redirect to /login for pages. It does NOT decide who may
// use the site. A cookie that is present can be forged, expired or revoked, so the real decision is `requireUser()`
// (src/lib/auth/guards.js), which every protected route handler and page calls on every request and which re-reads the user from the
// database. Next.js says the same about proxies: optimistic checks only, not session management or authorization.
import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAMES } from './src/lib/auth/config.js';

const PUBLIC_API = ['/api/health'];
const PUBLIC_API_PREFIXES = ['/api/auth/'];

export function proxy(request) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_API.includes(pathname) || PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  const hasSessionCookie = Object.values(SESSION_COOKIE_NAMES).some((name) =>
    Boolean(request.cookies.get(name)?.value),
  );
  if (hasSessionCookie) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'no_session' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const login = new URL('/login', request.url);
  login.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/dashboard/:path*', '/history/:path*', '/admin/:path*', '/api/:path*'],
};
