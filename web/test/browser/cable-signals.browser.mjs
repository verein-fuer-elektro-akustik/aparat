// Drawing signals on cables raises no errors.

export default async ({ ev, go, ok, shot, logs, sleep }) => {
  await go(`/aparat/`); await sleep(1000);
  await ev(`(aparat.top.modules.forEach(m => m.type === 'vco' && aparat.top.setColour(m, null)), 0)`);
  // fake levels on every cable for a while, as the engine sends them
  await ev(`(() => { const c = aparat.top.cables; let n = 0; const id = setInterval(() => { c.setPeaks(new Float32Array(64).fill(4 + Math.sin(n++))); if (n > 40) clearInterval(id); }, 33); return 0; })()`);
  await sleep(600);
  await shot('cablesig');
  ok(!logs.some((l) => /error/i.test(l)), 'no errors while drawing signals');
};
