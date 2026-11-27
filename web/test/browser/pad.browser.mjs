// The pad module's surface: square, press sets x and y, mouse presses fully, drag moves.

export default async ({ ev, go, ok, send, shot, sleep }) => {
  await go('/aparat/'); await sleep(800);
  await ev(`(() => { const r = aparat.rack; r.insert('pad', { x: 0, row: 1 }); r.insert('gamepad', { x: 4, row: 1 }); return 0; })()`);
  await sleep(300);
  const id = (t) => ev(`[...aparat.rack.modules.values()].find(m=>m.type==='${t}').id`);
  const padId = await id('pad');
  const box = await ev(`(() => { const r = aparat.rack.modules.get(${padId}).canvas.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
  ok(Math.abs(box[2] - box[3]) < 8, `pad is square-ish ${box[2]}x${box[3]}`);
  const vals = () => ev(`aparat.rack.modules.get(${padId}).values.map(v => +v.toFixed(2)).join(' ')`);
  const at = (fx, fy) => [box[0] + box[2] * fx, box[1] + box[3] * fy];
  const a = at(0.2, 0.2), b = at(0.8, 0.9);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a[0], y: a[1] });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a[0], y: a[1], button: 'left', clickCount: 1 });
  await sleep(50);
  const pressed = await vals();
  const knobPress = await ev(`aparat.rack.modules.get(${padId}).knobs[2].el.getAttribute('aria-valuetext')`);
  await shot('pad-pressed');
  for (let k = 1; k <= 5; k++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a[0] + (b[0] - a[0]) * k / 5, y: a[1] + (b[1] - a[1]) * k / 5, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b[0], y: b[1], button: 'left', clickCount: 1 });
  await sleep(100);
  console.log('pressed', pressed, 'press', knobPress, 'after', await vals());
  ok(/^0\.(19|2\d?) 0\.8/.test(pressed), `press sets x y: ${pressed}`);
  ok(knobPress === '1.00', `mouse presses fully: ${knobPress}`);
  const after = await vals();
  ok(after.startsWith('0.8') && +after.split(' ')[1] < 0.15, `drag moves: ${after}`);
  const saved = await ev(`JSON.stringify(aparat.top.toPatch ? 0 : 0)`);
  // stored: x y, not press
  const stored = await ev(`JSON.stringify(JSON.parse(localStorage.getItem([...Array(localStorage.length)].map((_, i) => localStorage.key(i)).find(k => /patch|autosave/i.test(k)) || 'null'))?.modules?.find(m => m.type === 'pad')?.params ?? null)`);
  console.log('stored', stored);
  // gamepad with a stub controller
  await ev(`document.getElementById('start').click(); 0`); await sleep(1500);
  await ev(`(() => {
    const pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)', connected: true, axes: [0.5, -1, 0, 0],
      buttons: Array.from({ length: 17 }, (_, k) => ({ value: k === 0 || k === 7 ? 1 : 0 })) };
    navigator.getGamepads = () => [pad, null, null, null];
    dispatchEvent(new Event('gamepadconnected'));
    return 0; })()`);
  await sleep(500);
  const gid = await id('gamepad');
  const live = await ev(`JSON.stringify(aparat.top.modules.get(${gid}).live)`);
  console.log('live', live);
  ok(/Xbox Wireless Contr/.test(live) && /a rt/.test(live), 'gamepad shows the controller');
  await shot('gamepad');
};
