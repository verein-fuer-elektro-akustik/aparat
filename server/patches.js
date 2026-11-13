// Stored patches are JSON files in one directory, one file per patch.
// The file name is the encoded patch name, so any name that passes
// validName maps to exactly one file inside the directory.

import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_NAME = 64;
export const MAX_BYTES = 1024 * 1024;

export class PatchError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Letters of any script (with their combining marks), digits, space and
// - _ . ( ) + , ' & #. No leading dot, mark or space and no trailing space.
const NAME = /^(?![. \p{M}])[\p{L}\p{M}\p{N} \-_.()+,'&#]+(?<! )$/u;

// File names are limited to 255 bytes; the encoded name plus ".json" must fit.
const MAX_FILE_NAME = 255;

const fileName = (name) => `${encodeURIComponent(name)}.json`;

export function validName(name) {
  return (
    typeof name === 'string' &&
    name.length <= MAX_NAME &&
    NAME.test(name) &&
    Buffer.byteLength(fileName(name)) <= MAX_FILE_NAME
  );
}

// Names are compared in NFC, so a composed and a decomposed "Rück" are one patch.
function checkName(name) {
  const nfc = typeof name === 'string' ? name.normalize('NFC') : name;
  if (!validName(nfc)) {
    throw new PatchError(400, `patch names are 1-${MAX_NAME} letters, digits, spaces or - _ . ( ) + , ' & #`);
  }
  return nfc;
}

export function checkPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new PatchError(400, 'a patch is a json object');
  if (!Array.isArray(patch.modules)) throw new PatchError(400, 'a patch needs a modules list');
  if (patch.cables !== undefined && !Array.isArray(patch.cables)) throw new PatchError(400, 'cables must be a list');
}

// Stored patches live in `dir`. Factory patches are read straight from
// `factoryDir` and never written: storing a patch with a factory name puts
// your version in `dir`, which then wins, and deleting it brings the factory
// one back. So factory updates show up unless you stored over them.
export class PatchStore {
  constructor(dir, factoryDir = null) {
    this.dir = dir;
    this.factoryDir = factoryDir;
    this.ready = mkdir(dir, { recursive: true });
    this.seq = 0;
  }

  async names(dir) {
    const files = await readdir(dir).catch((err) => {
      if (err.code === 'ENOENT') return [];
      throw err;
    });
    const out = new Map();
    for (const f of files) {
      if (!f.endsWith('.json') || f.startsWith('.')) continue;
      let name;
      try {
        name = decodeURIComponent(f.slice(0, -5));
      } catch {
        continue;
      }
      if (!validName(name)) continue;
      const info = await stat(join(dir, f)).catch(() => null);
      if (info) out.set(name, info.mtime.toISOString());
    }
    return out;
  }

  // [{name, updated, factory, stored}]: factory when the name is a factory
  // patch, stored when there is a stored version (which overrides it)
  async list() {
    await this.ready;
    const own = await this.names(this.dir);
    const factory = this.factoryDir ? await this.names(this.factoryDir) : new Map();
    const all = new Set([...own.keys(), ...factory.keys()]);
    return [...all]
      .map((name) => ({ name, updated: own.get(name) ?? factory.get(name), factory: factory.has(name), stored: own.has(name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async read(dir, name) {
    try {
      return JSON.parse(await readFile(join(dir, fileName(name)), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async get(name) {
    name = checkName(name);
    await this.ready;
    const patch = (await this.read(this.dir, name)) ?? (this.factoryDir && (await this.read(this.factoryDir, name)));
    if (!patch) throw new PatchError(404, 'no such patch');
    return patch;
  }

  // Write to a temporary file and rename, so a reader never sees half a file.
  async put(name, patch) {
    name = checkName(name);
    checkPatch(patch);
    await this.ready;
    const target = join(this.dir, fileName(name));
    const tmp = join(this.dir, `.${process.pid}.${++this.seq}.tmp`);
    try {
      await writeFile(tmp, `${JSON.stringify(patch, null, 2)}\n`);
      await rename(tmp, target);
    } catch (err) {
      await unlink(tmp).catch(() => {});
      throw err;
    }
    return { name, updated: (await stat(target)).mtime.toISOString() };
  }

  // Deletes the stored version. A factory patch without one cannot be deleted.
  async remove(name) {
    name = checkName(name);
    await this.ready;
    try {
      await unlink(join(this.dir, fileName(name)));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      const factory = this.factoryDir && (await stat(join(this.factoryDir, fileName(name))).catch(() => null));
      if (factory) throw new PatchError(403, 'factory patches cannot be deleted');
      throw new PatchError(404, 'no such patch');
    }
  }
}
