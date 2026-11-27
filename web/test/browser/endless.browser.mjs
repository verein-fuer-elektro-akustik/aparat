// The endless rack: zooming keeps the point under the pointer, the origin can be passed.

export default async ({ ev, go, ok, send, shot, logs, sleep }) => {
  await go('/aparat/'); await sleep(800);
  const wheel = (x, y, dy, modifiers = 0, dx = 0) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy, modifiers });
  // the rack point under the pointer, in rack pixels
  const under = (x, y) => ev(`JSON.stringify(aparat.rack.pointer({clientX:${x},clientY:${y}}))`).then(JSON.parse);
  // zoom out with the pointer near the top left of the patch: it used to jump
  const a = await under(300, 250);
  await wheel(300, 250, 400, 2); await sleep(150);
  const z1 = await ev('aparat.rack.zoom');
  const b = await under(300, 250);
  ok(z1 < 0.6 && Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2, `zoom out keeps the point under the pointer (zoom ${z1}, ${JSON.stringify(a)} -> ${JSON.stringify(b)})`);
  ok(await ev('aparat.rack.pan.x') > 0, 'the rack origin moved into the view (space left of it is shown)');
  await wheel(700, 500, -400, 2); await sleep(150);
  const c0 = await under(700, 500);
  await wheel(700, 500, -200, 2); await sleep(150);
  const c1 = await under(700, 500);
  ok(Math.abs(c0.x - c1.x) < 2 && Math.abs(c0.y - c1.y) < 2, `zoom in keeps it too (${JSON.stringify(c0)} -> ${JSON.stringify(c1)})`);
  // wheel pans, both ways, beyond the top left
  const p0 = await ev('JSON.stringify(aparat.rack.pan)').then(JSON.parse);
  await wheel(700, 500, -300, 0, -200); await sleep(600);
  const p1 = await ev('JSON.stringify(aparat.rack.pan)').then(JSON.parse);
  ok(Math.abs(p1.x - p0.x - 200) < 1e-6 && Math.abs(p1.y - p0.y - 300) < 1e-6, `wheel pans ${JSON.stringify(p0)} -> ${JSON.stringify(p1)}`);
  // drag a module into negative space
  await ev('(aparat.rack.setZoom(0.5), aparat.rack.setPan(700, 450), 0)'); await sleep(100);
  const m = await ev(`(() => { const m = [...aparat.rack.modules.values()][0]; const r = m.el.querySelector('.title').getBoundingClientRect(); return JSON.stringify({id: m.id, x: r.left + 10, y: r.top + 5}); })()`).then(JSON.parse);
  const zoom = await ev('aparat.rack.zoom');
  const pan = await ev('JSON.stringify(aparat.rack.pan)').then(JSON.parse);
  // target: rack (-3 cells, row -1) on screen
  const tx = pan.x + (-3 * 48 + 10) * zoom, ty = pan.y + (-384 + 5) * zoom;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: m.x, y: m.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let k = 1; k <= 10; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: m.x + (tx - m.x) * k / 10, y: m.y + (ty - m.y) * k / 10, button: 'left', buttons: 1 }); await sleep(20); }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tx, y: ty, button: 'left', buttons: 0, clickCount: 1 }); await sleep(150);
  const pos = await ev(`JSON.stringify((({x,row}) => ({x,row}))(aparat.rack.modules.get(${m.id})))`).then(JSON.parse);
  ok(pos.x < 0 && pos.row < 0, `module dropped at negative cell ${JSON.stringify(pos)}`);
  // cables meet the jacks on screen
  const off = await ev(`(() => { const r = aparat.rack; let worst = 0; for (const c of r.cables.list) { const m = c.from.m, j = m.jacks.out[c.from.i]; const e = j.el.getBoundingClientRect(); const view = r.scroller.getBoundingClientRect();
    const sx = view.left + r.pan.x + c.pts[0] * r.zoom, sy = view.top + r.pan.y + c.pts[1] * r.zoom; worst = Math.max(worst, Math.hypot(sx - (e.left + e.width/2), sy - (e.top + e.height/2))); } return worst; })()`);
  ok(off < 2, `cables start at their jacks on screen (worst ${off.toFixed(2)} px)`);
  // saved and reloaded at negative coordinates
  const saved = await ev(`JSON.stringify(aparat.rack.serialize ? aparat.rack.serialize().modules.find(p=>p.id===${m.id}) : null)`);
  console.log('saved', saved);
  await shot('endless');
  console.log('at', await ev(`document.elementFromPoint(250,150)?.className`));
  // right-click on empty space outside the old content area opens the menu
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 250, y: 150, button: 'right', buttons: 2, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 250, y: 150, button: 'right', buttons: 0, clickCount: 1 }); await sleep(150);
  ok(await ev(`!document.getElementById('menu').hidden`), 'add menu on empty space');
  const errs = logs.filter((l) => /error/i.test(l));
  ok(!errs.length, `no errors ${errs.join(' | ')}`);
};
