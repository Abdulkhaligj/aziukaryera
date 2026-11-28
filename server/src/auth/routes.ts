// /auth/v1 — the subset of the GoTrue API that the student site, the admin
// panel and the Edge Functions call through the data client.
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'mysql2/promise';
import type { Config } from '../config.ts';
import { contextFromHeaders, forgetSessions, systemContext, verifyJwt, type Claims } from '../context.ts';
import { exec, one, rows, toMysqlDatetime, transaction, type Tx } from '../db.ts';
import { AuthError, authErrors, DbRuleError } from '../errors.ts';
import type { Schema } from '../schema.ts';
import { composeMail, type Mailer, type MailKind, composeCodeMail } from './mailer.ts';
import { handleNewUser } from './new-user.ts';
import { deleteRow, updateRow } from '../write/pipeline.ts';
import { clientKey, RateLimiter } from './rate-limit.ts';
import { consumeFlowCode, consumeLinkCode, consumeOneTimeToken, createReauthCode, createFlowCode, createOneTimeToken, refreshSession, revokeSessions, sessionIsActive, startSession, type CodeChallenge } from './tokens.ts';
import { findUserByEmail, findUserById, isBanned, mergeMetadata, normalizeEmail, toGoTrueUser, validEmail, type AuthUser } from './users.ts';
import { OAuthSignInError, azureAuthorizeUrl, azureIdentity, newAzureState, readAzureState, signAzureState, type AzureState } from './azure.ts';
import { googleAuthorizeUrl, googleIdentity } from './google.ts';

export interface AuthDeps { config: Config; pool: Pool; schema: Schema; mailer: Mailer }

type Body = Record<string, any>;
const BCRYPT_COST = 10;
// Compared against when the email is unknown, so timing does not reveal it.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);
const PURPOSE: Record<string, string[]> = {
  signup: ['email_confirmation'], email: ['email_confirmation', 'magic_link'], magiclink: ['magic_link'],
  recovery: ['recovery'], invite: ['invite'], email_change: ['email_change']
};
const AMR: Record<string, string> = { email_confirmation: 'otp', magic_link: 'otp', recovery: 'recovery', invite: 'invite', email_change: 'email_change', azure: 'oauth', google: 'oauth' };
const HALF_CONFIRMED = 'Confirmation link accepted. Please proceed to confirm link sent to the other email';

export async function authRoutes(app: FastifyInstance, deps: AuthDeps) {
  const { config, pool, schema, mailer } = deps;
  // Limits per client address are wide: a whole lab or the campus Wi-Fi reaches
  // the API from one address (NAT). The narrow limits are per account and per
  // email address below (failed passwords, link cooldowns).
  const signIns = new RateLimiter(300, 5 * 60_000);
  const refreshes = new RateLimiter(3000, 5 * 60_000);
  const emailsPerIp = new RateLimiter(300, 60 * 60_000);
  // Per address and client (#16): someone else asking for links to your address
  // cannot use up your cooldown; the address itself has a larger hourly cap.
  const emailCooldown = new RateLimiter(1, 60_000);
  const emailPerClient = new RateLimiter(3, 60 * 60_000);
  const emailPerAddress = new RateLimiter(20, 60 * 60_000);
  const signups = new RateLimiter(300, 60 * 60_000);
  // Failed passwords per account and client (audit 2026-11-16, M7): a stranger's
  // wrong passwords lock only the stranger out. Per account, from any client, many
  // failures slow every attempt down instead of locking the owner out.
  const failedSignIns = new RateLimiter(10, 15 * 60_000);
  const failedPerAccount = new RateLimiter(1000, 15 * 60_000);
  const emailChanges = new RateLimiter(5, 60 * 60_000);
  const LINK_MINUTES = 60;
  const INVITE_MINUTES = 24 * 60;

  const meta = (req: FastifyRequest) => ({ userAgent: req.headers['user-agent'], ip: req.ip });
  /** The key a client is limited by: its address, an IPv6 one per /64 (L12). */
  const ipKey = (req: FastifyRequest) => clientKey(req.ip);
  /** At most so many emails per client; taken before anything is looked up, and
   *  whether or not the address exists, so the answer is the same either way (M8). */
  const mailQuota = (req: FastifyRequest) => { if (!emailsPerIp.take(ipKey(req))) throw authErrors.rateLimited(); };
  /** Sent after the answer: the response time does not tell whether the address exists (M8). */
  const deliver = (mail: ReturnType<typeof composeMail>) => {
    void mailer.send(mail).catch(error => app.log.error({ err: error, kind: mail.kind }, 'email delivery failed'));
  };
  /** The PKCE challenge of a request, as GoTrue reads it (L48). */
  function pkceOf(body: Body): CodeChallenge | null {
    if (body.code_challenge === undefined || body.code_challenge === null || body.code_challenge === '') return null;
    const challenge = String(body.code_challenge);
    const method = String(body.code_challenge_method ?? 's256').toLowerCase();
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(challenge) || (method !== 's256' && method !== 'plain')) {
      throw authErrors.validation('Invalid code_challenge or code_challenge_method');
    }
    return { challenge, method };
  }
  /** user_metadata is copied into every token: it stays small (L14). */
  function checkMetadata(data: unknown) {
    if (data === undefined) return;
    if (data === null || typeof data !== 'object' || Array.isArray(data) || JSON.stringify(data).length > 8192) {
      throw authErrors.validation('User metadata must be an object of at most 8 KB');
    }
  }
  const limit = (limiter: RateLimiter, key: string) => { if (!limiter.take(key)) throw new AuthError(429, 'over_request_rate_limit', 'Request rate limit reached'); };

  function redirectTarget(requested: unknown): string {
    const url = typeof requested === 'string' ? requested : '';
    if (url && config.redirectAllowList.some(pattern => pattern.endsWith('/**')
      ? url === pattern.slice(0, -3) || url.startsWith(pattern.slice(0, -2))
      : url === pattern)) return url;
    return config.siteUrl;
  }
  const verifyLink = (token: string, type: string, redirect: string) =>
    `${config.publicUrl}/auth/v1/verify?token=${encodeURIComponent(token)}&type=${type}&redirect_to=${encodeURIComponent(redirect)}`;

  /** Per address and client; the client's own limits are checked first, so one
   *  client cannot fill these maps with addresses (M10). */
  async function cooldown(email: string, ip: string) {
    const key = `${email}|${clientKey(ip)}`;
    if (!emailCooldown.take(key)) throw authErrors.tooFrequent(emailCooldown.retryAfter(key) || 60);
    if (!emailPerClient.take(key)) throw authErrors.rateLimited();
    // The hourly cap of an address stops strangers from many addresses; the
    // owner, asking from an address they signed in from before, still gets a
    // link (audit v4, L-7).
    if (!emailPerAddress.take(email) && !await knownClient(email, ip)) throw authErrors.rateLimited();
  }
  async function knownClient(email: string, ip: string) {
    return !!await one(pool, `SELECT 1 AS ok FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
       WHERE u.email = ? AND s.ip = ? AND s.created_at > DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 90 DAY) LIMIT 1`, [email, ip]);
  }
  /** Ends every session of a user (password set by an admin, ban, deletion: H-10). */
  async function endSessions(db: Tx, userId: string) {
    const ids = await rows<{ id: string }>(db, 'SELECT id FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL', [userId]);
    await exec(db, 'UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP(6) WHERE user_id = ? AND revoked_at IS NULL', [userId]);
    forgetSessions(...ids.map(r => r.id));
  }

  /** Inserts auth_users and runs handle_new_user in the same transaction. */
  async function createAuthUser(tx: Tx, input: { email: string; password: string | null; passwordHash?: string; confirmed: boolean; appMeta?: Body; userMeta?: Body }) {
    const id = randomUUID();
    const appMeta = { provider: 'email', providers: ['email'], ...(input.appMeta || {}) };
    const userMeta = input.userMeta || {};
    await exec(tx, `INSERT INTO auth_users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      VALUES (?, ?, ?, ?, ?, ?)`, [id, input.email, input.passwordHash ?? (input.password ? await bcrypt.hash(input.password, BCRYPT_COST) : null),
      input.confirmed ? toMysqlDatetime(new Date()) : null, JSON.stringify(appMeta), JSON.stringify(userMeta)]);
    await handleNewUser({ tx, ctx: systemContext, schema, now: new Date() },
      { id, email: input.email, raw_app_meta_data: appMeta, raw_user_meta_data: userMeta }, config.universityDomain, input.confirmed);
    return (await findUserById(tx, id))!;
  }
  const isRuleFailure = (error: unknown) => error instanceof DbRuleError || (error as { sqlState?: string })?.sqlState !== undefined;

  function checkPassword(password: unknown): string {
    if (typeof password !== 'string' || password.length < config.passwordMinLength) throw authErrors.weakPassword(config.passwordMinLength);
    // bcrypt reads 72 bytes; a longer password would be cut without notice (L15).
    if (Buffer.byteLength(password, 'utf8') > 72) throw authErrors.validation('Password cannot be longer than 72 bytes');
    return password;
  }
  function checkEmail(value: unknown): string {
    const email = normalizeEmail(value);
    if (!email) throw authErrors.validation('An email address is required');
    if (!validEmail(email)) throw authErrors.invalidEmail(email);
    return email;
  }

  async function bearerUser(req: FastifyRequest): Promise<{ user: AuthUser; claims: Claims; restricted: boolean; mustChange: boolean }> {
    const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw authErrors.noAuthorization();
    const claims = await verifyJwt(config, token);
    if (!claims || claims.role !== 'authenticated' || typeof claims.sub !== 'string') throw authErrors.badJwt();
    if (!await sessionIsActive(pool, claims.session_id)) throw authErrors.sessionNotFound();
    const user = await findUserById(pool, claims.sub);
    if (!user) throw new AuthError(403, 'user_not_found', 'User from sub claim in JWT does not exist');
    if (isBanned(user)) throw authErrors.banned();
    const session = await one<{ restricted: boolean }>(pool, 'SELECT restricted FROM auth_sessions WHERE id = ?', [claims.session_id]);
    return { user, claims, restricted: !!session?.restricted, mustChange: user.raw_app_meta_data?.must_change_password === true };
  }
  async function requireService(req: FastifyRequest) {
    const ctx = await contextFromHeaders(config, undefined, req.headers.authorization);
    if (ctx?.role !== 'service_role') throw authErrors.notAdmin();
  }

  // The confirmation page posts an HTML form.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 8192 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

  // Every route except the browser navigations (the email-link target and the
  // two Microsoft sign-in steps) needs the anon or service key.
  app.addHook('preHandler', async (req: FastifyRequest) => {
    if (req.routeOptions.url?.endsWith('/verify') && (req.method === 'GET' || /urlencoded/i.test(String(req.headers['content-type'] ?? '')))) return;
    if (req.method === 'GET' && (req.routeOptions.url?.endsWith('/authorize') || req.routeOptions.url?.endsWith('/callback'))) return;
    if (req.routeOptions.url?.endsWith('/health')) return;
    const apikey = (req.headers.apikey as string | undefined) ?? (req.query as Body)?.apikey;
    if (!apikey) throw authErrors.missingKey();
    const ctx = await contextFromHeaders(config, apikey, undefined);
    if (!ctx || (ctx.role !== 'anon' && ctx.role !== 'service_role')) throw new AuthError(401, 'invalid_api_key', 'Invalid API key');
  });

  app.get('/health', async () => ({ version: 'asoiu-career-api', name: 'GoTrue', description: 'GoTrue-compatible auth on MySQL' }));

  app.get('/settings', async () => ({
    external: { anonymous_users: false, apple: false, azure: !!config.azure, bitbucket: false, discord: false, facebook: false, figma: false,
      fly: false, github: false, gitlab: false, google: !!config.google, keycloak: false, kakao: false, linkedin: false, linkedin_oidc: false,
      notion: false, spotify: false, slack: false, slack_oidc: false, workos: false, twitch: false, twitter: false, email: true, phone: false, zoom: false },
    disable_signup: config.disableSignup, mailer_autoconfirm: config.mailerAutoconfirm, phone_autoconfirm: false, sms_provider: '', saml_enabled: false
  }));

  app.get('/.well-known/jwks.json', async () => ({ keys: [] }));

  // Microsoft 365 sign-in (azure.ts: only the university's directory) and
  // Google sign-in (google.ts). Only a browser that holds a PKCE verifier can
  // finish either.
  app.get('/authorize', async (req: FastifyRequest<{ Querystring: Body }>, reply: FastifyReply) => {
    const query = req.query || {};
    const provider = query.provider === 'azure' && config.azure ? 'azure' : query.provider === 'google' && config.google ? 'google' : null;
    if (!provider) throw authErrors.validation('Unsupported provider: provider is not enabled');
    const pkce = pkceOf(query);
    if (!pkce) throw authErrors.validation('code_challenge is required');
    limit(signIns, ipKey(req));
    const hint = String(query.role ?? '');
    const role = hint === 'student' || hint === 'master_student' || hint === 'graduate' ? hint : null;
    const state = newAzureState({ provider, redirect: redirectTarget(query.redirect_to), pkce, role });
    const signed = signAzureState(config.jwtSecret, state);
    const selectAccount = query.prompt === 'select_account';
    const target = provider === 'google'
      ? googleAuthorizeUrl(config.google!, config.publicUrl, state, signed, selectAccount)
      : azureAuthorizeUrl(config.azure!, config.publicUrl, config.universityDomain, state, signed, selectAccount);
    return reply.redirect(target, 302);
  });

  app.get('/callback', async (req: FastifyRequest<{ Querystring: Body }>, reply: FastifyReply) => {
    const query = req.query || {};
    const state = readAzureState(config.jwtSecret, query.state);
    // Without a valid state the place to return to is not known: the site's home.
    const back = (target: string, errorCode: string, description: string) =>
      reply.redirect(`${target}#${new URLSearchParams({ error: 'access_denied', error_code: errorCode, error_description: description })}`, 303);
    const provider = state?.provider === 'google' ? 'google' : 'azure';
    const name = provider === 'google' ? 'Google' : 'Microsoft';
    if (!state || !(provider === 'google' ? config.google : config.azure)) return back(config.siteUrl, 'bad_oauth_state', 'OAuth state is invalid or has expired');
    // Cancelled, or refused by the provider: its own text is not passed on.
    if (query.error || typeof query.code !== 'string' || !query.code) return back(state.redirect, 'access_denied', 'Sign-in was cancelled');
    limit(signIns, ipKey(req));
    let identity: { email: string; name: string };
    try {
      identity = provider === 'google'
        ? await googleIdentity(config.google!, config.publicUrl, config.universityDomain, query.code, state.nonce)
        : await azureIdentity(config.azure!, config.publicUrl, config.universityDomain, query.code, state.nonce);
    } catch (error) {
      if (error instanceof OAuthSignInError) return back(state.redirect, error.errorCode, error.message);
      app.log.error({ err: error }, `${name} token exchange failed`);
      return back(state.redirect, 'provider_error', `${name} did not confirm the sign-in`);
    }
    let code: string;
    try {
      code = await transaction(pool, tx => oauthSignIn(tx, provider, identity, state));
    } catch (error) {
      if (error instanceof AuthError) return back(state.redirect, error.errorCode, error.message);
      if (isRuleFailure(error)) return back(state.redirect, 'signup_disabled', error instanceof DbRuleError ? error.message : 'Database error saving new user');
      throw error;
    }
    const [base, fragment] = state.redirect.split('#');
    return reply.redirect(`${base}${base.includes('?') ? '&' : '?'}code=${encodeURIComponent(code)}${fragment !== undefined ? `#${fragment}` : ''}`, 303);
  });

  /** The account of a Microsoft or Google identity: the one with its address,
   *  or a new one. The provider vouches for the mailbox, as a confirmation link
   *  would. A new Google account is always a graduate's, also from the sign-in
   *  tab (most graduates have no university mailbox any more): it waits until
   *  staff have checked the diploma details (alumni.ts). Students sign up with
   *  their university address, so "Tələbə"/"Magistr" with Google is refused. */
  async function oauthSignIn(tx: Tx, provider: 'azure' | 'google', identity: { email: string; name: string }, state: AzureState): Promise<string> {
    let user = await findUserByEmail(tx, identity.email, true);
    if (!user) {
      if (config.disableSignup) throw authErrors.signupDisabled();
      if (provider === 'google' && state.role !== null && state.role !== 'graduate') {
        throw new AuthError(422, 'signup_disabled',
          `Tələbə hesabı @${config.universityDomain} (Outlook) ilə yaradılır. Məzunsunuzsa, qeydiyyatda "Məzun" seçin.`);
      }
      const role = provider === 'google' ? 'graduate' : state.role;
      const status = role === 'graduate' ? 'alumni' : role === 'master_student' ? 'master_student' : 'student';
      user = await createAuthUser(tx, {
        email: identity.email, password: null, confirmed: true,
        appMeta: { provider, providers: [provider] },
        userMeta: { full_name: identity.name || undefined, role: role === 'graduate' ? 'graduate' : 'student', account_status: status }
      });
    } else {
      if (isBanned(user)) throw authErrors.banned();
      if (!user.email_confirmed_at) {
        // A password set at someone else's sign-up with this address stops
        // working, as with a magic link (audit 2026-11-16, M9).
        await exec(tx, 'UPDATE auth_users SET encrypted_password = NULL WHERE id = ? AND email_confirmed_at IS NULL', [user.id]);
        if (user.raw_app_meta_data?.activate_on_confirm === true) {
          await updateRow({ tx, ctx: systemContext, schema, now: new Date() }, 'profiles', { id: user.id }, { status: 'active' });
          await exec(tx, `UPDATE auth_users SET raw_app_meta_data = JSON_REMOVE(raw_app_meta_data, '$.activate_on_confirm') WHERE id = ?`, [user.id]);
        }
        await exec(tx, 'UPDATE auth_users SET email_confirmed_at = CURRENT_TIMESTAMP(6) WHERE id = ?', [user.id]);
      }
      const providers = Array.isArray(user.raw_app_meta_data?.providers) ? user.raw_app_meta_data.providers as unknown[] : [];
      if (!providers.includes(provider)) {
        await exec(tx, `UPDATE auth_users SET raw_app_meta_data = JSON_SET(COALESCE(raw_app_meta_data, JSON_OBJECT()), '$.providers', CAST(? AS JSON)) WHERE id = ?`,
          [JSON.stringify([...providers, provider]), user.id]);
      }
    }
    return createFlowCode(tx, user.id, provider, state.pkce);
  }

  app.post('/signup', async (req: FastifyRequest<{ Body: Body; Querystring: Body }>) => {
    if (config.disableSignup) throw authErrors.signupDisabled();
    const body = req.body || {};
    const email = checkEmail(body.email);
    const password = checkPassword(body.password);
    checkMetadata(body.data);
    limit(signups, ipKey(req));
    const redirect = redirectTarget(req.query.redirect_to ?? body.redirect_to);
    // Hashed for every request, also when the address exists: same time either way (L9).
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const outcome = await transaction(pool, async tx => {
      const existing = await findUserByEmail(tx, email, true);
      if (existing) {
        if (config.mailerAutoconfirm) throw authErrors.userExists();
        // An address that is already in use answers like a new sign-up and the
        // owner gets a note instead: no data and no "exists" leaks (#13, #18).
        if (existing.email_confirmed_at || existing.raw_app_meta_data?.invited) return { duplicate: existing };
        // H-04: an unconfirmed sign-up belongs to whoever confirms the newest
        // link. The earlier attempt (its password and profile) is replaced, so a
        // pre-registered password can never be the one that works later.
        await deleteRow({ tx, ctx: systemContext, schema, now: new Date() }, 'auth_users', { id: existing.id });
      }
      let user: AuthUser;
      try {
        user = await createAuthUser(tx, { email, password, passwordHash, confirmed: config.mailerAutoconfirm, userMeta: body.data });
      } catch (error) {
        if (isRuleFailure(error)) { req.log.warn({ err: error }, 'signup rejected by handle_new_user'); throw authErrors.databaseSignup(); }
        throw error;
      }
      if (config.mailerAutoconfirm) return { session: await startSession(tx, config, user, 'password', meta(req)) };
      return { user, token: await createOneTimeToken(tx, user.id, 'email_confirmation', LINK_MINUTES, null, false, pkceOf(body)) };
    });
    if ('session' in outcome) return outcome.session;
    const sentAt = new Date().toISOString();
    if ('duplicate' in outcome) {
      if (emailsPerIp.take(ipKey(req))) deliver(composeMail('already_registered', email, config.siteUrl, null));
      return { ...toGoTrueUser({ ...outcome.duplicate, id: randomUUID(), raw_user_meta_data: {}, raw_app_meta_data: {}, created_at: sentAt, updated_at: sentAt,
        last_sign_in_at: null, email_confirmed_at: null } as AuthUser), identities: [], confirmation_sent_at: sentAt };
    }
    if (emailsPerIp.take(ipKey(req))) deliver(composeMail('confirmation', outcome.user.email!, verifyLink(outcome.token, 'signup', redirect), LINK_MINUTES));
    return { ...toGoTrueUser(outcome.user), confirmation_sent_at: sentAt };
  });

  app.post('/token', async (req: FastifyRequest<{ Body: Body; Querystring: Body }>) => {
    const body = req.body || {};
    if (req.query.grant_type === 'refresh_token') {
      limit(refreshes, ipKey(req));
      if (typeof body.refresh_token !== 'string' || !body.refresh_token) throw authErrors.refreshNotFound();
      const result = await transaction(pool, tx => refreshSession(tx, config, body.refresh_token));
      if ('replayed' in result) throw authErrors.refreshUsed();
      return result;
    }
    if (req.query.grant_type === 'link_code') {
      // The code an email link without a verifier brings to the site (L48).
      limit(signIns, ipKey(req));
      if (typeof body.link_code !== 'string') throw authErrors.validation('link_code is required');
      const flow = await transaction(pool, tx => consumeLinkCode(tx, body.link_code));
      if (!flow) throw new AuthError(400, 'flow_state_not_found', 'invalid flow state, no valid flow state found');
      return transaction(pool, async tx => {
        const user = await findUserById(tx, flow.user_id);
        if (!user) throw new AuthError(400, 'flow_state_not_found', 'invalid flow state, no valid flow state found');
        if (isBanned(user)) throw authErrors.banned();
        return startSession(tx, config, user, AMR[flow.purpose] || 'otp', meta(req), flow.purpose === 'recovery');
      });
    }
    if (req.query.grant_type === 'pkce') {
      // The code from an email link and the verifier kept by the browser that
      // asked for the link (L48). A code works once, for five minutes.
      limit(signIns, ipKey(req));
      if (typeof body.auth_code !== 'string' || typeof body.code_verifier !== 'string') throw authErrors.validation('auth_code and code_verifier are required');
      // The code is used up in its own transaction, so a wrong verifier closes it
      // too (an error in the session transaction would roll that back).
      const flow = await transaction(pool, tx => consumeFlowCode(tx, body.auth_code, body.code_verifier));
      if (!flow) throw new AuthError(400, 'flow_state_not_found', 'invalid flow state, no valid flow state found');
      return transaction(pool, async tx => {
        const user = await findUserById(tx, flow.user_id);
        if (!user) throw new AuthError(400, 'flow_state_not_found', 'invalid flow state, no valid flow state found');
        if (isBanned(user)) throw authErrors.banned();
        return startSession(tx, config, user, AMR[flow.purpose] || 'otp', meta(req), flow.purpose === 'recovery');
      });
    }
    if (req.query.grant_type !== 'password') throw new AuthError(400, 'validation_failed', 'unsupported_grant_type');
    limit(signIns, ipKey(req));
    const email = normalizeEmail(body.email);
    const lockKey = `${email}|${ipKey(req)}`;
    // Ten wrong passwords from one client lock that client out of the account for
    // 15 minutes (#64); others, the owner included, can still sign in (M7).
    if (email && failedSignIns.retryAfter(lockKey) > 0) throw authErrors.rateLimited();
    // Many failures from many clients: every attempt on the account waits longer.
    const failures = email ? failedPerAccount.count(email) : 0;
    if (failures > 20) await new Promise(resolve => setTimeout(resolve, Math.min(3000, (failures - 20) * 100)));
    const user = email ? await findUserByEmail(pool, email) : null;
    const password = String(body.password ?? '');
    // No password over 72 bytes was ever set (L15); it is still compared, for equal timing.
    const matches = await bcrypt.compare(password, user?.encrypted_password || DUMMY_HASH) && Buffer.byteLength(password, 'utf8') <= 72;
    if (!user || !user.encrypted_password || !matches) {
      if (email) { failedSignIns.take(lockKey); failedPerAccount.take(email); }
      throw authErrors.invalidCredentials();
    }
    if (!user.email_confirmed_at) throw authErrors.emailNotConfirmed();
    if (isBanned(user)) throw authErrors.banned();
    return transaction(pool, tx => startSession(tx, config, user, 'password', meta(req)));
  });

  app.post('/logout', async (req: FastifyRequest<{ Querystring: Body }>, reply: FastifyReply) => {
    const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const claims = token ? await verifyJwt(config, token) : null;
    if (!claims || claims.role !== 'authenticated' || typeof claims.sub !== 'string') throw authErrors.badJwt();
    const scope = ['global', 'local', 'others'].includes(req.query.scope) ? req.query.scope : 'global';
    const ended = await transaction(pool, async tx => {
      const ids = await rows<{ id: string }>(tx, 'SELECT id FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL', [claims.sub]);
      await revokeSessions(tx, claims.sub!, claims.session_id, scope);
      return ids.map(r => r.id).filter(id => scope === 'global' || (scope === 'local' ? id === claims.session_id : id !== claims.session_id));
    });
    forgetSessions(...ended);
    return reply.code(204).send();
  });

  app.get('/user', async (req: FastifyRequest) => toGoTrueUser((await bearerUser(req)).user));

  // GoTrue's reauthentication: a six-digit code by email before a dangerous
  // step, here the platform reset (audit v4, M-03: a second factor besides the password).
  const reauthCooldown = new RateLimiter(1, 60_000);
  const reauthHourly = new RateLimiter(5, 60 * 60_000);
  app.get('/reauthenticate', async (req: FastifyRequest) => {
    const { user, restricted, mustChange } = await bearerUser(req);
    if (restricted || mustChange) throw new AuthError(403, 'password_change_required', 'Set a new password first');
    if (!user.email) throw authErrors.validation('The account has no email address');
    if (!reauthCooldown.take(user.id)) throw authErrors.tooFrequent(reauthCooldown.retryAfter(user.id) || 60);
    if (!reauthHourly.take(user.id)) throw authErrors.rateLimited();
    const code = await transaction(pool, tx => createReauthCode(tx, user.id));
    deliver(composeCodeMail(user.email, code));
    return {};
  });

  app.put('/user', async (req: FastifyRequest<{ Body: Body; Querystring: Body }>) => {
    const { user, claims, restricted, mustChange } = await bearerUser(req);
    const body = req.body || {};
    // A session from a recovery link, or an account with a temporary password,
    // only sets the new password (#15, audit 2026-11-16 M44).
    if ((restricted || mustChange) && (body.email !== undefined || body.data !== undefined || body.password === undefined)) {
      throw new AuthError(403, 'password_change_required', 'Set a new password first');
    }
    checkMetadata(body.data);
    // Without the second link to the current address, an email change asks for the
    // password instead, so a stolen session alone cannot move the account (L10).
    if (body.email !== undefined && !config.secureEmailChange && user.encrypted_password && !restricted) {
      if (typeof body.current_password !== 'string' || !await bcrypt.compare(body.current_password, user.encrypted_password)) {
        throw new AuthError(400, 'invalid_credentials', 'Current password is incorrect');
      }
    }
    const newEmail = body.email === undefined ? null : checkEmail(body.email);
    let changeTokens: { to: string; kind: MailKind; token: string }[] = [];
    let ended: string[] = [];
    await transaction(pool, async tx => {
      if (newEmail && newEmail !== user.email) {
        // Secure email change: a link to the new address (and to the current one);
        // the address changes once every link is confirmed. An address in use by
        // someone else gets no link and no error: nobody learns who is registered (#18).
        if (!emailChanges.take(user.id)) throw authErrors.rateLimited();
        await cooldown(newEmail, req.ip);
        const taken = await findUserByEmail(tx, newEmail);
        if (!taken || taken.id === user.id) changeTokens = await startEmailChange(tx, user, newEmail);
      }
      if (body.password !== undefined) {
        const password = checkPassword(body.password);
        // The current password is checked here, not only in the browser (#14);
        // a recovery-link session or an account without a password needs none.
        if (!restricted && user.encrypted_password) {
          if (typeof body.current_password !== 'string' || !await bcrypt.compare(body.current_password, user.encrypted_password)) {
            throw new AuthError(400, 'invalid_credentials', 'Current password is incorrect');
          }
        }
        if (user.encrypted_password && await bcrypt.compare(password, user.encrypted_password)) {
          throw new AuthError(422, 'same_password', 'New password should be different from the old password.');
        }
        // A temporary password set by the Career Centre is replaced now (#32).
        await exec(tx, `UPDATE auth_users SET encrypted_password = ?,
            raw_app_meta_data = JSON_REMOVE(IF(JSON_EXTRACT(raw_app_meta_data, '$.must_change_password') = CAST('true' AS JSON),
              JSON_SET(raw_app_meta_data, '$.must_change_password', FALSE), raw_app_meta_data), '$.needs_password')
          WHERE id = ?`, [await bcrypt.hash(password, BCRYPT_COST), user.id]);
        // Every other session ends; this one may now do everything again (H-10).
        ended = (await rows<{ id: string }>(tx, 'SELECT id FROM auth_sessions WHERE user_id = ? AND id <> ? AND revoked_at IS NULL',
          [user.id, claims.session_id ?? ''])).map(r => r.id);
        await revokeSessions(tx, user.id, claims.session_id, 'others');
        await exec(tx, 'UPDATE auth_sessions SET restricted = 0 WHERE id = ?', [claims.session_id ?? '']);
      }
      if (body.data !== undefined) {
        await exec(tx, 'UPDATE auth_users SET raw_user_meta_data = ? WHERE id = ?',
          [JSON.stringify(mergeMetadata(user.raw_user_meta_data || {}, body.data)), user.id]);
      }
    });
    forgetSessions(...ended, claims.session_id);
    const redirect = redirectTarget((req.query as Body | undefined)?.redirect_to);
    for (const mail of changeTokens) {
      if (!emailsPerIp.take(ipKey(req))) throw authErrors.rateLimited();
      await mailer.send(composeMail(mail.kind, mail.to, verifyLink(mail.token, 'email_change', redirect)));
    }
    const fresh = (await findUserById(pool, user.id))!;
    // A request for an address that is taken looks like a pending change.
    return toGoTrueUser(newEmail && newEmail !== user.email && !changeTokens.length
      ? { ...fresh, email_change: newEmail, email_change_sent_at: new Date().toISOString() } : fresh);
  });

  app.post('/recover', async (req: FastifyRequest<{ Body: Body; Querystring: Body }>) => {
    const email = checkEmail(req.body?.email);
    mailQuota(req);
    await cooldown(email, req.ip);
    const user = await findUserByEmail(pool, email);
    if (user) {
      const pkce = pkceOf(req.body || {});
      const token = await transaction(pool, tx => createOneTimeToken(tx, user.id, 'recovery', LINK_MINUTES, null, true, pkce));
      deliver(composeMail('recovery', user.email!, verifyLink(token, 'recovery', redirectTarget(req.query.redirect_to ?? req.body?.redirect_to)), LINK_MINUTES));
    }
    return {};
  });

  app.post('/otp', async (req: FastifyRequest<{ Body: Body; Querystring: Body }>) => {
    const body = req.body || {};
    const email = checkEmail(body.email);
    checkMetadata(body.data);
    mailQuota(req);
    await cooldown(email, req.ip);
    const redirect = redirectTarget(req.query.redirect_to ?? body.redirect_to);
    const outcome = await transaction(pool, async tx => {
      let user = await findUserByEmail(tx, email, true);
      if (!user) {
        // No account: the same empty answer as when one exists (#18).
        if (body.create_user === false || config.disableSignup) return null;
        // Creating accounts counts against the sign-up limit (#17).
        limit(signups, ipKey(req));
        try { user = await createAuthUser(tx, { email, password: null, confirmed: false, userMeta: body.data }); }
        catch (error) { if (isRuleFailure(error)) throw authErrors.databaseSignup(); throw error; }
      }
      return { user, token: await createOneTimeToken(tx, user.id, 'magic_link', LINK_MINUTES, null, true, pkceOf(body)) };
    });
    if (outcome) deliver(composeMail('magic_link', outcome.user.email!, verifyLink(outcome.token, 'magiclink', redirect), LINK_MINUTES));
    return {};
  });

  /** Fresh email-change links (the new address, and the current one when secure);
   *  earlier links stop working and confirmation starts over. */
  async function startEmailChange(tx: Tx, user: AuthUser, newEmail: string) {
    await exec(tx, `UPDATE auth_one_time_tokens SET used_at = CURRENT_TIMESTAMP(6) WHERE user_id = ? AND purpose = 'email_change' AND used_at IS NULL`, [user.id]);
    await exec(tx, `UPDATE auth_users SET email_change = ?, email_change_confirm_status = 0, email_change_sent_at = CURRENT_TIMESTAMP(6) WHERE id = ?`,
      [newEmail, user.id]);
    const tokens: { to: string; kind: MailKind; token: string }[] =
      [{ to: newEmail, kind: 'email_change', token: await createOneTimeToken(tx, user.id, 'email_change', LINK_MINUTES, newEmail) }];
    if (config.secureEmailChange && user.email) {
      tokens.push({ to: user.email, kind: 'email_change_current', token: await createOneTimeToken(tx, user.id, 'email_change', LINK_MINUTES, user.email) });
    }
    return tokens;
  }

  app.post('/resend', async (req: FastifyRequest<{ Body: Body; Querystring: Body }>) => {
    const body = req.body || {};
    if (body.type === 'email_change') {
      // GoTrue: the email is the pending new address. Only the account itself may
      // send its links again; that also voids the earlier ones (audit 2026-11-16, L11).
      const { user: me } = await bearerUser(req);
      const pendingEmail = checkEmail(body.email);
      mailQuota(req);
      await cooldown(pendingEmail, req.ip);
      const user = me.email_change === pendingEmail ? me : null;
      if (user) {
        const tokens = await transaction(pool, tx => startEmailChange(tx, user, pendingEmail));
        const redirect = redirectTarget(req.query.redirect_to ?? body.options?.emailRedirectTo);
        for (const mail of tokens) deliver(composeMail(mail.kind, mail.to, verifyLink(mail.token, 'email_change', redirect)));
      }
      return {};
    }
    if (body.type !== 'signup') throw authErrors.validation('Only signup and email_change links can be resent');
    const email = checkEmail(body.email);
    mailQuota(req);
    await cooldown(email, req.ip);
    const user = await findUserByEmail(pool, email);
    if (user && !user.email_confirmed_at) {
      // Marked as resent: its confirmation drops a password set at sign-up (audit v4, H-01).
      const token = await transaction(pool, tx => createOneTimeToken(tx, user.id, 'email_confirmation', LINK_MINUTES, 'resend', false, pkceOf(body)));
      deliver(composeMail('confirmation', user.email!, verifyLink(token, 'signup', redirectTarget(req.query.redirect_to ?? body.options?.emailRedirectTo)), LINK_MINUTES));
    }
    return {};
  });

  /** Consumes an email token, confirms the address and opens a session. For an
   *  email change confirmed on one of two addresses, returns the GoTrue message. */
  async function verify(token: string, type: string, _req: FastifyRequest): Promise<{ msg: string } | { code: string } | { linkCode: string }> {
    // Own keys only: type=constructor is not a purpose (#75).
    const purposes = Object.hasOwn(PURPOSE, type) ? PURPOSE[type] : null;
    if (!purposes || !token) throw authErrors.otpExpired();
    return transaction(pool, async tx => {
      const used = await consumeOneTimeToken(tx, token, purposes);
      if (used.purpose === 'email_change') {
        const pending = await findUserById(tx, used.user_id, true);
        if (!pending?.email_change || (used.relates_to !== pending.email_change && used.relates_to !== pending.email)) throw authErrors.otpExpired();
        if (config.secureEmailChange && pending.email && pending.email_change_confirm_status === 0) {
          await exec(tx, 'UPDATE auth_users SET email_change_confirm_status = 1 WHERE id = ?', [pending.id]);
          return { msg: HALF_CONFIRMED };
        }
        const taken = await findUserByEmail(tx, pending.email_change);
        if (taken && taken.id !== pending.id) throw authErrors.emailExists();
        await exec(tx, `UPDATE auth_users SET email = email_change, email_change = NULL, email_change_confirm_status = 0,
            email_confirmed_at = COALESCE(email_confirmed_at, CURRENT_TIMESTAMP(6)) WHERE id = ?`, [pending.id]);
      }
      // An account confirmed for the first time by a magic link (or an invite) did
      // not choose its password through this mailbox: a password set at a
      // stranger's sign-up stops working (audit 2026-11-16, M9).
      // A resent confirmation too (audit v4, H-01): whoever signed up first chose
      // that password, not necessarily the owner of the mailbox.
      if (used.purpose === 'magic_link' || used.purpose === 'invite' || (used.purpose === 'email_confirmation' && used.relates_to === 'resend')) {
        await exec(tx, 'UPDATE auth_users SET encrypted_password = NULL WHERE id = ? AND email_confirmed_at IS NULL', [used.user_id]);
      }
      // L-6: the first confirmation makes a waiting sign-up's profile active.
      if (await one(tx, `SELECT 1 AS ok FROM auth_users WHERE id = ? AND JSON_EXTRACT(raw_app_meta_data, '$.activate_on_confirm') = CAST('true' AS JSON)`, [used.user_id])) {
        await updateRow({ tx, ctx: systemContext, schema, now: new Date() }, 'profiles', { id: used.user_id }, { status: 'active' });
        await exec(tx, `UPDATE auth_users SET raw_app_meta_data = JSON_REMOVE(raw_app_meta_data, '$.activate_on_confirm') WHERE id = ?`, [used.user_id]);
      }
      await exec(tx, 'UPDATE auth_users SET email_confirmed_at = COALESCE(email_confirmed_at, CURRENT_TIMESTAMP(6)) WHERE id = ?', [used.user_id]);
      // An account without a password is asked for one on the site.
      await exec(tx, `UPDATE auth_users SET raw_app_meta_data = JSON_SET(COALESCE(raw_app_meta_data, JSON_OBJECT()), '$.needs_password', TRUE)
        WHERE id = ? AND encrypted_password IS NULL`, [used.user_id]);
      const user = await findUserById(tx, used.user_id);
      if (!user) throw authErrors.otpExpired();
      if (isBanned(user)) throw authErrors.banned();
      // Code flow: the browser that asked for the link gets a one-time code, and
      // trades it (with its verifier) for the session; no token in the address (L48).
      if (used.code_challenge && used.code_challenge_method) {
        return { code: await createFlowCode(tx, user.id, used.purpose, { challenge: used.code_challenge, method: used.code_challenge_method as CodeChallenge['method'] }) };
      }
      // A link without a verifier (an invitation, a resent confirmation, an email
      // change) gets a one-time link code too: the site trades it for the session,
      // so no session token is ever in an address (L48).
      return { linkCode: await createFlowCode(tx, user.id, used.purpose, { challenge: '-', method: 'link' }) };
    });
  }

  /** Consumes a link and sends the browser back to the site with the session. */
  async function verifyAndRedirect(req: FastifyRequest, reply: FastifyReply, token: unknown, type: unknown, redirectTo: unknown) {
    const redirect = redirectTarget(redirectTo);
    try {
      const session = await verify(String(token ?? ''), String(type ?? ''), req);
      if ('msg' in session) return reply.redirect(`${redirect}#${new URLSearchParams({ message: session.msg })}`, 303);
      if ('code' in session) {
        const [base, fragment] = redirect.split('#');
        return reply.redirect(`${base}${base.includes('?') ? '&' : '?'}code=${encodeURIComponent(session.code)}${fragment !== undefined ? `#${fragment}` : ''}`, 303);
      }
      return reply.redirect(`${redirect}#${new URLSearchParams({ link_code: session.linkCode, type: String(type) })}`, 303);
    } catch (error) {
      if (!(error instanceof AuthError)) throw error;
      const hash = new URLSearchParams({ error: 'access_denied', error_code: error.errorCode, error_description: 'Email link is invalid or has expired' });
      return reply.redirect(`${redirect}#${hash}`, 303);
    }
  }

  app.post('/verify', async (req: FastifyRequest<{ Body: Body }>, reply: FastifyReply) => {
    const body = req.body || {};
    // The confirmation page's form: consume the link and go back to the site.
    if (/urlencoded/i.test(String(req.headers['content-type'] ?? ''))) return verifyAndRedirect(req, reply, body.token, body.type, body.redirect_to);
    return verify(String(body.token_hash ?? body.token ?? ''), String(body.type ?? ''), req);
  });

  // The link in an email opens a page with one button; only the button (a POST)
  // uses the link, so mail scanners that open links do not burn it (#75).
  const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  app.get('/verify', async (req: FastifyRequest<{ Querystring: Body }>, reply: FastifyReply) => {
    const field = (name: string, value: unknown) => `<input type="hidden" name="${name}" value="${escapeHtml(String(value ?? '').slice(0, 2048))}">`;
    const type = String(req.query.type ?? '');
    const action = type === 'recovery' ? 'Davam et və yeni şifrə təyin et' : 'Təsdiqlə';
    // The answer to the button is a redirect to the site; form-action covers redirects
    // too, so the (allow-listed) site origin is permitted besides this API.
    let target = '';
    try { target = new URL(redirectTarget(req.query.redirect_to)).origin; } catch { target = ''; }
    return reply.code(200)
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header('x-frame-options', 'DENY')
      .header('content-security-policy', `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${target}; base-uri 'none'; frame-ancestors 'none'`)
      .send(`<!doctype html><html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ADNSU Karyera</title><style>body{font-family:system-ui,sans-serif;background:#f3f5fb;display:grid;place-items:center;min-height:100vh;margin:0}
main{background:#fff;padding:32px 28px;border-radius:16px;max-width:420px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.08)}
button{background:#0b1f6b;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:16px;cursor:pointer}</style></head>
<body><main><h1 style="font-size:20px">ADNSU Karyera Mərkəzi</h1><p>Davam etmək üçün düyməni basın.</p>
<form method="post" action="${escapeHtml(config.publicUrl)}/auth/v1/verify">${field('token', req.query.token)}${field('type', type)}${field('redirect_to', req.query.redirect_to)}
<button type="submit">${action}</button></form></main></body></html>`);
  });

  // ---- admin API (service role only) ----
  function banUntil(duration: unknown): string | null | undefined {
    if (duration === undefined) return undefined;
    if (duration === 'none') return null;
    const m = String(duration).match(/^(\d+)(h|m|s)$/);
    if (!m) throw authErrors.validation('ban_duration must look like 24h or none');
    const ms = Number(m[1]) * (m[2] === 'h' ? 3_600_000 : m[2] === 'm' ? 60_000 : 1000);
    return toMysqlDatetime(new Date(Date.now() + ms));
  }

  app.get('/admin/users', async (req: FastifyRequest<{ Querystring: Body }>, reply: FastifyReply) => {
    await requireService(req);
    const page = Math.max(1, Number(req.query.page || 1));
    const perPage = Math.min(1000, Math.max(1, Number(req.query.per_page || 50)));
    const [list] = await pool.query('SELECT * FROM auth_users WHERE deleted_at IS NULL ORDER BY created_at LIMIT ? OFFSET ?', [perPage, (page - 1) * perPage]);
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM auth_users WHERE deleted_at IS NULL') as any;
    reply.header('x-total-count', String(total));
    return { users: (list as AuthUser[]).map(toGoTrueUser), aud: 'authenticated' };
  });

  app.get('/admin/users/:id', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    await requireService(req);
    const user = await findUserById(pool, req.params.id);
    if (!user) throw authErrors.userNotFound();
    return toGoTrueUser(user);
  });

  app.post('/admin/users', async (req: FastifyRequest<{ Body: Body }>) => {
    await requireService(req);
    const body = req.body || {};
    const email = checkEmail(body.email);
    const password = body.password === undefined ? null : checkPassword(body.password);
    const user = await transaction(pool, async tx => {
      if (await findUserByEmail(tx, email, true)) throw authErrors.emailExists();
      try {
        const created = await createAuthUser(tx, { email, password, confirmed: body.email_confirm === true, appMeta: body.app_metadata, userMeta: body.user_metadata });
        const ban = banUntil(body.ban_duration);
        if (ban !== undefined) await exec(tx, 'UPDATE auth_users SET banned_until = ? WHERE id = ?', [ban, created.id]);
        return (await findUserById(tx, created.id))!;
      } catch (error) {
        if (isRuleFailure(error)) throw new AuthError(500, 'unexpected_failure', 'Database error creating new user');
        throw error;
      }
    });
    return toGoTrueUser(user);
  });

  app.put('/admin/users/:id', async (req: FastifyRequest<{ Params: { id: string }; Body: Body }>) => {
    await requireService(req);
    const body = req.body || {};
    const user = await transaction(pool, async tx => {
      const current = await findUserById(tx, req.params.id, true);
      if (!current) throw authErrors.userNotFound();
      const sets: string[] = []; const params: unknown[] = [];
      if (body.email !== undefined) {
        const email = checkEmail(body.email);
        const other = await findUserByEmail(tx, email);
        if (other && other.id !== current.id) throw authErrors.emailExists();
        sets.push('email = ?'); params.push(email);
      }
      if (body.password !== undefined) {
        sets.push('encrypted_password = ?'); params.push(await bcrypt.hash(checkPassword(body.password), BCRYPT_COST));
        if (body.app_metadata === undefined) sets.push(`raw_app_meta_data = JSON_REMOVE(COALESCE(raw_app_meta_data, JSON_OBJECT()), '$.needs_password')`);
      }
      if (body.email_confirm === true) sets.push('email_confirmed_at = COALESCE(email_confirmed_at, CURRENT_TIMESTAMP(6))');
      if (body.app_metadata !== undefined) {
        const merged = mergeMetadata(current.raw_app_meta_data || {}, body.app_metadata) as Record<string, unknown>;
        if (body.password !== undefined) delete merged.needs_password;
        sets.push('raw_app_meta_data = ?'); params.push(JSON.stringify(merged));
      }
      if (body.user_metadata !== undefined) { sets.push('raw_user_meta_data = ?'); params.push(JSON.stringify(mergeMetadata(current.raw_user_meta_data || {}, body.user_metadata))); }
      const ban = banUntil(body.ban_duration);
      if (ban !== undefined) { sets.push('banned_until = ?'); params.push(ban); }
      if (sets.length) await exec(tx, `UPDATE auth_users SET ${sets.join(', ')} WHERE id = ?`, [...params, current.id]);
      // A password set by an administrator, or a ban, ends every open session (H-10).
      if (body.password !== undefined || (ban !== undefined && ban !== null)) await endSessions(tx, current.id);
      return (await findUserById(tx, current.id))!;
    });
    return toGoTrueUser(user);
  });

  app.delete('/admin/users/:id', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    await requireService(req);
    const user = await findUserById(pool, req.params.id);
    if (!user) throw authErrors.userNotFound();
    // Through the write pipeline: the profile and its rows go with their
    // triggers (audit, quota counters), as the Postgres FK cascade did.
    await transaction(pool, async tx => {
      await endSessions(tx, user.id);
      await deleteRow({ tx, ctx: systemContext, schema, now: new Date() }, 'auth_users', { id: user.id });
    });
    return toGoTrueUser(user);
  });

  app.post('/invite', async (req: FastifyRequest<{ Body: Body; Querystring: Body }>) => {
    await requireService(req);
    const body = req.body || {};
    const email = checkEmail(body.email);
    const redirect = redirectTarget(req.query.redirect_to ?? body.redirect_to);
    checkMetadata(body.data);
    const outcome = await transaction(pool, async tx => {
      const existing = await findUserByEmail(tx, email, true);
      // An invite that was never accepted is sent again with a new link (M31).
      if (existing && existing.raw_app_meta_data?.invited && !existing.email_confirmed_at) {
        return { user: existing, created: false, token: await createOneTimeToken(tx, existing.id, 'invite', INVITE_MINUTES) };
      }
      if (existing) throw authErrors.emailExists();
      let user: AuthUser;
      try { user = await createAuthUser(tx, { email, password: null, confirmed: false, appMeta: { invited: true }, userMeta: body.data }); }
      catch (error) { if (isRuleFailure(error)) throw new AuthError(500, 'unexpected_failure', 'Database error saving new user'); throw error; }
      return { user, created: true, token: await createOneTimeToken(tx, user.id, 'invite', INVITE_MINUTES) };
    });
    try {
      await mailer.send(composeMail('invite', email, verifyLink(outcome.token, 'invite', redirect), INVITE_MINUTES));
    } catch (error) {
      // No email, no account: the invite can simply be tried again (M31).
      req.log.error({ err: error }, 'invite email failed');
      if (outcome.created) await transaction(pool, tx => deleteRow({ tx, ctx: systemContext, schema, now: new Date() }, 'auth_users', { id: outcome.user.id }));
      throw new AuthError(502, 'email_send_failed', 'The invite email could not be sent; try again');
    }
    return toGoTrueUser(outcome.user);
  });
}
