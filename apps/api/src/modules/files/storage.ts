import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { env } from '../../config/env';

/**
 * Storage abstraction. `local` writes outside the web root under UPLOAD_DIR and
 * is served only through the authorised download endpoint. Swap in an object
 * store (Cloudinary/S3) by implementing this interface.
 */
export interface StorageProvider {
  name: 'local' | 'cloudinary' | 's3';
  put(key: string, data: Buffer): Promise<void>;
  read(key: string): Readable;
  remove(key: string): Promise<void>;
}

function localPath(key: string): string {
  const root = resolve(env().UPLOAD_DIR);
  const full = resolve(root, key);
  if (!full.startsWith(root + sep)) throw new Error('Invalid storage key');
  return full;
}

export const localStorage: StorageProvider = {
  name: 'local',
  async put(key, data) {
    const path = localPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx' });
  },
  read: (key) => createReadStream(localPath(key)),
  async remove(key) {
    await rm(localPath(key), { force: true });
  },
};

export const storage = (): StorageProvider => localStorage;
