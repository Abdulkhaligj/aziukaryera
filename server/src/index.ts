// Entry point: node src/index.ts (Node 22.18+ runs TypeScript directly).
import { buildApp } from './app.ts';
import { keyExpiresIn } from './context.ts';
import { createMailer } from './auth/mailer.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db.ts';
import { loadSchema } from './schema.ts';
import { encryptLegacyClaimCodes } from './maintenance.ts';

const config = loadConfig();
const pool = createPool(config.mysqlUrl);
const schema = await loadSchema(pool);
const app = await buildApp({ config, pool, schema, mailer: createMailer(config), logger: true });
const encrypted = await encryptLegacyClaimCodes(pool);
if (encrypted) app.log.info(`encrypted ${encrypted} legacy claim code(s)`);
if (!config.smtp) app.log.warn('SMTP_HOST is not set: auth emails are kept in memory and not delivered');
// API keys expire (M-08): warn a month ahead; an expired key is refused.
for (const [name, key] of [['ANON_KEY', config.anonKey], ['SERVICE_ROLE_KEY', config.serviceRoleKey]] as const) {
  const left = keyExpiresIn(key);
  if (left != null && left <= 0) app.log.error(`${name} has expired: run deploy/universitet-mysql/scripts/rotate-keys.sh`);
  else if (left != null && left < 30 * 86400) app.log.warn(`${name} expires in ${Math.floor(left / 86400)} days: run deploy/universitet-mysql/scripts/rotate-keys.sh`);
}
if (!config.smtp && !config.mailerAutoconfirm) app.log.error('Email confirmation is on but SMTP_HOST is not set: new sign-ups cannot be confirmed');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
await app.listen({ host: config.host, port: config.port });
