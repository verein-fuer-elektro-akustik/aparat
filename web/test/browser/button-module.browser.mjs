// The ms-50 patch loads; the button module is on only while held and does not change the patch.

export default async ({ ev, go, ok, shot, mouse, sleep }) => {
  await go('/aparat/patch/ms-50'); await sleep(800);
  ok(await ev('aparat.rack.modules.size') === 18, `ms-50 loads: ${await ev('aparat.rack.modules.size')} modules`);
  await ev(`document.getElementById('start').click(); 0`); await sleep(1500);
  const btn = `[...aparat.rack.modules.values()].find(m=>m.type==='button')`;
  const b = await ev(`(() => { const r=${btn}.knobs[0].el.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; })()`);
  await mouse('mousePressed', ...b); await sleep(300);
  ok(await ev(`${btn}.knobs[0].el.classList.contains('on')`), 'button is on while held');
  await mouse('mouseReleased', ...b); await sleep(700);
  ok(!await ev(`${btn}.knobs[0].el.classList.contains('on')`), 'button is off after release');
  ok(await ev(`document.getElementById('patchCurrent').textContent`) === 'ms-50', 'pressing does not change the patch');
  ok(await ev(`document.getElementById('undo').disabled`), 'no undo step');
  await shot('ms50');
};
