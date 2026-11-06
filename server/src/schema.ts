// Column metadata read once from information_schema, used to convert JSON
// request values into MySQL values and to find primary keys.
import type { Pool } from 'mysql2/promise';
import { rows } from './db.ts';

export interface Column {
  name: string;
  dataType: string;
  columnType: string;
  nullable: boolean;
  primary: boolean;
  hasDefault: boolean;
  enumValues: string[] | null;
}

export interface Table {
  name: string;
  columns: Map<string, Column>;
  primaryKey: string[];
}

export type Schema = Map<string, Table>;

export async function loadSchema(pool: Pool): Promise<Schema> {
  const result = await rows<{ t: string; c: string; dt: string; ct: string; n: string; k: string; d: string | null; x: string; p: number }>(pool,
    `SELECT table_name AS t, column_name AS c, data_type AS dt, column_type AS ct, is_nullable AS n,
            column_key AS k, column_default AS d, extra AS x, ordinal_position AS p
       FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position`);
  const schema: Schema = new Map();
  for (const r of result) {
    if (!schema.has(r.t)) schema.set(r.t, { name: r.t, columns: new Map(), primaryKey: [] });
    const table = schema.get(r.t)!;
    const enumValues = r.dt === 'enum' ? [...r.ct.matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1].replace(/''/g, "'")) : null;
    table.columns.set(r.c, {
      name: r.c, dataType: r.dt, columnType: r.ct, nullable: r.n === 'YES', primary: r.k === 'PRI',
      hasDefault: r.d !== null || /auto_increment|DEFAULT_GENERATED/i.test(r.x), enumValues
    });
  }
  const keys = await rows<{ t: string; c: string }>(pool,
    `SELECT table_name AS t, column_name AS c FROM information_schema.key_column_usage
      WHERE table_schema = DATABASE() AND constraint_name = 'PRIMARY' ORDER BY table_name, ordinal_position`);
  for (const k of keys) schema.get(k.t)?.primaryKey.push(k.c);
  return schema;
}

export function table(schema: Schema, name: string): Table {
  const found = schema.get(name);
  if (!found) throw new Error(`unknown table ${name}`);
  return found;
}
