// Presets are patch JSON files in one directory, one file per preset.
// The file name is the encoded preset name, so any name that passes
// validName maps to exactly one file inside the directory.

import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_NAME = 64;
export const MAX_BYTES = 1024 * 1024;

export class PresetError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Letters of any script, digits, space and - _ . ( ) + , ' & #.
// No leading dot and no leading or trailing space.
const NAME = /^(?![. ])[\p{L}\p{N} \-_.()+,'&#]+(?<! )$/u;

export function validName(name) {
  return typeof name === 'string' && name.length <= MAX_NAME && NAME.test(name);
}

function checkName(name) {
  if (!validName(name)) {
    throw new PresetError(400, `preset names are 1-${MAX_NAME} letters, digits, spaces or - _ . ( ) + , ' & #`);
  }
}

export function checkPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new PresetError(400, 'a patch is a json object');
  if (!Array.isArray(patch.modules)) throw new PresetError(400, 'a patch needs a modules list');
  if (patch.cables !== undefined && !Array.isArray(patch.cables)) throw new PresetError(400, 'cables must be a list');
}

const fileName = (name) => `${encodeURIComponent(name)}.json`;

// Stored presets live in `dir`. Factory presets are read straight from
// `factoryDir` and never written: storing a preset with a factory name puts
// your version in `dir`, which then wins, and deleting it brings the factory
// one back. So factory updates show up unless you stored over them.
export class PresetStore {
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
  // preset, stored when there is a stored version (which overrides it)
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
    checkName(name);
    await this.ready;
    const patch = (await this.read(this.dir, name)) ?? (this.factoryDir && (await this.read(this.factoryDir, name)));
    if (!patch) throw new PresetError(404, 'no such preset');
    return patch;
  }

  // Write to a temporary file and rename, so a reader never sees half a file.
  async put(name, patch) {
    checkName(name);
    checkPatch(patch);
    await this.ready;
    const target = join(this.dir, fileName(name));
    const tmp = join(this.dir, `.${process.pid}.${++this.seq}.tmp`);
    await writeFile(tmp, `${JSON.stringify(patch, null, 2)}\n`);
    await rename(tmp, target);
    return { name, updated: (await stat(target)).mtime.toISOString() };
  }

  // Deletes the stored version. A factory preset without one cannot be deleted.
  async remove(name) {
    checkName(name);
    await this.ready;
    try {
      await unlink(join(this.dir, fileName(name)));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      const factory = this.factoryDir && (await stat(join(this.factoryDir, fileName(name))).catch(() => null));
      if (factory) throw new PresetError(403, 'factory presets cannot be deleted');
      throw new PresetError(404, 'no such preset');
    }
  }
}
