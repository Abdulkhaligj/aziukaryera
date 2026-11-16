// pg_cron replacement: runs JOBS on their cron schedule (UTC, minute
// resolution). Each run holds a MySQL named lock, so two API processes never
// run the same job at once, and works in one transaction as definer code
// (a job that commits in steps gets the pool instead).
import type { Pool } from 'mysql2/promise';
import { systemContext } from '../context.ts';
import { one, transaction } from '../db.ts';
import type { Schema } from '../schema.ts';
import { JOBS } from './tasks.ts';

const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]] as const;

/** One cron field: '*', a number, a range a-b, a step (* / n, a-b / n) or a comma
 *  list of those. Anything else is an error, not a job that never runs (L31). */
export function parseField(field: string, index: number): Set<number> {
  const [lo, hi] = RANGES[index];
  const values = new Set<number>();
  for (const part of field.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`invalid cron field "${field}"`);
    const from = m[1] === '*' ? lo : Number(m[2]);
    const to = m[1] === '*' ? hi : m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? hi : from;
    const step = m[4] !== undefined ? Number(m[4]) : 1;
    if (from < lo || to > hi || from > to || step < 1) throw new Error(`cron field "${field}" is out of range ${lo}-${hi}`);
    for (let v = from; v <= to; v += step) values.add(v);
  }
  return values;
}

export function parseCron(schedule: string): Set<number>[] {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron schedule "${schedule}" needs 5 fields`);
  return fields.map((field, i) => parseField(field, i));
}

export function cronMatches(schedule: string, at: Date): boolean {
  const [minute, hour, day, month, weekday] = parseCron(schedule);
  return minute.has(at.getUTCMinutes()) && hour.has(at.getUTCHours()) && day.has(at.getUTCDate())
    && month.has(at.getUTCMonth() + 1) && weekday.has(at.getUTCDay());
}

// Every schedule is checked when the module loads: a typo stops the start.
for (const job of JOBS) parseCron(job.schedule);

type Log = { info(obj: object, msg: string): void; warn?(obj: object, msg: string): void; error(obj: object, msg: string): void };

/** The named lock of a job: per database, so two deployments on one MySQL
 *  server do not block each other (L31). */
const prefixes = new WeakMap<Pool, Promise<string>>();
async function lockName(pool: Pool, name: string) {
  if (!prefixes.has(pool)) prefixes.set(pool, one<{ db: string }>(pool, 'SELECT DATABASE() AS db').then(r => `asoiu_job:${r?.db ?? ''}`));
  return `${await prefixes.get(pool)}:${name}`.slice(0, 64);
}

export async function runJob(pool: Pool, schema: Schema, name: string, log?: Log): Promise<unknown> {
  const job = JOBS.find(j => j.name === name);
  if (!job) throw new Error(`unknown job ${name}`);
  const key = await lockName(pool, name);
  let lock: Awaited<ReturnType<Pool['getConnection']>> | null = null;
  try {
    lock = await pool.getConnection();
    const [[got]] = await lock.query(`SELECT GET_LOCK(?, 0) AS ok`, [key]) as unknown as [[{ ok: number }]];
    if (Number(got.ok) !== 1) return { skipped: 'already running' };
    let result: Record<string, unknown>;
    try {
      const now = new Date();
      result = job.runWithPool
        ? await job.runWithPool(pool, { ctx: systemContext, schema, now, definer: true })
        : await transaction(pool, tx => job.run!({ tx, ctx: systemContext, schema, now, definer: true }));
    } finally {
      // A failed release does not turn a finished job into a failed one (M29).
      await lock.query(`SELECT RELEASE_LOCK(?)`, [key]).catch(error => log?.error({ job: name, err: error }, 'job lock release failed'));
    }
    log?.info({ job: name, result }, 'job finished');
    if (result.more) log?.warn?.({ job: name, result }, 'job stopped at its batch limit; the rest waits for the next run');
    return result;
  } catch (error) {
    log?.error({ job: name, err: error }, 'job failed');
    throw error;
  } finally {
    lock?.release();
  }
}

/** Starts the minute ticker; returns a stop function. */
export function startScheduler(pool: Pool, schema: Schema, log: Log): () => void {
  let timer: NodeJS.Timeout | null = null;
  const tick = () => {
    const at = new Date();
    // runJob logs its own failures; this catch only keeps an unexpected one visible (M29).
    for (const job of JOBS) if (cronMatches(job.schedule, at)) runJob(pool, schema, job.name, log).catch(error => log.error({ job: job.name, err: error }, 'job run failed'));
    // Next whole minute, plus a second so the clock has clearly moved on.
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 1000);
  };
  timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 1000);
  return () => { if (timer) clearTimeout(timer); timer = null; };
}
