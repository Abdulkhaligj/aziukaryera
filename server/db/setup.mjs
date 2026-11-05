// Creates the MySQL database from db/schema.sql and applies db/migrations/*.sql
// that are not yet recorded in schema_migrations.
//   MYSQL_URL=mysql://user:pass@host:3306/asoiu_career node db/setup.mjs [--reset]
// --reset drops the database first (refused unless ALLOW_RESET=1).
import { readFileSync, readdirSync } from 'node:fs';
import mysql from 'mysql2/promise';

const url = new URL(process.env.MYSQL_URL || '');
if (!url.pathname.slice(1)) throw new Error('MYSQL_URL must include the database name.');
const database = decodeURIComponent(url.pathname.slice(1));
const reset = process.argv.includes('--reset');
if (reset && process.env.ALLOW_RESET !== '1') throw new Error('--reset drops all data; set ALLOW_RESET=1 to confirm.');

const dir = new URL('./', import.meta.url);
url.pathname = '/';
const admin = await mysql.createConnection({ uri: url.toString(), multipleStatements: true, timezone: 'Z' });
try {
  if (reset) await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci`);
  await admin.query(`USE \`${database}\``);
  const [[{ has }]] = await admin.query(
    `SELECT COUNT(*) AS has FROM information_schema.tables WHERE table_schema = ? AND table_name = 'profiles'`, [database]);
  if (!has) {
    console.log('schema.sql …');
    await admin.query(readFileSync(new URL('schema.sql', dir), 'utf8'));
  }
  const files = readdirSync(new URL('migrations/', dir)).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const [[ledger]] = await admin.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = 'schema_migrations'`, [database]);
    if (ledger.n) {
      const [[done]] = await admin.query('SELECT COUNT(*) AS n FROM schema_migrations WHERE version = ?', [version]);
      if (done.n) continue;
    }
    console.log(`${file} …`);
    await admin.query(readFileSync(new URL(`migrations/${file}`, dir), 'utf8'));
    await admin.query('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
  }
  const [[{ tables }]] = await admin.query(
    `SELECT COUNT(*) AS tables FROM information_schema.tables WHERE table_schema = ?`, [database]);
  console.log(`Hazırdır: ${database}, ${tables} cədvəl/view.`);
} finally {
  await admin.end();
}
