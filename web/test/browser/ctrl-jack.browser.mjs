// ctrl+drag from a jack adds a cable; a plain drag moves one.

export default async ({ ev, go, ok, send, sleep }) => {
  await go('/aparat/'); await sleep(800);
  const pos = (type, dir, name) => ev(`(() => { const m=[...aparat.rack.modules.values()].find(m=>m.type==='${type}');
    const i=${dir === 'out' ? `m.def.outputs.indexOf('${name}')` : `Object.keys(m.def.inputs).indexOf('${name}')`};
    const r=m.el.querySelector('.jack[data-dir="${dir}"][data-index="'+i+'"]').getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; })()`);
  const n = () => ev(`aparat.rack.cables.list.length`);
  const drag = async (a, b, modifiers) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a[0], y: a[1] });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a[0], y: a[1], button: 'left', clickCount: 1, modifiers });
    for (let k = 1; k <= 5; k++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a[0] + (b[0] - a[0]) * k / 5, y: a[1] + (b[1] - a[1]) * k / 5, button: 'left', buttons: 1, modifiers });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b[0], y: b[1], button: 'left', clickCount: 1, modifiers });
    await sleep(100);
  };
  const c0 = await n();
  // vco out already has a cable; ctrl-drag from it to the scope's in
  const from = await pos('vco', 'out', (await ev(`[...aparat.rack.modules.values()].find(m=>m.type==='vco').def.outputs[0]`)));
  const to = await pos('output', 'in', '3');
  await drag(from, to, 2);
  ok(await n() === c0 + 1, `ctrl on an output: new cable (${c0} -> ${await n()})`);
  // ctrl-drag from an input that has a cable (vcf in) to the output's l
  const vin = await pos('vcf', 'in', 'in');
  await drag(vin, await pos('midi in', 'out', 'vel'), 2);
  ok(await n() === c0 + 2, `ctrl on an input: new cable (${await n()})`);
  // without ctrl it picks up the newest cable at the input (vel) and moves
  // its loose end to another input; the count stays
  await drag(vin, await pos('vco', 'in', 'fm'), 0);
  const moved = await ev(`aparat.rack.cables.list.some(c => c.from.m.type === 'midi in' && c.from.m.def.outputs[c.from.i] === 'vel' && c.to.m.type === 'vco' && Object.keys(c.to.m.def.inputs)[c.to.i] === 'fm')`);
  ok(await n() === c0 + 2 && moved, `plain drag moves a cable (${await n()}, vel to vco fm: ${moved})`);
};
