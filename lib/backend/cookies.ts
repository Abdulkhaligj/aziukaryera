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

/** Keeps the user object out of the session cookie (auth-js `userStorage`):
 *  the cookie then holds only the tokens (~1.5 KB instead of ~3.5 KB in two
 *  chunks). Behind the university WAF the panel's responses may carry at most
 *  ~4 KB of headers; a sign-in answer with the full session cookie went over
 *  it and the WAF answered 502. The panel always reads the user with
 *  getUser() from the API, never from the cookie. One store per client. */
export function memoryUserStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
    removeItem: (key: string) => { items.delete(key); }
  };
}
