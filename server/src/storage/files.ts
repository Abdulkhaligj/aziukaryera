// Object bytes on disk: <STORAGE_DIR>/<bucket>/<object name>. Writes go to a
// temporary file first and are renamed into place inside the transaction.
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

// The storage key rule of the previous backend, plus no "." / ".." segments.
const KEY = /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/;
export const validKey = (name: string) =>
  name.length > 0 && name.length <= 1024 && KEY.test(name) && !name.startsWith('/') && !name.split('/').some(s => s === '' || s === '.' || s === '..');
export const validBucket = (id: string) => /^[a-z0-9][a-z0-9._-]{0,62}$/i.test(id) && id !== '.' && id !== '..';

export class FileStore {
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); }

  path(bucket: string, name: string): string {
    const full = resolve(join(this.root, bucket, ...name.split('/')));
    if (!full.startsWith(this.root + sep)) throw new Error('path escapes the storage directory');
    return full;
  }

  /** Writes the bytes to <root>/.staging (not a bucket: no API path reaches it)
   *  and returns the path. No folder of the object is created before the
   *  policies allowed it (audit 2026-11-16, M12). */
  async stage(bytes: Uint8Array): Promise<string> {
    const dir = join(this.root, '.staging');
    await mkdir(dir, { recursive: true });
    const temp = join(dir, randomUUID());
    await writeFile(temp, bytes);
    return temp;
  }

  /** Moves the staged file to the object's place (same file system: atomic). */
  async place(temp: string, bucket: string, name: string) {
    const target = this.path(bucket, name);
    await mkdir(dirname(target), { recursive: true });
    await rename(temp, target);
  }
  /** Moves the object's current file aside; returns where, or null if there is none (M13). */
  async setAside(bucket: string, name: string): Promise<string | null> {
    const target = this.path(bucket, name);
    if (!await this.exists(bucket, name)) return null;
    const aside = join(this.root, '.staging', `previous-${randomUUID()}`);
    await mkdir(dirname(aside), { recursive: true });
    await rename(target, aside);
    return aside;
  }
  /** Puts a file moved aside back in place (M13). */
  async restore(aside: string, bucket: string, name: string) { await rename(aside, this.path(bucket, name)); }
  /** Takes a placed file back to the staging path, so a retried transaction can place it again (M14). */
  async unplace(bucket: string, name: string, temp: string) { await rename(this.path(bucket, name), temp); await this.prune(bucket, name); }
  async discard(path: string) { await rm(path, { force: true }); }
  async remove(bucket: string, name: string) { await rm(this.path(bucket, name), { force: true }); await this.prune(bucket, name); }
  /** Removes the object's folders that became empty (up to the bucket). */
  private async prune(bucket: string, name: string) {
    const bucketDir = resolve(join(this.root, bucket));
    for (let dir = dirname(this.path(bucket, name)); dir.startsWith(bucketDir + sep); dir = dirname(dir)) {
      try { await rmdir(dir); } catch { return; }
    }
  }
  async exists(bucket: string, name: string) { return stat(this.path(bucket, name)).then(s => s.isFile(), () => false); }
  read(bucket: string, name: string) { return createReadStream(this.path(bucket, name)); }
}
