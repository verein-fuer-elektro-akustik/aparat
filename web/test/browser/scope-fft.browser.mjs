// The scope's fft button.

export default async ({ ev, go, ok, shot, send, mouse, sleep, site }) => {
  const U = `${site}/aparat/`;
  await go(U); await sleep(500);
  await ev(`document.getElementById('start').click(); 0`); await sleep(800);
  await send('Input.dispatchKeyEvent', {type:'keyDown', key:'a', code:'KeyA'}); await sleep(600);
  const sc = `[...aparat.rack.modules.values()].find(m=>m.type==='scope')`;
  await shot('scope-wave');
  const b = await ev(`(() => { const r=${sc}.knobs[1].el.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; })()`); await mouse('mousePressed', ...b); await mouse('mouseReleased', ...b); await sleep(1200);
  ok(await ev(`${sc}.values[1]`) === 1, 'fft button switches on');
  await shot('scope-fft');
};
