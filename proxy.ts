import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { sessionCookieOptions } from '@/lib/backend/cookies';

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

const AUTH_PATHS = /^\/(admin|account|login)(\/|$)/;

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
  await db.auth.getClaims();
  return response;
}

export const config = {
  matcher: [{
    source: '/((?!_next/static|_next/image|icons/|favicon|manifest\\.webmanifest).*)',
    missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }]
  }]
};
