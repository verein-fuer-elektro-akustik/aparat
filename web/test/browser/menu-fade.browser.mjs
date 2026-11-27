// The add-module menu fades in and out and focuses its search.

export default async ({ ev, go, ok, send, sleep }) => {
  await go('/aparat/'); await sleep(800);
  const sample = () => ev(`new Promise((res) => { const out = []; const c = document.getElementById('menu'); const t0 = performance.now(); const f = () => { const cs = getComputedStyle(c); out.push(cs.display + ' ' + (+cs.opacity).toFixed(2)); if (performance.now() - t0 < 160) requestAnimationFrame(f); else res(out.join(' | ')); }; f(); })`);
  await ev(`document.getElementById('add').click(), 0`);
  const a = await sample();
  ok(/flex 0\.[1-9]/.test(a) && /flex 1\.00$/.test(a), `fades in: ${a}`);
  ok(await ev(`document.activeElement === document.getElementById('search')`), 'search has focus');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  const b = await sample();
  ok(/flex 0\.[1-9]/.test(b) && /none 0\.00$/.test(b), `fades out: ${b}`);
};
