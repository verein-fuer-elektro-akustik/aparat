// The on button of a bypassable module: lit at first, click bypasses, midi top turns it on.

export default async ({ ev, go, ok, mouse, sleep }) => {
  await go('/aparat/'); await sleep(800);
  await ev(`(() => { aparat.rack.clear(); aparat.rack.insert('delay', { x: 0, row: 0 }); return 0; })()`); await sleep(300);
  const m = `[...aparat.rack.modules.values()][0]`, i = `${m}.keys.indexOf('bypass')`;
  const st = () => ev(`(() => { const k=${m}.knobs[${i}].el; return [k.textContent, k.classList.contains('on'), ${m}.values[${i}]].join(','); })()`);
  ok(await st() === 'on,true,0', `default lit: ${await st()}`);
  const r = await ev(`(() => { const r=${m}.knobs[${i}].el.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; })()`);
  await mouse('mousePressed', r[0], r[1]); await mouse('mouseReleased', r[0], r[1]); await sleep(50);
  ok(await st() === 'on,false,1', `click bypasses: ${await st()}`);
  await ev(`(() => { aparat.rack.midiMap.push({ id: ${m}.id, param: 'bypass', channel: 1, cc: 7 }); return 0; })()`);
  await ev(`aparat.rack.handleCc(1, 7, 127)`); await sleep(30);
  ok(await st() === 'on,true,0', `cc top turns it on: ${await st()}`);
  await ev(`aparat.rack.handleCc(1, 7, 0)`); await sleep(30);
  ok(await st() === 'on,false,1', `cc bottom bypasses: ${await st()}`);
};
