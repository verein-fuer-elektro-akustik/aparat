// The wheel scrolls the rack smoothly.

export default async ({ ev, go, ok, send, logs, sleep }) => {
  await go(`/aparat/`); await sleep(1000);
  const pan = () => ev('JSON.stringify(aparat.rack.pan)').then(JSON.parse);
  const r = await ev(`JSON.stringify(aparat.rack.scroller.getBoundingClientRect())`).then(JSON.parse);
  const x = r.right - 100, y = r.bottom - 100; // empty space
  await ev(`(() => { window.ys = []; const tick = () => { ys.push(aparat.rack.pan.y); requestAnimationFrame(tick); }; tick(); return 0; })()`);
  const p0 = await pan();
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: 100 });
  await sleep(500);
  const p1 = await pan();
  const ys = await ev(`JSON.stringify([...new Set(ys)])`).then(JSON.parse);
  ok(Math.abs(p1.y - (p0.y - 100)) < 1e-9 && p1.x === p0.x, `one notch moves exactly 100 px (${p0.y} -> ${p1.y})`);
  ok(ys.length > 4, `in steps, not a jump (${ys.length} positions)`);
  // three quick notches add up
  for (let k = 0; k < 3; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: 100 }); await sleep(20); }
  await sleep(500);
  const p2 = await pan();
  ok(Math.abs(p2.y - (p1.y - 300)) < 1e-9, `three notches add up to 300 px (${p2.y - p1.y})`);
  // a press stops it
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: 300 });
  await sleep(30);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  const s0 = await pan(); await sleep(200); const s1 = await pan();
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  ok(s0.y === s1.y, 'a press stops the glide');
  ok(!logs.some((l) => /error/i.test(l)), 'no errors');
};
