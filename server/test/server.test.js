import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createService } from '../server.js';

let server;
let base;
let patchesDir;

before(async () => {
  patchesDir = await mkdtemp(join(tmpdir(), 'aparat-patches-'));
  server = createService({ patchesDir, factoryDir: null });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await rm(patchesDir, { recursive: true, force: true });
});

const patch = { v: 2, modules: [{ id: 1, type: 'vco', x: 0, row: 0 }], cables: [] };
const url = (name) => `${base}/api/patches/${encodeURIComponent(name)}`;
const put = (name, body) =>
  fetch(url(name), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

// fetch normalises paths, so traversal tests use a raw request
function raw(path) {
  return new Promise((ok, fail) => {
    const { port } = server.address();
    request({ host: '127.0.0.1', port, path }, (res) => {
      res.resume();
      ok(res.statusCode);
    })
      .on('error', fail)
      .end();
  });
}

test('starts with no patches', async () => {
  const res = await fetch(`${base}/api/patches`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test('stores, lists, loads and overwrites a patch', async () => {
  let res = await put('drone 1', patch);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).name, 'drone 1');
  assert.deepEqual(await (await fetch(url('drone 1'))).json(), patch);

  const changed = { ...patch, modules: [] };
  res = await put('drone 1', changed);
  assert.equal(res.status, 200);
  assert.deepEqual(await (await fetch(url('drone 1'))).json(), changed);

  const list = await (await fetch(`${base}/api/patches`)).json();
  assert.deepEqual(list.map((p) => p.name), ['drone 1']);
  assert.ok(!Number.isNaN(Date.parse(list[0].updated)));
});

test('accepts names in any script', async () => {
  for (const name of ['Rückkopplung', 'клинг', 'a-b_c.d (2)', '音', 'हिन्दी', 'ภาษาไทย', '#1 & co']) {
    assert.equal((await put(name, patch)).status, 200, name);
    assert.deepEqual(await (await fetch(url(name))).json(), patch);
  }
});

test('treats composed and decomposed names as one patch', async () => {
  const composed = 'Grün';
  const decomposed = composed.normalize('NFD');
  assert.notEqual(composed, decomposed);
  assert.equal((await put(decomposed, { ...patch, v: 7 })).status, 200);
  assert.equal((await (await fetch(url(composed))).json()).v, 7);
  assert.equal((await fetch(url(decomposed), { method: 'DELETE' })).status, 204);
  assert.equal((await fetch(url(composed))).status, 404);
});

test('rejects bad names', async () => {
  // the last two fit in 64 characters but their encoded file names exceed 255 bytes
  const long = ['я'.repeat(64), '音'.repeat(30)];
  for (const name of ['', '.hidden', '..', ' lead', 'trail ', 'a/b', 'a\\b', 'x'.repeat(65), 'tab\there', '\u0301a', ...long]) {
    const res = await put(name, patch);
    // '' and '..' never reach the name check: '' is the list url, '..' is normalised away
    const expected = { '': 405, '..': 404 }[name] ?? 400;
    assert.equal(res.status, expected, JSON.stringify(name));
  }
  assert.equal((await fetch(`${base}/api/patches/%E0%A4%A`)).status, 400);
});

test('rejects bad bodies', async () => {
  assert.equal((await put('x', 'not json')).status, 400);
  assert.equal((await put('x', [1, 2])).status, 400);
  assert.equal((await put('x', { modules: 'no' })).status, 400);
  assert.equal((await put('x', { modules: [], cables: 3 })).status, 400);
  const big = { modules: [], pad: 'x'.repeat(1024 * 1024) };
  assert.equal((await put('x', big)).status, 413);
  // without a content-length the limit is counted while reading
  const chunked = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(JSON.stringify(big)));
      c.close();
    },
  });
  const res = await fetch(url('x'), { method: 'PUT', body: chunked, duplex: 'half' });
  assert.equal(res.status, 413);
  assert.equal((await fetch(url('x'))).status, 404);
});

test('deletes a patch', async () => {
  await put('gone', patch);
  assert.equal((await fetch(url('gone'), { method: 'DELETE' })).status, 204);
  assert.equal((await fetch(url('gone'))).status, 404);
  assert.equal((await fetch(url('gone'), { method: 'DELETE' })).status, 404);
});

test('leaves no temporary files', async () => {
  const files = await readdir(patchesDir);
  assert.ok(files.every((f) => f.endsWith('.json') && !f.startsWith('.')), files.join(' '));
});

test('serves only the api', async () => {
  for (const path of ['/', '/index.html', '/modules/vco.js', '/patch/test', '/api/nope']) {
    const res = await fetch(base + path);
    assert.equal(res.status, 404, path);
    assert.match(res.headers.get('content-type'), /json/);
  }
  assert.equal(await raw('/api/patches/..%2f..%2fserver'), 400);
  assert.equal((await fetch(`${base}/api/patches`, { method: 'POST' })).status, 405);
});

test('serves factory patches until a stored version overrides them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aparat-store-'));
  const factoryDir = await mkdtemp(join(tmpdir(), 'aparat-factory-'));
  const s = createService({ patchesDir: dir, factoryDir });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const at = `http://127.0.0.1:${s.address().port}/api/patches`;
  const factory = { v: 2, modules: [{ id: 1, type: 'vco' }], cables: [] };
  try {
    await writeFile(join(factoryDir, 'tekno.json'), JSON.stringify(factory));
    let list = await (await fetch(at)).json();
    assert.deepEqual(list.map((p) => [p.name, p.factory, p.stored]), [['tekno', true, false]]);
    assert.deepEqual(await (await fetch(`${at}/tekno`)).json(), factory);
    // nothing is copied into the store
    assert.deepEqual(await readdir(dir), []);
    // a factory patch without a stored version cannot be deleted
    assert.equal((await fetch(`${at}/tekno`, { method: 'DELETE' })).status, 403);
    // storing over it wins, and an update of the factory file does not show
    const mine = { ...factory, modules: [] };
    assert.equal((await fetch(`${at}/tekno`, { method: 'PUT', body: JSON.stringify(mine) })).status, 200);
    await writeFile(join(factoryDir, 'tekno.json'), JSON.stringify({ ...factory, v: 3 }));
    assert.deepEqual(await (await fetch(`${at}/tekno`)).json(), mine);
    list = await (await fetch(at)).json();
    assert.deepEqual(list.map((p) => [p.name, p.factory, p.stored]), [['tekno', true, true]]);
    // deleting the stored version brings back the current factory one
    assert.equal((await fetch(`${at}/tekno`, { method: 'DELETE' })).status, 204);
    assert.deepEqual(await (await fetch(`${at}/tekno`)).json(), { ...factory, v: 3 });
  } finally {
    s.close();
    await rm(dir, { recursive: true, force: true });
    await rm(factoryDir, { recursive: true, force: true });
  }
});

test('ships the factory patches', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aparat-store-'));
  const s = createService({ patchesDir: dir });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const at = `http://127.0.0.1:${s.address().port}/api/patches`;
  try {
    const names = (await (await fetch(at)).json()).map((p) => p.name);
    for (const n of ['drones', 'hardtekno', 'idm']) {
      assert.ok(names.includes(n), n);
      const file = JSON.parse(await readFile(new URL(`../patches/${n}.json`, import.meta.url), 'utf8'));
      assert.deepEqual(await (await fetch(`${at}/${n}`)).json(), file);
    }
  } finally {
    s.close();
    await rm(dir, { recursive: true, force: true });
  }
});
