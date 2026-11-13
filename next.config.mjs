/**
 * ADNSU Karyera admin — response hardening for every route.
 * These headers protect only the admin Next.js project; they do not modify
 * the independently deployed student website.
 */
// The Content-Security-Policy of the pages, with a nonce per response, is set
// by proxy.ts (audit 2026-11-13, #58); a second, static policy here would
// block the nonce scripts. Static files run no inline code and need none.

const securityHeaders = [
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
// ADMIN_MAINTENANCE=false at build time turns it off for a local check.
const MAINTENANCE = process.env.ADMIN_MAINTENANCE !== 'false';

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
