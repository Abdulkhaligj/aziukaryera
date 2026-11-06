// /auth/v1 — the subset of the GoTrue API that the student site, the admin
// panel and the Edge Functions call through supabase-js.
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'mysql2/promise';
import type { Config } from '../config.ts';
import { contextFromHeaders, systemContext, verifyJwt, type Claims } from '../context.ts';
import { exec, toMysqlDatetime, transaction, type Tx } from '../db.ts';
import { AuthError, authErrors, DbRuleError } from '../errors.ts';
import type { Schema } from '../schema.ts';
import { composeMail, type Mailer, type MailKind } from './mailer.ts';
import { handleNewUser } from './new-user.ts';
import { RateLimiter } from './rate-limit.ts';
import { consumeOneTimeToken, createOneTimeToken, refreshSession, revokeSessions, sessionIsActive, startSession } from './tokens.ts';
import { findUserByEmail, findUserById, isBanned, mergeMetadata, normalizeEmail, toGoTrueUser, validEmail, type AuthUser } from './users.ts';

export interface AuthDeps { config: Config; pool: Pool; schema: Schema; mailer: Mailer }

type Body = Record<string, any>;
const BCRYPT_COST = 10;
// Compared against when the email is unknown, so timing does not reveal it.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);
const PURPOSE: Record<string, string[]> = {
  signup: ['email_confirmation'], email: ['email_confirmation', 'magic_link'], magiclink: ['magic_link'],
  recovery: ['recovery'], invite: ['invite']
};
const AMR: Record<string, string> = { email_confirmation: 'otp', magic_link: 'otp', recovery: 'recovery', invite: 'invite' };

export async function authRoutes(app: FastifyInstance, deps: AuthDeps) {
  const { config, pool, schema, mailer } = deps;
  const signIns = new RateLimiter(30, 5 * 60_000);
  const refreshes = new RateLimiter(150, 5 * 60_000);
  const emailsPerIp = new RateLimiter(30, 60 * 60_000);
  const emailCooldown = new RateLimiter(1, 60_000);
  const signups = new RateLimiter(30, 60 * 60_000);

  const meta = (req: FastifyRequest) => ({ userAgent: req.headers['user-agent'], ip: req.ip });
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

  async function sendMail(kind: MailKind, user: AuthUser, token: string, type: string, redirect: string, ip: string) {
    if (!emailsPerIp.take(ip)) throw authErrors.rateLimited();
    await mailer.send(composeMail(kind, user.email!, verifyLink(token, type, redirect)));
  }
  function cooldown(email: string) {
    if (!emailCooldown.take(email)) throw authErrors.tooFrequent(emailCooldown.retryAfter(email) || 60);
  }

  /** Inserts auth_users and runs handle_new_user in the same transaction. */
  async function createAuthUser(tx: Tx, input: { email: string; password: string | null; confirmed: boolean; appMeta?: Body; userMeta?: Body }) {
    const id = randomUUID();
    const appMeta = { provider: 'email', providers: ['email'], ...(input.appMeta || {}) };
    const userMeta = input.userMeta || {};
    await exec(tx, `INSERT INTO auth_users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      VALUES (?, ?, ?, ?, ?, ?)`, [id, input.email, input.password ? await bcrypt.hash(input.password, BCRYPT_COST) : null,
      input.confirmed ? toMysqlDatetime(new Date()) : null, JSON.stringify(appMeta), JSON.stringify(userMeta)]);
    await handleNewUser({ tx, ctx: systemContext, schema, now: new Date() },
      { id, email: input.email, raw_app_meta_data: appMeta, raw_user_meta_data: userMeta }, config.universityDomain);
    return (await findUserById(tx, id))!;
  }
  const isRuleFailure = (error: unknown) => error instanceof DbRuleError || (error as { sqlState?: string })?.sqlState !== undefined;

  function checkPassword(password: unknown): string {
    if (typeof password !== 'string' || password.length < config.passwordMinLength) throw authErrors.weakPassword(config.passwordMinLength);
    if (password.length > 72) throw authErrors.validation('Password cannot be longer than 72 characters');
    return password;
  }
  function checkEmail(value: unknown): string {
    const email = normalizeEmail(value);
    if (!email) throw authErrors.validation('An email address is required');
    if (!validEmail(email)) throw authErrors.invalidEmail(email);
    return email;
  }

  async function bearerUser(req: FastifyRequest): Promise<{ user: AuthUser; claims: Claims }> {
    const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw authErrors.noAuthorization();
    const claims = await verifyJwt(config, token);
    if (!claims || claims.role !== 'authenticated' || typeof claims.sub !== 'string') throw authErrors.badJwt();
    if (!await sessionIsActive(pool, claims.session_id)) throw authErrors.sessionNotFound();
    const user = await findUserById(pool, claims.sub);
    if (!user) throw new AuthError(403, 'user_not_found', 'User from sub claim in JWT does not exist');
    return { user, claims };
  }
  async function requireService(req: FastifyRequest) {
    const ctx = await contextFromHeaders(config, undefined, req.headers.authorization);
    if (ctx?.role !== 'service_role') throw authErrors.notAdmin();
  }

  // Every route except the email-link target needs the anon or service key.
  app.addHook('preHandler', async (req: FastifyRequest) => {
    if (req.routeOptions.url?.endsWith('/verify') && req.method === 'GET') return;
    if (req.routeOptions.url?.endsWith('/health')) return;
    const apikey = (req.headers.apikey as string | undefined) ?? (req.query as Body)?.apikey;
    if (!apikey) throw authErrors.missingKey();
    const ctx = await contextFromHeaders(config, apikey, undefined);
    if (!ctx || (ctx.role !== 'anon' && ctx.role !== 'service_role')) throw new AuthError(401, 'invalid_api_key', 'Invalid API key');
  });

  app.get('/health', async () => ({ version: 'asoiu-career-api', name: 'GoTrue', description: 'GoTrue-compatible auth on MySQL' }));

  app.get('/settings', async () => ({
    external: { anonymous_users: false, apple: false, azure: false, bitbucket: false, discord: false, facebook: false, figma: false,
      fly: false, github: false, gitlab: false, google: false, keycloak: false, kakao: false, linkedin: false, linkedin_oidc: false,
      notion: false, spotify: false, slack: false, slack_oidc: false, workos: false, twitch: false, twitter: false, email: true, phone: false, zoom: false },
    disable_signup: config.disableSignup, mailer_autoconfirm: config.mailerAutoconfirm, phone_autoconfirm: false, sms_provider: '', saml_enabled: false
  }));

  app.get('/.well-known/jwks.json', async () => ({ keys: [] }));

  app.get('/authorize', async () => { throw authErrors.validation('Unsupported provider: provider is not enabled'); });

  app.post('/signup', async (req: FastifyRequest<{ Body: Body; Querystring: Body }>) => {
    if (config.disableSignup) throw authErrors.signupDisabled();
    const body = req.body || {};
    const email = checkEmail(body.email);
    const password = checkPassword(body.password);
    limit(signups, req.ip);
    const redirect = redirectTarget(req.query.redirect_to ?? body.redirect_to);
    const outcome = await transaction(pool, async tx => {
      const existing = await findUserByEmail(tx, email, true);
      if (existing) {
        if (config.mailerAutoconfirm || existing.email_confirmed_at) throw authErrors.userExists();
        return { user: existing, resend: true as const };
      }
      let user: AuthUser;
      try {
        user = await createAuthUser(tx, { email, password, confirmed: config.mailerAutoconfirm, userMeta: body.data });
      } catch (error) {
        if (isRuleFailure(error)) { req.log.warn({ err: error }, 'signup rejected by handle_new_user'); throw authErrors.databaseSignup(); }
        throw error;
      }
      if (config.mailerAutoconfirm) return { session: await startSession(tx, config, user, 'password', meta(req)) };
      return { user, token: await createOneTimeToken(tx, user.id, 'email_confirmation', 24 * 60) };
    });
    if ('session' in outcome) return outcome.session;
    if ('token' in outcome && outcome.token) await sendMail('confirmation', outcome.user, outcome.token, 'signup', redirect, req.ip);
    return { ...toGoTrueUser(outcome.user), confirmation_sent_at: new Date().toISOString() };
  });

  app.post('/token', async (req: FastifyRequest<{ Body: Body; Querystring: Body }>) => {
    const body = req.body || {};
    if (req.query.grant_type === 'refresh_token') {
      limit(refreshes, req.ip);
      if (typeof body.refresh_token !== 'string' || !body.refresh_token) throw authErrors.refreshNotFound();
      const result = await transaction(pool, tx => refreshSession(tx, config, body.refresh_token));
      if ('replayed' in result) throw authErrors.refreshUsed();
      return result;
    }
    if (req.query.grant_type !== 'password') throw new AuthError(400, 'validation_failed', 'unsupported_grant_type');
    limit(signIns, req.ip);
    const email = normalizeEmail(body.email);
    const user = email ? await findUserByEmail(pool, email) : null;
    const matches = await bcrypt.compare(String(body.password ?? ''), user?.encrypted_password || DUMMY_HASH);
    if (!user || !user.encrypted_password || !matches) throw authErrors.invalidCredentials();
    if (!user.email_confirmed_at) throw authErrors.emailNotConfirmed();
    if (isBanned(user)) throw authErrors.banned();
    return transaction(pool, tx => startSession(tx, config, user, 'password', meta(req)));
  });

  app.post('/logout', async (req: FastifyRequest<{ Querystring: Body }>, reply: FastifyReply) => {
    const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const claims = token ? await verifyJwt(config, token) : null;
    if (!claims || claims.role !== 'authenticated' || typeof claims.sub !== 'string') throw authErrors.badJwt();
    const scope = ['global', 'local', 'others'].includes(req.query.scope) ? req.query.scope : 'global';
    await transaction(pool, tx => revokeSessions(tx, claims.sub!, claims.session_id, scope));
    return reply.code(204).send();
  });

  app.get('/user', async (req: FastifyRequest) => toGoTrueUser((await bearerUser(req)).user));

  app.put('/user', async (req: FastifyRequest<{ Body: Body }>) => {
    const { user } = await bearerUser(req);
    const body = req.body || {};
    if (body.email !== undefined && normalizeEmail(body.email) !== user.email) {
      throw new AuthError(422, 'email_change_not_supported', 'Email changes are made by the Career Centre');
    }
    await transaction(pool, async tx => {
      if (body.password !== undefined) {
        const password = checkPassword(body.password);
        if (user.encrypted_password && await bcrypt.compare(password, user.encrypted_password)) {
          throw new AuthError(422, 'same_password', 'New password should be different from the old password.');
        }
        await exec(tx, 'UPDATE auth_users SET encrypted_password = ? WHERE id = ?', [await bcrypt.hash(password, BCRYPT_COST), user.id]);
      }
      if (body.data !== undefined) {
        await exec(tx, 'UPDATE auth_users SET raw_user_meta_data = ? WHERE id = ?',
          [JSON.stringify(mergeMetadata(user.raw_user_meta_data || {}, body.data)), user.id]);
      }
    });
    return toGoTrueUser((await findUserById(pool, user.id))!);
  });

  app.post('/recover', async (req: FastifyRequest<{ Body: Body; Querystring: Body }>) => {
    const email = checkEmail(req.body?.email);
    cooldown(email);
    const user = await findUserByEmail(pool, email);
    if (user) {
      const token = await transaction(pool, tx => createOneTimeToken(tx, user.id, 'recovery'));
      await sendMail('recovery', user, token, 'recovery', redirectTarget(req.query.redirect_to ?? req.body?.redirect_to), req.ip);
    }
    return {};
  });

  app.post('/otp', async (req: FastifyRequest<{ Body: Body; Querystring: Body }>) => {
    const body = req.body || {};
    const email = checkEmail(body.email);
    cooldown(email);
    const redirect = redirectTarget(req.query.redirect_to ?? body.redirect_to);
    const outcome = await transaction(pool, async tx => {
      let user = await findUserByEmail(tx, email, true);
      if (!user) {
        if (body.create_user === false || config.disableSignup) throw authErrors.otpSignupDisabled();
        try { user = await createAuthUser(tx, { email, password: null, confirmed: false, userMeta: body.data }); }
        catch (error) { if (isRuleFailure(error)) throw authErrors.databaseSignup(); throw error; }
      }
      return { user, token: await createOneTimeToken(tx, user.id, 'magic_link') };
    });
    await sendMail('magic_link', outcome.user, outcome.token, 'magiclink', redirect, req.ip);
    return {};
  });

  app.post('/resend', async (req: FastifyRequest<{ Body: Body; Querystring: Body }>) => {
    const body = req.body || {};
    if (body.type !== 'signup') throw authErrors.validation('Only signup confirmations can be resent');
    const email = checkEmail(body.email);
    cooldown(email);
    const user = await findUserByEmail(pool, email);
    if (user && !user.email_confirmed_at) {
      const token = await transaction(pool, tx => createOneTimeToken(tx, user.id, 'email_confirmation', 24 * 60));
      await sendMail('confirmation', user, token, 'signup', redirectTarget(req.query.redirect_to ?? body.options?.emailRedirectTo), req.ip);
    }
    return {};
  });

  /** Consumes an email token, confirms the address and opens a session. */
  async function verify(token: string, type: string, req: FastifyRequest) {
    const purposes = PURPOSE[type];
    if (!purposes || !token) throw authErrors.otpExpired();
    return transaction(pool, async tx => {
      const used = await consumeOneTimeToken(tx, token, purposes);
      await exec(tx, 'UPDATE auth_users SET email_confirmed_at = COALESCE(email_confirmed_at, CURRENT_TIMESTAMP(6)) WHERE id = ?', [used.user_id]);
      const user = await findUserById(tx, used.user_id);
      if (!user) throw authErrors.otpExpired();
      if (isBanned(user)) throw authErrors.banned();
      return startSession(tx, config, user, AMR[used.purpose] || 'otp', meta(req));
    });
  }

  app.post('/verify', async (req: FastifyRequest<{ Body: Body }>) => {
    const body = req.body || {};
    return verify(String(body.token_hash ?? body.token ?? ''), String(body.type ?? ''), req);
  });

  app.get('/verify', async (req: FastifyRequest<{ Querystring: Body }>, reply: FastifyReply) => {
    const { token, type } = req.query;
    const redirect = redirectTarget(req.query.redirect_to);
    try {
      const session = await verify(String(token ?? ''), String(type ?? ''), req);
      const hash = new URLSearchParams({
        access_token: session.access_token, expires_at: String(session.expires_at), expires_in: String(session.expires_in),
        refresh_token: session.refresh_token, token_type: 'bearer', type: String(type)
      });
      return reply.redirect(`${redirect}#${hash}`, 303);
    } catch (error) {
      if (!(error instanceof AuthError)) throw error;
      const hash = new URLSearchParams({ error: 'access_denied', error_code: error.errorCode, error_description: 'Email link is invalid or has expired' });
      return reply.redirect(`${redirect}#${hash}`, 303);
    }
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
      if (body.password !== undefined) { sets.push('encrypted_password = ?'); params.push(await bcrypt.hash(checkPassword(body.password), BCRYPT_COST)); }
      if (body.email_confirm === true) sets.push('email_confirmed_at = COALESCE(email_confirmed_at, CURRENT_TIMESTAMP(6))');
      if (body.app_metadata !== undefined) { sets.push('raw_app_meta_data = ?'); params.push(JSON.stringify(mergeMetadata(current.raw_app_meta_data || {}, body.app_metadata))); }
      if (body.user_metadata !== undefined) { sets.push('raw_user_meta_data = ?'); params.push(JSON.stringify(mergeMetadata(current.raw_user_meta_data || {}, body.user_metadata))); }
      const ban = banUntil(body.ban_duration);
      if (ban !== undefined) { sets.push('banned_until = ?'); params.push(ban); }
      if (sets.length) await exec(tx, `UPDATE auth_users SET ${sets.join(', ')} WHERE id = ?`, [...params, current.id]);
      return (await findUserById(tx, current.id))!;
    });
    return toGoTrueUser(user);
  });

  app.delete('/admin/users/:id', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    await requireService(req);
    const user = await findUserById(pool, req.params.id);
    if (!user) throw authErrors.userNotFound();
    // FK cascades remove the profile and its rows (see README, known gaps).
    await exec(pool, 'DELETE FROM auth_users WHERE id = ?', [user.id]);
    return toGoTrueUser(user);
  });

  app.post('/invite', async (req: FastifyRequest<{ Body: Body; Querystring: Body }>) => {
    await requireService(req);
    const body = req.body || {};
    const email = checkEmail(body.email);
    const redirect = redirectTarget(req.query.redirect_to ?? body.redirect_to);
    const outcome = await transaction(pool, async tx => {
      if (await findUserByEmail(tx, email, true)) throw authErrors.emailExists();
      let user: AuthUser;
      try { user = await createAuthUser(tx, { email, password: null, confirmed: false, userMeta: body.data }); }
      catch (error) { if (isRuleFailure(error)) throw new AuthError(500, 'unexpected_failure', 'Database error saving new user'); throw error; }
      return { user, token: await createOneTimeToken(tx, user.id, 'invite', 24 * 60) };
    });
    await mailer.send(composeMail('invite', email, verifyLink(outcome.token, 'invite', redirect)));
    return toGoTrueUser(outcome.user);
  });
}
