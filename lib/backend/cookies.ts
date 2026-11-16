// Session cookies of the panel (audit 2026-11-13, #58): HttpOnly, so page
// scripts cannot read the access or refresh token; Secure outside development;
// SameSite=Lax, so other sites cannot send them with their own requests.
export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  // Two hours without a request and the cookie is gone (it is renewed with every
  // token refresh): an idle time-out instead of the library's 400 days (audit 2026-11-16, M41).
  maxAge: 2 * 60 * 60
};

/** When the staff member signed in; a session ends 12 hours later however
 *  active it is (absolute time-out, M41). */
export const SESSION_STARTED = 'adm_session_started';
export const SESSION_MAX_MS = 12 * 60 * 60 * 1000;
