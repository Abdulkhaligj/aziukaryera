// Entry point: node src/index.ts (Node 22.18+ runs TypeScript directly).
import { buildApp } from './app.ts';
import { createMailer } from './auth/mailer.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db.ts';
import { loadSchema } from './schema.ts';

const config = loadConfig();
const pool = createPool(config.mysqlUrl);
const schema = await loadSchema(pool);
const app = await buildApp({ config, pool, schema, mailer: createMailer(config), logger: true });
if (!config.smtp) app.log.warn('SMTP_HOST is not set: auth emails are kept in memory and not delivered');
if (!config.smtp && !config.mailerAutoconfirm) app.log.error('Email confirmation is on but SMTP_HOST is not set: new sign-ups cannot be confirmed');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
await app.listen({ host: config.host, port: config.port });
