// Who is calling. Mirrors the Postgres roles the old backend used: anon,
// authenticated and service_role come from the request's key or JWT;
// system stands for SECURITY DEFINER code (signup, scheduled jobs).
import { jwtVerify } from 'jose';
import type { Config } from './config.ts';

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

/** Resolve a request's context from its apikey and Authorization headers. */
export async function contextFromHeaders(config: Config, apikey: string | undefined, authorization: string | undefined): Promise<Context | null> {
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer || apikey;
  if (!token) return null;
  const claims = await verifyJwt(config, token);
  if (!claims) return null;
  if (claims.role === 'service_role') return { role: 'service_role', uid: null, claims: null };
  if (claims.role === 'anon') return anonContext;
  if (claims.role === 'authenticated' && typeof claims.sub === 'string') return { role: 'authenticated', uid: claims.sub, claims };
  return null;
}
