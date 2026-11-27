// Right-click on a knob opens its menu: learn, forget, reset, clear limits,
// then the module's items. shift+right-click learns at once.

export default async ({ ev, go, ok, send, sleep, shot }) => {
  await go('/aparat/');
  const vcf = `[...aparat.rack.modules.values()].find((m) => m.type === 'vcf')`;
  const pos = (param) => ev(`(() => { const m = ${vcf}; const r = m.knobs[m.keys.indexOf('${param}')].el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  const right = async (p, modifiers = 0) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1] });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p[0], y: p[1], button: 'right', clickCount: 1, modifiers });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p[0], y: p[1], button: 'right', clickCount: 1, modifiers });
    await sleep(150);
  };
  const items = () => ev(`[...document.querySelectorAll('#ctxItems > button')].map((b) => b.textContent)`);
  const click = (label) => ev(`[...document.querySelectorAll('#ctxItems > button')].find((b) => b.textContent === '${label}').click(); 0`);
  const open = () => ev(`!document.getElementById('ctx').hidden`);

  await right(await pos('cutoff'));
  ok(await open() && await ev(`document.getElementById('ctxTitle').textContent`) === 'vcf · cutoff', 'a knob opens its own menu');
  let list = await items();
  ok(list[0] === 'midi learn' && list.includes('reset cutoff') && !list.includes('clear limits') && list.includes('duplicate') && list.includes('help'), `learn first, reset, then the module's items: ${list.join(', ')}`);
  ok(!(await ev(`!!aparat.rack.learning`)), 'opening it does not learn yet');
  await shot('knob-menu');

  await click('midi learn');
  ok(await ev(`!!aparat.rack.learning`) && !(await open()), 'midi learn from the menu');
  // a controller arrives: cc 21 on channel 1
  await ev(`(() => { aparat.rack.handleCc(0, 21, 64); return 0; })()`);
  await sleep(100);
  await right(await pos('cutoff'));
  list = await items();
  ok(list.includes('forget cc 21'), `the link shows: ${list.slice(0, 3).join(', ')}`);
  await click('forget cc 21');
  ok(await ev(`aparat.rack.midiMap.length`) === 0, 'forgotten');

  // reset and clear limits
  await ev(`(() => { const m = ${vcf}; const k = m.knobs[m.keys.indexOf('cutoff')]; k.setRange([0.2, 0.6]); m.ranges.cutoff = [0.2, 0.6]; k.setNorm(0.5); return 0; })()`);
  await right(await pos('cutoff'));
  ok((await items()).includes('clear limits'), 'clear limits on a limited knob');
  await click('clear limits');
  ok(await ev(`(() => { const m = ${vcf}; return !m.knobs[m.keys.indexOf('cutoff')].limited() && !m.ranges.cutoff; })()`), 'limits cleared, also in the patch');
  await right(await pos('cutoff'));
  await click('reset cutoff');
  ok(await ev(`(() => { const m = ${vcf}; return m.values[m.keys.indexOf('cutoff')] === m.def.params.cutoff.default; })()`), 'reset to the default');

  // a button: keys too
  await right(await pos('bypass'));
  ok((await items())[0] === 'learn a key or controller', `a button learns keys too: ${(await items())[0]}`);
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 0`);
  await ev(`document.getElementById('ctx').hidden = true; 0`);

  // shift+right-click learns at once, twice forgets
  await right(await pos('res'), 8);
  ok(await ev(`!!aparat.rack.learning`) && !(await open()), 'shift+right-click learns at once');
  await right(await pos('res'), 8);
  ok(!(await ev(`!!aparat.rack.learning`)), 'a second one stops it');
};
