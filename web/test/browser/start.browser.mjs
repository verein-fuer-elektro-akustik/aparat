// The app starts with the default patch, not dirty, and audio runs.

export default async ({ ev, key, mouse, shot, go, ok, send, sleep, site }) => {
  const U = `${site}/aparat/`;
  await go(U);
  ok(await ev('location.pathname') === '/aparat/patch/default', 'starts with default');
  ok(await ev(`document.getElementById('patchCurrent').textContent`) === 'default', 'header: default, not dirty');
  const lib = await ev(`[...document.getElementById('library').children].map(b=>b.textContent)`);
  ok(JSON.stringify(lib) === JSON.stringify([...lib].sort((a,b)=>a.localeCompare(b))), `library sorted, ${lib.length} modules`);
  // add every new module, look at the panels
  await ev(`aparat.rack.clear(); for (const t of ['vco','delay','midi in','sampler','meter','note','div','logic','compare','switch','pan','xfade','chorus','phaser']) aparat.rack.add(t); 0`);
  await ev(`document.getElementById('start').click()`); await sleep(1200);
  ok(await ev('aparat.audio.running'), 'audio runs');
  await ev(`(() => { const r=aparat.rack; const find=t=>[...r.modules.values()].find(m=>m.type===t); r.connect({m:find('vco'),i:2},{m:find('meter'),i:0}); })()`);
  await sleep(800);
  await shot('modules');
  // computer keyboard -> midi in
  await ev(`aparat.rack.clear(); 0`);
  await ev(`document.getElementById('new').click()`); await sleep(300);
  const gate = `(() => new Promise(r => { const before = aparat.rack.cables.list.find(c => c.from.m.type==='midi in' && c.to.m.type==='env'); setTimeout(()=>r(aparat.rack.cables.bySlot[before.slot] ? 1 : 0), 10); }))()`;
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65});
  await sleep(500);
  const peakOn = await ev(`Math.max(...aparat.rack.cables.list.map(c => c.level ?? 0))`);
  const snap = await ev(`JSON.stringify(aparat.rack.cables.list.map(c => [c.from.m.type, Object.keys(c).join(',')]).slice(0,1))`);
  console.log('cable fields', snap, peakOn);
  await shot('playing');
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA'});
};
