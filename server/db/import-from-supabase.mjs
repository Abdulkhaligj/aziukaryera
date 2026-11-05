// Copies every row from the Supabase Postgres database into the MySQL schema
// created by db/setup.mjs, then checks row counts and foreign keys.
//
// Production (cutover):
//   SOURCE_DB_URL=postgresql://… MYSQL_URL=mysql://… node db/import-from-supabase.mjs
// Local test through a logged-in Supabase CLI (password hashes are blanked
// unless --keep-password-hashes is given):
//   SUPABASE_PROJECT_REF=… MYSQL_URL=mysql://… node db/import-from-supabase.mjs --source supabase-cli
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import mysql from 'mysql2/promise';

const args = process.argv.slice(2);
const source = args.includes('--source') ? args[args.indexOf('--source') + 1] : 'pg';
const keepHashes = source === 'pg' || args.includes('--keep-password-hashes');

const pgColumns = JSON.parse(readFileSync(new URL('source/pg-columns.json', import.meta.url), 'utf8'));
const pgTables = [...new Map(pgColumns.map(c => [`${c.s}.${c.t}`, { schema: c.s, table: c.t }])).values()];
const target = ({ schema, table }) => schema === 'public' ? table : `${schema}_${table}`;

// Source tables that are not part of the public/private schema dump.
const extra = [
  { from: 'auth.users', to: 'auth_users', select: `select id, email, ${keepHashes ? 'encrypted_password' : 'null::text as encrypted_password'},
      coalesce(email_confirmed_at, confirmed_at) as email_confirmed_at, last_sign_in_at,
      coalesce(raw_app_meta_data, '{}'::jsonb) as raw_app_meta_data, coalesce(raw_user_meta_data, '{}'::jsonb) as raw_user_meta_data,
      banned_until, created_at, updated_at, deleted_at from auth.users` },
  { from: 'storage.buckets', to: 'storage_buckets', select: `select id, public, file_size_limit,
      to_jsonb(allowed_mime_types) as allowed_mime_types, created_at from storage.buckets` },
  { from: 'storage.objects', to: 'storage_objects', select: `select id, bucket_id, name, coalesce(owner_id, owner::text) as owner_id,
      metadata->>'mimetype' as mimetype, coalesce((metadata->>'size')::bigint, 0) as size,
      metadata->>'cacheControl' as cache_control, created_at, coalesce(updated_at, created_at) as updated_at from storage.objects` }
];
const jobs = [
  ...pgTables.map(t => ({ from: `${t.schema}.${t.table}`, to: target(t), select: `select * from ${t.schema}.${t.table}` })),
  ...extra
];

// ---- source adapters: both return plain JSON rows (to_jsonb semantics) ----
async function pgSource() {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.SOURCE_DB_URL });
  await client.connect();
  await client.query("set time zone 'UTC'; set default_transaction_read_only = on");
  return {
    async rows(sql) {
      const { rows } = await client.query(`select coalesce(json_agg(to_jsonb(x)), '[]'::json)::text as j from (${sql}) x`);
      return JSON.parse(rows[0].j);
    },
    end: () => client.end()
  };
}
function cliSource() {
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!ref) throw new Error('SUPABASE_PROJECT_REF is required for --source supabase-cli.');
  const bin = process.env.SUPABASE_BIN || 'supabase';
  return {
    async rows(sql) {
      const out = execFileSync(bin, ['db', 'query', '--linked', '--project-ref', ref, '--workdir', process.env.SUPABASE_WORKDIR || '.',
        `select coalesce(json_agg(to_jsonb(x)), '[]'::json) as j from (${sql}) x`], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
      const parsed = JSON.parse(out.slice(out.indexOf('{')));
      const value = parsed.rows[0].j;
      return typeof value === 'string' ? JSON.parse(value) : value;
    },
    end: async () => {}
  };
}

// ---- value conversion by MySQL column type ----
function toDatetime(value) {
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)?$/);
  if (!m) throw new Error(`unparseable timestamp ${value}`);
  const fraction = (m[3] || '.0').slice(1).padEnd(6, '0').slice(0, 6);
  const offset = m[4] && m[4] !== 'Z' && !/^[+-]00(:?00)?$/.test(m[4]) ? m[4] : null;
  if (!offset) return `${m[1]} ${m[2]}.${fraction}`;
  const utc = new Date(`${m[1]}T${m[2]}${offset.length === 3 ? offset + ':00' : offset}`).toISOString();
  return `${utc.slice(0, 10)} ${utc.slice(11, 19)}.${fraction}`;
}
function convert(value, type) {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'datetime': return toDatetime(value);
    case 'json': return JSON.stringify(value);
    case 'tinyint': return value === true ? 1 : value === false ? 0 : value;
    default: return typeof value === 'object' ? JSON.stringify(value) : value;
  }
}

const db = await mysql.createConnection({ uri: process.env.MYSQL_URL, timezone: 'Z', multipleStatements: false });
const [[{ database }]] = await db.query('SELECT DATABASE() AS `database`');
const [typeRows] = await db.query('SELECT table_name AS t, column_name AS c, data_type AS d FROM information_schema.columns WHERE table_schema = ?', [database]);
const types = new Map();
for (const r of typeRows) { if (!types.has(r.t)) types.set(r.t, new Map()); types.get(r.t).set(r.c, r.d); }

for (const job of jobs) {
  if (!types.has(job.to)) throw new Error(`target table ${job.to} is missing; run db/setup.mjs first.`);
  const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM \`${job.to}\``);
  if (n) throw new Error(`target table ${job.to} already has ${n} rows; import into an empty database.`);
}

const src = source === 'supabase-cli' ? cliSource() : await pgSource();
const report = [];
try {
  await db.query('SET FOREIGN_KEY_CHECKS = 0');
  await db.beginTransaction();
  for (const job of jobs) {
    const rows = await src.rows(job.select);
    const cols = [...types.get(job.to).keys()].filter(c => rows.length === 0 || c in rows[0]);
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200).map(r => cols.map(c => convert(r[c], types.get(job.to).get(c))));
      await db.query(`INSERT INTO \`${job.to}\` (${cols.map(c => `\`${c}\``).join(', ')}) VALUES ?`, [batch]);
    }
    report.push({ table: job.to, source: rows.length });
    process.stdout.write(`${job.to}: ${rows.length}\n`);
  }
  await db.commit();
} catch (error) {
  await db.rollback();
  throw error;
} finally {
  await db.query('SET FOREIGN_KEY_CHECKS = 1');
  await src.end();
}

// ---- verification: counts and every foreign key ----
let problems = 0;
for (const r of report) {
  const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM \`${r.table}\``);
  if (n !== r.source) { problems++; console.error(`COUNT ${r.table}: source ${r.source}, mysql ${n}`); }
}
const [fks] = await db.query(`SELECT k.constraint_name AS name, k.table_name AS t, k.referenced_table_name AS rt,
    GROUP_CONCAT(k.column_name ORDER BY k.ordinal_position) AS cols, GROUP_CONCAT(k.referenced_column_name ORDER BY k.ordinal_position) AS rcols
  FROM information_schema.key_column_usage k WHERE k.table_schema = ? AND k.referenced_table_name IS NOT NULL
  GROUP BY k.constraint_name, k.table_name, k.referenced_table_name`, [database]);
for (const fk of fks) {
  const cols = fk.cols.split(','), rcols = fk.rcols.split(',');
  const join = cols.map((c, i) => `p.\`${rcols[i]}\` = c.\`${c}\``).join(' AND ');
  const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM \`${fk.t}\` c LEFT JOIN \`${fk.rt}\` p ON ${join}
    WHERE ${cols.map(c => `c.\`${c}\` IS NOT NULL`).join(' AND ')} AND p.\`${rcols[0]}\` IS NULL`);
  if (n) { problems++; console.error(`FK ${fk.name}: ${n} orphan row(s) in ${fk.t}`); }
}
await db.end();
console.log(problems ? `XƏTA: ${problems} problem tapıldı.` : `Hazırdır: ${report.length} cədvəl, ${report.reduce((s, r) => s + r.source, 0)} sətir; saylar və xarici açarlar düzgündür.`);
if (!keepHashes) console.log('Qeyd: şifrə hash-ları bu sınaqda köçürülmədi (--keep-password-hashes).');
process.exitCode = problems ? 1 : 0;
