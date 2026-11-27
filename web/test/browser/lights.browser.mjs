// Outputs light up with their events.

export default async ({ ev, go, ok, shot, sleep }) => {
  await go('/aparat/patch/acid'); await sleep(800);
  await ev(`document.getElementById('start').click(); 0`); await sleep(2500);
  const lit = () => ev(`[...document.querySelectorAll('.jack[style*="--lit"]')].length`);
  let seen = 0;
  for (let k = 0; k < 10; k++) { seen = Math.max(seen, await lit()); await sleep(37); }
  ok(seen > 3, `acid: jacks light up (${seen} at once)`);
  await shot('lights-acid');
  await go('/aparat/'); await sleep(800);
  await ev(`(() => { aparat.rack.insert('gamepad', { x: 0, row: 1 }); return 0; })()`);
  await ev(`document.getElementById('start').click(); 0`); await sleep(1500);
  await ev(`(() => {
    const pad = { id: 'Test Pad (STANDARD GAMEPAD)', connected: true, axes: [1, -0.4, 0, 0],
      buttons: Array.from({ length: 17 }, (_, k) => ({ value: k === 1 || k === 6 || k === 13 ? 1 : 0 })) };
    navigator.getGamepads = () => [pad, null, null, null];
    dispatchEvent(new Event('gamepadconnected'));
    return 0; })()`);
  await sleep(600);
  const g = await ev(`(() => { const m = [...aparat.rack.modules.values()].find(m => m.type === 'gamepad');
    return m.def.outputs.map((o, i) => o + '=' + (m.jacks.out[i].el.style.getPropertyValue('--lit') || '0')).join(' '); })()`);
  console.log(g);
  ok(/lx=1\.00/.test(g) && /ly=0\.3\d/.test(g) && /b=1\.00/.test(g) && /lt=1\.00/.test(g) && /down=1\.00/.test(g) && /a=0 /.test(g), 'gamepad lights follow the controller');
  await shot('lights-gamepad');
  await ev(`(() => { navigator.getGamepads = () => [null, null, null, null]; dispatchEvent(new Event('gamepaddisconnected')); return 0; })()`);
  await sleep(800);
  ok(await lit() === 0, 'lights fade out when the controller is gone');
};
