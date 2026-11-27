// Modules slide into place when moved or pushed aside.

export default async ({ ev, go, ok, mouse, logs, sleep }) => {
  await go(`/aparat/`); await sleep(1000);
  // watch where every panel is drawn, each frame
  await ev(`(() => { window.seen = new Map(); const tick = () => { for (const m of aparat.top.modules.values()) { const l = parseFloat(m.el.style.left); const s = seen.get(m.type) ?? new Set(); s.add(l); seen.set(m.type, s); } requestAnimationFrame(tick); }; tick(); return 0; })()`);
  const info = (t) => ev(`(() => { const m = [...aparat.top.modules.values()].find(m => m.type === '${t}'); const r = m.el.querySelector('.title').getBoundingClientRect(); return JSON.stringify({ x: m.x, left: m.left, shown: m.shownX, cx: r.left + 30, cy: r.top + 5 }); })()`).then(JSON.parse);
  const vcf = await info('vcf'); const vco = await info('vco');
  // drag the vcf title left over the vco, slowly, then let go between cells
  await mouse('mousePressed', vcf.cx, vcf.cy);
  for (let k = 1; k <= 20; k++) { await mouse('mouseMoved', vcf.cx - 130 * k / 20, vcf.cy); await sleep(16); }
  await mouse('mouseReleased', vcf.cx - 130, vcf.cy);
  await sleep(400);
  const vco2 = await info('vco'); const vcf2 = await info('vcf');
  const steps = await ev(`JSON.stringify([...seen.get('vco')].sort((a,b)=>a-b))`).then(JSON.parse);
  console.log('vco left values', steps.length, steps.slice(0, 6), '...', vco.left, '->', vco2.left);
  ok(vco2.left !== vco.left && steps.length > 4 && steps.some((v) => v % 48 !== 0), 'the pushed vco slides (in-between positions were drawn)');
  ok(vco2.shown === vco2.left && vcf2.shown === vcf2.left && vcf2.left % 48 === 0, 'both end on the grid');
  const vcfSteps = await ev(`JSON.stringify([...seen.get('vcf')].filter(v => v % 1 !== 0).length)`);
  ok(Number(vcfSteps) > 0, 'the released vcf eases into its cell');
  // cables end at the jacks
  const off = await ev(`(() => { let worst = 0; const r = aparat.top; for (const c of r.cables.list) { const a = r.jackPos(c.from, 'out'); worst = Math.max(worst, Math.hypot(a.x - c.pts[0], a.y - c.pts[1])); } return worst; })()`);
  ok(off < 0.01, 'cables end at the jacks');
  ok(!logs.some((l) => /error/i.test(l)), 'no errors');
};
