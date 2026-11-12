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
  /** Run the scheduled jobs (pg_cron equivalents) in this process. */
  jobs: boolean;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const jwtSecret = required(env, 'JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
  const publicUrl = required(env, 'API_EXTERNAL_URL').replace(/\/$/, '');
  const siteUrl = (env.SITE_URL || 'https://asoiu-career.vercel.app').replace(/\/$/, '');
  return {
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 8000),
    mysqlUrl: required(env, 'MYSQL_URL'),
    publicUrl,
    siteUrl,
    redirectAllowList: [siteUrl + '/**', ...(env.ADDITIONAL_REDIRECT_URLS || '').split(',').map(s => s.trim()).filter(Boolean)],
    jwtSecret,
    anonKey: required(env, 'ANON_KEY'),
    serviceRoleKey: required(env, 'SERVICE_ROLE_KEY'),
    accessTokenTtl: Number(env.JWT_EXPIRY || 3600),
    refreshTokenTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS || 30),
    // H-01 (audit 2026-11-12): sign-ups confirm their email unless explicitly disabled.
    mailerAutoconfirm: (env.ENABLE_EMAIL_AUTOCONFIRM ?? 'false') === 'true',
    secureEmailChange: (env.SECURE_EMAIL_CHANGE ?? 'true') === 'true',
    disableSignup: env.DISABLE_SIGNUP === 'true',
    passwordMinLength: Number(env.PASSWORD_MIN_LENGTH || 6),
    universityDomain: env.UNIVERSITY_EMAIL_DOMAIN || 'asoiu.edu.az',
    smtp: env.SMTP_HOST ? {
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT || 587),
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      from: `${env.SMTP_SENDER_NAME || 'ADNSU Karyera Mərkəzi'} <${env.SMTP_ADMIN_EMAIL || 'career@asoiu.edu.az'}>`
    } : null,
    storageDir: env.STORAGE_DIR || new URL('../storage/', import.meta.url).pathname,
    functionsDir: env.FUNCTIONS_DIR || new URL('../functions/', import.meta.url).pathname,
    functionEnv: { ...env },
    jobs: (env.ENABLE_JOBS ?? 'true') === 'true'
  };
}
