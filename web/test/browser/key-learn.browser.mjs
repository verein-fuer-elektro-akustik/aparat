// Key learn on buttons and switches; knobs refuse keys; undo and the patch keep the links.

export default async ({ ev, go, ok, send, shot, sleep }) => {
  await go('/aparat/'); await sleep(800);
  await ev(`(() => { aparat.rack.insert('button', { x: 0, row: 1 }); return 0; })()`); await sleep(200);
  const knobPos = (type, param) => ev(`(() => { const m=[...aparat.rack.modules.values()].find(m=>m.type==='${type}');
    const r=m.knobs[m.keys.indexOf('${param}')].el.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; })()`);
  const right = async (p) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1] });
    // shift+right-click learns at once (a plain one opens the knob's menu)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p[0], y: p[1], button: 'right', clickCount: 1, modifiers: 8 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p[0], y: p[1], button: 'right', clickCount: 1, modifiers: 8 });
    await sleep(80);
  };
  const down = (key, code) => send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 });
  const up = (key, code) => send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
  const keyMap = () => ev(`JSON.stringify(aparat.top.keyMap.map(e => [aparat.top.modules.get(e.id).type, e.param, e.key]))`);
  const val = (type, param) => ev(`(() => { const m=[...aparat.rack.modules.values()].find(m=>m.type==='${type}'); const i=m.keys.indexOf('${param}'); return m.def.params['${param}'].momentary ? m.knobs[i].el.classList.contains('on') : m.values[i] === 1; })()`);
  // learn q on the button
  await right(await knobPos('button', 'push'));
  ok(await ev(`!!aparat.top.learning`), 'shift+right-click arms');
  await down('q', 'KeyQ'); await up('q', 'KeyQ'); await sleep(50);
  ok(await keyMap() === '[["button","push","KeyQ"]]', `learned: ${await keyMap()}`);
  ok(await ev(`[...aparat.rack.modules.values()].find(m=>m.type==='button').knobs[0].el.dataset.key`) === 'q', 'shows q');
  // q holds the button
  await down('q', 'KeyQ'); await sleep(50);
  const held = await val('button', 'push');
  await shot('keylearn-held');
  await up('q', 'KeyQ'); await sleep(50);
  ok(held && !(await val('button', 'push')), 'q holds the button down, letting go releases it');
  // a (a playing key) on the vcf bypass: flips each press
  await right(await knobPos('vcf', 'bypass'));
  await down('a', 'KeyA'); await up('a', 'KeyA'); await sleep(50);
  const b0 = await val('vcf', 'bypass');
  await down('a', 'KeyA'); await up('a', 'KeyA'); await sleep(50);
  const b1 = await val('vcf', 'bypass');
  await down('a', 'KeyA'); await up('a', 'KeyA'); await sleep(50);
  const b2 = await val('vcf', 'bypass');
  ok(!b0 && b1 && !b2, `a flips bypass: ${b0} ${b1} ${b2}`);
  // a knob takes no key
  await right(await knobPos('vcf', 'cutoff'));
  await down('w', 'KeyW'); await up('w', 'KeyW'); await sleep(100);
  const toast = await ev(`[...document.querySelectorAll('.toast')].map(t => t.textContent).join('|')`);
  ok(/knobs learn midi/.test(toast) && !(await ev(`!!aparat.top.learning`)), `knob refused: ${toast}`);
  // escape cancels, taken keys are refused
  await right(await knobPos('button', 'push'));
  await down('Delete', 'Delete'); await up('Delete', 'Delete'); await sleep(50);
  ok(await ev(`!!aparat.top.learning`) && /delete has a job/.test(await ev(`[...document.querySelectorAll('.toast')].map(t => t.textContent).join('|')`)), 'delete refused, still learning');
  await down('Escape', 'Escape'); await up('Escape', 'Escape'); await sleep(50);
  ok(!(await ev(`!!aparat.top.learning`)), 'escape cancels learning');
  // right-click twice removes the link
  await right(await knobPos('button', 'push')); await right(await knobPos('button', 'push'));
  ok(await keyMap() === '[["vcf","bypass","KeyA"]]', `removed: ${await keyMap()}`);
  // undo brings it back
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 2, windowsVirtualKeyCode: 90 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 2 }); await sleep(150);
  ok((await keyMap()).includes('KeyQ'), `undo restores: ${await keyMap()}`);
  ok(await ev(`JSON.stringify(aparat.top.toJSON().keyMap).includes('KeyA')`), 'kept in the patch');
};
