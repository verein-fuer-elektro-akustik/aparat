// The eq's controls fit in its panel.

export default async ({ ev, go, ok, shot, sleep }) => {
  await go('/aparat/'); await sleep(800);
  await ev(`(() => { const r=aparat.rack; const m=r.add('eq'); const set=(k,v)=>{ const i=m.keys.indexOf(k); m.knobs[i].setValue(v); m.values[i]=v; r.send({op:'param',id:m.id,i,v}); };
    set('low g', 6); set('lm g', -9); set('hm g', 5); set('hm q', 3); set('high g', -4); r.queuePaint(m); r.select(null); m.el.scrollIntoView(); })(); 0`);
  await sleep(300);
  const box = await ev(`(() => { const m=[...aparat.rack.modules.values()].find(m=>m.type==='eq'); const r=m.el.getBoundingClientRect(); const last=[...m.el.querySelectorAll('.jack, .knob')].map(e=>e.getBoundingClientRect().bottom); return [r.left, r.top, r.width, r.height, Math.max(...last) <= r.bottom]; })()`);
  ok(box[4], 'everything fits in the panel');
  await shot('eq');
  console.log(JSON.stringify(box));
};
