// /rest/v1 — the PostgREST subset supabase-js uses: table reads with
// embedding and counts, inserts/upserts, updates, deletes. Every request runs
// in one transaction with the caller's session variables set.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'mysql2/promise';
import type { Config } from '../config.ts';
import { contextFromHeaders, type Context } from '../context.ts';
import { transaction, type Row } from '../db.ts';
import { table as tableOf, type Schema } from '../schema.ts';
import { fromDatabase, PgError, pgErrors } from './errors.ts';
import { deleteRows, insertRows, keysWhere, updateRows } from './mutate.ts';
import { parseFilters, parseOrder, parseSelect } from './parse.ts';
import { exposed, VIEW_BASE } from './policy.ts';
import { filterSql, readRows } from './select.ts';
import { applySession } from './session.ts';

export interface RestDeps { config: Config; pool: Pool; schema: Schema }
type Query = Record<string, unknown>;
const OBJECT = 'application/vnd.pgrst.object+json';

function prefer(req: FastifyRequest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req.headers.prefer || '').split(',')) {
    const [k, v] = part.trim().split('=');
    if (k) out[k] = v ?? '';
  }
  return out;
}

const wantsObject = (req: FastifyRequest) => String(req.headers.accept || '').includes(OBJECT);

function contentRange(offset: number, count: number, total: number | null) {
  const range = count ? `${offset}-${offset + count - 1}` : '*';
  return `${range}/${total ?? '*'}`;
}

export async function restRoutes(app: FastifyInstance, deps: RestDeps) {
  const { config, pool, schema } = deps;

  async function context(req: FastifyRequest): Promise<Context> {
    const apikey = (req.headers.apikey as string | undefined) ?? (req.query as Query)?.apikey as string | undefined;
    if (!apikey) throw pgErrors.missingKey();
    const ctx = await contextFromHeaders(config, apikey, req.headers.authorization);
    if (!ctx) throw pgErrors.badJwt();
    return ctx;
  }

  function send(reply: FastifyReply, req: FastifyRequest, status: number, rows: Row[], extra: { range?: string } = {}) {
    if (extra.range) reply.header('content-range', extra.range);
    if (wantsObject(req)) {
      if (rows.length !== 1) throw pgErrors.singular(rows.length);
      return reply.code(status).type(`${OBJECT}; charset=utf-8`).send(rows[0]);
    }
    return reply.code(status).type('application/json; charset=utf-8').send(rows);
  }

  async function run<T>(req: FastifyRequest, tableName: string, work: (tx: import('../db.ts').Tx, ctx: Context) => Promise<T>): Promise<T> {
    if (!exposed(tableName) || !schema.has(tableName)) throw pgErrors.tableNotFound(tableName);
    const ctx = await context(req);
    try {
      return await transaction(pool, async tx => { await applySession(tx, ctx); return work(tx, ctx); });
    } catch (error) {
      const mapped = fromDatabase(error, tableName, ctx);
      if (mapped) throw mapped;
      throw error;
    }
  }

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof PgError) return reply.code(error.status).send(error.body());
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.code(status).send({ code: 'PGRST100', details: null, hint: null, message: (error as Error).message });
    req.log.error({ err: error }, 'unhandled data API error');
    return reply.code(500).send({ code: 'XX000', details: null, hint: null, message: 'Internal server error' });
  });

  const read = async (req: FastifyRequest<{ Params: { table: string }; Querystring: Query }>, reply: FastifyReply) => {
    const { table: name } = req.params;
    const query = req.query;
    const count = prefer(req).count === 'exact';
    const offset = Number(query.offset || 0);
    const result = await run(req, name, (tx, ctx) => readRows(tx, schema, ctx, name, parseSelect(query.select as string), {
      where: filterSql(tableOf(schema, name), parseFilters(query)),
      order: parseOrder(query.order), limit: query.limit != null ? Number(query.limit) : null, offset, count
    }));
    const range = contentRange(offset, result.rows.length, result.total);
    if (req.method === 'HEAD') return reply.code(200).header('content-range', range).send();
    return send(reply, req, 200, result.rows, { range });
  };
  // Fastify derives HEAD from GET; the handler answers it with headers only.
  app.get('/:table', read);

  app.post('/:table', async (req: FastifyRequest<{ Params: { table: string }; Querystring: Query; Body: unknown }>, reply) => {
    const { table: name } = req.params;
    const p = prefer(req);
    const body = req.body;
    const input = Array.isArray(body) ? body : [body];
    const resolution = p.resolution === 'merge-duplicates' ? 'merge' : p.resolution === 'ignore-duplicates' ? 'ignore' : null;
    const columns = typeof req.query.columns === 'string' ? req.query.columns.split(',').map(c => c.trim().replace(/^"|"$/g, '')) : null;
    const onConflict = typeof req.query.on_conflict === 'string' ? req.query.on_conflict.split(',').map(c => c.trim()) : null;
    const representation = p.return === 'representation';
    const result = await run(req, name, async (tx, ctx) => {
      if (VIEW_BASE[name]) throw pgErrors.permission(ctx, name);
      const keys = await insertRows(tx, schema, ctx, name, input as Row[], { onConflict, resolution, columns, missingDefault: p.missing === 'default' });
      if (!representation) return null;
      const t = tableOf(schema, name);
      const visible = await readRows(tx, schema, ctx, name, parseSelect(req.query.select as string), { where: keysWhere(t, keys) });
      // RETURNING needs SELECT visibility for every new row, as in Postgres.
      if (visible.rows.length < keys.length && !resolution) throw pgErrors.rls(ctx, name);
      const order = new Map(keys.map((k, i) => [JSON.stringify(t.primaryKey.map(c => k[c])), i]));
      return visible.raw.map((r, i) => ({ r: visible.rows[i], i: order.get(JSON.stringify(t.primaryKey.map(c => r[c]))) ?? 0 }))
        .sort((a, b) => a.i - b.i).map(x => x.r);
    });
    if (!result) return reply.code(201).send();
    return send(reply, req, 201, result);
  });

  app.patch('/:table', async (req: FastifyRequest<{ Params: { table: string }; Querystring: Query; Body: unknown }>, reply) => {
    const { table: name } = req.params;
    const representation = prefer(req).return === 'representation';
    const result = await run(req, name, async (tx, ctx) => {
      if (VIEW_BASE[name]) throw pgErrors.permission(ctx, name);
      const t = tableOf(schema, name);
      const keys = await updateRows(tx, schema, ctx, name, req.body as Row, filterSql(t, parseFilters(req.query)));
      return representation ? (await readRows(tx, schema, ctx, name, parseSelect(req.query.select as string), { where: keysWhere(t, keys) })).rows : null;
    });
    if (!result) return reply.code(204).send();
    return send(reply, req, 200, result);
  });

  app.delete('/:table', async (req: FastifyRequest<{ Params: { table: string }; Querystring: Query }>, reply) => {
    const { table: name } = req.params;
    const representation = prefer(req).return === 'representation';
    const result = await run(req, name, async (tx, ctx) => {
      if (VIEW_BASE[name]) throw pgErrors.permission(ctx, name);
      const t = tableOf(schema, name);
      const where = filterSql(t, parseFilters(req.query));
      // Deleted rows are returned as they were, so read them first.
      const before = representation ? await readRows(tx, schema, ctx, name, parseSelect(req.query.select as string), { where }) : null;
      const keys = await deleteRows(tx, schema, ctx, name, where);
      if (!before) return null;
      const gone = new Set(keys.map(k => JSON.stringify(t.primaryKey.map(c => k[c]))));
      return before.rows.filter((_, i) => gone.has(JSON.stringify(t.primaryKey.map(c => before.raw[i][c]))));
    });
    if (!result) return reply.code(204).send();
    return send(reply, req, 200, result);
  });
}
