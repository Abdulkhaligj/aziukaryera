// Test harness: a throwaway MySQL database per test file and the API on a
// random port, driven through the same supabase-js the portal uses.
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buildApp } from '../src/app.ts';
import type { Mailer } from '../src/auth/mailer.ts';
import { createMailer } from '../src/auth/mailer.ts';
import { loadConfig, type Config } from '../src/config.ts';
import { createPool, exec } from '../src/db.ts';
import { loadSchema } from '../src/schema.ts';
// @ts-expect-error plain ESM helper without types
import { dropDatabase, setupDatabase } from '../db/setup.mjs';

const BASE = process.env.MYSQL_TEST_URL || 'mysql://root@127.0.0.1:3307';

export interface Harness {
  url: string;
  config: Config;
  pool: ReturnType<typeof createPool>;
  mailer: Mailer;
  anon(): SupabaseClient;
  service(): SupabaseClient;
  close(): Promise<void>;
}

export async function startHarness(env: Record<string, string> = {}): Promise<Harness> {
  const database = `asoiu_test_${process.pid}_${randomBytes(3).toString('hex')}`;
  const mysqlUrl = `${BASE}/${database}`;
  await setupDatabase(mysqlUrl, { reset: true, log: () => {} });
  const secret = randomBytes(32).toString('base64url');
  const key = new TextEncoder().encode(secret);
  const sign = (role: string) => new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1y').sign(key);
  const config = loadConfig({
    MYSQL_URL: mysqlUrl, JWT_SECRET: secret, ANON_KEY: await sign('anon'), SERVICE_ROLE_KEY: await sign('service_role'),
    API_EXTERNAL_URL: 'http://127.0.0.1', SITE_URL: 'https://asoiu-career.vercel.app',
    ADDITIONAL_REDIRECT_URLS: 'https://asoiu-career-admin.vercel.app/**', ...env
  } as NodeJS.ProcessEnv);
  const pool = createPool(mysqlUrl);
  const mailer = createMailer(config);
  let app: Awaited<ReturnType<typeof buildApp>>;
  try {
    await seed(pool);
    // TEST_LOG=1 prints the API log, including errors hidden behind generic auth messages.
    app = await buildApp({ config, pool, schema: await loadSchema(pool), mailer, logger: process.env.TEST_LOG === '1' });
    await app.listen({ host: '127.0.0.1', port: 0 });
  } catch (error) {
    // A failed setup must not leave an open pool behind, or the runner never exits.
    await pool.end();
    await dropDatabase(mysqlUrl);
    throw error;
  }
  const address = app.server.address();
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  config.publicUrl = url;
  const client = (keyValue: string) => createClient(url, keyValue, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return {
    url, config, pool, mailer,
    anon: () => client(config.anonKey),
    service: () => client(config.serviceRoleKey),
    async close() { await app.close(); await pool.end(); await dropDatabase(mysqlUrl); }
  };
}

/** Reference rows the signup flow depends on (same values as production). */
async function seed(pool: ReturnType<typeof createPool>) {
  await exec(pool, `INSERT INTO plans (id, name, monthly_price, currency, active, sort_order) VALUES
    ('free', 'Free', 0, 'AZN', 1, 1), ('pro', 'Pro', 24.99, 'AZN', 1, 2)`);
  await exec(pool, `INSERT INTO plan_features (plan_id, feature_key, label, enabled, limit_value) VALUES
    ('free', 'team_members', 'Komanda üzvləri', 1, 1), ('pro', 'team_members', 'Komanda üzvləri', 1, 3)`);
}
