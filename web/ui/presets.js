// Client for the preset service (server/). The URL is relative to the page, so
// the frontend works under any path. Without the service the page still runs
// from static hosting, available() just reports false.

const BASE = 'api/presets';

async function call(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      message = (await res.json()).error ?? message;
    } catch {}
    throw new Error(`preset: ${message}`);
  }
  return res.status === 204 ? null : res.json();
}

const url = (name) => `${BASE}/${encodeURIComponent(name)}`;

export const presets = {
  async available() {
    try {
      const res = await fetch(BASE);
      return res.ok && (res.headers.get('content-type') ?? '').includes('json');
    } catch {
      return false;
    }
  },
  list: () => call(BASE),
  load: (name) => call(url(name)),
  store: (name, patch) =>
    call(url(name), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }),
  remove: (name) => call(url(name), { method: 'DELETE' }),
};
