// A composite's edit view.

export default async ({ ev, go, ok, shot, send, sleep }) => {
  await go('/aparat/'); await sleep(800);
  await ev(`localStorage.clear(); 0`);
  await go('/aparat/'); await sleep(800);
  await ev(`document.getElementById('start').click(); 0`); await sleep(1000);
  // make the voice composite with cutoff on its panel
  const ctxOn = (rackExpr, type) => ev(`(() => { const r=${rackExpr}; const m=[...r.modules.values()].find(m=>m.type==='${type}'); if(!r.selection.has(m)) r.select(m); const t=m.el.querySelector('.title').getBoundingClientRect();
    m.el.querySelector('.title').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:t.left+10,clientY:t.top+5})); })(); 0`);
  const item = (label) => ev(`[...document.querySelectorAll('#ctxItems button')].find(b=>b.textContent==='${label}').click(); 0`);
  await ev(`(() => { const r=aparat.rack; r.select(null); for (const m of r.modules.values()) if (['vco','vcf','env','vca'].includes(m.type)) r.select(m,true); })(); 0`);
  await ctxOn('aparat.rack', 'vcf'); await item('make composite'); await sleep(100);
  await ev(`(() => { const n=document.getElementById('composeName'); n.value='voice'; n.dispatchEvent(new Event('input')); document.querySelector('#composeKnobs input[data-param="cutoff"]').checked=true; document.getElementById('composeOk').click(); })(); 0`);
  await sleep(700);
  // open it by double-clicking its title
  await ev(`(() => { const m=[...aparat.rack.modules.values()].find(m=>m.type==='voice'); m.el.querySelector('.title').dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); })(); 0`);
  await sleep(300);
  ok(!await ev(`document.getElementById('inner').hidden`), 'edit view open');
  ok(await ev(`document.getElementById('crumbs').textContent`) === 'default›voice', `crumbs: ${await ev(`document.getElementById('crumbs').textContent`)}`);
  const innerTypes = () => ev(`[...document.querySelectorAll('#innerContent .module .title span')].map(s=>s.textContent).sort().join(' ')`);
  ok(await innerTypes() === 'env in out vca vcf vco', `inside: ${await innerTypes()}`);
  ok(await ev(`document.querySelectorAll('#innerContent .module').length`) === 6, 'six panels');
  ok(await ev(`document.title`) !== '', 'ok');
  await shot('edit-view');
  // play, then turn the vco's tune knob inside: the instance follows (engine param)
  const lvl = async () => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA' }); await sleep(400); const v = await ev(`(() => { const c=aparat.top?.cables.list.find(c=>['voice','synth'].includes(c.from.m.type) && c.to.m.type==='output'); return c ? c.hist[c.head] : -1; })()`); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA' }); await sleep(300); return v; };
  // vca gain to 0 inside: silence
  const setInner = (type, key, v) => ev(`(() => { const r=aparat.rack; const m=[...r.modules.values()].find(m=>m.type==='${type}'); const i=m.keys.indexOf('${key}'); m.knobs[i].setNorm(${v}); })(); 0`);
  ok(await lvl() > 0.05, 'sounds while editing');
  await setInner('vca', 'gain', 0); await sleep(100);
  const quiet = await lvl();
  ok(quiet < 0.01, `vca gain 0 inside silences the instance (${quiet})`);
  await setInner('vca', 'gain', 1); await sleep(100);
  ok(await lvl() > 0.05, 'and back');
  // add an output from env via the "+" jack of "out"
  const jack = (title, dir, name) => ev(`(() => { const m=[...aparat.rack.modules.values()].find(m=>m.def.name==='${title}'||m.type==='${title}'); const i=${dir==='out'?`m.def.outputs.indexOf('${name}')`:`Object.keys(m.def.inputs).indexOf('${name}')`}; return {m:m.id, i}; })()`);
  await ev(`(() => { const r=aparat.rack; const env=[...r.modules.values()].find(m=>m.type==='env'); const out=[...r.modules.values()].find(m=>m.type==='composite out'); r.connect({m:env,i:0},{m:out,i:Object.keys(out.def.inputs).indexOf('+')}); })(); 0`);
  await sleep(200);
  const outs = await ev(`aparat.top.composites.voice.outputs.map(j=>j.name).join(',')`);
  ok(outs === 'out,out 2', `new output: ${outs}`);
  ok(await ev(`[...aparat.top.modules.values()].find(m=>m.type==='voice').def.outputs.join(',')`) === 'out,out 2', 'the instance has it');
  ok(await ev(`[...aparat.rack.modules.values()].find(m=>m.type==='composite out').def.inputs['+'] === 0`), 'out panel has a new spare jack');
  ok(await lvl() > 0.05, 'still sounds after rebuild');
  // panel dialog: rename and show env attack
  await ev(`document.getElementById('innerPanel').click(); 0`); await sleep(100);
  await ev(`(() => { const f=[...document.querySelectorAll('#panelFields input:not([type])')];
    f.find(i=>i.dataset.kind==='outputs' && i.dataset.old==='out 2').value='env';
    f.find(i=>i.dataset.kind==='inputs' && i.dataset.old==='pitch').value='v/oct';
    const a=f.find(i=>i.dataset.param==='a'); const box=a.previousElementSibling.querySelector('input'); box.checked=true; box.dispatchEvent(new Event('change')); a.value='attack';
    document.getElementById('panelDoc').value='a simple voice'; })(); 0`);
  await shot('panel-dialog');
  await ev(`document.getElementById('panelOk').click(); 0`); await sleep(300);
  const v = await ev(`(() => { const m=[...aparat.top.modules.values()].find(m=>m.type==='voice'); return { out: m.def.outputs, ins: Object.keys(m.def.inputs), knobs: m.keys, doc: m.def.doc }; })()`);
  ok(JSON.stringify(v.out) === '["out","env"]' && v.ins.includes('v/oct') && v.knobs.join() === 'cutoff,attack' && v.doc === 'a simple voice', `panel: ${JSON.stringify(v)}`);
  ok(await ev(`aparat.top.cables.list.some(c=>c.to.m.type==='voice' && Object.keys(c.to.m.def.inputs)[c.to.i]==='v/oct')`), 'outer cable follows the rename');
  ok(await lvl() > 0.05, 'still sounds after renaming');
  // leave with escape
  await ev(`aparat.rack.select(null); 0`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(200);
  ok(await ev(`document.getElementById('inner').hidden`) && await ev(`aparat.rack === aparat.top`), 'escape leaves');
  await shot('after-edit');
  // undo the panel change from outside
  await sleep(500);
  await ev(`document.getElementById('undo').click(); 0`); await sleep(300);
  ok(await ev(`[...aparat.top.modules.values()].find(m=>m.type==='voice').keys.join()`) === 'cutoff', 'undo the panel edit');
  // nested: make "synth" of voice + midi in, open synth, open voice inside
  await ev(`(() => { const r=aparat.rack; r.select(null); for (const m of r.modules.values()) if (['voice','midi in'].includes(m.type)) r.select(m,true); })(); 0`);
  await ctxOn('aparat.rack', 'voice'); await item('make composite'); await sleep(100);
  await ev(`(() => { const n=document.getElementById('composeName'); n.value='synth'; n.dispatchEvent(new Event('input')); document.getElementById('composeOk').click(); })(); 0`);
  await sleep(500);
  await ctxOn('aparat.rack', 'synth'); await item('edit composite'); await sleep(200);
  await ev(`(() => { const m=[...aparat.rack.modules.values()].find(m=>m.type==='voice'); m.el.querySelector('.title').dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); })(); 0`); await sleep(300);
  ok(await ev(`document.getElementById('crumbs').textContent`) === 'default›synth›voice', `nested crumbs: ${await ev(`document.getElementById('crumbs').textContent`)}`);
  // the add menu does not offer synth or voice here
  await ev(`document.getElementById('add').click(); 0`); await sleep(100);
  ok(await ev(`document.querySelectorAll('#library button.composite').length`) === 0, 'open composites not in the add menu');
  await ev(`document.getElementById('add').click(); 0`);
  await setInner('vca', 'gain', 0); await sleep(100);
  ok(await lvl() < 0.01, 'a knob two levels down reaches the instance');
  await setInner('vca', 'gain', 1); await sleep(100);
  await ev(`document.querySelector('#crumbs button').click(); 0`); await sleep(200);
  ok(await ev(`aparat.rack === aparat.top`), 'the crumb leads back to the patch');
  ok(await lvl() > 0.05, 'sounds at the end');
};
