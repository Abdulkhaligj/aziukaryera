// Runtime configuration from the environment. Names follow the self-hosted
// previous backend's .env where an equivalent exists, so operators recognise them.

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export interface Config {
  host: string;
  port: number;
  mysqlUrl: string;
  /** Public base URL of this API, e.g. https://api.career.asoiu.edu.az */
  publicUrl: string;
  /** Default redirect target for email links (the student site). */
  siteUrl: string;
  /** Other allowed redirect targets; a trailing ** matches any path. */
  redirectAllowList: string[];
  jwtSecret: string;
  anonKey: string;
  serviceRoleKey: string;
  accessTokenTtl: number;
  refreshTokenTtlDays: number;
  mailerAutoconfirm: boolean;
  /** Email change needs a link confirmed on both the current and the new address (GoTrue default). */
  secureEmailChange: boolean;
  disableSignup: boolean;
  passwordMinLength: number;
  universityDomain: string;
  /** null → emails go to the in-memory/console outbox (development, tests). */
  smtp: SmtpConfig | null;
  storageDir: string;
  /** server/functions: the AI and admin function sources run by the API. */
  functionsDir: string;
  /** Environment the Edge Functions read with Deno.env.get (AI keys, webhook secret, …). */
  functionEnv: Record<string, string | undefined>;
  /** DATA_ENCRYPTION_KEY: base64 32 bytes for fields encrypted at rest (#73). */
  dataEncryptionKey?: string;
  /** MODERATION_WEBHOOK_SECRET, sent to the moderation function. */
  moderationSecret?: string;
  /** Run the scheduled jobs (pg_cron equivalents) in this process. */
  jobs: boolean;
  /** Browser origins allowed to call the API (CORS). */
  corsOrigins: string[];
  /** STORAGE_SIGNING_KEY: own key for signed storage URLs (optional). */
  storageSigningKey?: string;
  /** Requests per minute to /rest and /storage: per account, and per address
   *  for calls without a signed-in person (audit 2026-11-16, I10). */
  requestsPerMinute: { user: number; address: number };
  /** Sign-in with the university's Microsoft 365 accounts (Entra ID); null = off. */
  azure: AzureConfig | null;
  /** Sign-in with a Google account (Gmail); null = off. */
  google: GoogleConfig | null;
}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** Google's sign-in page, token endpoint and the issuers its ID tokens name
   *  (another base only in tests). */
  authorizeUrl: string;
  tokenUrl: string;
  issuers: string[];
}

export interface AzureConfig {
  clientId: string;
  clientSecret: string;
  /** The university's directory (tenant) ID; only its accounts get in. */
  tenantId: string;
  /** https://login.microsoftonline.com (another base only in tests). */
  authority: string;
}

import { fileURLToPath } from 'node:url';
import { intEnv } from './db.ts';

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** Secrets that only the API's own code reads. Once the configuration has them,
 *  they are removed from process.env, so code loaded later in the same process
 *  (the functions) cannot read them there (audit 2026-11-16, L19). The functions
 *  get their own allow-listed environment through the Deno shim. */
export const PROCESS_SECRETS = ['JWT_SECRET', 'MYSQL_URL', 'DATA_ENCRYPTION_KEY', 'SMTP_PASS', 'STORAGE_SIGNING_KEY', 'MODERATION_WEBHOOK_SECRET',
  'SERVICE_ROLE_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'AZURE_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET'];

/** Microsoft sign-in is on when all three values are set; a half-filled set
 *  stops the start instead of silently leaving the button off. */
function azureConfig(env: NodeJS.ProcessEnv): AzureConfig | null {
  const clientId = env.AZURE_CLIENT_ID || '', clientSecret = env.AZURE_CLIENT_SECRET || '', tenantId = (env.AZURE_TENANT_ID || '').toLowerCase();
  if (!clientId && !clientSecret && !tenantId) return null;
  if (!clientId || !clientSecret || !tenantId) throw new Error('AZURE_CLIENT_ID, AZURE_CLIENT_SECRET and AZURE_TENANT_ID go together');
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  // The tenant is compared with the token's tid claim, which is always the ID.
  if (!guid.test(tenantId)) throw new Error('AZURE_TENANT_ID must be the directory (tenant) ID, a GUID');
  if (!guid.test(clientId.toLowerCase())) throw new Error('AZURE_CLIENT_ID must be the application (client) ID, a GUID');
  const authority = (env.AZURE_AUTHORITY || 'https://login.microsoftonline.com').replace(/\/$/, '');
  if (env.NODE_ENV === 'production' && authority !== 'https://login.microsoftonline.com') throw new Error('AZURE_AUTHORITY can be changed only outside production');
  return { clientId: clientId.toLowerCase(), clientSecret, tenantId, authority };
}
/** Google sign-in is on when both values are set (an OAuth client of type
 *  "Web application" in Google Cloud); one without the other stops the start. */
function googleConfig(env: NodeJS.ProcessEnv): GoogleConfig | null {
  const clientId = (env.GOOGLE_CLIENT_ID || '').trim(), clientSecret = (env.GOOGLE_CLIENT_SECRET || '').trim();
  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET go together');
  if (!/^[0-9]+-[0-9a-z]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new Error('GOOGLE_CLIENT_ID must be the OAuth client ID (…apps.googleusercontent.com)');
  }
  const base = (env.GOOGLE_AUTHORITY || '').replace(/\/$/, '');
  if (base && env.NODE_ENV === 'production') throw new Error('GOOGLE_AUTHORITY can be set only outside production');
  return base
    ? { clientId, clientSecret, authorizeUrl: `${base}/o/oauth2/v2/auth`, tokenUrl: `${base}/token`, issuers: [base] }
    : { clientId, clientSecret, authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
      issuers: ['https://accounts.google.com', 'accounts.google.com'] };
}

export function scrubProcessSecrets(env: NodeJS.ProcessEnv = process.env) {
  for (const name of PROCESS_SECRETS) delete env[name];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const jwtSecret = required(env, 'JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
  const publicUrl = required(env, 'API_EXTERNAL_URL').replace(/\/$/, '');
  const siteUrl = (env.SITE_URL || 'https://asoiu-career.vercel.app').replace(/\/$/, '');
  // In production the API does not start without what keeps it honest (M30, M32):
  // its own field-encryption key (not derived from JWT_SECRET, which rotate-keys.sh
  // replaces), real email delivery, and the moderation secret.
  if (env.NODE_ENV === 'production') {
    const missing = ['DATA_ENCRYPTION_KEY', 'SMTP_HOST', 'MODERATION_WEBHOOK_SECRET'].filter(name => !env[name]);
    if (missing.length) throw new Error(`production needs ${missing.join(', ')}`);
    if ((env.MODERATION_WEBHOOK_SECRET ?? '').length < 32) throw new Error('MODERATION_WEBHOOK_SECRET must be at least 32 characters');
  }
  return {
    host: env.HOST || '127.0.0.1',
    port: intEnv(env, 'PORT', 8000, 1, 65535),
    mysqlUrl: required(env, 'MYSQL_URL'),
    publicUrl,
    siteUrl,
    redirectAllowList: [siteUrl + '/**', ...(env.ADDITIONAL_REDIRECT_URLS || '').split(',').map(s => s.trim()).filter(Boolean)],
    jwtSecret,
    anonKey: required(env, 'ANON_KEY'),
    serviceRoleKey: required(env, 'SERVICE_ROLE_KEY'),
    accessTokenTtl: intEnv(env, 'JWT_EXPIRY', 3600, 60, 86400),
    refreshTokenTtlDays: intEnv(env, 'REFRESH_TOKEN_TTL_DAYS', 30, 1, 365),
    // H-01 (audit 2026-11-12): sign-ups confirm their email unless explicitly disabled.
    mailerAutoconfirm: (env.ENABLE_EMAIL_AUTOCONFIRM ?? 'false') === 'true',
    secureEmailChange: (env.SECURE_EMAIL_CHANGE ?? 'true') === 'true',
    disableSignup: env.DISABLE_SIGNUP === 'true',
    // At least 8 characters (#64).
    // A value that is not a whole number stops the start, instead of becoming NaN
    // and letting any password through (audit 2026-11-16, M6).
    passwordMinLength: intEnv(env, 'PASSWORD_MIN_LENGTH', 8, 8, 72),
    universityDomain: env.UNIVERSITY_EMAIL_DOMAIN || 'asoiu.edu.az',
    smtp: env.SMTP_HOST ? {
      host: env.SMTP_HOST,
      port: intEnv(env, 'SMTP_PORT', 587, 1, 65535),
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      from: `${env.SMTP_SENDER_NAME || 'ADNSU Karyera Mərkəzi'} <${env.SMTP_ADMIN_EMAIL || 'careercenter@asoiu.edu.az'}>`
    } : null,
    // fileURLToPath: a file path on every system (pathname is /C:/… on Windows: L55).
    storageDir: env.STORAGE_DIR || fileURLToPath(new URL('../storage/', import.meta.url)),
    functionsDir: env.FUNCTIONS_DIR || fileURLToPath(new URL('../functions/', import.meta.url)),
    // Only what the functions need; not the database URL or other secrets (#63).
    functionEnv: Object.fromEntries(Object.entries(env).filter(([k]) => /^(GEMINI_|GROQ_|MODERATION_WEBHOOK_SECRET$|PUBLIC_SITE_URL$|SITE_URL$|TZ$|NODE_ENV$)/.test(k))),
    dataEncryptionKey: env.DATA_ENCRYPTION_KEY || undefined,
    moderationSecret: env.MODERATION_WEBHOOK_SECRET || undefined,
    storageSigningKey: env.STORAGE_SIGNING_KEY || undefined,
    jobs: (env.ENABLE_JOBS ?? 'true') === 'true',
    requestsPerMinute: {
      user: intEnv(env, 'API_REQUESTS_PER_MINUTE_USER', 600, 60, 100_000),
      // Many students share the campus address (NAT); the home page alone makes
      // about eight requests, so the budget for one address is wide.
      address: intEnv(env, 'API_REQUESTS_PER_MINUTE_ADDRESS', 6000, 60, 100_000)
    },
    corsOrigins: [...new Set([siteUrl, ...(env.CORS_ORIGINS || '').split(','), ...(env.ADDITIONAL_REDIRECT_URLS || '').split(',')]
      .map(s => s.trim()).filter(Boolean).map(s => { try { return new URL(s.replace(/\/\*\*$/, '')).origin; } catch { return ''; } }).filter(Boolean))],
    azure: azureConfig(env),
    google: googleConfig(env)
  };
}
