// Browser tests: the app in headless Chromium, driven over the DevTools
// protocol, with the same urls as production (nginx serves web/ with the
// repository's aparat-locations.conf, the patch API runs in this process on
// a fresh patches folder). Needs node 22+, nginx and Chromium or Chrome.
//
//   node web/test/browser/run.mjs            all of them
//   node web/test/browser/run.mjs mixer key  those whose file name has one of the words
//
// CHROME picks the browser binary, SHOTS where screenshots go (default: a
// folder in the system's temp directory). Each test is a file *.browser.mjs here
// whose default export gets the helpers below and checks with ok().

import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createService } from '../../../server/server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const name of ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome']) {
    try {
      return execFileSync('which', [name], { encoding: 'utf8' }).trim();
    } catch {}
  }
  throw new Error('no chromium or chrome found, set CHROME');
}

function findMimeTypes() {
  for (const p of ['/etc/nginx/mime.types', '/usr/local/etc/nginx/mime.types', '/opt/homebrew/etc/nginx/mime.types']) {
    if (existsSync(p)) return p;
  }
  throw new Error('nginx mime.types not found');
}

// nginx and the API on free ports; returns the site's url and a stop()
async function startSite(tmp) {
  const api = createService({ patchesDir: join(tmp, 'patches') });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const port = await freePort();
  const ng = join(tmp, 'nginx');
  mkdirSync(ng, { recursive: true });
  const conf = join(ng, 'test.conf');
  writeFileSync(conf, `daemon off;
worker_processes 1;
pid ${ng}/nginx.pid;
error_log ${ng}/error.log warn;
events { worker_connections 64; }
http {
  include ${findMimeTypes()};
  types_hash_max_size 4096;
  default_type application/octet-stream;
  access_log off;
  client_body_temp_path ${ng}/body;
  proxy_temp_path ${ng}/proxy;
  fastcgi_temp_path ${ng}/fastcgi;
  uwsgi_temp_path ${ng}/uwsgi;
  scgi_temp_path ${ng}/scgi;
  map $host $aparat_web { default ${ROOT}/web; }
  upstream aparat_api { server 127.0.0.1:${api.address().port}; }
  server {
    listen 127.0.0.1:${port};
    include ${ROOT}/nginx/aparat-locations.conf;
  }
}
`);
  const nginx = spawn('nginx', ['-p', ng, '-c', conf], { stdio: ['ignore', 'ignore', 'inherit'] });
  const site = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`${site}/aparat/`)).ok) break;
    } catch {}
    await sleep(100);
  }
  return {
    site,
    stop() {
      nginx.kill();
      api.close();
    },
  };
}

// One test in a fresh browser. Returns the number of failed checks (page
// errors count as one; dialogs are accepted).
async function runTest(file, { site, chrome, tmp, shots }) {
  const port = await freePort();
  const profile = join(tmp, `chrome-${port}`);
  const browser = spawn(chrome, ['--headless=new', '--mute-audio', '--no-first-run', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      await sleep(200);
      try {
        target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
      } catch {}
    }
    if (!target) throw new Error('the browser did not start');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 0;
    const pending = new Map();
    const logs = [];
    const dialogs = []; // types of the dialogs the page opened
    const send = (method, params = {}) => new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id) {
        pending.get(m.id)?.(m);
        pending.delete(m.id);
      } else if (m.method === 'Runtime.exceptionThrown') {
        logs.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        logs.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
      } else if (m.method === 'Page.javascriptDialogOpening') {
        // leaving a changed patch asks first (beforeunload); say yes
        dialogs.push(m.params.type);
        send('Page.handleJavaScriptDialog', { accept: true });
      }
    };
    const ev = async (expression) => {
      const r = (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })).result;
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result?.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });

    let fails = 0;
    const t = {
      site,
      debugPort: port, // for a second tab of its own (portal)
      send,
      ev,
      logs,
      dialogs,
      sleep,
      ok(cond, msg) {
        if (!cond) fails++;
        console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
      },
      // a path ('/aparat/') is on the test site
      async go(url, wait = 1800) {
        await send('Page.navigate', { url: url.startsWith('/') ? site + url : url });
        await sleep(wait);
      },
      async key(key, code, modifiers = 0) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
      },
      mouse: (type, x, y, o = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...o }),
      async shot(name) {
        const data = (await send('Page.captureScreenshot', { format: 'png' })).result.data;
        writeFileSync(join(shots, `${name}.png`), Buffer.from(data, 'base64'));
      },
    };
    const test = (await import(pathToFileURL(file))).default;
    try {
      await test(t);
    } catch (err) {
      fails++;
      console.log(`  FAIL threw: ${err.stack ?? err}`);
    }
    if (logs.length) {
      fails++;
      for (const l of logs) console.log(`  FAIL page ${l}`);
    }
    return fails;
  } finally {
    ws?.close();
    if (browser.exitCode === null) {
      browser.kill();
      await once(browser, 'exit');
    }
  }
}

const words = process.argv.slice(2);
const files = readdirSync(HERE)
  .filter((f) => f.endsWith('.browser.mjs') && (!words.length || words.some((w) => f.includes(w))))
  .sort();
if (!files.length) {
  console.log('no tests match');
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), 'aparat-browser-'));
const shots = process.env.SHOTS ?? join(tmpdir(), 'aparat-shots');
mkdirSync(shots, { recursive: true });
const chrome = findChrome();
const { site, stop } = await startSite(tmp);
const failed = [];
const t0 = Date.now();
try {
  for (const f of files) {
    console.log(f.replace('.browser.mjs', ''));
    let fails;
    try {
      fails = await runTest(join(HERE, f), { site, chrome, tmp, shots });
    } catch (err) {
      fails = 1;
      console.log(`  FAIL ${err.message}`);
    }
    if (fails) failed.push(f);
  }
} finally {
  stop();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(`\n${files.length - failed.length} of ${files.length} passed in ${Math.round((Date.now() - t0) / 1000)} s${failed.length ? `; failed: ${failed.join(', ')}` : ''} (screenshots in ${shots})`);
process.exit(failed.length ? 1 : 0);
