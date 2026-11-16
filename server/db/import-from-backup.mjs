// Copies every row of the final backup of the old Postgres database (taken
// 2026-11-12) into the MySQL schema created by db/setup.mjs,
// then checks row counts and foreign keys. The backup (full.dump) is
// first restored into a throwaway Postgres; scripts/02-import.sh does that.
//
//   SOURCE_DB_URL=postgresql://…restored-backup… MYSQL_URL=mysql://… node db/import-from-backup.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';

const pgColumns = JSON.parse(readFileSync(new URL('source/pg-columns.json', import.meta.url), 'utf8'));
const pgTables = [...new Map(pgColumns.map(c => [`${c.s}.${c.t}`, { schema: c.s, table: c.t }])).values()];
const target = ({ schema, table }) => schema === 'public' ? table : `${schema}_${table}`;

// Source tables that are not part of the public/private schema dump.
const extra = [
  { from: 'auth.users', to: 'auth_users', select: `select id, email, encrypted_password,
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

// ---- source: plain JSON rows (to_jsonb semantics) ----
async function pgSource() {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.SOURCE_DB_URL });
  await client.connect();
  await client.query("set time zone 'UTC'; set default_transaction_read_only = on");
  return {
    async rows(sql) {
      const { rows } = await client.query(`select coalesce(json_agg(to_jsonb(x)), '[]'::json)::text as j from (${sql}) x`);
      // Numbers keep their exact text (numeric, bigint): no float on the way (M37).
      return JSON.parse(rows[0].j, (_key, value, context) => typeof value === 'number' ? JSON.rawJSON(context.source) : value);
    },
    end: () => client.end()
  };
}
// ---- verification inside the import transaction (M36) ----
function digest(ids) {
  return createHash('sha256').update([...ids].sort().join('\n')).digest('hex');
}
async function verify() {
  let problems = 0;
  for (const r of report) {
    const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM \`${r.table}\``);
    if (n !== r.source) { problems++; console.error(`COUNT ${r.table}: source ${r.source}, mysql ${n}`); }
    if (r.ids) {
      const [ids] = await db.query(`SELECT id FROM \`${r.table}\``);
      if (digest(ids.map(x => String(x.id))) !== r.ids) { problems++; console.error(`IDS ${r.table}: the set of ids differs`); }
    }
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
  return problems;
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
/** A DECIMAL(p,s) value must fit exactly; MySQL would round it silently (M37). */
function checkDecimal(text, columnType, where) {
  const m = /^decimal\((\d+),(\d+)\)$/.exec(columnType);
  if (!m) return;
  const [int, frac = ''] = String(text).replace(/^-/, '').split('.');
  if (frac.replace(/0+$/, '').length > Number(m[2]) || int.replace(/^0+/, '').length > Number(m[1]) - Number(m[2])) {
    throw new Error(`${where}: ${text} does not fit ${columnType}`);
  }
}
function convert(value, type) {
  if (value === null || value === undefined) return null;
  if (JSON.isRawJSON(value)) return value.rawJSON;
  switch (type) {
    case 'datetime': return toDatetime(value);
    case 'json': return JSON.stringify(value);
    case 'tinyint': return value === true ? 1 : value === false ? 0 : value;
    default: return typeof value === 'object' ? JSON.stringify(value) : value;
  }
}

// Big integers come back as exact text, so the id check compares them exactly.
const db = await mysql.createConnection({ uri: process.env.MYSQL_URL, timezone: 'Z', multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true });
const [[{ database }]] = await db.query('SELECT DATABASE() AS `database`');
const [typeRows] = await db.query('SELECT table_name AS t, column_name AS c, data_type AS d FROM information_schema.columns WHERE table_schema = ?', [database]);
const types = new Map();
const columnTypes = new Map();
for (const r of typeRows) { if (!types.has(r.t)) types.set(r.t, new Map()); types.get(r.t).set(r.c, r.d); }
const [fullTypes] = await db.query('SELECT table_name AS t, column_name AS c, column_type AS ct FROM information_schema.columns WHERE table_schema = ?', [database]);
for (const r of fullTypes) columnTypes.set(`${r.t}.${r.c}`, r.ct);
// Strict: a value MySQL cannot store as it is stops the import instead of being changed (M37).
await db.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");
// Source columns MySQL does not have on purpose (none today). Any other one stops the import (M36).
const DROPPED = new Set([]);

for (const job of jobs) {
  if (!types.has(job.to)) throw new Error(`target table ${job.to} is missing; run db/setup.mjs first.`);
  const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM \`${job.to}\``);
  if (n) throw new Error(`target table ${job.to} already has ${n} rows; import into an empty database.`);
}

const src = await pgSource();
const report = [];
try {
  await db.query('SET FOREIGN_KEY_CHECKS = 0');
  await db.beginTransaction();
  for (const job of jobs) {
    const rows = await src.rows(job.select);
    const target = types.get(job.to);
    // Every source column must have a place in MySQL, so nothing is dropped unseen (M36).
    const sourceCols = rows.length ? Object.keys(rows[0]) : [];
    const missing = sourceCols.filter(c => !target.has(c) && !DROPPED.has(`${job.to}.${c}`));
    if (missing.length) throw new Error(`${job.from}: column(s) ${missing.join(', ')} have no MySQL column`);
    const cols = [...target.keys()].filter(c => rows.length === 0 || c in rows[0]);
    for (const r of rows) for (const c of cols) if (JSON.isRawJSON(r[c])) checkDecimal(r[c].rawJSON, columnTypes.get(`${job.to}.${c}`), `${job.to}.${c}`);
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200).map(r => cols.map(c => convert(r[c], target.get(c))));
      await db.query(`INSERT INTO \`${job.to}\` (${cols.map(c => `\`${c}\``).join(', ')}) VALUES ?`, [batch]);
    }
    const idText = v => String(JSON.isRawJSON(v) ? v.rawJSON : v);
    report.push({ table: job.to, source: rows.length, ids: 'id' in (rows[0] ?? {}) ? digest(rows.map(r => idText(r.id))) : null });
    process.stdout.write(`${job.to}: ${rows.length}\n`);
  }
  // The buckets the platform uses, with the production settings, in case the
  // source project lacks one (the repo defines them: audit 2026-11-12, M-06).
  await db.query(`INSERT IGNORE INTO storage_buckets (id, public, file_size_limit, allowed_mime_types) VALUES
    ('avatars', 0, 1048576, JSON_ARRAY('image/webp', 'image/jpeg')),
    ('public-media', 1, 5242880, JSON_ARRAY('image/png', 'image/jpeg', 'image/webp')),
    ('assistant-audio', 0, 10485760, JSON_ARRAY('audio/wav', 'audio/x-wav'))`);
  // Sequences that are not column identities continue from their Postgres value.
  for (const seq of await src.rows(`select sequencename as name, coalesce(last_value, 0) as value
      from pg_sequences where schemaname = 'private' and sequencename in ('invoice_seq')`)) {
    await db.query('UPDATE `private_sequences` SET `value` = ? WHERE `name` = ?', [String(JSON.isRawJSON(seq.value) ? seq.value.rawJSON : seq.value), seq.name]);
    process.stdout.write(`sequence ${seq.name}: ${JSON.isRawJSON(seq.value) ? seq.value.rawJSON : seq.value}\n`);
  }
  // The moderation secret lives only in api.env, never in the database (H2, #73).
  await db.query("UPDATE `private_moderation_webhook_config` SET `secret` = '' WHERE `secret` <> ''");
  // Checked before the commit: counts, the set of ids and every foreign key (M36).
  const problems = await verify();
  if (problems) throw new Error(`${problems} problem(s) found; nothing was imported.`);
  await db.commit();
} catch (error) {
  await db.rollback();
  throw error;
} finally {
  await db.query('SET FOREIGN_KEY_CHECKS = 1');
  await src.end();
}

await db.end();
console.log(`Hazırdır: ${report.length} cədvəl, ${report.reduce((s, r) => s + r.source, 0)} sətir; saylar, id-lər və xarici açarlar düzgündür.`);

