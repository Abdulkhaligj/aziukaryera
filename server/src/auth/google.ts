// Sign-in with a Google account (Gmail): the same OpenID Connect code flow as
// Microsoft's (azure.ts), with the same signed state, PKCE binding and
// callback address (/auth/v1/callback); the state says which provider it was.
//
// A Google account signs in to the account with its address. A new account is
// made only for a graduate, and staff review it (new-user.ts), as for any
// graduate with a personal address. University addresses sign in with
// Microsoft only: the university's directory, not Google, vouches for them.
import type { GoogleConfig } from '../config.ts';
import { OAuthSignInError, type AzureState } from './azure.ts';

export const googleCallbackUrl = (publicUrl: string) => `${publicUrl}/auth/v1/callback`;

export function googleAuthorizeUrl(google: GoogleConfig, publicUrl: string, state: AzureState, signedState: string, selectAccount: boolean) {
  const params = new URLSearchParams({
    client_id: google.clientId, response_type: 'code',
    redirect_uri: googleCallbackUrl(publicUrl), scope: 'openid email profile',
    state: signedState, nonce: state.nonce
  });
  if (selectAccount) params.set('prompt', 'select_account');
  return `${google.authorizeUrl}?${params}`;
}

export interface GoogleIdentity { email: string; name: string; subject: string }

/** Trades Google's code for the ID token and checks it. As with Microsoft, the
 *  token comes straight from the token endpoint over TLS in answer to this
 *  API's secret (OpenID Connect Core 3.1.3.7); the claims are checked one by one. */
export async function googleIdentity(google: GoogleConfig, publicUrl: string, universityDomain: string, code: string, nonce: string): Promise<GoogleIdentity> {
  const response = await fetch(google.tokenUrl, {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: google.clientId, client_secret: google.clientSecret, grant_type: 'authorization_code',
      code, redirect_uri: googleCallbackUrl(publicUrl)
    })
  });
  const body = await response.json().catch(() => ({})) as { id_token?: unknown };
  if (!response.ok || typeof body.id_token !== 'string') throw new OAuthSignInError('provider_error', 'Google did not confirm the sign-in');
  const claims = idTokenClaims(body.id_token);
  const now = Date.now() / 1000;
  const ok = claims
    && claims.aud === google.clientId
    && typeof claims.iss === 'string' && google.issuers.includes(claims.iss)
    && claims.nonce === nonce
    && typeof claims.exp === 'number' && claims.exp > now - 60
    && typeof claims.sub === 'string' && claims.sub.length > 0;
  if (!ok) throw new OAuthSignInError('provider_error', 'Google did not confirm the sign-in');
  // Only an address Google has confirmed stands for its owner.
  if (claims.email_verified !== true && claims.email_verified !== 'true') {
    throw new OAuthSignInError('email_address_not_authorized', 'Google hesabının e-poçtu təsdiqlənməyib');
  }
  const email = String(claims.email || '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1 || !/^[a-z0-9._%+-]+$/.test(email.slice(0, at)) || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(email.slice(at + 1))) {
    throw new OAuthSignInError('email_address_not_authorized', 'Google hesabının e-poçtu qəbul olunmadı');
  }
  if (email.endsWith('@' + universityDomain)) {
    throw new OAuthSignInError('email_address_not_authorized', `@${universityDomain} hesabı Outlook (Microsoft) ilə daxil olur`);
  }
  return { email, name: typeof claims.name === 'string' ? claims.name.trim().slice(0, 200) : '', subject: claims.sub as string };
}

function idTokenClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : null;
  } catch { return null; }
}
