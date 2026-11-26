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

/** The university address the panel is also served under (Caddy passes it
 *  through); see next.config.mjs. */
const PUBLIC_HOSTS = (globalThis.process?.env?.ADMIN_PUBLIC_HOSTS || 'career.asoiu.edu.az')
  .split(',').map(host => host.trim().toLowerCase()).filter(Boolean);

/** State-changing admin requests must come from the panel itself: same
 *  origin, or the university address it is served under (a browser always
 *  sends Origin on cross-site POST/PATCH/DELETE). */
export function crossSite(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return request.headers.get('sec-fetch-site') === 'cross-site';
  try {
    const url = new URL(origin);
    if (url.host === new URL(request.url).host) return false;
    return !(url.protocol === 'https:' && PUBLIC_HOSTS.includes(url.host.toLowerCase()));
  } catch { return true; }
}

/** The message of a refused Edge Function call: db-js returns no data
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

/** The fields admin-users may change for each section; anything else in the
 *  request is dropped, so a manager cannot pass role or admin_role through a
 *  student form (audit 2026-11-16, M38). */
const PEOPLE_FIELDS: Record<string, string[]> = {
  students: ['full_name', 'email', 'personal_email', 'phone', 'city', 'faculty_id', 'major_id', 'course', 'gpa', 'status'],
  master_students: ['full_name', 'email', 'personal_email', 'phone', 'city', 'faculty_id', 'major_id', 'course', 'gpa', 'status'],
  alumni: ['full_name', 'email', 'personal_email', 'phone', 'city', 'faculty_id', 'major_id', 'status', 'alumni_verified'],
  admins: ['full_name', 'email', 'phone', 'status', 'admin_role']
};
export function peopleFields(resource: string, body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries((PEOPLE_FIELDS[resource] ?? []).filter(field => sent(body, field)).map(field => [field, body[field]]));
}

/** A whole number in a range, or the fallback when the field is empty (L39). */
export function intInRange(value: unknown, min: number, max: number, fallback: number | null = null): number | null | 'invalid' {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : 'invalid';
}
/** A non-negative amount with at most two decimals, or null when empty (L39). */
export function amount(value: unknown, max = 1_000_000): number | null | 'invalid' {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= max && Math.round(n * 100) === n * 100 ? n : 'invalid';
}

/** A short audit title built by the server; client text is cut (L37). */
export const auditTitle = (text: string, suffix: string) => `${text.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Qeyd'} ${suffix}`;

/** The bytes are what the image or audio type says (L40). */
export function sniffMedia(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
  return null;
}
