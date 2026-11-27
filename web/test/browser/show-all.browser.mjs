// Show the whole patch.

export default async ({ ev, go, ok, key, shot, logs, sleep }) => {
  await go('/aparat/'); await sleep(800);
  // lose the patch: far away and tiny
  await ev('(aparat.rack.setZoom(0.3), aparat.rack.setPan(-5000, 4000), 0)');
  await key('1', 'Digit1'); await sleep(200);
  const r = await ev(`JSON.stringify((() => { const v = aparat.rack.scroller.getBoundingClientRect(); let a=1e9,b=1e9,c=-1e9,d=-1e9; for (const m of aparat.rack.modules.values()) { const q = m.el.getBoundingClientRect(); a=Math.min(a,q.left-v.left); b=Math.min(b,q.top-v.top); c=Math.max(c,q.right-v.left); d=Math.max(d,q.bottom-v.top);} return {a,b,c,d,w:v.width,h:v.height,z:aparat.rack.zoom}; })())`).then(JSON.parse);
  console.log(r);
  ok(r.a >= 20 && r.b >= 20 && r.c <= r.w - 20 && r.d <= r.h - 20, 'all modules in view with a margin');
  ok(Math.abs(r.a - (r.w - r.c)) < 3, 'centred sideways');
  ok(await ev(`document.getElementById('zoomLevel').textContent`) === `${Math.round(r.z * 100)}%`, 'zoom shown');
  // a wide patch zooms out
  await ev(`(aparat.rack.add('vco', {x: 60, row: 3}), 0)`); await sleep(100);
  await key('1', 'Digit1'); await sleep(200);
  ok(await ev('aparat.rack.zoom') < r.z, `a bigger patch zooms out (${await ev('aparat.rack.zoom')})`);
  await ev(`document.getElementById('showAll').click(); 0`);
  await shot('showall');
  ok(!logs.some((l) => /error/i.test(l)), 'no errors');
};
