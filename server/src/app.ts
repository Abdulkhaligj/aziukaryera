// Assembles the API. Routes follow the URL layout the sites' data client
// clients only need a different base URL.
import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import type { Config } from './config.ts';
import { AuthError } from './errors.ts';
import type { Schema } from './schema.ts';
import { authRoutes } from './auth/routes.ts';
import { restRoutes } from './rest/routes.ts';
import { storageRoutes } from './storage/routes.ts';
import { functionRoutes } from './functions/routes.ts';
import { startScheduler } from './jobs/scheduler.ts';
import type { Mailer } from './auth/mailer.ts';
import './write/rules/index.ts';
import { setStoragePublicBase } from './write/rules/hardening.ts';
import { setModerationSecret } from './write/rules/moderation.ts';
import { setEncryptionKey } from './crypto.ts';

export interface AppDeps { config: Config; pool: Pool; schema: Schema; mailer: Mailer; logger?: boolean }

export async function buildApp(deps: AppDeps) {
  setStoragePublicBase(deps.config.publicUrl);
  setModerationSecret(deps.config.moderationSecret);
  setEncryptionKey(deps.config.dataEncryptionKey, deps.config.jwtSecret);
  // One trusted hop, and only from the internal network (Caddy): a client that
  // reaches the API port directly cannot pick its address with X-Forwarded-For (#23).
  const internal = (address: string) => /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::ffff:(127|10)\.|f[cd][0-9a-f]{2}:)/i.test(address);
  // Logs keep the path, never the query (tokens, keys, signed URLs) or credentials (#19).
  const logger = deps.logger ? {
    redact: ['req.headers.authorization', 'req.headers.apikey', 'req.headers.cookie', 'req.headers["x-moderation-secret"]'],
    serializers: { req: (req: { method: string; url: string; ip?: string }) => ({ method: req.method, url: String(req.url).split('?')[0], ip: req.ip }) }
  } : false;
  const app = Fastify({ logger, trustProxy: (address, hop) => hop < 1 && internal(address), bodyLimit: 1024 * 1024 });
  // Only the platform's own sites may call the API from a browser (#60).
  const origins = new Set(deps.config.corsOrigins);
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || origins.has(origin)),
    allowedHeaders: ['authorization', 'apikey', 'content-type', 'x-client-info', 'x-supabase-api-version', 'prefer', 'range',
      'accept-profile', 'content-profile', 'x-upsert', 'cache-control', 'x-moderation-secret', 'x-metadata'],
    exposedHeaders: ['content-range', 'x-total-count', 'x-supabase-api-version'],
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86400
  });

  // The data client sends some POSTs (e.g. /logout) with a JSON content type and
  // no body; GoTrue and PostgREST accept that, so an empty body means {}.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body) return done(null, {});
    try { done(null, JSON.parse(body as string)); }
    catch { done(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }), undefined); }
  });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof AuthError) return reply.code(error.status).send(error.body());
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ code: status, error_code: 'validation_failed', msg: (error as Error).message });
    }
    req.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({ code: 500, error_code: 'unexpected_failure', msg: 'Internal server error' });
  });

  await app.register(async scope => authRoutes(scope, deps), { prefix: '/auth/v1' });
  await app.register(async scope => restRoutes(scope, deps), { prefix: '/rest/v1' });
  await app.register(async scope => storageRoutes(scope, deps), { prefix: '/storage/v1' });
  await app.register(async scope => functionRoutes(scope, deps), { prefix: '/functions/v1' });
  if (deps.config.jobs) {
    let stop: (() => void) | null = null;
    app.addHook('onReady', async () => { stop = startScheduler(deps.pool, deps.schema, app.log); });
    app.addHook('onClose', async () => { stop?.(); });
  }
  return app;
}
