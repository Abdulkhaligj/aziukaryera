// Object bytes on disk: <STORAGE_DIR>/<bucket>/<object name>. Writes go to a
// temporary file first and are renamed into place inside the transaction.
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

// Supabase Storage's key rule (storage-api isValidKey), plus no "." / ".." segments.
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

  /** Writes the bytes next to their final place; returns the temporary path. */
  async stage(bucket: string, name: string, bytes: Uint8Array): Promise<string> {
    const target = this.path(bucket, name);
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.upload-${randomUUID()}`;
    await writeFile(temp, bytes);
    return temp;
  }

  async place(temp: string, bucket: string, name: string) { await rename(temp, this.path(bucket, name)); }
  async discard(path: string) { await rm(path, { force: true }); }
  async remove(bucket: string, name: string) { await rm(this.path(bucket, name), { force: true }); }
  async exists(bucket: string, name: string) { return stat(this.path(bucket, name)).then(s => s.isFile(), () => false); }
  read(bucket: string, name: string) { return createReadStream(this.path(bucket, name)); }
}
