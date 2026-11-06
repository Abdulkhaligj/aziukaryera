// Access tokens (HS256 JWT, same claims as Supabase) and refresh-token
// sessions. Only SHA-256 hashes of refresh and one-time tokens are stored.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import type { Pool } from 'mysql2/promise';
import type { Config } from '../config.ts';
import { exec, one, toMysqlDatetime, type Row, type Tx } from '../db.ts';
import { authErrors } from '../errors.ts';
import { toGoTrueUser, type AuthUser } from './users.ts';

/** GoTrue's refresh-token reuse interval. */
const REUSE_INTERVAL_MS = 10_000;
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const newSecret = () => randomBytes(32).toString('base64url');

interface SessionRow extends Row { id: string; user_id: string; aal: string; amr_method: string; created_at: string; expires_at: string; revoked_at: string | null }

export async function signAccessToken(config: Config, user: AuthUser, session: Pick<SessionRow, 'id' | 'aal' | 'amr_method' | 'created_at'>) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + config.accessTokenTtl;
  const token = await new SignJWT({
    aud: 'authenticated', email: user.email ?? '', phone: '',
    app_metadata: user.raw_app_meta_data || {}, user_metadata: user.raw_user_meta_data || {},
    role: 'authenticated', aal: session.aal,
    amr: [{ method: session.amr_method, timestamp: Math.floor(new Date(session.created_at).getTime() / 1000) }],
    session_id: session.id, is_anonymous: false
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(`${config.publicUrl}/auth/v1`)
    .setSubject(user.id)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(config.jwtSecret));
  return { token, exp };
}

async function issue(tx: Tx, config: Config, user: AuthUser, session: SessionRow, parentHash: string | null) {
  const refreshToken = newSecret();
  await exec(tx, 'INSERT INTO auth_refresh_tokens (session_id, token_hash, parent_hash) VALUES (?, ?, ?)',
    [session.id, sha256(refreshToken), parentHash]);
  const { token, exp } = await signAccessToken(config, user, session);
  return {
    access_token: token, token_type: 'bearer', expires_in: config.accessTokenTtl, expires_at: exp,
    refresh_token: refreshToken, user: toGoTrueUser(user)
  };
}

/** Sign-in: a new session (device) with its first refresh token. */
export async function startSession(tx: Tx, config: Config, user: AuthUser, method: string, meta: { userAgent?: string; ip?: string }) {
  const id = randomUUID();
  const expires = new Date(Date.now() + config.refreshTokenTtlDays * 86_400_000);
  await exec(tx, `INSERT INTO auth_sessions (id, user_id, amr_method, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, user.id, method, toMysqlDatetime(expires), meta.userAgent?.slice(0, 255) ?? null, meta.ip ?? null]);
  await exec(tx, 'UPDATE auth_users SET last_sign_in_at = CURRENT_TIMESTAMP(6) WHERE id = ?', [user.id]);
  const session = (await one<SessionRow>(tx, 'SELECT * FROM auth_sessions WHERE id = ?', [id]))!;
  const fresh = (await one<AuthUser>(tx, 'SELECT * FROM auth_users WHERE id = ?', [user.id]))!;
  return issue(tx, config, fresh, session, null);
}

/** grant_type=refresh_token. A late replay revokes the session; that
 *  revocation must commit, so it is returned instead of thrown. */
export async function refreshSession(tx: Tx, config: Config, refreshToken: string): Promise<Awaited<ReturnType<typeof issue>> | { replayed: true }> {
  const hash = sha256(refreshToken);
  const presented = await one<{ session_id: string; revoked_at: string | null }>(tx,
    'SELECT session_id, revoked_at FROM auth_refresh_tokens WHERE token_hash = ? FOR UPDATE', [hash]);
  if (!presented) throw authErrors.refreshNotFound();
  const session = await one<SessionRow>(tx, 'SELECT * FROM auth_sessions WHERE id = ? FOR UPDATE', [presented.session_id]);
  if (!session || session.revoked_at || new Date(session.expires_at) <= new Date()) throw authErrors.refreshNotFound();
  if (presented.revoked_at && Date.now() - new Date(presented.revoked_at).getTime() > REUSE_INTERVAL_MS) {
    // A rotated token replayed later than the reuse interval: assume it leaked.
    await exec(tx, 'UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP(6) WHERE id = ?', [session.id]);
    return { replayed: true };
  }
  const user = await one<AuthUser>(tx, 'SELECT * FROM auth_users WHERE id = ? AND deleted_at IS NULL', [session.user_id]);
  if (!user) throw authErrors.refreshNotFound();
  if (user.banned_until && new Date(user.banned_until) > new Date()) throw authErrors.banned();
  if (!presented.revoked_at) await exec(tx, 'UPDATE auth_refresh_tokens SET revoked_at = CURRENT_TIMESTAMP(6) WHERE token_hash = ?', [hash]);
  await exec(tx, 'UPDATE auth_sessions SET refreshed_at = CURRENT_TIMESTAMP(6) WHERE id = ?', [session.id]);
  return issue(tx, config, user, session, hash);
}

export async function revokeSessions(tx: Tx, userId: string, sessionId: string | undefined, scope: 'global' | 'local' | 'others') {
  if (scope === 'local') {
    await exec(tx, 'UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND user_id = ? AND revoked_at IS NULL', [sessionId ?? '', userId]);
  } else {
    await exec(tx, `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP(6) WHERE user_id = ? AND revoked_at IS NULL${scope === 'others' ? ' AND id <> ?' : ''}`,
      scope === 'others' ? [userId, sessionId ?? ''] : [userId]);
  }
}

export async function sessionIsActive(db: Tx | Pool, sessionId: string | undefined) {
  if (!sessionId) return false;
  return !!await one(db, `SELECT 1 AS ok FROM auth_sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP(6)`, [sessionId]);
}

/** One-time email token (recovery, confirmation, invite, magic link). */
export async function createOneTimeToken(tx: Tx, userId: string, purpose: string, ttlMinutes = 60) {
  const token = newSecret();
  await exec(tx, `UPDATE auth_one_time_tokens SET used_at = CURRENT_TIMESTAMP(6) WHERE user_id = ? AND purpose = ? AND used_at IS NULL`, [userId, purpose]);
  await exec(tx, `INSERT INTO auth_one_time_tokens (id, user_id, purpose, token_hash, expires_at) VALUES (UUID(), ?, ?, ?, ?)`,
    [userId, purpose, sha256(token), toMysqlDatetime(new Date(Date.now() + ttlMinutes * 60_000))]);
  return token;
}

export async function consumeOneTimeToken(tx: Tx, token: string, purposes: string[]) {
  const row = await one<{ id: string; user_id: string; purpose: string }>(tx,
    `SELECT id, user_id, purpose FROM auth_one_time_tokens WHERE token_hash = ? AND used_at IS NULL
       AND expires_at > CURRENT_TIMESTAMP(6) FOR UPDATE`, [sha256(token)]);
  if (!row || !purposes.includes(row.purpose)) throw authErrors.otpExpired();
  await exec(tx, 'UPDATE auth_one_time_tokens SET used_at = CURRENT_TIMESTAMP(6) WHERE id = ?', [row.id]);
  return row;
}
