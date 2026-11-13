// aparat service: serves the frontend in web/ and stores presets.
//
//   GET    /api/presets          [{ name, updated, factory, stored }]
//   GET    /api/presets/:name    the patch
//   PUT    /api/presets/:name    store the patch in the request body
//   DELETE /api/presets/:name    the stored version (factory presets stay)
//   GET    /preset/:name         the app, which then loads that preset
//
// No dependencies. No authentication, so it listens on 127.0.0.1 unless HOST
// says otherwise.

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_BYTES, PresetError, PresetStore } from './presets.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(data);
}

function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BYTES) {
        fail(new PresetError(413, `presets are limited to ${MAX_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
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
        throw new PresetError(413, `presets are limited to ${MAX_BYTES} bytes`);
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

async function file(req, res, webDir, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
  let path;
  try {
    path = resolve(webDir, `.${decodeURIComponent(pathname)}`);
  } catch {
    return send(res, 400, 'bad path', 'text/plain');
  }
  if (path !== webDir && !path.startsWith(webDir + sep)) return send(res, 404, 'not found', 'text/plain');
  let info = await stat(path).catch(() => null);
  if (info?.isDirectory()) {
    if (!pathname.endsWith('/')) {
      res.writeHead(301, { location: `${pathname}/` }).end();
      return undefined;
    }
    path = join(path, 'index.html');
    info = await stat(path).catch(() => null);
  }
  if (!info?.isFile()) return send(res, 404, 'not found', 'text/plain');
  // no-cache: the browser revalidates, so edited modules are never stale
  res.writeHead(200, {
    'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
    'content-length': info.size,
    'cache-control': 'no-cache',
    'last-modified': info.mtime.toUTCString(),
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(path).pipe(res);
  return undefined;
}

// The page at /preset/<name> gets <base href="../"> so its relative urls
// (styles, modules, worklet, api) resolve against the app root, also when the
// app sits under a path behind a proxy. The name is read by the page itself.
async function presetPage(req, res, webDir) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
  const html = (await readFile(join(webDir, 'index.html'), 'utf8')).replace(/<head>/i, '<head>\n<base href="../">');
  res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : html);
  return undefined;
}

export function createService({
  webDir = join(ROOT, 'web'),
  presetsDir = join(ROOT, 'data', 'presets'),
  factoryDir = join(ROOT, 'server', 'presets'),
} = {}) {
  const web = resolve(webDir);
  const store = new PresetStore(resolve(presetsDir), factoryDir ? resolve(factoryDir) : null);
  return createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname === '/api/presets' || pathname.startsWith('/api/presets/')) {
        await api(req, res, store, pathname.slice('/api/presets/'.length));
      } else if (/^\/preset\/[^/]+$/.test(pathname)) {
        await presetPage(req, res, web);
      } else if (pathname.startsWith('/api/')) {
        send(res, 404, { error: 'not found' });
      } else {
        await file(req, res, web, pathname);
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
  const port = Number(process.env.PORT ?? 8000);
  const presetsDir = process.env.PRESETS_DIR;
  createService(presetsDir ? { presetsDir } : {}).listen(port, host, () => {
    console.log(`aparat on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`);
  });
}
