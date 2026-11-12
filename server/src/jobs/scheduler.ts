// pg_cron replacement: runs JOBS on their cron schedule (UTC, minute
// resolution). Each run holds a MySQL named lock, so two API processes never
// run the same job at once, and works in one transaction as definer code.
import type { Pool } from 'mysql2/promise';
import { systemContext } from '../context.ts';
import { transaction } from '../db.ts';
import type { Schema } from '../schema.ts';
import { JOBS } from './tasks.ts';

/** One cron field: '*', a number, or a comma list of numbers. */
const fieldMatches = (field: string, value: number) => field === '*' || field.split(',').some(part => Number(part) === value);

export function cronMatches(schedule: string, at: Date): boolean {
  const [minute, hour, day, month, weekday] = schedule.trim().split(/\s+/);
  return fieldMatches(minute, at.getUTCMinutes()) && fieldMatches(hour, at.getUTCHours()) && fieldMatches(day, at.getUTCDate())
    && fieldMatches(month, at.getUTCMonth() + 1) && fieldMatches(weekday, at.getUTCDay());
}

type Log = { info(obj: object, msg: string): void; error(obj: object, msg: string): void };

export async function runJob(pool: Pool, schema: Schema, name: string, log?: Log): Promise<unknown> {
  const job = JOBS.find(j => j.name === name);
  if (!job) throw new Error(`unknown job ${name}`);
  const lock = await pool.getConnection();
  try {
    const [[got]] = await lock.query(`SELECT GET_LOCK(?, 0) AS ok`, [`asoiu_job:${name}`]) as unknown as [[{ ok: number }]];
    if (Number(got.ok) !== 1) return { skipped: 'already running' };
    try {
      const result = await transaction(pool, tx => job.run({ tx, ctx: systemContext, schema, now: new Date(), definer: true }));
      log?.info({ job: name, result }, 'job finished');
      return result;
    } finally {
      await lock.query(`SELECT RELEASE_LOCK(?)`, [`asoiu_job:${name}`]);
    }
  } catch (error) {
    log?.error({ job: name, err: error }, 'job failed');
    throw error;
  } finally {
    lock.release();
  }
}

/** Starts the minute ticker; returns a stop function. */
export function startScheduler(pool: Pool, schema: Schema, log: Log): () => void {
  let timer: NodeJS.Timeout | null = null;
  const tick = () => {
    const at = new Date();
    for (const job of JOBS) if (cronMatches(job.schedule, at)) runJob(pool, schema, job.name, log).catch(() => {});
    // Next whole minute, plus a second so the clock has clearly moved on.
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 1000);
  };
  timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 1000);
  return () => { if (timer) clearTimeout(timer); timer = null; };
}
