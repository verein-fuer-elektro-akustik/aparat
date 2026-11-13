// aparat API: stores presets. The frontend in web/ is static and served by
// nginx, which proxies /api/ here (see nginx/).
//
//   GET    /api/presets          [{ name, updated, factory, stored }]
//   GET    /api/presets/:name    the patch
//   PUT    /api/presets/:name    store the patch in the request body
//   DELETE /api/presets/:name    the stored version (factory presets stay)
//
// No dependencies. No authentication, so it listens on 127.0.0.1 unless HOST
// says otherwise.

import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_BYTES, PresetError, PresetStore } from './presets.js';

// Factory presets ship next to this file. Stored presets default to data/presets
// in the repository; deployed, PRESETS_DIR says where they go.
const HERE = fileURLToPath(new URL('.', import.meta.url));

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(data);
}

const tooLarge = () => new PresetError(413, `presets are limited to ${MAX_BYTES} bytes`);

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
    throw new PresetError(400, 'bad preset name');
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
        if (err instanceof PresetError) throw err;
        throw new PresetError(400, 'body is not json');
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
  presetsDir = join(HERE, '..', 'data', 'presets'),
  factoryDir = join(HERE, 'presets'),
} = {}) {
  const store = new PresetStore(resolve(presetsDir), factoryDir ? resolve(factoryDir) : null);
  return createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname === '/api/presets' || pathname.startsWith('/api/presets/')) {
        await api(req, res, store, pathname.slice('/api/presets/'.length));
      } else {
        send(res, 404, { error: 'not found' });
      }
    } catch (err) {
      if (res.headersSent) return res.destroy();
      if (err instanceof PresetError) return send(res, err.status, { error: err.message });
      console.error(err);
      send(res, 500, { error: 'internal error' });
    }
    return undefined;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 8001);
  const presetsDir = process.env.PRESETS_DIR;
  createService(presetsDir ? { presetsDir } : {}).listen(port, host, () => {
    console.log(`aparat api on http://${host}:${port}/api/`);
  });
}
