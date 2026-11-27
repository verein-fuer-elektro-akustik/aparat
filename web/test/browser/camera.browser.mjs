// The camera runs only with audio and a camera module; undo brings both back.

export default async ({ ev, go, ok, shot, sleep }) => {
  await go('/aparat/'); await sleep(800);
  await ev(`(() => { aparat.rack.insert('camera', { x: 0, row: 1 }); return 0; })()`); await sleep(300);
  const cam = `[...aparat.top.modules.values()].find(m => m.type === 'camera')`;
  ok(await ev(`${cam}.live == null`), 'no picture while audio is off');
  await shot('camera-off');
  await ev(`document.getElementById('start').click(); 0`); await sleep(2500);
  ok(await ev(`!!${cam}.live?.luma`) && await ev(`aparat.camera.on`), 'picture arrives with audio');
  const lit = await ev(`${cam}.def.outputs.map((o, i) => o + '=' + (${cam}.jacks.out[i].el.style.getPropertyValue('--lit') || '0')).join(' ')`);
  console.log(lit);
  await shot('camera-on');
  // removing the module stops the camera
  await ev(`(() => { aparat.top.remove(${cam}); return 0; })()`); await sleep(300);
  ok(await ev(`!aparat.camera.on`), 'removing the module stops the camera');
  await ev(`aparat.undo.go(-1); 0`); await sleep(1500);
  ok(await ev(`aparat.camera.on`), 'undo brings module and camera back');
  await ev(`document.getElementById('start').click(); 0`); await sleep(500);
  ok(await ev(`!aparat.camera.on`), 'stopping audio stops the camera');
};
