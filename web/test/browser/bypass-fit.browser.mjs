// The on buttons of small modules fit in their panels.

export default async ({ ev, go, ok, shot, sleep }) => {
  await go('/aparat/'); await sleep(800);
  await ev(`(() => { const r = aparat.rack; r.insert('slew', { x: 0, row: 1 }); r.insert('quant', { x: 2, row: 1 }); r.insert('sample hold', { x: 4, row: 1 }); return 0; })()`); await sleep(300);
  const fit = await ev(`[...aparat.rack.modules.values()].filter(m => ['slew','quant','sample hold'].includes(m.type)).map(m => {
    const b = m.el.getBoundingClientRect(); const k = m.knobs.at(-1).el.getBoundingClientRect(); const ins = m.el.querySelector('.inputs')?.getBoundingClientRect();
    return m.type + ':' + (k.bottom <= (ins ? ins.top : b.bottom) + 1); }).join(' ')`);
  ok(!/false/.test(fit), `bypass buttons fit: ${fit}`);
  await shot('bypass3');
};
