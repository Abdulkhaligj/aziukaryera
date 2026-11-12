// /functions/v1/:name — the Edge Functions gateway. Like the old gateway, it checks the
// JWT only for functions deployed with verify_jwt = true (admin-users); the
// others verify their callers themselves.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.ts';
import { verifyJwt } from '../context.ts';
import { FunctionRuntime } from './runtime.ts';

const VERIFY_JWT = new Set(['admin-users']);
const HOP_BY_HOP = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade']);

export async function functionRoutes(app: FastifyInstance, deps: { config: Config }) {
  const { config } = deps;
  const runtime = new FunctionRuntime(config);

  // The function reads the body itself, so it arrives unparsed.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 25 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  async function invoke(req: FastifyRequest, reply: FastifyReply) {
    const name = (req.params as { name: string }).name;
    if (!runtime.exists(name)) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Requested function was not found' });
    if (VERIFY_JWT.has(name)) {
      const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!token) return reply.code(401).send({ code: 401, message: 'Missing authorization header' });
      if (!await verifyJwt(config, token)) return reply.code(401).send({ code: 401, message: 'Invalid JWT' });
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value == null || HOP_BY_HOP.has(key)) continue;
      headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
    }
    // The functions rate-limit guests by IP (cf-connecting-ip, then x-real-ip):
    // set it here so a client cannot pick its own.
    headers.delete('cf-connecting-ip');
    headers.set('x-real-ip', req.ip);
    const body = req.method === 'GET' || req.method === 'HEAD' || !Buffer.isBuffer(req.body) ? undefined : new Uint8Array(req.body);
    const request = new Request(config.publicUrl + req.url, { method: req.method, headers, body });
    let response: Response;
    try {
      response = await (await runtime.handler(name))(request);
    } catch (error) {
      req.log.error({ err: error, fn: name }, 'edge function failed');
      return reply.code(500).send({ code: 'WORKER_ERROR', message: 'Function exited due to an error' });
    }
    reply.code(response.status);
    response.headers.forEach((value, key) => { if (!HOP_BY_HOP.has(key) && key !== 'content-encoding') reply.header(key, value); });
    return reply.send(Buffer.from(await response.arrayBuffer()));
  }

  app.all('/:name', invoke);
  app.all('/:name/*', invoke);
}
