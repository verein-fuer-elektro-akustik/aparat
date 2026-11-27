// Space does not scroll the rack and still presses a focused button.

export default async ({ ev, go, ok, send, sleep }) => {
  await go('/aparat/patch/berlin'); await sleep(800);
  const top = () => ev(`document.getElementById('rack').scrollTop`);
  const space = async () => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', text: type === 'keyDown' ? ' ' : undefined, windowsVirtualKeyCode: 32 }); await sleep(150); };
  await ev(`document.activeElement?.blur(); 0`); console.log('scrollable', await ev(`(() => { const r=document.getElementById('rack'); return r.scrollHeight - r.clientHeight; })()`));
  const t0 = await top();
  await space();
  ok(await top() === t0, `space on the rack: no scroll (${t0} -> ${await top()})`);
  // click empty rack space, then space
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: 700, y: 850, button: 'left', clickCount: 1 });
  await space();
  ok(await top() === t0, `space after clicking the rack: no scroll (${await top()})`);
  // a focused knob: no scroll either
  await ev(`[...aparat.rack.modules.values()][0].knobs[0].el.focus(); 0`);
  await space();
  ok(await top() === t0, 'space on a knob: no scroll');
  // a header button still clicks with space
  await ev(`window.__c=0; document.getElementById('add').addEventListener('click',()=>window.__c++); document.getElementById('add').focus(); 0`);
  await space();
  ok(await ev(`window.__c`) === 1, 'space still presses a focused button');
};
