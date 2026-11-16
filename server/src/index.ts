// Entry point: node src/index.ts (Node 22.18+ runs TypeScript directly).
import { buildApp } from './app.ts';
import { keyExpiresIn } from './context.ts';
import { createMailer } from './auth/mailer.ts';
import { loadConfig, scrubProcessSecrets } from './config.ts';
import { checkSession, createPool, drainAfterCommit } from './db.ts';
import { loadSchema } from './schema.ts';
import { encryptLegacyClaimCodes, rehashClaimCodes } from './maintenance.ts';

const config = loadConfig();
const pool = createPool(config.mysqlUrl);
// The configuration and the pool have what they need; the functions run in this
// process and get an allow-listed environment of their own (L19).
scrubProcessSecrets();
// Time zone, isolation and SQL mode of the sessions are what the code assumes (M22, H3).
await checkSession(pool);
const schema = await loadSchema(pool);
const app = await buildApp({ config, pool, schema, mailer: createMailer(config), logger: true });

// An error nobody awaited is logged with its stack and the process stays up;
// one thrown synchronously leaves the process in an unknown state, so it is
// logged and the API stops, to be restarted by Docker (audit 2026-11-16, M34).
process.on('unhandledRejection', reason => {
  app.log.error({ err: reason }, 'unhandled promise rejection');
});
process.on('uncaughtException', error => {
  app.log.fatal({ err: error }, 'uncaught exception; stopping');
  void shutdown(1);
});

const encrypted = await encryptLegacyClaimCodes(pool);
if (encrypted) app.log.info(`encrypted ${encrypted} legacy claim code(s)`);
const rehashed = await rehashClaimCodes(pool);
if (rehashed) app.log.info(`renewed the lookup hash of ${rehashed} claim code(s)`);
if (!config.smtp) app.log.warn('SMTP_HOST is not set: auth emails are kept in memory and not delivered');
// API keys expire (M-08): warn a month ahead; an expired key is refused.
for (const [name, key] of [['ANON_KEY', config.anonKey], ['SERVICE_ROLE_KEY', config.serviceRoleKey]] as const) {
  const left = keyExpiresIn(key);
  if (left != null && left <= 0) app.log.error(`${name} has expired: run deploy/universitet-mysql/scripts/rotate-keys.sh`);
  else if (left != null && left < 30 * 86400) app.log.warn(`${name} expires in ${Math.floor(left / 86400)} days: run deploy/universitet-mysql/scripts/rotate-keys.sh`);
}
if (!config.smtp && !config.mailerAutoconfirm) app.log.error('Email confirmation is on but SMTP_HOST is not set: new sign-ups cannot be confirmed');

// Shutdown: stop taking requests, let after-commit work (webhooks) finish, close
// the pool. A watchdog ends the process if any step hangs (M24, M34).
let stopping = false;
async function shutdown(code: number) {
  if (stopping) return;
  stopping = true;
  const watchdog = setTimeout(() => { app.log.error('shutdown took too long; exiting'); process.exit(code || 1); }, 15_000);
  watchdog.unref();
  try {
    await app.close();
    const left = await drainAfterCommit(8_000);
    if (left) app.log.warn(`${left} after-commit task(s) still running at shutdown`);
    await pool.end();
  } catch (error) {
    app.log.error({ err: error }, 'shutdown failed');
  } finally {
    process.exit(code);
  }
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void shutdown(0); });
await app.listen({ host: config.host, port: config.port });
