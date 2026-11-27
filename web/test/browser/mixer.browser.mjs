// The mixer's channel strips: fader drag and cap position, mute, an old patch's levels, neighbours pushed aside.

export default async ({ ev, go, ok, send, shot, mouse, sleep }) => {
  await go('/aparat/'); await sleep(800);
  await ev(`(() => { aparat.rack.clear(); aparat.rack.insert('mixer', { x: 0, row: 0 }); return 0; })()`); await sleep(300);
  const m = `[...aparat.rack.modules.values()].find(m=>m.type==='mixer')`;
  const rect = (k) => ev(`(() => { const r=${m}.knobs[${m}.keys.indexOf('${k}')].el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
  const cap = (k) => ev(`(() => { const d=${m}.knobs[${m}.keys.indexOf('${k}')].el.querySelector('.dial'); const r=d.getBoundingClientRect(); const pos=+d.style.getPropertyValue('--pos'); return [r.left+r.width/2, r.bottom - 5*(r.height/d.offsetHeight) - pos*(r.height-10*(r.height/d.offsetHeight)), r.height]; })()`);
  const fa = await rect('a'), fm = await rect('master');
  ok(Math.abs(fa[1] + fa[3] - (fm[1] + fm[3])) < 1, 'faders end on one line');
  ok(fa[3] > 100, `fader is tall: ${fa[3]}`);
  // drag cap of a down to the bottom
  const c = await cap('a');
  await mouse('mousePressed', c[0], c[1]);
  for (let k = 1; k <= 10; k++) { await mouse('mouseMoved', c[0], c[1] + k * 50); await sleep(10); }
  await mouse('mouseReleased', c[0], c[1] + 500); await sleep(400);
  ok(await ev(`${m}.values[0]`) === 0, `dragged to 0: ${await ev(`${m}.values[0]`)}`);
  // drag up by half the track
  const c2 = await cap('a');
  const travel = c2[2] - 10;
  await mouse('mousePressed', c2[0], c2[1]);
  await mouse('mouseMoved', c2[0], c2[1] - travel / 2); await sleep(10);
  await mouse('mouseReleased', c2[0], c2[1] - travel / 2); await sleep(50);
  const v = await ev(`${m}.values[0]`);
  ok(Math.abs(v - 0.5) < 0.02, `half the track is half: ${v}`);
  const c3 = await cap('a');
  ok(Math.abs(c3[1] - (c2[1] - travel / 2)) < 2, `cap under the pointer: ${c3[1]} vs ${c2[1] - travel / 2}`);
  // mute toggles
  const mu = await rect('mute b');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mu[0] + 24, y: mu[1] + 20, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mu[0] + 24, y: mu[1] + 20, button: 'left', clickCount: 1 });
  ok(await ev(`${m}.values[${m}.keys.indexOf('mute b')]`) === 1, 'mute b on');
  // old patch params load
  await ev(`(() => { aparat.rack.load({ v: 2, modules: [{ id: 1, type: 'mixer', x: 0, row: 0, params: { a: 0.3, b: 1, c: 0.2, d: 0, master: 0.7 } }, { id: 2, type: 'vco', x: 4, row: 0 }], cables: [] }); return 0; })()`); await sleep(300);
  ok(await ev(`JSON.stringify(${m}.values)`) === JSON.stringify([0.3, 1, 0.2, 0, 0.7, 0, 0, 0, 0, 0, 0, 0, 0]), `old patch: ${await ev(`JSON.stringify(${m}.values)`)}`);
  ok(await ev(`[...aparat.rack.modules.values()].find(m=>m.type==='vco').x`) === 5, 'neighbour pushed aside');
  await ev(`(() => { const m=[...aparat.rack.modules.values()].find(m=>m.type==='mixer'); m.knobs[m.keys.indexOf('mute b')].setNorm(1); m.knobs[m.keys.indexOf('solo c')].setNorm(1); return 0; })()`); await sleep(100); await shot('mixer');
};
