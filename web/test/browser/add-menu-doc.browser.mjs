// The add-module menu shows the doc of the module in focus.

export default async ({ ev, go, ok, shot, key, send, sleep }) => {
  await go('/aparat/'); await sleep(800);
  await ev(`document.getElementById('add').click(); 0`); await sleep(200);
  const doc = () => ev(`(() => { const d=document.getElementById('doc'); return d.hidden ? null : d.textContent; })()`);
  const h0 = await ev(`document.querySelector('#menu .hints').offsetHeight`);
  ok(await doc() === null, 'no doc before anything is chosen');
  await ev(`(() => { const s=document.getElementById('search'); s.value='vc'; s.dispatchEvent(new Event('input')); })()`); await sleep(100);
  ok((await doc())?.startsWith('Amplifier'), `typing shows the first match: ${await doc()}`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown' }); await sleep(50);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown' }); await sleep(100);
  ok((await doc())?.startsWith('Resonant'), `arrow keys move it: ${await doc()}`);
  ok(await ev(`document.getElementById('doc').offsetHeight`) === h0, `the doc takes the hints' height ${h0}`);
  await shot('doc');
};
