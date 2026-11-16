// Creates the MySQL database from db/schema.sql and applies db/migrations/*.sql
// that are not yet recorded in schema_migrations.
//   MYSQL_URL=mysql://user:pass@host:3306/asoiu_career node db/setup.mjs [--reset]
// --reset drops the database first (refused unless ALLOW_RESET=1).
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';

const dir = new URL('./', import.meta.url);

export async function setupDatabase(mysqlUrl, { reset = false, log = console.log } = {}) {
  const url = new URL(mysqlUrl);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!database) throw new Error('MYSQL_URL must include the database name.');
  url.pathname = '/';
  const admin = await mysql.createConnection({ uri: url.toString(), multipleStatements: true, timezone: 'Z' });
  try {
    if (reset) await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci`);
    await admin.query(`USE \`${database}\``);
    // The ledger first, so schema.sql is marked done only after it ran to the end
    // (a half-created schema is never taken for a complete one: audit 2026-11-16, M35).
    await admin.query(`CREATE TABLE IF NOT EXISTS \`schema_migrations\` (
      \`version\` VARCHAR(191) NOT NULL,
      \`applied_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (\`version\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci`);
    const [[{ done }]] = await admin.query("SELECT COUNT(*) AS done FROM schema_migrations WHERE version = '0000_schema'");
    if (!done) {
      const [[{ tables, recorded }]] = await admin.query(
        `SELECT (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = ? AND table_name <> 'schema_migrations') AS tables,
                (SELECT COUNT(*) FROM schema_migrations) AS recorded`, [database]);
      if (tables && recorded) {
        // A database set up before the schema itself was recorded: complete, since migrations ran.
        await admin.query("INSERT INTO schema_migrations (version) VALUES ('0000_schema')");
      } else if (tables) {
        throw new Error(`${database} has ${tables} tables but no record of a complete schema.sql; set it up again with --reset (ALLOW_RESET=1).`);
      } else {
        log('schema.sql …');
        await admin.query(readFileSync(new URL('schema.sql', dir), 'utf8'));
        await admin.query("INSERT INTO schema_migrations (version) VALUES ('0000_schema')");
      }
    }
    const files = readdirSync(new URL('migrations/', dir)).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
    // MySQL cannot roll DDL back; every migration is written to run again, so one
    // that stopped half-way is completed by the next run (it is recorded only at the end).
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      const [[done]] = await admin.query('SELECT COUNT(*) AS n FROM schema_migrations WHERE version = ?', [version]);
      if (done.n) continue;
      log(`${file} …`);
      await admin.query(readFileSync(new URL(`migrations/${file}`, dir), 'utf8'));
      await admin.query('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
    }
    const [[{ tables }]] = await admin.query(
      `SELECT COUNT(*) AS tables FROM information_schema.tables WHERE table_schema = ?`, [database]);
    log(`Hazırdır: ${database}, ${tables} cədvəl/view.`);
  } finally {
    await admin.end();
  }
}

export async function dropDatabase(mysqlUrl) {
  const url = new URL(mysqlUrl);
  const database = decodeURIComponent(url.pathname.slice(1));
  url.pathname = '/';
  const admin = await mysql.createConnection({ uri: url.toString() });
  try { await admin.query(`DROP DATABASE IF EXISTS \`${database}\``); } finally { await admin.end(); }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const reset = process.argv.includes('--reset');
  if (reset && process.env.ALLOW_RESET !== '1') throw new Error('--reset drops all data; set ALLOW_RESET=1 to confirm.');
  await setupDatabase(process.env.MYSQL_URL || '', { reset });
}
