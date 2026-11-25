// Sign-in with the university's Microsoft 365 accounts (Entra ID): the OpenID
// Connect authorization code flow, with this API as a confidential client.
//
//   site ──/authorize (PKCE challenge)──▶ API ──302──▶ Microsoft (university tenant)
//   Microsoft ──/callback?code&state──▶ API ── code + client secret ──▶ token endpoint
//   API ──303 site?code=<one-time code>──▶ site ── code + verifier ──▶ /token?grant_type=pkce
//
// Only the browser that started the sign-in (it holds the PKCE verifier) can
// turn the result into a session, and no token is ever put in an address (L48).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AzureConfig } from '../config.ts';
import type { CodeChallenge } from './tokens.ts';

/** The state travels through Microsoft and comes back unchanged; it is signed,
 *  so nobody can change where the result goes or which challenge it is bound to. */
export interface AzureState {
  /** Where the site wants to go back to (already checked against the allow list). */
  redirect: string;
  pkce: CodeChallenge;
  /** Sent to Microsoft and expected back in the ID token. */
  nonce: string;
  /** What the person picked on the sign-up form; used only for a new account. */
  role: 'student' | 'master_student' | 'graduate' | null;
  /** Milliseconds since the epoch. */
  expires: number;
}

const STATE_MINUTES = 10;
const b64 = (data: Buffer | string) => Buffer.from(data).toString('base64url');

function stateKey(jwtSecret: string) {
  // Its own key, derived from the JWT secret: a state can never pass for a token.
  return createHmac('sha256', jwtSecret).update('azure-oauth-state').digest();
}

export function newAzureState(input: Omit<AzureState, 'nonce' | 'expires'>): AzureState {
  return { ...input, nonce: randomBytes(16).toString('base64url'), expires: Date.now() + STATE_MINUTES * 60_000 };
}

export function signAzureState(jwtSecret: string, state: AzureState): string {
  const payload = b64(JSON.stringify(state));
  return `${payload}.${b64(createHmac('sha256', stateKey(jwtSecret)).update(payload).digest())}`;
}

/** The state if it is ours, unchanged and not expired; otherwise null. */
export function readAzureState(jwtSecret: string, value: unknown): AzureState | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = createHmac('sha256', stateKey(jwtSecret)).update(payload).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AzureState;
    if (typeof state.expires !== 'number' || state.expires < Date.now()) return null;
    return state;
  } catch { return null; }
}

export const azureCallbackUrl = (publicUrl: string) => `${publicUrl}/auth/v1/callback`;

export function azureAuthorizeUrl(azure: AzureConfig, publicUrl: string, universityDomain: string, state: AzureState, signedState: string, selectAccount: boolean) {
  const params = new URLSearchParams({
    client_id: azure.clientId, response_type: 'code', response_mode: 'query',
    redirect_uri: azureCallbackUrl(publicUrl), scope: 'openid email profile',
    state: signedState, nonce: state.nonce,
    // Microsoft shows the university's own sign-in page at once.
    domain_hint: universityDomain
  });
  if (selectAccount) params.set('prompt', 'select_account');
  return `${azure.authority}/${azure.tenantId}/oauth2/v2.0/authorize?${params}`;
}

/** A Microsoft sign-in that cannot be used; the message goes to the site. */
export class AzureSignInError extends Error {
  readonly errorCode: string;
  constructor(errorCode: string, message: string) { super(message); this.errorCode = errorCode; }
}

export interface AzureIdentity { email: string; name: string; objectId: string }

/** Trades Microsoft's code for the ID token and checks it. The token comes
 *  straight from the token endpoint over TLS, in answer to this API's own
 *  secret, so its issuer is the endpoint itself (OpenID Connect Core 3.1.3.7);
 *  the claims are still checked one by one. */
export async function azureIdentity(azure: AzureConfig, publicUrl: string, universityDomain: string, code: string, nonce: string): Promise<AzureIdentity> {
  const response = await fetch(`${azure.authority}/${azure.tenantId}/oauth2/v2.0/token`, {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: azure.clientId, client_secret: azure.clientSecret, grant_type: 'authorization_code',
      code, redirect_uri: azureCallbackUrl(publicUrl), scope: 'openid email profile'
    })
  });
  const body = await response.json().catch(() => ({})) as { id_token?: unknown };
  if (!response.ok || typeof body.id_token !== 'string') throw new AzureSignInError('provider_error', 'Microsoft did not confirm the sign-in');
  const claims = idTokenClaims(body.id_token);
  const now = Date.now() / 1000;
  const ok = claims
    && claims.aud === azure.clientId
    && claims.tid === azure.tenantId
    && claims.iss === `${azure.authority}/${azure.tenantId}/v2.0`
    && claims.nonce === nonce
    && typeof claims.exp === 'number' && claims.exp > now - 60
    && (typeof claims.nbf !== 'number' || claims.nbf < now + 60);
  if (!ok) throw new AzureSignInError('provider_error', 'Microsoft did not confirm the sign-in');
  // A member of the university's directory signs in with their university
  // address; a guest's name has #EXT# and another domain, and gets no account.
  const email = String(claims.preferred_username || claims.email || '').trim().toLowerCase();
  const local = email.slice(0, email.lastIndexOf('@'));
  if (!email.endsWith('@' + universityDomain) || !/^[a-z0-9._%+-]+$/.test(local)) {
    throw new AzureSignInError('email_address_not_authorized', `Universitet girişi üçün @${universityDomain} hesabı tələb olunur`);
  }
  const objectId = typeof claims.oid === 'string' ? claims.oid : '';
  return { email, name: typeof claims.name === 'string' ? claims.name.trim().slice(0, 200) : '', objectId };
}

function idTokenClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : null;
  } catch { return null; }
}
