// /storage/v1 — the Supabase Storage subset supabase-js uses: upload (POST,
// x-upsert; PUT update), download, public and signed URLs, remove, list.
// Rows live in storage_objects (with RLS from ./policy.ts and the
// storage.objects triggers); bytes live on disk (./files.ts).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'mysql2/promise';
import { SignJWT, jwtVerify } from 'jose';
import type { Config } from '../config.ts';
import { contextFromHeaders, type Context } from '../context.ts';
import { one, rows, transaction, type Row, type Tx } from '../db.ts';
import { DbRuleError } from '../errors.ts';
import type { Schema } from '../schema.ts';
import { deleteRow, insertRow, nowText, updateRow, type WriteEnv } from '../write/pipeline.ts';
import { FileStore, validBucket, validKey } from './files.ts';
import { storageAllows } from './policy.ts';

export interface StorageDeps { config: Config; pool: Pool; schema: Schema }
const MAX_UPLOAD = 50 * 1024 * 1024;

/** Supabase Storage error body: { statusCode, error, message }. */
export class StorageError extends Error {
  readonly status: number;
  readonly error: string;
  constructor(status: number, error: string, message: string) { super(message); this.status = status; this.error = error; }
  body() { return { statusCode: String(this.status), error: this.error, message: this.message }; }
}
const notFound = () => new StorageError(404, 'not_found', 'Object not found');
const denied = () => new StorageError(403, 'Unauthorized', 'new row violates row-level security policy');

function fromError(error: unknown): StorageError | null {
  if (error instanceof StorageError) return error;
  if (error instanceof DbRuleError) {
    if (error.sqlState === '42501') return new StorageError(403, 'Unauthorized', error.message);
    if (error.sqlState === '23505') return new StorageError(409, 'Duplicate', error.message);
    return new StorageError(400, 'Bad Request', error.message);
  }
  if ((error as { errno?: number }).errno === 1062) return new StorageError(409, 'Duplicate', 'The resource already exists');
  return null;
}

/** The object's Storage metadata, from the row's columns. */
const metadata = (o: Row) => ({
  eTag: `"${o.id}-${o.size}"`, size: o.size, mimetype: o.mimetype, cacheControl: o.cache_control,
  lastModified: o.updated_at, contentLength: o.size, httpStatusCode: 200
});
const fileObject = (o: Row) => ({
  name: o.name, bucket_id: o.bucket_id, owner: o.owner_id, owner_id: o.owner_id, id: o.id,
  updated_at: o.updated_at, created_at: o.created_at, last_accessed_at: o.updated_at, metadata: metadata(o)
});

interface Upload { bytes: Uint8Array; mime: string; cacheControl: string }

async function readUpload(req: FastifyRequest): Promise<Upload> {
  const type = String(req.headers['content-type'] || 'application/octet-stream');
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? ''));
  if (/^multipart\/form-data/i.test(type)) {
    const form = await new Response(new Blob([new Uint8Array(raw)]), { headers: { 'content-type': type } }).formData();
    const file = [...form.values()].find((v): v is File => typeof v !== 'string');
    if (!file) throw new StorageError(400, 'Bad Request', 'No file in the upload');
    const cache = form.get('cacheControl');
    return { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type || 'application/octet-stream',
      cacheControl: `max-age=${typeof cache === 'string' && cache ? cache : '3600'}` };
  }
  return { bytes: new Uint8Array(raw), mime: type, cacheControl: String(req.headers['cache-control'] || 'max-age=3600') };
}

function mimeAllowed(allowed: unknown, mime: string): boolean {
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  const base = mime.split(';')[0].trim().toLowerCase();
  return allowed.some(a => {
    const rule = String(a).toLowerCase();
    return rule.endsWith('/*') ? base.startsWith(rule.slice(0, -1)) : base === rule;
  });
}

export async function storageRoutes(app: FastifyInstance, deps: StorageDeps) {
  const { config, pool, schema } = deps;
  const files = new FileStore(config.storageDir);
  const key = new TextEncoder().encode(config.jwtSecret);

  app.removeAllContentTypeParsers();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body) return done(null, {});
    try { done(null, JSON.parse(body as string)); } catch { done(new StorageError(400, 'Bad Request', 'Invalid JSON body'), undefined); }
  });
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: MAX_UPLOAD }, (_req, body, done) => done(null, body));

  app.setErrorHandler((error, req, reply) => {
    const mapped = fromError(error);
    if (mapped) return reply.code(mapped.status).send(mapped.body());
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 413) return reply.code(413).send(new StorageError(413, 'Payload too large', 'The object exceeded the maximum allowed size').body());
    if (status && status >= 400 && status < 500) return reply.code(status).send(new StorageError(status, 'Bad Request', (error as Error).message).body());
    req.log.error({ err: error }, 'unhandled storage error');
    return reply.code(500).send(new StorageError(500, 'Internal Server Error', 'Internal server error').body());
  });

  async function context(req: FastifyRequest): Promise<Context> {
    const ctx = await contextFromHeaders(config, req.headers.apikey as string | undefined, req.headers.authorization);
    if (!ctx) throw new StorageError(400, 'Invalid JWT', 'invalid signature');
    return ctx;
  }

  function target(req: FastifyRequest): { bucket: string; name: string } {
    const params = req.params as { bucket: string; '*'?: string };
    const name = (params['*'] ?? '').replace(/^\/+/, '');
    if (!validBucket(params.bucket)) throw new StorageError(400, 'Invalid key', `Invalid bucket: ${params.bucket}`);
    if (!validKey(name)) throw new StorageError(400, 'Invalid key', `Invalid key: ${name}`);
    return { bucket: params.bucket, name };
  }

  async function bucketRow(db: Pool | Tx, bucket: string) {
    const row = await one<{ id: string; public: boolean; file_size_limit: number | null; allowed_mime_types: unknown }>(db,
      'SELECT * FROM storage_buckets WHERE id = ?', [bucket]);
    if (!row) throw new StorageError(404, 'Bucket not found', 'Bucket not found');
    return row;
  }

  type Stored = Row & { bucket_id: string; name: string };
  const objectRow = (db: Pool | Tx, bucket: string, name: string, lock = false) =>
    one<Stored>(db, `SELECT * FROM storage_objects WHERE bucket_id = ? AND name = ?${lock ? ' FOR UPDATE' : ''}`, [bucket, name]);

  const env = (tx: Tx, ctx: Context): WriteEnv => ({ tx, ctx, schema, now: new Date() });

  async function serve(reply: FastifyReply, req: FastifyRequest, row: Row) {
    if (!await files.exists(row.bucket_id as string, row.name as string)) throw notFound();
    reply.header('content-type', (row.mimetype as string) || 'application/octet-stream');
    reply.header('cache-control', (row.cache_control as string) || 'no-cache');
    reply.header('content-length', String(row.size));
    reply.header('etag', metadata(row).eTag);
    reply.header('last-modified', new Date(row.updated_at as string).toUTCString());
    const download = (req.query as Record<string, string | undefined>).download;
    if (download !== undefined) {
      const file = download || String(row.name).split('/').pop()!;
      reply.header('content-disposition', `attachment; filename="${file.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(file)}`);
    }
    return reply.send(files.read(row.bucket_id as string, row.name as string));
  }

  async function upload(req: FastifyRequest, reply: FastifyReply, mode: 'create' | 'update') {
    const { bucket, name } = target(req);
    const ctx = await context(req);
    const settings = await bucketRow(pool, bucket);
    const file = await readUpload(req);
    if (settings.file_size_limit != null && file.bytes.length > settings.file_size_limit) {
      throw new StorageError(413, 'Payload too large', 'The object exceeded the maximum allowed size');
    }
    if (!mimeAllowed(settings.allowed_mime_types, file.mime)) throw new StorageError(415, 'invalid_mime_type', `mime type ${file.mime} is not supported`);
    const upsert = mode === 'update' || String(req.headers['x-upsert'] ?? '').toLowerCase() === 'true';
    const temp = await files.stage(bucket, name, file.bytes);
    let placed = false;
    let created = false;
    try {
      const stored = await transaction(pool, async tx => {
        const existing = await objectRow(tx, bucket, name, true);
        if (existing && !upsert) throw new StorageError(409, 'Duplicate', 'The resource already exists');
        if (!existing && mode === 'update') throw notFound();
        const next = { bucket_id: bucket, name, owner_id: ctx.uid, mimetype: file.mime, size: file.bytes.length, cache_control: file.cacheControl };
        let row: Row;
        if (existing) {
          // INSERT … ON CONFLICT runs the BEFORE INSERT trigger first: an avatar path is never reused.
          if (mode === 'create' && bucket === 'avatars') throw new DbRuleError('Avatar generation keys cannot be reused; upload a new random path', '23505');
          if (!await storageAllows(tx, ctx, 'SELECT', existing) || !await storageAllows(tx, ctx, 'UPDATE', existing)
            || !await storageAllows(tx, ctx, 'UPDATE', next)) throw denied();
          row = (await updateRow(env(tx, ctx), 'storage_objects', { bucket_id: bucket, name },
            { owner_id: ctx.uid, mimetype: file.mime, size: file.bytes.length, cache_control: file.cacheControl, updated_at: nowText(env(tx, ctx)) }))!;
        } else {
          // WITH CHECK is evaluated before the row exists (the folder room count excludes it).
          if (!await storageAllows(tx, ctx, 'INSERT', next)) throw denied();
          row = await insertRow(env(tx, ctx), 'storage_objects', next);
          created = true;
        }
        await files.place(temp, bucket, name);
        placed = true;
        return row;
      });
      return reply.send({ Key: `${bucket}/${name}`, Id: stored.id });
    } catch (error) {
      if (!placed) await files.discard(temp);
      else if (created) await files.remove(bucket, name);
      throw error;
    }
  }

  app.post('/object/:bucket/*', (req, reply) => upload(req, reply, 'create'));
  app.put('/object/:bucket/*', (req, reply) => upload(req, reply, 'update'));

  const download = async (req: FastifyRequest, reply: FastifyReply) => {
    const { bucket, name } = target(req);
    const ctx = await context(req);
    await bucketRow(pool, bucket);
    const row = await transaction(pool, async tx => {
      const found = await objectRow(tx, bucket, name);
      return found && await storageAllows(tx, ctx, 'SELECT', found) ? found : null;
    });
    if (!row) throw notFound();
    return serve(reply, req, row);
  };
  app.get('/object/authenticated/:bucket/*', download);
  app.get('/object/:bucket/*', download);

  app.get('/object/public/:bucket/*', async (req, reply) => {
    const { bucket, name } = target(req);
    const settings = await bucketRow(pool, bucket);
    if (!settings.public) throw new StorageError(404, 'Bucket not found', 'Bucket not found');
    const row = await objectRow(pool, bucket, name);
    if (!row) throw notFound();
    return serve(reply, req, row);
  });

  async function sign(bucket: string, name: string, expiresIn: number) {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ url: `${bucket}/${name}` }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(now).setExpirationTime(now + expiresIn).sign(key);
    return `/object/sign/${bucket}/${name}?token=${token}`;
  }
  const expiry = (value: unknown) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) throw new StorageError(400, 'Bad Request', 'expiresIn must be a positive number');
    return Math.floor(n);
  };

  app.get('/object/sign/:bucket/*', async (req, reply) => {
    const { bucket, name } = target(req);
    const token = (req.query as Record<string, string | undefined>).token;
    if (!token) throw new StorageError(400, 'InvalidSignature', 'Missing token');
    let url: unknown;
    try { url = (await jwtVerify(token, key, { algorithms: ['HS256'] })).payload.url; }
    catch (error) { throw new StorageError(400, 'InvalidJWT', (error as Error).message); }
    if (url !== `${bucket}/${name}`) throw new StorageError(400, 'InvalidSignature', 'The url do not match the signature');
    const row = await objectRow(pool, bucket, name);
    if (!row) throw notFound();
    return serve(reply, req, row);
  });

  app.post('/object/sign/:bucket/*', async (req) => {
    const { bucket, name } = target(req);
    const ctx = await context(req);
    const expiresIn = expiry((req.body as Record<string, unknown> | undefined)?.expiresIn);
    const visible = await transaction(pool, async tx => {
      const row = await objectRow(tx, bucket, name);
      return !!row && await storageAllows(tx, ctx, 'SELECT', row);
    });
    if (!visible) throw notFound();
    return { signedURL: await sign(bucket, name, expiresIn) };
  });

  app.post('/object/sign/:bucket', async (req) => {
    const bucket = (req.params as { bucket: string }).bucket;
    const ctx = await context(req);
    const body = (req.body ?? {}) as { expiresIn?: unknown; paths?: unknown };
    const expiresIn = expiry(body.expiresIn);
    if (!Array.isArray(body.paths)) throw new StorageError(400, 'Bad Request', 'paths must be an array');
    const paths = body.paths.map(String);
    const visible = await transaction(pool, async tx => {
      const out = new Set<string>();
      for (const name of paths) {
        const row = validKey(name) ? await objectRow(tx, bucket, name) : null;
        if (row && await storageAllows(tx, ctx, 'SELECT', row)) out.add(name);
      }
      return out;
    });
    return Promise.all(paths.map(async path => visible.has(path)
      ? { error: null, path, signedURL: await sign(bucket, path, expiresIn) }
      : { error: 'Either the object does not exist or you do not have access to it', path, signedURL: null }));
  });

  app.delete('/object/:bucket', async (req) => {
    const bucket = (req.params as { bucket: string }).bucket;
    const ctx = await context(req);
    const prefixes = (req.body as { prefixes?: unknown } | undefined)?.prefixes;
    if (!Array.isArray(prefixes) || !prefixes.length) throw new StorageError(400, 'Bad Request', 'prefixes must be a non-empty array');
    await bucketRow(pool, bucket);
    const deleted = await transaction(pool, async tx => {
      const out: Row[] = [];
      for (const name of [...new Set(prefixes.map(String))]) {
        const row = await objectRow(tx, bucket, name, true);
        // Rows the caller may not see or delete are skipped, as DELETE … USING does.
        if (!row || !await storageAllows(tx, ctx, 'SELECT', row) || !await storageAllows(tx, ctx, 'DELETE', row)) continue;
        await deleteRow(env(tx, ctx), 'storage_objects', { bucket_id: bucket, name });
        out.push(row);
      }
      return out;
    });
    for (const row of deleted) await files.remove(bucket, row.name as string).catch(() => {});
    return deleted.map(fileObject);
  });

  app.post('/object/list/:bucket', async (req) => {
    const bucket = (req.params as { bucket: string }).bucket;
    const ctx = await context(req);
    await bucketRow(pool, bucket);
    const body = (req.body ?? {}) as { prefix?: string; limit?: number; offset?: number; search?: string; sortBy?: { column?: string; order?: string } };
    let prefix = String(body.prefix ?? '').replace(/^\/+/, '');
    if (prefix && !prefix.endsWith('/')) prefix += '/';
    const limit = Math.max(0, Number(body.limit ?? 100));
    const offset = Math.max(0, Number(body.offset ?? 0));
    const search = String(body.search ?? '').toLowerCase();
    const column = ['name', 'created_at', 'updated_at', 'last_accessed_at'].includes(String(body.sortBy?.column)) ? String(body.sortBy!.column) : 'name';
    const descending = String(body.sortBy?.order ?? 'asc').toLowerCase() === 'desc';
    const candidates = await rows<Row & { bucket_id: string; name: string }>(pool, `SELECT * FROM storage_objects WHERE bucket_id = ? AND LEFT(name, ?) = ? ORDER BY name`,
      [bucket, [...prefix].length, prefix]);
    const visible = await transaction(pool, async tx => {
      const out: Row[] = [];
      for (const row of candidates) if (await storageAllows(tx, ctx, 'SELECT', row)) out.push(row);
      return out;
    });
    const folders = new Map<string, Row>();
    const items: Row[] = [];
    for (const row of visible) {
      const rest = String(row.name).slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash >= 0) {
        const folder = rest.slice(0, slash);
        if (!folders.has(folder)) folders.set(folder, { name: folder, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null });
      } else items.push({ ...fileObject(row), name: rest });
    }
    const all = [...folders.values(), ...items].filter(i => !search || String(i.name).toLowerCase().startsWith(search));
    const field = column === 'last_accessed_at' ? 'updated_at' : column;
    all.sort((a, b) => {
      const x = a[field] as string | null, y = b[field] as string | null;
      const order = x === y ? (a.name! < b.name! ? -1 : a.name! > b.name! ? 1 : 0) : x === null ? -1 : y === null ? 1 : x < y ? -1 : 1;
      return descending ? -order : order;
    });
    return all.slice(offset, offset + limit);
  });
}
