/**
 * ADNSU Karyera admin — response hardening.
 * These headers protect only the admin Next.js project; they do not modify
 * the independently deployed student website.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Cache-Control', value: 'private, no-store, max-age=0' }
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      { source: '/admin/:path*', headers: securityHeaders },
      { source: '/account/:path*', headers: securityHeaders },
      { source: '/login', headers: securityHeaders }
    ];
  }
};

export default nextConfig;
