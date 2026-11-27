// A cable colours the ring of its jack, and gives it back when removed.

export default async ({ ev, go, ok, sleep }) => {
  await go(`/aparat/`); await sleep(1000);
  await ev(`(aparat.top.modules.forEach(m => aparat.top.setColour(m, null)), 0)`); await sleep(100);
  const ring = () => ev(`(() => { const r = aparat.top; const c = r.cables.list.find(c => c.kind === 'gate'); window.gc = c ?? window.gc; const j = window.gc.from.m.jacks.out[window.gc.from.i].el; return getComputedStyle(j).borderTopColor + '|' + j.style.getPropertyValue('--plug'); })()`);
  const on = await ring();
  ok(/\|rgb/.test(on), `a gate cable colours its jack's ring (${on})`);
  await ev('(aparat.top.disconnect(window.gc), 0)'); await sleep(100);
  const off = await ring();
  ok(/\|$/.test(off), `removing it gives the ring back its own colour (${off})`);
};
