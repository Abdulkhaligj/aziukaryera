// Who is calling. Mirrors the Postgres roles the old backend used: anon,
// authenticated and service_role come from the request's key or JWT;
// system stands for SECURITY DEFINER code (signup, scheduled jobs).
import { timingSafeEqual } from 'node:crypto';
import { decodeJwt, jwtVerify } from 'jose';
import type { Pool } from 'mysql2/promise';
import type { Config } from './config.ts';
import { one } from './db.ts';

export type Role = 'anon' | 'authenticated' | 'service_role' | 'system';

export interface Claims {
  sub?: string;
  role?: string;
  email?: string;
  session_id?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Context {
  role: Role;
  /** auth.uid(): the signed-in user's id, null otherwise. */
  uid: string | null;
  /** auth.jwt(): the verified access-token claims, null for keys/system. */
  claims: Claims | null;
  /** A session opened by a password-recovery link: it may only set a new
   *  password (audit 2026-11-13, #15). */
  restricted?: boolean;
}

export const systemContext: Context = { role: 'system', uid: null, claims: null };
export const anonContext: Context = { role: 'anon', uid: null, claims: null };

export async function verifyJwt(config: Config, token: string): Promise<Claims | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(config.jwtSecret), { algorithms: ['HS256'] });
    return payload as Claims;
  } catch {
    return null;
  }
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Seconds until an API key expires (its exp claim); null when it has none. */
export function keyExpiresIn(key: string, now = Date.now()): number | null {
  try {
    const { exp } = decodeJwt(key);
    return typeof exp === 'number' ? exp - Math.floor(now / 1000) : null;
  } catch { return null; }
}
// An API key past its exp claim is refused, even though it is compared exactly (M-08).
const live = (key: string) => (keyExpiresIn(key) ?? 1) > 0;

// The state of a session, read for every request that carries a user token
// and kept for a few seconds: a revoked, expired, banned or deleted account
// stops working at once instead of when its access token expires (H-10).
const SESSION_CACHE_MS = 5000;
const sessionCache = new Map<string, { at: number; ok: boolean; restricted: boolean }>();
export function forgetSessions(...ids: (string | undefined | null)[]) {
  for (const id of ids) if (id) sessionCache.delete(id);
}
export function forgetAllSessions() { sessionCache.clear(); }

async function sessionState(db: Pool, uid: string, sessionId: string) {
  const hit = sessionCache.get(sessionId);
  if (hit && Date.now() - hit.at < SESSION_CACHE_MS) return hit;
  const row = await one<{ restricted: boolean }>(db, `SELECT s.restricted FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
     WHERE s.id = ? AND s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP(6)
       AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until <= CURRENT_TIMESTAMP(6))`, [sessionId, uid]);
  const state = { at: Date.now(), ok: !!row, restricted: !!row?.restricted };
  if (sessionCache.size > 50_000) sessionCache.clear();
  sessionCache.set(sessionId, state);
  return state;
}

/** Resolve a request's context from its apikey and Authorization headers.
 *  The anon and service keys are compared with the configured keys (not just
 *  their signature: #20); a user token needs a live session when `db` is given. */
export async function contextFromHeaders(config: Config, apikey: string | undefined, authorization: string | undefined, db?: Pool): Promise<Context | null> {
  if (apikey && !same(apikey, config.anonKey) && !same(apikey, config.serviceRoleKey)) return null;
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer || apikey;
  if (!token) return null;
  if (same(token, config.serviceRoleKey)) return live(config.serviceRoleKey) ? { role: 'service_role', uid: null, claims: null } : null;
  if (same(token, config.anonKey)) return live(config.anonKey) ? anonContext : null;
  const claims = await verifyJwt(config, token);
  if (!claims || claims.role !== 'authenticated' || typeof claims.sub !== 'string') return null;
  if (!db) return { role: 'authenticated', uid: claims.sub, claims };
  if (typeof claims.session_id !== 'string') return null;
  const state = await sessionState(db, claims.sub, claims.session_id);
  if (!state.ok) return null;
  return { role: 'authenticated', uid: claims.sub, claims, restricted: state.restricted };
}
