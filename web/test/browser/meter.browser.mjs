// The meter sends its bars.

export default async ({ ev, go, ok, shot, sleep }) => {
  await go('/aparat/patch/ms-50'); await sleep(800);
  await ev(`document.getElementById('start').click(); 0`); await sleep(1500);
  // patch an lfo into the meter so it moves
  await ev(`(() => { const r = aparat.top; const meter = [...r.modules.values()].find(m => m.type === 'meter');
    const lfo = [...r.modules.values()].find(m => m.type === 'lfo'); r.connect({ m: lfo, i: 0 }, { m: meter, i: 0 }); return 0; })()`);
  await sleep(1500);
  const live = await ev(`JSON.stringify(Array.from([...aparat.top.modules.values()].find(m => m.type === 'meter').live).map(v => +v.toFixed(1)))`);
  console.log(live);
  ok(JSON.parse(live).length === 6, 'meter sends bar values');
  const box = await ev(`(() => { const r = [...aparat.top.modules.values()].find(m => m.type === 'meter').el.getBoundingClientRect(); return [r.left, r.top, r.width]; })()`);
  await shot('meterbar');
  console.log(box);
};
