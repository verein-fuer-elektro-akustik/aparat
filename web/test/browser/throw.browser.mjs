// A dragged view coasts on a little when let go.

export default async ({ ev, go, ok, mouse, send, sleep }) => {
  await go('/aparat/'); await sleep(800);
  const pan = () => ev('JSON.stringify(aparat.rack.pan)').then(JSON.parse);
  const r = await ev(`JSON.stringify(aparat.rack.scroller.getBoundingClientRect())`).then(JSON.parse);
  const x = r.right - 300, y = r.bottom - 150;
  // a quick flick: 200 px in ~100 ms, let go while moving
  await mouse('mousePressed', x, y);
  for (let k = 1; k <= 6; k++) { await mouse('mouseMoved', x - 200 * k / 6, y); await sleep(16); }
  const p0 = await pan();
  await mouse('mouseReleased', x - 200, y);
  await sleep(600);
  const p1 = await pan();
  const coast = p0.x - p1.x;
  console.log('coasted', coast.toFixed(1));
  ok(coast > 20 && coast < 250, `a flick coasts on a little (${coast.toFixed(1)} px)`);
  ok(Math.abs(p1.y - p0.y) < 1, 'only along the flick');
  // a slow drag that rests before letting go: no coasting
  await mouse('mousePressed', x, y);
  for (let k = 1; k <= 6; k++) { await mouse('mouseMoved', x + 100 * k / 6, y); await sleep(16); }
  await sleep(150);
  const q0 = await pan();
  await mouse('mouseReleased', x + 100, y); await sleep(400);
  const q1 = await pan();
  ok(q1.x === q0.x && q1.y === q0.y, 'resting before letting go: no coast');
  // a click during a coast stops it
  await mouse('mousePressed', x, y);
  for (let k = 1; k <= 6; k++) { await mouse('mouseMoved', x - 200 * k / 6, y); await sleep(16); }
  await mouse('mouseReleased', x - 200, y); await sleep(40);
  await mouse('mousePressed', x, y); const s0 = await pan(); await sleep(200); const s1 = await pan(); await mouse('mouseReleased', x, y);
  ok(s0.x === s1.x, 'a press stops the coast');
  // touch flick
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  await touch('touchStart', [[x, y]]);
  for (let k = 1; k <= 5; k++) { await touch('touchMove', [[x, y - 150 * k / 6]]); await sleep(16); }
  const t0 = await pan(); // one step (25 px) before letting go
  await touch('touchMove', [[x, y - 150]]); await touch('touchEnd', []); await sleep(600); const t1 = await pan();
  ok(t0.y - t1.y - 25 > 15, `a touch flick coasts (${(t0.y - t1.y).toFixed(1)} px)`);
};
