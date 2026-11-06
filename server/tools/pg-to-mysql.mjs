// Converts the exported Postgres schema (server/db/source/pg-*.json) into
// MySQL 8.4 DDL. Anything that has no faithful MySQL equivalent is listed in
// db/schema-followups.md so the API enforces it instead of silently losing it.
//   node server/tools/pg-to-mysql.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../db/', import.meta.url);
const load = name => JSON.parse(readFileSync(new URL(`source/pg-${name}.json`, root), 'utf8'));
const columns = load('columns'), constraints = load('constraints'), indexes = load('indexes');
const enums = Object.fromEntries(load('enums').map(e =>
  [e.name, Array.isArray(e.labels) ? e.labels : e.labels.slice(1, -1).split(',').map(v => v.replace(/^"|"$/g, ''))]));
const views = load('views');
const followups = [];
const note = (table, text) => followups.push(`- \`${table}\`: ${text}`);

// public.x → x, private.x → private_x, auth.users → auth_users.
const tableName = (schema, table) => schema === 'public' ? table : `${schema}_${table}`;
function qualified(ref) {
  const [schema, table] = ref.includes('.') ? ref.split('.') : ['public', ref];
  return tableName(schema, table);
}
const q = id => '`' + id.replace(/`/g, '``') + '`';
const sqlString = s => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
const splitList = list => list.split(',').map(s => s.trim().replace(/^"|"$/g, ''));

// Text columns used by keys or indexes must be VARCHAR in MySQL.
const indexedText = new Set();
const mark = (schema, table, cols) => cols.forEach(c => indexedText.add(`${schema}.${table}.${c}`));
for (const c of constraints) {
  const m = c.def.match(/^(?:PRIMARY KEY|UNIQUE|FOREIGN KEY) \(([^)]+)\)/);
  if (m) mark(c.s, c.t, splitList(m[1]));
  const r = c.def.match(/REFERENCES ([\w.]+)\(([^)]+)\)/);
  if (r) { const [s, t] = r[1].includes('.') ? r[1].split('.') : ['public', r[1]]; mark(s, t, splitList(r[2])); }
  if (c.type === 'c') { const e = c.def.match(/\(\(?(\w+) = ANY \(ARRAY\[/); if (e) mark(c.s, c.t, [e[1]]); }
}
for (const i of indexes) {
  const m = i.def.match(/USING btree \((.+?)\)(?: WHERE|$)/);
  if (m) mark(i.s, i.t, m[1].split(',').map(p => p.trim().split(' ')[0]).filter(p => /^\w+$/.test(p)));
}
// companies_name_ci_idx is lower(name): a plain unique key under a case-insensitive collation.
mark('public', 'companies', ['name']);

function columnType(c) {
  const indexed = indexedText.has(`${c.s}.${c.t}.${c.col}`);
  switch (c.udt) {
    case 'uuid': return 'CHAR(36) CHARACTER SET ascii COLLATE ascii_bin';
    case 'text': return indexed ? 'VARCHAR(191)' : 'TEXT';
    case 'varchar': return `VARCHAR(${c.len || 191})`;
    case 'timestamptz': case 'timestamp': return 'DATETIME(6)';
    case 'date': return 'DATE';
    case 'int2': return 'SMALLINT';
    case 'int4': return 'INT';
    case 'int8': return 'BIGINT';
    case 'numeric': return c.prec ? `DECIMAL(${c.prec},${c.scale ?? 0})` : 'DECIMAL(12,2)';
    case 'bool': return 'TINYINT(1)';
    case 'json': case 'jsonb': return 'JSON';
    default:
      if (c.udt.startsWith('_')) return 'JSON';
      if (enums[c.udt]) return `ENUM(${enums[c.udt].map(sqlString).join(',')})`;
      throw new Error(`${c.t}.${c.col}: unknown type ${c.udt}`);
  }
}

function pgArrayLiteral(text) {
  if (text === '{}') return [];
  return text.slice(1, -1).split(',').map(v => v.replace(/^"|"$/g, ''));
}
function columnDefault(c, type) {
  const d = c.def;
  if (d == null) return '';
  const isText = type === 'TEXT' || type === 'JSON';
  let m;
  if (/^(now\(\)|CURRENT_TIMESTAMP|clock_timestamp\(\))$/.test(d)) return ' DEFAULT CURRENT_TIMESTAMP(6)';
  if (d === 'CURRENT_DATE') return ' DEFAULT (CURRENT_DATE)';
  if (d === 'gen_random_uuid()') return ' DEFAULT (UUID())';
  if (d === 'true' || d === 'false') return ` DEFAULT ${d === 'true' ? 1 : 0}`;
  if (/^-?\d+(\.\d+)?$/.test(d)) return ` DEFAULT ${d}`;
  if ((m = d.match(/^\(now\(\) \+ '(\d+) (day|days|hour|hours|minute|minutes)'::interval\)$/)))
    return ` DEFAULT (CURRENT_TIMESTAMP(6) + INTERVAL ${m[1]} ${m[2].replace(/s$/, '').toUpperCase()})`;
  if ((m = d.match(/^'(.*)'::text\[\]$/s))) return ` DEFAULT (JSON_ARRAY(${pgArrayLiteral(m[1]).map(sqlString).join(', ')}))`;
  if ((m = d.match(/^ARRAY\[(.*)\]$/s))) return ` DEFAULT (JSON_ARRAY(${[...m[1].matchAll(/'([^']*)'::text/g)].map(x => sqlString(x[1])).join(', ')}))`;
  if ((m = d.match(/^'(.*)'::jsonb?$/s))) return ` DEFAULT (CAST(${sqlString(m[1])} AS JSON))`;
  if ((m = d.match(/^'(.*)'::(?:text|character varying|\w+)$/s))) return isText ? ` DEFAULT (${sqlString(m[1])})` : ` DEFAULT ${sqlString(m[1])}`;
  if (d === 'auth.uid()') { note(c.t, `\`${c.col}\` defaulted to auth.uid(); the API must set it to the caller's id.`); return ''; }
  throw new Error(`${c.t}.${c.col}: unsupported default ${d}`);
}

// CHECK expressions: Postgres → MySQL, or null when there is no safe equivalent.
function convertCheck(def) {
  let e = def.replace(/^CHECK \(/, '').replace(/\)$/, '');
  if (/(private|public|auth)\.\w+\(|<@|@>|&&|::interval/.test(e)) return null;
  // A bare boolean column is not a boolean expression for MySQL CHECK.
  if (/^\(?\w+\)?$/.test(e)) return `${e.replace(/[()]/g, '')} = 1`;
  e = e.replace(/\((\w+) = ANY \(ARRAY\[(.*?)\]\)\)/g, (_, col, list) =>
    `(${col} IN (${[...list.matchAll(/'([^']*)'(?:::[\w ]+)?/g)].map(x => sqlString(x[1])).join(', ')}))`);
  e = e.replace(/\((\w+) ~ '((?:[^']|'')*)'::text\)/g, (_, col, re) => `REGEXP_LIKE(${col}, ${sqlString(re.replace(/''/g, "'"))}, 'c')`);
  e = e.replace(/cardinality\((\w+)\)/g, 'JSON_LENGTH($1)');
  e = e.replace(/jsonb_typeof\((\w+)\) = 'array'::text/g, "JSON_TYPE($1) = 'ARRAY'");
  e = e.replace(/jsonb_array_length\((\w+)\)/g, 'JSON_LENGTH($1)');
  e = e.replace(/octet_length\(\((\w+)\)::text\)/g, 'LENGTH(CAST($1 AS CHAR))');
  // MySQL re-prints TRIM(BOTH FROM x) inside CHECK as unparseable SQL; TRIM(x)
  // trims spaces on both sides just like Postgres btrim(x).
  e = e.replace(/TRIM\(BOTH FROM /g, 'TRIM(').replace(/\bbtrim\(/g, 'TRIM(');
  e = e.replace(/\bchar_length\(/g, 'CHAR_LENGTH(').replace(/\blength\(/g, 'CHAR_LENGTH(');
  e = e.replace(/'((?:[^']|'')*)'::[\w ]+(\[\])?/g, (_, s) => sqlString(s.replace(/''/g, "'")));
  e = e.replace(/::(text|integer|numeric|bigint|date|timestamp with time zone|character varying)/g, '');
  if (/::|~|\bANY\b|ARRAY\[/.test(e)) return null;
  return e;
}

// Quote the table's column names (some, like `match`, are MySQL keywords),
// leaving string literals untouched.
function quoteColumns(expr, names) {
  return expr.split(/('(?:[^'\\]|\\.|'')*')/).map((part, i) => i % 2 ? part
    : part.replace(/\b[a-z_][a-z0-9_]*\b/g, word => names.has(word) ? q(word) : word)).join('');
}

const tables = new Map();
for (const c of columns) {
  const key = `${c.s}.${c.t}`;
  if (!tables.has(key)) tables.set(key, { schema: c.s, table: c.t, cols: [], lines: [] });
  tables.get(key).cols.push(c);
}
const fkColumnsWithActions = new Set();
for (const c of constraints.filter(c => c.type === 'f' && /ON (DELETE|UPDATE) (CASCADE|SET NULL|SET DEFAULT)/.test(c.def)))
  splitList(c.def.match(/^FOREIGN KEY \(([^)]+)\)/)[1]).forEach(col => fkColumnsWithActions.add(`${c.s}.${c.t}.${col}`));

for (const t of tables.values()) {
  const name = tableName(t.schema, t.table);
  for (const c of t.cols) {
    const type = columnType(c);
    // Postgres identity columns (GENERATED … AS IDENTITY) have no column_default.
    const tail = c.identity ? ' AUTO_INCREMENT' : columnDefault(c, type);
    t.lines.push(`  ${q(c.col)} ${type}${c.nullable === 'NO' ? ' NOT NULL' : ''}${tail}`);
  }
  for (const c of constraints.filter(c => c.s === t.schema && c.t === t.table)) {
    let m;
    if (c.type === 'p') t.lines.push(`  PRIMARY KEY (${splitList(c.def.match(/\(([^)]+)\)/)[1]).map(q).join(', ')})`);
    else if (c.type === 'u') t.lines.push(`  UNIQUE KEY ${q(c.name)} (${splitList(c.def.match(/\(([^)]+)\)/)[1]).map(q).join(', ')})`);
    else if (c.type === 'f') {
      m = c.def.match(/^FOREIGN KEY \(([^)]+)\) REFERENCES ([\w.]+)\(([^)]+)\)(.*)$/);
      const actions = (m[4].match(/ON (DELETE|UPDATE) (CASCADE|SET NULL|SET DEFAULT|RESTRICT|NO ACTION)/g) || []).join(' ');
      t.lines.push(`  CONSTRAINT ${q(c.name)} FOREIGN KEY (${splitList(m[1]).map(q).join(', ')}) REFERENCES ${q(qualified(m[2]))} (${splitList(m[3]).map(q).join(', ')})${actions ? ' ' + actions : ''}`);
    } else if (c.type === 'c') {
      const expr = convertCheck(c.def);
      const cols = [...c.def.matchAll(/\b(\w+)\b/g)].map(x => x[1]);
      if (cols.some(col => fkColumnsWithActions.has(`${c.s}.${c.t}.${col}`))) note(name, `CHECK \`${c.name}\` uses a column with an FK action (not allowed in MySQL); enforce in the API: ${c.def}`);
      else if (expr) t.lines.push(`  CONSTRAINT ${q(c.name)} CHECK (${quoteColumns(expr, new Set(t.cols.map(col => col.col)))})`);
      else note(name, `CHECK \`${c.name}\` has no MySQL equivalent; enforce in the API: ${c.def}`);
    } else if (c.type === 'x') note(name, `EXCLUDE \`${c.name}\` (no overlapping ranges) must be enforced in the API inside a transaction: ${c.def}`);
  }
  const owned = new Set(constraints.filter(c => c.s === t.schema && c.t === t.table).map(c => c.name));
  for (const i of indexes.filter(i => i.s === t.schema && i.t === t.table && !owned.has(i.name))) {
    if (i.name === 'companies_name_ci_idx') { t.lines.push('  UNIQUE KEY `companies_name_ci_idx` (`name`)'); continue; }
    if (/ USING gin /.test(i.def)) { note(name, `GIN index \`${i.name}\` only speeds up array lookups; no rule is lost (a MySQL multi-valued index can be added if needed).`); continue; }
    const m = i.def.match(/^CREATE (UNIQUE )?INDEX \S+ ON \S+ USING btree \((.+?)\)(?: WHERE (.+))?$/);
    if (!m) { note(name, `index \`${i.name}\` is not a plain btree index; enforce in the API: ${i.def}`); continue; }
    // LEAST(a, b), GREATEST(a, b) pair keys become MySQL functional key parts.
    const pair = m[2].match(/^LEAST\((\w+), (\w+)\), GREATEST\(\1, \2\)$/);
    if (pair) {
      t.lines.push(`  ${m[1] ? 'UNIQUE ' : ''}KEY ${q(i.name)} ((LEAST(${q(pair[1])}, ${q(pair[2])})), (GREATEST(${q(pair[1])}, ${q(pair[2])})))`);
      continue;
    }
    const parts = m[2].split(',').map(p => p.trim());
    if (!parts.every(p => /^\w+( DESC)?$/.test(p))) { note(name, `expression index \`${i.name}\` skipped: ${i.def}`); continue; }
    // A unique index limited to non-NULL rows is equivalent in MySQL, which
    // never treats NULLs as duplicates. Any other predicate is not.
    const nullOnly = m[3] && m[3].split(' AND ').every(p => /^\w+ IS NOT NULL$/.test(p.replace(/[()]/g, '').trim()));
    if (m[1] && m[3] && !nullOnly) note(name, `partial unique index \`${i.name}\` (WHERE ${m[3]}) is enforced by the API; MySQL keeps a plain index.`);
    t.lines.push(`  ${m[1] ? 'UNIQUE ' : ''}KEY ${q(i.name)} (${parts.map(p => p.replace(/^(\w+)/, '`$1`')).join(', ')})`);
  }
}

const header = `-- Generated by server/tools/pg-to-mysql.mjs from the live Postgres schema.
-- Do not edit by hand: change the generator or add a migration under db/migrations.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
`;
const body = [...tables.values()].map(t =>
  `CREATE TABLE ${q(tableName(t.schema, t.table))} (\n${t.lines.join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;\n`).join('\n');
const viewSql = views.map(v => `CREATE OR REPLACE VIEW ${q(tableName(v.s, v.t))} AS\n${v.def.trim().replace(/;$/, '')};\n`).join('\n');
writeFileSync(new URL('schema.sql', root), `${header}\n${body}\n${viewSql}\nSET FOREIGN_KEY_CHECKS = 1;\n`);
writeFileSync(new URL('schema-followups.md', root),
  `# Schema rules the API must enforce\n\nGenerated with schema.sql. Each item is a Postgres rule MySQL cannot express.\n\n${followups.join('\n')}\n`);
console.log(`${tables.size} tables, ${views.length} view(s), ${followups.length} follow-ups`);
