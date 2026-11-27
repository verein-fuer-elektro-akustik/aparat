// The gamepad module with several controllers.

export default async ({ ev, go, ok, shot, sleep }) => {
  await go('/aparat/'); await sleep(800);
  await ev(`(() => { aparat.rack.insert('gamepad', { x: 0, row: 1 }); return 0; })()`);
  await ev(`document.getElementById('start').click(); 0`); await sleep(1500);
  await ev(`(() => {
    const mk = (id, ax, b) => ({ id, connected: true, axes: ax, buttons: Array.from({ length: 17 }, (_, k) => ({ value: k === b ? 1 : 0 })) });
    navigator.getGamepads = () => [mk('Pad One (STANDARD GAMEPAD)', [0.5, 0, 0, 0], 0), mk('Pad Two (STANDARD GAMEPAD)', [0.5, 0, 0, 0], 1), null, null];
    dispatchEvent(new Event('gamepadconnected')); return 0; })()`);
  await sleep(500);
  const g = `[...aparat.top.modules.values()].find(m => m.type === 'gamepad')`;
  const text = () => ev(`JSON.stringify(${g}.live)`);
  console.log(await text());
  ok(/1 Pad One/.test(await text()), 'pad 1 on by default');
  await ev(`${g}.knobs[1].setNorm(1); 0`); await sleep(300);
  console.log(await text());
  ok(/pads 1 2/.test(await text()) && /a b/.test(await text()), 'both pads merged');
  await ev(`${g}.knobs[0].setNorm(0); ${g}.knobs[1].setNorm(0); 0`); await sleep(300);
  ok(/no pad on/.test(await text()), 'none on');
  await ev(`${g}.knobs[0].setNorm(1); ${g}.knobs[1].setNorm(1); 0`); await sleep(300);
  await shot('gp4');
};
