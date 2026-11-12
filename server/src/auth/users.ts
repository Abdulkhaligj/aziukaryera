// auth_users rows and the GoTrue user object the data client expects.
import { one, type Row, type Tx } from '../db.ts';
import type { Pool } from 'mysql2/promise';

export interface AuthUser extends Row {
  id: string;
  email: string | null;
  encrypted_password: string | null;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  raw_app_meta_data: Record<string, unknown>;
  raw_user_meta_data: Record<string, unknown>;
  banned_until: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** Pending new address (secure email change), and how many links were confirmed. */
  email_change?: string | null;
  email_change_confirm_status?: number;
  email_change_sent_at?: string | null;
}

export const normalizeEmail = (email: unknown) => String(email ?? '').trim().toLowerCase();
export const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 191;

export function findUserByEmail(db: Pool | Tx, email: string, lock = false) {
  return one<AuthUser>(db, `SELECT * FROM auth_users WHERE email = ? AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [normalizeEmail(email)]);
}

export function findUserById(db: Pool | Tx, id: string, lock = false) {
  return one<AuthUser>(db, `SELECT * FROM auth_users WHERE id = ? AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [id]);
}

export function isBanned(user: AuthUser, now = new Date()) {
  return !!user.banned_until && new Date(user.banned_until) > now;
}

/** The user JSON GoTrue returns from /user, /token, /signup and admin routes. */
export function toGoTrueUser(user: AuthUser) {
  const identity = user.email ? [{
    identity_id: user.id, id: user.id, user_id: user.id,
    identity_data: { email: user.email, email_verified: !!user.email_confirmed_at, phone_verified: false, sub: user.id },
    provider: 'email', last_sign_in_at: user.last_sign_in_at, created_at: user.created_at, updated_at: user.updated_at, email: user.email
  }] : [];
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email ?? '',
    email_confirmed_at: user.email_confirmed_at,
    phone: '',
    confirmed_at: user.email_confirmed_at,
    last_sign_in_at: user.last_sign_in_at,
    app_metadata: user.raw_app_meta_data || {},
    user_metadata: user.raw_user_meta_data || {},
    identities: identity,
    created_at: user.created_at,
    updated_at: user.updated_at,
    banned_until: user.banned_until ?? undefined,
    new_email: user.email_change || undefined,
    email_change_sent_at: user.email_change ? user.email_change_sent_at ?? undefined : undefined,
    is_anonymous: false
  };
}

/** GoTrue metadata update: shallow merge, a null value removes the key. */
export function mergeMetadata(current: Record<string, unknown>, patch: Record<string, unknown> | undefined) {
  if (!patch) return current;
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}
