/**
 * ADNSU Karyera admin — response hardening for every route.
 * These headers protect only the admin Next.js project; they do not modify
 * the independently deployed student website.
 */
const backend = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const backendWs = backend.replace(/^http/, 'ws');
const dev = process.env.NODE_ENV !== 'production';

// Next.js renders inline bootstrap scripts, so scripts and styles allow
// 'unsafe-inline'; everything else is limited to this site and the backend.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${backend} ${backendWs} https://*.supabase.co wss://*.supabase.co`.trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  // The admin voice assistant records from the microphone on this origin only.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' }
];

const noStore = [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }];

// The backend is moving to the university's MySQL server and the old one is
// gone. While this is true every page shows /maintenance. Set it to false
// once the MySQL API is live (see deploy/universitet-mysql/README.md).
const MAINTENANCE = true;

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async redirects() {
    if (!MAINTENANCE) return [];
    return [{
      source: '/((?!maintenance|_next/|icons/|favicon|manifest\\.webmanifest).*)',
      destination: '/maintenance',
      permanent: false
    }];
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/admin/:path*', headers: noStore },
      { source: '/account/:path*', headers: noStore },
      { source: '/api/admin/:path*', headers: noStore },
      { source: '/login', headers: noStore }
    ];
  }
};

export default nextConfig;
