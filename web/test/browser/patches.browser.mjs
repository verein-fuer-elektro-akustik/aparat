// Every bundled patch loads with all its modules where the file puts them
// (nothing pushed aside, nothing missing) and without page errors.

import { readdirSync, readFileSync } from 'node:fs';

const DIR = new URL('../../../server/patches/', import.meta.url);

export default async ({ ev, go, ok, sleep }) => {
  await go('/aparat/');
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()) {
    const json = readFileSync(new URL(file, DIR), 'utf8');
    await ev(`(() => { aparat.rack.load(${json}); return 0; })()`);
    await sleep(300);
    const moved = await ev(`(() => {
      const want = ${json};
      return want.modules.filter((p) => { const m = aparat.rack.modules.get(p.id); return !m || m.x !== p.x || m.row !== p.row; }).map((p) => p.type + ' ' + p.id);
    })()`);
    ok(moved.length === 0, `${file}: loads where stored${moved.length ? `, not: ${moved.join(', ')}` : ''}`);
  }
};
