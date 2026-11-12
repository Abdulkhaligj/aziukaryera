// Row-level security of storage.objects, ported from the 13 Postgres
// policies (permissive OR, restrictive AND; anon has none; service_role
// bypasses). Policies run on the object row as it is or would be stored.
import { one, type Tx } from '../db.ts';
import type { Context } from '../context.ts';
import { currentAdminRole } from '../write/rules/core.ts';

export interface ObjectRow { bucket_id: string; name: string }
export type StorageCmd = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

/** (storage.foldername(name))[1]: the first folder, or null for a top-level file. */
export const firstFolder = (name: string) => (name.includes('/') ? name.split('/')[0] : null);

class Checks {
  private role: Promise<string | null> | undefined;
  private tx: Tx;
  private ctx: Context;
  constructor(tx: Tx, ctx: Context) { this.tx = tx; this.ctx = ctx; }
  get uid() { return this.ctx.uid; }
  /** public.current_admin_role() */
  adminRole() { return (this.role ??= currentAdminRole(this.tx, this.ctx)); }
  async isAdmin() { return (await this.adminRole()) !== null; }
  own(o: ObjectRow) { return this.uid != null && firstFolder(o.name) === this.uid; }
  /** public.avatar_folder_has_room: fewer than 20 avatar files in the caller's folder. */
  async folderHasRoom() {
    if (!this.uid) return false;
    const n = await one<{ n: number }>(this.tx, `SELECT COUNT(*) AS n FROM storage_objects WHERE bucket_id = 'avatars' AND name LIKE ?`,
      [`${this.uid.replace(/[\\%_]/g, '\\$&')}/%`]);
    return Number(n!.n) < 20;
  }
  /** public.avatar_is_shown */
  async shown(name: string) {
    return !!await one(this.tx, `SELECT 1 AS ok FROM profiles WHERE avatar_path = ? COLLATE utf8mb4_bin AND status = 'active' LIMIT 1`, [name]);
  }
  /** public.avatar_path_is_referenced */
  async referenced(name: string) {
    return !!await one(this.tx, `SELECT 1 AS ok FROM profiles WHERE avatar_path = ? COLLATE utf8mb4_bin OR avatar_pending_path = ? COLLATE utf8mb4_bin LIMIT 1`,
      [name, name]);
  }
}

type Rule = (c: Checks, o: ObjectRow) => Promise<boolean> | boolean;
const audio: Rule = async (c, o) => o.bucket_id === 'assistant-audio' && await c.isAdmin() && c.own(o);
const media: Rule = async (c, o) => o.bucket_id === 'public-media' && await c.isAdmin();
// Site images: super admins, managers and editors upload; only super admins
// and managers replace or delete (audit 2026-11-12).
const mediaBy = (...roles: string[]): Rule => async (c, o) => o.bucket_id === 'public-media' && roles.includes((await c.adminRole()) ?? '');
const mediaUpload = mediaBy('super_admin', 'manager', 'editor');
const mediaManage = mediaBy('super_admin', 'manager');
const notReferencedAvatar: Rule = async (c, o) => o.bucket_id !== 'avatars' || !await c.referenced(o.name);

const PERMISSIVE: Record<StorageCmd, Rule[]> = {
  SELECT: [audio, media, async (c, o) => o.bucket_id === 'avatars' && (c.own(o) || await c.shown(o.name) || await c.isAdmin())],
  INSERT: [audio, mediaUpload, async (c, o) => o.bucket_id === 'avatars' && c.own(o) && await c.folderHasRoom()],
  UPDATE: [mediaManage],
  DELETE: [audio, mediaManage, (c, o) => o.bucket_id === 'avatars' && c.own(o)]
};
const RESTRICTIVE: Record<StorageCmd, Rule[]> = {
  SELECT: [],
  INSERT: [notReferencedAvatar],
  UPDATE: [(_c, o) => o.bucket_id !== 'avatars'],
  DELETE: [notReferencedAvatar]
};

/** USING (or WITH CHECK) of every policy for `cmd` on one object. */
export async function storageAllows(tx: Tx, ctx: Context, cmd: StorageCmd, object: ObjectRow): Promise<boolean> {
  if (ctx.role === 'service_role' || ctx.role === 'system') return true;
  if (ctx.role !== 'authenticated') return false;
  const c = new Checks(tx, ctx);
  let permitted = false;
  for (const rule of PERMISSIVE[cmd]) if (await rule(c, object)) { permitted = true; break; }
  if (!permitted) return false;
  for (const rule of RESTRICTIVE[cmd]) if (!await rule(c, object)) return false;
  return true;
}
