// The computer keyboard plays notes without changing the patch; sharing a patch as a link.

const $ = (id) => `document.getElementById('${id}')`;
export default async ({ ev, key, mouse, shot, go, ok, send, logs, sleep, site, dialogs }) => {
  const U = `${site}/aparat/`;
  await go(U);
  const n = () => ev('aparat.rack.modules.size');
  const title = () => ev(`${$('patchCurrent')}.textContent`);
  const toasts = () => ev(`[...${$('error')}.children].map(t=>t.textContent).join(' | ')`);

  // --- computer keyboard
  await ev(`${$('start')}.click()`); await sleep(1200);
  const level = `Math.max(0, ...aparat.rack.cables.list.filter(c=>c.to.m.type==='output').map(c=>Math.max(...c.hist)))`;
  ok(await ev(level) === 0, 'silent before a key');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65});
  await sleep(400);
  ok(await ev(level) > 0.5, `key a plays a note (cable level ${(await ev(level)).toFixed(2)})`);
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA'});
  await sleep(2500);
  ok(await ev(level) < 0.1, 'note ends after key up: ' + (await ev(level)).toFixed(3));
  ok(await title() === 'default', 'playing does not change the patch');
  await ev(`${$('keys')}.click()`);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65}); await sleep(300);
  ok(await ev(level) < 0.05, 'keyboard off: silent'); 
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA'});
  await ev(`${$('keys')}.click()`);

  // --- recording counter
  await ev(`${$('record')}.click()`); await sleep(1300);
  ok(/^stop 0:01$/.test(await ev(`${$('record')}.textContent`)), 'record shows time: ' + await ev(`${$('record')}.textContent`));
  await ev(`${$('record')}.click()`);
  ok(await ev(`${$('record')}.textContent`) === 'record', 'record stopped');

  // --- multi select
  await key('a','KeyA',2);
  ok(await ev('aparat.rack.selection.size') === 7, 'ctrl+a selects all 7');
  await key('c','KeyC',2); await key('v','KeyV',2); await sleep(200);
  ok(await n() === 14 && await ev('aparat.rack.cables.list.length') === 16, 'copy + paste: 14 modules, 16 cables');
  ok(await ev(`[...aparat.rack.selection].every(m => m.row === 1)`) && await ev('aparat.rack.selection.size') === 7, 'the copies are selected, in the row below');
  // drag the group by one title: 2 cells right, one row down
  const box = await ev(`(() => { const m=[...aparat.rack.selection][0]; const r=m.el.querySelector('.title').getBoundingClientRect(); return {x:r.left+20,y:r.top+8,mx:m.x,row:m.row}; })()`);
  await mouse('mousePressed', box.x, box.y); 
  for (let i=1;i<=8;i++) await mouse('mouseMoved', box.x + i*12, box.y + i*48);
  await mouse('mouseReleased', box.x+96, box.y+384); await sleep(200);
  ok(await ev(`[...aparat.rack.selection].every(m => m.row === 2)`) && await ev(`[...aparat.rack.selection][0].x`) === box.mx + 2, 'group drag moves all 7 by 2 cells and a row');
  await sleep(600); await key('Delete','Delete'); await sleep(600);
  ok(await n() === 7, 'delete removes the selection');
  await key('z','KeyZ',2); await sleep(500);
  ok(await n() === 14, 'undo brings them back');
  await key('z','KeyZ',2); await key('z','KeyZ',2); await sleep(500);
  if (await n() !== 7) { await key('z','KeyZ',2); await sleep(300); }
  ok(await n() === 7, `undo again: ${await n()} modules`);
  ok(await title() === 'default', `back to the stored patch, not dirty: "${await title()}"`);
  // shift-drag band
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:1300,y:700,button:'left',buttons:1,clickCount:1,modifiers:8});
  for (const [x,y] of [[1000,500],[600,300],[200,200]]) await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'left',buttons:1,modifiers:8});
  await shot('band');
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:200,y:200,button:'left',modifiers:8});
  const sel = await ev(`[...aparat.rack.selection].map(m=>m.type).join(' ')`);
  ok(sel.split(' ').sort().join(' ') === 'env output scope vca vcf vco', `band selects what it touches: ${sel}`);
  ok(await title() === 'default', 'selecting does not change the patch');

  // --- note + autosave
  await ev(`(() => { const m = aparat.rack.add('note'); m.textArea.value = 'hello'; m.textArea.dispatchEvent(new Event('input')); })()`);
  await sleep(700);
  ok(await title() === 'default *', `changed patch gets a star: "${await title()}"`);
  ok(await ev(`JSON.parse(localStorage.getItem('aparat.autosave')).patch.modules.at(-1).data.text`) === 'hello', 'autosave holds the note text');
  await go(U);
  ok(dialogs.includes('beforeunload'), 'leaving with changes asks first');
  ok(await n() === 8 && await title() === 'default *', `reload restores the unsaved patch: ${await n()} modules, "${await title()}"`);
  ok(await ev(`[...aparat.rack.modules.values()].at(-1).textArea.value`) === 'hello', 'note text restored');
  ok((await toasts()).includes('unsaved changes'), 'says so: ' + await toasts());
  await key('z','KeyZ',2); await sleep(400);
  ok(await n() === 7 && await title() === 'default', 'undo returns to the stored patch');
  ok(await ev(`localStorage.getItem('aparat.autosave')`) === null, 'autosave cleared when clean');

  // --- share link
  await ev(`aparat.rack.add('lfo'); 0`); await sleep(600);
  await ev(`${$('share')}.click()`); await sleep(600);
  const link = await ev(`import('/aparat/ui/share.js').then(async (m) => '/aparat/' + await m.patchToHash(aparat.rack.toJSON()))`);
  ok(link.includes('/aparat/#p='), `share link (${link.length} chars): ${await toasts()}`);
  await ev(`localStorage.removeItem('aparat.autosave')`);
  await go('about:blank', 300);
  await go(link);
  ok(await n() === 8 && await ev('location.href') === U, `link opens the patch: ${await n()} modules at ${await ev('location.pathname')}`);
  ok(await title() === 'untitled', `shared patch has no name and is not dirty: "${await title()}"`);

  // --- long press (touch) opens the module menu
  await ev(`(() => { const el=[...aparat.rack.modules.values()][1].el; const r=el.getBoundingClientRect(); const o={bubbles:true,pointerType:'touch',clientX:r.left+30,clientY:r.top+150,button:0}; el.dispatchEvent(new PointerEvent('pointerdown',o)); })()`);
  await sleep(700);
  ok(await ev(`!${$('ctx')}.hidden && ${$('ctxTitle')}.textContent`) === 'vco', 'long press opens the module menu');
  await ev(`window.dispatchEvent(new PointerEvent('pointerup',{pointerType:'touch'}))`);
  await key('Escape','Escape');
};
