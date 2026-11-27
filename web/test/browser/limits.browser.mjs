// ctrl+drag limits a knob's or fader's travel; plain drags stay inside.

export default async ({ ev, go, ok, mouse, send, sleep }) => {
  await go('/aparat/'); await sleep(800);
  await ev(`(() => { aparat.rack.clear(); aparat.rack.insert('vco', { x: 0, row: 0 }); aparat.rack.insert('mixer', { x: 3, row: 0 }); return 0; })()`); await sleep(400);
  const M = (t) => `[...aparat.rack.modules.values()].find(m=>m.type==='${t}')`;
  const K = (t, p) => `${M(t)}.knobs[${M(t)}.keys.indexOf('${p}')]`;
  const rect = (sel) => ev(`(() => { const r=${sel}.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
  const norm = (t, p) => ev(`+${K(t, p)}.el.getAttribute('aria-valuenow')`);
  const ranges = (t) => ev(`JSON.stringify(${M(t)}.ranges)`);
  const drag = async (x, y, dy, ctrl) => {
    const o = ctrl ? { modifiers: 2 } : {};
    await mouse('mouseMoved', x, y, o); await sleep(20);
    await mouse('mousePressed', x, y, o);
    for (let k = 1; k <= 6; k++) { await mouse('mouseMoved', x, y + dy * k / 6, o); await sleep(10); }
    await mouse('mouseReleased', x, y + dy, o); await sleep(50);
  };
  const d = await rect(`${K('vco','tune')}.el.querySelector('.dial')`);
  // ctrl-drag right half down 54 px: hi 1 -> 0.7
  await drag(d[0] + d[2] * 0.8, d[1] + d[3] / 2, 54, true);
  ok(await ranges('vco') === '{"tune":[0,0.7]}', `right half moves hi: ${await ranges('vco')}`);
  ok(await norm('vco','tune') === 0.5, 'value untouched');
  // ctrl-drag left half up 54: lo 0 -> 0.3
  await drag(d[0] + d[2] * 0.2, d[1] + d[3] / 2, -54, true);
  ok(await ranges('vco') === '{"tune":[0.3,0.7]}', `left half moves lo: ${await ranges('vco')}`);
  // plain drag stops at limit
  await drag(d[0] + d[2] / 2, d[1] + d[3] / 2, -300, false);
  ok(Math.abs(await norm('vco','tune') - 0.7) < 1e-6, `plain drag stops at hi: ${await norm('vco','tune')}`);
  // ctrl-dblclick right half clears hi
  const [x, y] = [d[0] + d[2] * 0.8, d[1] + d[3] / 2];
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 2, modifiers: 2 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 2, modifiers: 2 }); await sleep(50);
  ok(await ranges('vco') === '{"tune":[0.3,1]}' && Math.abs(await norm('vco','tune') - 0.7) < 1e-6, `ctrl-dblclick clears hi, keeps value: ${await ranges('vco')} ${await norm('vco','tune')}`);
  // fader a (value 0.8): range middle 0.5; grab above middle -> hi
  const t = await rect(`${K('mixer','a')}.el.querySelector('.dial')`);
  const yAt = (n) => t[1] + t[3] - 5 - n * (t[3] - 10);
  await drag(t[0] + 3, yAt(0.9), (t[3] - 10) * 0.3, true);
  const fr = await ev(`${M('mixer')}.ranges.a`);
  ok(fr && fr[0] === 0 && Math.abs(fr[1] - 0.7) < 0.01, `fader above middle moves hi: ${JSON.stringify(fr)}`);
  ok(Math.abs(await norm('mixer','a') - fr[1]) < 1e-3, `value pushed down: ${await norm('mixer','a')}`);
  await drag(t[0] + 3, yAt(0.1), -(t[3] - 10) * 0.2, true);
  const fr2 = await ev(`${M('mixer')}.ranges.a`);
  ok(Math.abs(fr2[0] - 0.2) < 0.01, `fader below middle moves lo: ${JSON.stringify(fr2)}`);
  // ctrl-click on a toggle still flips it
  const m = await rect(`${K('mixer','mute a')}.el`);
  await mouse('mousePressed', m[0] + m[2] / 2, m[1] + m[3] / 2, { modifiers: 2 }); await mouse('mouseReleased', m[0] + m[2] / 2, m[1] + m[3] / 2, { modifiers: 2 }); await sleep(50);
  ok(await ev(`${M('mixer')}.values[${M('mixer')}.keys.indexOf('mute a')]`) === 1, 'ctrl-click flips a button');
};
