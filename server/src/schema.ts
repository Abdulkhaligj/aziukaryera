// Column metadata read once from information_schema, used to convert JSON
// request values into MySQL values and to find primary keys.
import type { Pool } from 'mysql2/promise';
import { rows } from './db.ts';
import { canonical } from './values.ts';

const UNIT_MS: Record<string, number> = { day: 86_400_000, hour: 3_600_000, minute: 60_000, second: 1000 };

/** A column default, resolved once so the write pipeline can fill NEW the
 *  way Postgres does before BEFORE triggers run. */
export type DefaultSpec =
  | { kind: 'value'; value: unknown }
  | { kind: 'uuid' }
  | { kind: 'now'; offsetMs: number }
  | { kind: 'today' };

export interface Column {
  name: string;
  dataType: string;
  columnType: string;
  nullable: boolean;
  primary: boolean;
  hasDefault: boolean;
  autoIncrement: boolean;
  /** null: no default, or one only MySQL can compute (left to the INSERT). */
  defaultSpec: DefaultSpec | null;
  enumValues: string[] | null;
}

export interface ForeignKey {
  name: string;
  table: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
}

export interface Table {
  name: string;
  columns: Map<string, Column>;
  primaryKey: string[];
  /** Foreign keys declared on this table (many-to-one). */
  foreignKeys: ForeignKey[];
  /** Foreign keys on other tables that point here (one-to-many). */
  referencedBy: ForeignKey[];
}

export type Schema = Map<string, Table>;

export async function loadSchema(pool: Pool): Promise<Schema> {
  const result = await rows<{ t: string; c: string; dt: string; ct: string; n: string; k: string; d: string | null; x: string; p: number }>(pool,
    `SELECT table_name AS t, column_name AS c, data_type AS dt, column_type AS ct, is_nullable AS n,
            column_key AS k, column_default AS d, extra AS x, ordinal_position AS p
       FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position`);
  const schema: Schema = new Map();
  const expressions = new Map<string, Column[]>();
  for (const r of result) {
    if (!schema.has(r.t)) schema.set(r.t, { name: r.t, columns: new Map(), primaryKey: [], foreignKeys: [], referencedBy: [] });
    const table = schema.get(r.t)!;
    const enumValues = r.dt === 'enum' ? [...r.ct.matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1].replace(/''/g, "'")) : null;
    const column: Column = {
      name: r.c, dataType: r.dt, columnType: r.ct, nullable: r.n === 'YES', primary: r.k === 'PRI',
      hasDefault: r.d !== null || /auto_increment|DEFAULT_GENERATED/i.test(r.x),
      autoIncrement: /auto_increment/i.test(r.x), defaultSpec: null, enumValues
    };
    table.columns.set(r.c, column);
    if (r.d === null) continue;
    if (!/DEFAULT_GENERATED/i.test(r.x)) { column.defaultSpec = { kind: 'value', value: canonical(column, r.d) }; continue; }
    const interval = r.d.match(/^\(now\(\d?\) \+ interval (\d+) (day|hour|minute|second)\)$/i);
    if (/^uuid\(\)$/i.test(r.d)) column.defaultSpec = { kind: 'uuid' };
    else if (/^(CURRENT_TIMESTAMP|now)(\(\d?\))?$/i.test(r.d)) column.defaultSpec = { kind: 'now', offsetMs: 0 };
    else if (interval) column.defaultSpec = { kind: 'now', offsetMs: Number(interval[1]) * UNIT_MS[interval[2].toLowerCase()] };
    else if (/^(curdate\(\)|CURRENT_DATE)$/i.test(r.d)) column.defaultSpec = { kind: 'today' };
    else {
      // Constant expressions ('' , JSON_ARRAY(...), ...) are evaluated once.
      const sql = r.d.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      expressions.set(sql, [...(expressions.get(sql) ?? []), column]);
    }
  }
  for (const [sql, columns] of expressions) {
    try {
      const value = (await rows<{ v: unknown }>(pool, `SELECT (${sql}) AS v`))[0]?.v;
      for (const column of columns) column.defaultSpec = { kind: 'value', value: canonical(column, value) };
    } catch { /* left to MySQL */ }
  }
  const keys = await rows<{ t: string; c: string }>(pool,
    `SELECT table_name AS t, column_name AS c FROM information_schema.key_column_usage
      WHERE table_schema = DATABASE() AND constraint_name = 'PRIMARY' ORDER BY table_name, ordinal_position`);
  for (const k of keys) schema.get(k.t)?.primaryKey.push(k.c);
  const fks = await rows<{ n: string; t: string; c: string; rt: string; rc: string }>(pool,
    `SELECT constraint_name AS n, table_name AS t, column_name AS c, referenced_table_name AS rt, referenced_column_name AS rc
       FROM information_schema.key_column_usage
      WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL
      ORDER BY table_name, constraint_name, ordinal_position`);
  const byName = new Map<string, ForeignKey>();
  for (const f of fks) {
    const key = `${f.t}.${f.n}`;
    if (!byName.has(key)) byName.set(key, { name: f.n, table: f.t, columns: [], refTable: f.rt, refColumns: [] });
    byName.get(key)!.columns.push(f.c);
    byName.get(key)!.refColumns.push(f.rc);
  }
  for (const fk of byName.values()) {
    schema.get(fk.table)?.foreignKeys.push(fk);
    schema.get(fk.refTable)?.referencedBy.push(fk);
  }
  return schema;
}

export function table(schema: Schema, name: string): Table {
  const found = schema.get(name);
  if (!found) throw new Error(`unknown table ${name}`);
  return found;
}
