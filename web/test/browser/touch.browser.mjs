// Touch: one finger pans, pinch zooms.

export default async ({ ev, go, ok, send, logs, sleep }) => {
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await go('/aparat/'); await sleep(800);
  await ev('(aparat.top.throwView = aparat.inner.throwView = () => {}, 0)'); // exact drags, no coasting
  const pan = () => ev('JSON.stringify(aparat.rack.pan)').then(JSON.parse);
  const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const drag = async (from, to, n = 8) => {
    await touch('touchStart', [from]);
    for (let k = 1; k <= n; k++) { await touch('touchMove', [[from[0] + (to[0] - from[0]) * k / n, from[1] + (to[1] - from[1]) * k / n]]); await sleep(16); }
    await touch('touchEnd', []); await sleep(100);
  };
  // empty space: below the patch
  let p0 = await pan();
  await drag([300, 800], [400, 700]);
  let p1 = await pan();
  ok(p1.x - p0.x === 100 && p1.y - p0.y === -100, `one finger on empty space pans ${JSON.stringify(p0)} -> ${JSON.stringify(p1)}`);
  // on a module's body (between its knobs)
  const body = await ev(`(() => { const m = [...aparat.rack.modules.values()].find(m => m.type === 'output'); const r = m.el.getBoundingClientRect(); return JSON.stringify([r.left + r.width / 2, r.top + r.height * 0.45]); })()`).then(JSON.parse);
  console.log('at body:', await ev(`document.elementFromPoint(${body[0]}, ${body[1]}).className`));
  p0 = await pan();
  await drag(body, [body[0] - 80, body[1] + 40]);
  p1 = await pan();
  ok(p1.x - p0.x === -80 && p1.y - p0.y === 40, `one finger on a panel pans (${p1.x - p0.x}, ${p1.y - p0.y})`);
  // tap selects
  await touch('touchStart', [[body[0] - 80, body[1] + 40]]); await sleep(50); await touch('touchEnd', []); await sleep(100);
  ok(await ev(`[...aparat.rack.selection].map(m => m.type).join()`) === 'output', 'a tap selects the module');
  // a knob still turns
  await ev('(aparat.rack.setPan(0, 0), 0)'); await sleep(50);
  const kn = await ev(`(() => { const m = [...aparat.rack.modules.values()].find(m => m.type === 'vcf'); const r = m.knobs[0].el.getBoundingClientRect(); return JSON.stringify({ v: m.values[0], x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`).then(JSON.parse);
  console.log('knob at', JSON.stringify(kn), await ev(`document.elementFromPoint(${kn.x}, ${kn.y}).className`));
  p0 = await pan();
  await drag([kn.x, kn.y], [kn.x, kn.y - 60]);
  const v1 = await ev(`[...aparat.rack.modules.values()].find(m => m.type === 'vcf').values[0]`);
  p1 = await pan();
  ok(v1 !== kn.v && p1.x === p0.x && p1.y === p0.y, `a finger on a knob turns it (${kn.v} -> ${v1}), no pan`);
  // pinch out around (700, 500)
  const z0 = await ev('aparat.rack.zoom');
  const under = () => ev(`JSON.stringify(aparat.rack.pointer({clientX: 700, clientY: 500}))`).then(JSON.parse);
  const u0 = await under();
  await touch('touchStart', [[650, 500], [750, 500]]);
  for (let k = 1; k <= 10; k++) { await touch('touchMove', [[650 - 5 * k, 500], [750 + 5 * k, 500]]); await sleep(16); }
  await touch('touchEnd', []); await sleep(150);
  const z1 = await ev('aparat.rack.zoom');
  const u1 = await under();
  ok(z1 > z0 * 1.6, `pinch zooms in ${z0} -> ${z1}`);
  ok(Math.abs(u0.x - u1.x) < 3 && Math.abs(u0.y - u1.y) < 3, `around the fingers' middle ${JSON.stringify(u0)} -> ${JSON.stringify(u1)}`);
  ok(await ev(`document.getElementById('zoomLevel').textContent`) === `${Math.round(z1 * 100)}%`, 'zoom label follows');
  ok(!logs.some((l) => /error/i.test(l)), 'no errors');
};
