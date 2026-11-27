// A touch tap on a cable selects it.

export default async ({ ev, go, ok, send, sleep }) => {
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await go('/aparat/'); await sleep(800);
  const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  // the middle of a cable whose middle is over empty space or a panel, not a control
  const p = await ev(`(() => { const r = aparat.rack; const view = r.content.getBoundingClientRect();
    for (const c of r.cables.list) for (const k of [16, 12, 20, 8, 24]) { const x = view.left + c.pts[2*k] * r.zoom, y = view.top + c.pts[2*k+1] * r.zoom;
      const el = document.elementFromPoint(x, y); if (el && !el.closest('.knob, .jack, button, .title, canvas, textarea') && r.cableAt({ target: el, clientX: x, clientY: y }) === c) return JSON.stringify([x, y, r.cableName(c)]); } return 'null'; })()`).then(JSON.parse);
  ok(!!p, 'found a cable to tap');
  await touch('touchStart', [[p[0], p[1]]]); await sleep(50); await touch('touchEnd', []); await sleep(100);
  const sel = await ev(`aparat.rack.selectedCable ? aparat.rack.cableName(aparat.rack.selectedCable) : 'none'`);
  ok(sel === p[2], `a tap selects the cable (${sel})`);
};
