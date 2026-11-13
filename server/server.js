// aparat API: stores patches. The frontend in web/ is static and served by
// nginx, which proxies /api/ here (see nginx/).
//
//   GET    /api/patches          [{ name, updated, factory, stored }]
//   GET    /api/patches/:name    the patch
//   PUT    /api/patches/:name    store the patch in the request body
//   DELETE /api/patches/:name    the stored version (factory patches stay)
//
// No dependencies. No authentication, so it listens on 127.0.0.1 unless HOST
// says otherwise.

import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_BYTES, PatchError, PatchStore } from './patches.js';

// Factory patches ship next to this file. Stored patches default to data/patches
// in the repository; deployed, PATCHES_DIR says where they go.
const HERE = fileURLToPath(new URL('.', import.meta.url));

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(data);
}

const tooLarge = () => new PatchError(413, `patches are limited to ${MAX_BYTES} bytes`);

// Bodies without a content-length (chunked) are counted as they arrive. Past
// the limit the rest is read and dropped, so the 413 reaches the client
// instead of a reset connection.
function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size <= MAX_BYTES) chunks.push(c);
    });
    req.on('end', () => (size > MAX_BYTES ? fail(tooLarge()) : ok(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', fail);
  });
}

async function api(req, res, store, path) {
  if (path === '') {
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    return send(res, 200, await store.list());
  }
  let name;
  try {
    name = decodeURIComponent(path);
  } catch {
    throw new PatchError(400, 'bad patch name');
  }
  switch (req.method) {
    case 'GET':
      return send(res, 200, await store.get(name));
    case 'PUT': {
      if (Number(req.headers['content-length']) > MAX_BYTES) {
        // the body is not read, so the connection cannot be reused
        res.setHeader('connection', 'close');
        throw tooLarge();
      }
      let patch;
      try {
        patch = JSON.parse(await readBody(req));
      } catch (err) {
        if (err instanceof PatchError) throw err;
        throw new PatchError(400, 'body is not json');
      }
      return send(res, 200, await store.put(name, patch));
    }
    case 'DELETE':
      await store.remove(name);
      res.writeHead(204).end();
      return undefined;
    default:
      return send(res, 405, { error: 'method not allowed' });
  }
}

export function createService({
  patchesDir = join(HERE, '..', 'data', 'patches'),
  factoryDir = join(HERE, 'patches'),
} = {}) {
  const store = new PatchStore(resolve(patchesDir), factoryDir ? resolve(factoryDir) : null);
  return createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname === '/api/patches' || pathname.startsWith('/api/patches/')) {
        await api(req, res, store, pathname.slice('/api/patches/'.length));
      } else {
        send(res, 404, { error: 'not found' });
      }
    } catch (err) {
      if (res.headersSent) return res.destroy();
      if (err instanceof PatchError) return send(res, err.status, { error: err.message });
      console.error(err);
      send(res, 500, { error: 'internal error' });
    }
    return undefined;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 8001);
  const patchesDir = process.env.PATCHES_DIR;
  createService(patchesDir ? { patchesDir } : {}).listen(port, host, () => {
    console.log(`aparat api on http://${host}:${port}/api/`);
  });
}
