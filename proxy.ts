import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_MAX_MS, SESSION_STARTED, sessionCookieOptions } from '@/lib/backend/cookies';

// Content-Security-Policy with a fresh nonce per response (audit 2026-11-13,
// #58): only the scripts Next.js renders with this nonce run; an injected
// <script> or inline handler does not. Style attributes stay allowed.
function contentSecurityPolicy(nonce: string) {
  const backend = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
  const dev = process.env.NODE_ENV !== 'production';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${backend}`.trim(),
    "media-src 'self' blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${backend}`.trim(),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
  ].join('; ');
}

// /api/admin too: its requests refresh the session like the pages (L42).
const AUTH_PATHS = /^\/(admin|account|login|api\/admin)(\/|$)/;

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(nonce);
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  const next = () => {
    const res = NextResponse.next({ request: { headers } });
    res.headers.set('content-security-policy', csp);
    return res;
  };
  let response = next();
  const url = process.env.NEXT_PUBLIC_API_URL;
  const key = process.env.NEXT_PUBLIC_API_KEY;
  if (!url || !key || !AUTH_PATHS.test(request.nextUrl.pathname)) return response;
  // Absolute time-out (M41): a session older than 12 hours, or one without a
  // recorded sign-in time, is ended; the next page is the sign-in.
  const path = request.nextUrl.pathname;
  const authCookies = request.cookies.getAll().filter(c => /^sb-.+-auth-token(\.\d+)?$/.test(c.name));
  const endSession = () => {
    const ended = path.startsWith('/api/')
      ? NextResponse.json({ error: 'Sessiya bitib. Yenidən daxil olun.' }, { status: 401 })
      : NextResponse.redirect(new URL('/login', request.url));
    for (const cookie of authCookies) ended.cookies.delete(cookie.name);
    ended.cookies.delete(SESSION_STARTED);
    ended.headers.set('content-security-policy', csp);
    return ended;
  };
  const started = Number(request.cookies.get(SESSION_STARTED)?.value);
  if (path !== '/login' && authCookies.length && (!Number.isFinite(started) || !started || Date.now() - started > SESSION_MAX_MS)) return endSession();
  const db = createServerClient(url, key, {
    cookieOptions: sessionCookieOptions,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        headers.set('cookie', request.cookies.toString());
        response = next();
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, { ...options, ...sessionCookieOptions }));
      }
    }
  });
  // A damaged or foreign session cookie made getClaims throw and the page
  // answer 500; it now ends the session and shows the sign-in page.
  let data: Awaited<ReturnType<typeof db.auth.getClaims>>['data'];
  try {
    ({ data } = await db.auth.getClaims());
  } catch {
    return endSession();
  }
  // The cookie above is only a hint the browser can change. The limit itself is
  // the sign-in time the API signed into the token (amr), which a refresh keeps.
  const signedIn = Number((data?.claims as { amr?: { timestamp?: number }[] } | undefined)?.amr?.[0]?.timestamp) * 1000;
  if (path !== '/login' && Number.isFinite(signedIn) && signedIn > 0 && Date.now() - signedIn > SESSION_MAX_MS) return endSession();
  return response;
}

export const config = {
  matcher: [{
    source: '/((?!_next/static|_next/image|icons/|favicon|manifest\\.webmanifest).*)',
    missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }]
  }]
};
