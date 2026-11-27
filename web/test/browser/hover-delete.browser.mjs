// delete removes the cable under the pointer.

export default async ({ ev, go, ok, send, key, sleep }) => {
  await go('/aparat/'); await sleep(800);
  const n = () => ev(`aparat.rack.cables.list.length`);
  const n0 = await n();
  // find a point on some cable by scanning the rack for cableAt hits
  const pt = await ev(`(() => { const r = aparat.rack; for (let y = 200; y < 700; y += 3) for (let x = 50; x < 1300; x += 3) {
    const el = document.elementFromPoint(x, y); if (!el || el.classList.contains('jack') || el.closest('.module')) continue;
    if (r.cableAt({ clientX: x, clientY: y, target: el })) return [x, y]; } return null; })()`);
  ok(!!pt, `found a cable at ${pt}`);
  // a module stays selected, the hovered cable should go first
  await ev(`(() => { aparat.rack.select([...aparat.rack.modules.values()][0]); return 0; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt[0], y: pt[1] }); await sleep(100);
  ok(await ev(`!!aparat.rack.hoverCable`), 'cable is hovered');
  await key('Delete', 'Delete'); await sleep(100);
  ok(await n() === n0 - 1 && await ev(`aparat.rack.modules.size`) === 7, `hovered cable removed, modules kept (${n0} -> ${await n()})`);
  // pointer away from cables: delete removes the selection as before
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1350, y: 850 }); await sleep(100);
  await key('Delete', 'Delete'); await sleep(100);
  ok(await ev(`aparat.rack.modules.size`) === 6, 'away from cables: the selected module goes');
};
