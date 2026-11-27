// The right-click menu fades in and out.

export default async ({ ev, go, ok, send, sleep }) => {
  await go('/aparat/'); await sleep(800);
  const st = () => ev(`(() => { const c = document.getElementById('ctx'); const cs = getComputedStyle(c); return [cs.display, (+cs.opacity).toFixed(2)].join(' '); })()`);
  // right-click a module title
  const [x, y] = await ev(`(() => { const r = [...aparat.rack.modules.values()][0].el.querySelector('.title').getBoundingClientRect(); return [r.left + 20, r.top + 8]; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 });
  await sleep(30); const a = await st();
  await sleep(150); const b = await st();
  ok(/^block/.test(a) && +a.split(' ')[1] < 1, `fading in: ${a}`);
  ok(b === 'block 1.00', `shown: ${b}`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  const samples = await ev(`new Promise((res) => { const out = []; const c = document.getElementById('ctx'); const t0 = performance.now(); const f = () => { const cs = getComputedStyle(c); out.push(Math.round(performance.now() - t0) + ':' + cs.display + ' ' + (+cs.opacity).toFixed(2) + ' h' + c.hidden); if (performance.now() - t0 < 150) requestAnimationFrame(f); else res(out.join(' | ')); }; f(); })`);
  const c = samples;
  await sleep(150); const d = await st();
  ok(/block 0\.[1-9]/.test(c), `fading out: ${c}`);
  ok(/^none/.test(d), `gone: ${d}`);
  // reopen right away works
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 });
  await sleep(200);
  ok(await st() === 'block 1.00', 'reopens');
};
