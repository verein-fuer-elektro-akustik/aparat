// The wheel over a knob turns it.

export default async ({ ev, go, ok, sleep }) => {
  await go('/aparat/patch/acid'); await sleep(800);
  const knob = (type, key) => `(() => { const m=[...aparat.rack.modules.values()].find(m=>m.type==='${type}'); return m.knobs[m.keys.indexOf('${key}')]; })()`;
  const val = (type, key) => ev(`(() => { const m=[...aparat.rack.modules.values()].find(m=>m.type==='${type}'); return m.values[m.keys.indexOf('${key}')]; })()`);
  const wheel = (type, key, dy, extra = '') => ev(`(() => { const k=${knob(type, key)}; const r=k.el.getBoundingClientRect();
    return !k.el.dispatchEvent(new WheelEvent('wheel', { deltaY: ${dy}, bubbles: true, cancelable: true, clientX: r.left+10, clientY: r.top+10 ${extra} })); })()`);
  const c0 = await val('vcf', 'cutoff');
  ok(await wheel('vcf', 'cutoff', -100), 'wheel on a knob is taken (page does not scroll)');
  const c1 = await val('vcf', 'cutoff');
  ok(c1 > c0, `wheel up raises cutoff: ${c0.toFixed(0)} -> ${c1.toFixed(0)}`);
  await wheel('vcf', 'cutoff', 100);
  ok(Math.abs(await val('vcf', 'cutoff') - c0) < 1e-6 * c0 + 1e-9, 'wheel down brings it back');
  // trackpad: many small deltas add up to the same
  for (let k = 0; k < 10; k++) await wheel('vcf', 'cutoff', -10);
  ok(Math.abs(await val('vcf', 'cutoff') - c1) / c1 < 1e-6, 'ten small deltas = one notch');
  await wheel('vcf', 'cutoff', 100);
  // stepped knob: one step per notch, small deltas wait for a full notch
  const l0 = await val('euclid', 'hits1');
  await wheel('euclid', 'hits1', -100);
  ok(await val('euclid', 'hits1') === l0 + 1, `stepped knob moves one step: ${l0} -> ${await val('euclid', 'hits1')}`);
  await wheel('euclid', 'hits1', 30);
  ok(await val('euclid', 'hits1') === l0 + 1, 'a part of a notch does not step');
  // shift: finer
  const s0 = await val('vcf', 'res');
  await wheel('vcf', 'res', -100, ', shiftKey: true');
  const s1 = await val('vcf', 'res');
  await wheel('vcf', 'res', -100);
  const s2 = await val('vcf', 'res');
  ok(s1 - s0 > 0 && (s2 - s1) / (s1 - s0) > 5, `shift is finer: ${(s1 - s0).toFixed(4)} vs ${(s2 - s1).toFixed(4)}`);
  // ctrl+wheel still zooms and leaves the knob alone
  const z0 = await ev(`aparat.rack.zoom`);
  const before = await val('vcf', 'cutoff');
  await wheel('vcf', 'cutoff', -100, ', ctrlKey: true');
  await sleep(100);
  ok(await val('vcf', 'cutoff') === before && await ev(`aparat.rack.zoom`) !== z0, 'ctrl+wheel zooms instead');
};
