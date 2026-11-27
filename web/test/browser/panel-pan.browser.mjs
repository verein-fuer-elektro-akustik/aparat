// Dragging a panel away from its controls moves the view.

export default async ({ ev, go, ok, mouse, logs, sleep }) => {
  await go('/aparat/'); await sleep(800);
  await ev('(aparat.top.throwView = aparat.inner.throwView = () => {}, 0)'); // exact drags, no coasting
  const pan = () => ev('JSON.stringify(aparat.rack.pan)').then(JSON.parse);
  const at = (type, sel) => ev(`(() => { const m = [...aparat.rack.modules.values()].find(m => m.type === '${type}'); const r = m.el.getBoundingClientRect(); return JSON.stringify([r.left + r.width / 2, r.top + r.height * 0.45, document.elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.45).className]); })()`).then(JSON.parse);
  const drag = async ([x, y], dx, dy) => { await mouse('mousePressed', x, y); for (let k = 1; k <= 6; k++) { await mouse('mouseMoved', x + dx * k / 6, y + dy * k / 6); await sleep(16); } await mouse('mouseReleased', x + dx, y + dy); await sleep(100); };
  const [x, y, cls] = await at('output');
  console.log('on', cls);
  const p0 = await pan();
  await drag([x, y], 120, -60);
  const p1 = await pan();
  ok(p1.x - p0.x === 120 && p1.y - p0.y === -60, `drag on a panel pans (${p1.x - p0.x}, ${p1.y - p0.y})`);
  const mod = await ev(`JSON.stringify([...aparat.rack.modules.values()].find(m => m.type === 'output')).length > 0 && [...aparat.rack.modules.values()].find(m => m.type === 'output').x`);
  ok(mod === await ev(`[...aparat.rack.modules.values()].find(m => m.type === 'output').x`), 'module did not move');
  // a click selects it, and keeps it selected
  await mouse('mousePressed', x + 120, y - 60); await mouse('mouseReleased', x + 120, y - 60); await sleep(100);
  ok(await ev(`[...aparat.rack.selection].map(m => m.type).join()`) === 'output', 'a click on the panel selects it');
  await ev('(aparat.rack.setPan(0, 0), 0)'); await sleep(50);
  // a knob still turns
  const kn = await ev(`(() => { const m = [...aparat.rack.modules.values()].find(m => m.type === 'vcf'); const r = m.knobs[0].el.getBoundingClientRect(); return JSON.stringify({ v: m.values[0], x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`).then(JSON.parse);
  const q0 = await pan();
  await drag([kn.x, kn.y], 0, -40);
  const q1 = await pan();
  ok(q1.x === q0.x && q1.y === q0.y && await ev(`[...aparat.rack.modules.values()].find(m => m.type === 'vcf').values[0]`) !== kn.v, 'a knob turns, no pan');
  // the title still moves the module
  const t = await ev(`(() => { const m = [...aparat.rack.modules.values()].find(m => m.type === 'scope'); const r = m.el.querySelector('.title').getBoundingClientRect(); return JSON.stringify({ x: m.x, cx: r.left + 30, cy: r.top + 5 }); })()`).then(JSON.parse);
  await drag([t.cx, t.cy], 0, 420);
  ok(await ev(`[...aparat.rack.modules.values()].find(m => m.type === 'scope').row`) === 1, 'the title still moves the module');
  ok(!logs.some((l) => /error/i.test(l)), 'no errors');
};
