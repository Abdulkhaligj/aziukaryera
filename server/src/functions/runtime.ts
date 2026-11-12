// Runs the functions in server/functions unchanged, inside the API
// process: a small Deno shim (Deno.serve, Deno.env) and an import hook for
// their `npm:` and `jsr:` specifiers. The functions call this API through
// supabase-js with SUPABASE_URL = the API's public URL, as they called Supabase.
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Config } from '../config.ts';

export type FunctionHandler = (req: Request) => Response | Promise<Response>;

let hooked = false;
function installHooks() {
  if (hooked) return;
  hooked = true;
  const base = import.meta.url;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      // npm:@scope/name@1.2.3/sub → @scope/name/sub, resolved from the server's node_modules
      const npm = specifier.match(/^npm:(@[^/@]+\/[^/@]+|[^/@]+)(?:@[^/]*)?(\/.*)?$/);
      if (npm) return nextResolve(npm[1] + (npm[2] ?? ''), { ...context, parentURL: base });
      // Type-only side-effect imports such as jsr:@supabase/functions-js/edge-runtime.d.ts
      if (specifier.startsWith('jsr:') && specifier.endsWith('.d.ts')) return { url: 'data:text/javascript,', shortCircuit: true };
      return nextResolve(specifier, context);
    }
  });
}

interface DenoShim { env: { get(key: string): string | undefined; toObject(): Record<string, string> }; serve: (...args: unknown[]) => unknown }

export class FunctionRuntime {
  private handlers = new Map<string, FunctionHandler>();
  private loading: Promise<unknown> = Promise.resolve();
  private config: Config;
  private dir: string;

  constructor(config: Config) {
    this.config = config;
    this.dir = config.functionsDir;
  }

  /** Read when a function is first loaded (functions read env at import time). */
  private environment(): Record<string, string | undefined> {
    return {
      ...this.config.functionEnv,
      SUPABASE_URL: this.config.publicUrl,
      SUPABASE_ANON_KEY: this.config.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: this.config.serviceRoleKey
    };
  }

  /** The names of the deployable functions (folders with an index.ts). */
  exists(name: string) {
    return /^[a-z0-9][a-z0-9-]*$/.test(name) && existsSync(join(this.dir, name, 'index.ts'));
  }

  /** Imports a function once; its top-level Deno.serve call registers the handler. */
  handler(name: string): Promise<FunctionHandler> {
    const known = this.handlers.get(name);
    if (known) return Promise.resolve(known);
    const next = this.loading.then(async () => {
      if (this.handlers.has(name)) return this.handlers.get(name)!;
      installHooks();
      let captured: FunctionHandler | null = null;
      const env = this.environment();
      const shim: DenoShim = {
        env: { get: key => env[key], toObject: () => Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] != null)) },
        serve: (...args: unknown[]) => {
          const handler = args.find(a => typeof a === 'function') ?? (args[0] as { handler?: unknown } | undefined)?.handler;
          if (typeof handler !== 'function') throw new Error('Deno.serve needs a handler');
          captured = handler as FunctionHandler;
          return { finished: Promise.resolve(), shutdown: async () => {}, ref() {}, unref() {} };
        }
      };
      (globalThis as unknown as { Deno: DenoShim }).Deno = shim;
      await import(pathToFileURL(join(this.dir, name, 'index.ts')).href);
      if (!captured) throw new Error(`function ${name} did not call Deno.serve`);
      this.handlers.set(name, captured);
      return captured as FunctionHandler;
    });
    this.loading = next.catch(() => {});
    return next;
  }
}
