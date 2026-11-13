// Session cookies of the panel (audit 2026-11-13, #58): HttpOnly, so page
// scripts cannot read the access or refresh token; Secure outside development;
// SameSite=Lax, so other sites cannot send them with their own requests.
export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/'
};
