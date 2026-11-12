// Server-side helpers for the admin API routes: input normalisation, safe
// error messages and a same-origin check for state-changing requests.
import 'server-only';

/** A clickable web link: http(s) only (no javascript:, data: …). */
export function webUrl(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : null;
}

/** An image or media URL loaded by the pages: https only. */
export function httpsUrl(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return /^https:\/\/[^\s]+$/i.test(s) ? s : null;
}

/** Matches the text literally in a (case-insensitive) LIKE pattern. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Request bodies are read only for these field names, never inherited ones. */
export const sent = (body: Record<string, unknown>, key: string) => Object.hasOwn(body, key);

type DbError = { message?: string; code?: string } | null | undefined;

/** A message safe to show: the database's own Azerbaijani rule messages pass
 *  through; constraint and system details stay in the server log. */
export function publicError(error: DbError, fallback = 'Əməliyyat alınmadı'): string {
  if (!error) return fallback;
  const code = error.code ?? '';
  if (code === '23505') return 'Bu qeyd artıq mövcuddur';
  if (code === '23503') return 'Qeyd başqa məlumatlarla əlaqəlidir və ya əlaqəli qeyd tapılmadı';
  if (code === '23514' && /violates check constraint/i.test(error.message ?? '')) return 'Daxil edilən dəyər qaydalara uyğun deyil (məsələn, link https:// ilə başlamalıdır)';
  if (code === '23502') return 'Məcburi sahə boşdur';
  if (code === 'P0001' || code === '42501' || code === '23514') return error.message || fallback;
  console.error('admin api error:', code, error.message);
  return fallback;
}

/** State-changing admin requests must come from the panel itself: same
 *  origin (a browser always sends Origin on cross-site POST/PATCH/DELETE). */
export function crossSite(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return request.headers.get('sec-fetch-site') === 'cross-site';
  try { return new URL(origin).host !== new URL(request.url).host; } catch { return true; }
}

/** The message of a refused Edge Function call: supabase-js returns no data
 *  for non-2xx answers, only an error whose response holds the function's JSON. */
export async function functionError(error: unknown, data: { error?: string } | null | undefined, fallback: string): Promise<string> {
  if (data?.error) return data.error;
  const response = (error as { context?: Response } | null)?.context;
  if (response && typeof response.json === 'function') {
    const body = await response.clone().json().catch(() => null) as { error?: string } | null;
    if (body?.error) return body.error;
  }
  return fallback;
}
