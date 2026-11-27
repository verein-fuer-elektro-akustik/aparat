// Making and using composites.

export default async ({ ev, go, ok, shot, send, key, sleep }) => {
  await go('/aparat/'); await sleep(800);
  const types = () => ev(`[...aparat.rack.modules.values()].map(m=>m.type).sort().join(' ')`);
  const ncab = () => ev(`aparat.rack.cables.list.length`);
  await ev(`document.getElementById('start').click(); 0`); await sleep(1200);
  // select the voice and right-click the vcf
  await ev(`(() => { const r=aparat.rack; r.select(null); for (const m of r.modules.values()) if (['vco','vcf','env','vca'].includes(m.type)) r.select(m, true);
    const m=[...r.modules.values()].find(m=>m.type==='vcf'); const t=m.el.querySelector('.title').getBoundingClientRect();
    m.el.querySelector('.title').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:t.left+10,clientY:t.top+5})); })(); 0`);
  await sleep(100);
  ok((await ev(`[...document.querySelectorAll('#ctxItems button')].map(b=>b.textContent).join(',')`)).includes('make composite'), 'menu offers make composite');
  await ev(`[...document.querySelectorAll('#ctxItems button')].find(b=>b.textContent==='make composite').click(); 0`); await sleep(100);
  ok(!await ev(`document.getElementById('compose').hidden`), 'dialog open');
  await ev(`(() => { const n=document.getElementById('composeName'); n.value='voice'; n.dispatchEvent(new Event('input'));
    document.querySelector('#composeKnobs input[data-param="cutoff"]').checked = true; })(); 0`);
  await shot('compose-dialog');
  await ev(`document.getElementById('composeOk').click(); 0`); await sleep(700);
  ok(await types() === 'midi in output scope voice', `after making: ${await types()}`);
  ok(await ncab() === 5, `cables: ${await ncab()}`);
  ok(await ev(`document.querySelector('header h1').textContent`) === 'default *', 'patch marked changed');
  // play a note with the computer keyboard
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA' }); await sleep(500);
  const lvl = await ev(`(() => { const c=aparat.rack.cables.list.find(c=>c.from.m.type==='voice'); return Math.max(...c.hist); })()`);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA' });
  ok(lvl > 0.05, `the composite sounds: level ${lvl.toFixed(3)}`);
  await shot('composite');
  // undo / redo
  await sleep(600);
  await ev(`document.getElementById('undo').click(); 0`); await sleep(400);
  ok(await types() === 'env midi in output scope vca vcf vco', `undo: ${await types()}`);
  await ev(`document.getElementById('redo').click(); 0`); await sleep(400);
  ok(await types() === 'midi in output scope voice', `redo: ${await types()}`);
  // a second one from the add-module menu
  await ev(`document.getElementById('add').click(); 0`); await sleep(100);
  const first = await ev(`document.querySelector('#library button').textContent`);
  ok(first === 'voice', `menu lists the composite first: ${first}`);
  await ev(`document.querySelector('#library button.composite').click(); 0`); await sleep(500);
  ok((await types()).split(' ').filter((t) => t === 'voice').length === 2, 'two voices');
  // reload: the unsaved patch comes back with its composite
  await sleep(600);
  await go('/aparat/'); await sleep(1000);
  ok((await types()).split(' ').filter((t) => t === 'voice').length === 2, `after reload: ${await types()}`);
  // ungroup the connected one
  await ev(`(() => { const r=aparat.rack; const m=[...r.modules.values()].find(m=>m.type==='voice' && r.cables.list.some(c=>c.to.m===m));
    r.select(m); const t=m.el.querySelector('.title').getBoundingClientRect();
    m.el.querySelector('.title').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:t.left+10,clientY:t.top+5})); })(); 0`);
  await sleep(100);
  await ev(`[...document.querySelectorAll('#ctxItems button')].find(b=>b.textContent==='ungroup composite').click(); 0`); await sleep(500);
  ok(await types() === 'env midi in output scope vca vcf vco voice', `ungrouped: ${await types()}`);
  ok(await ncab() === 8, `cables back: ${await ncab()}`);
};
