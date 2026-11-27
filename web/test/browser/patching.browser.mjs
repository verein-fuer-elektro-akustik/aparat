// Dragging modules, patching jack to jack and turning knobs, and that they make the patch dirty.

const $ = (id) => `document.getElementById('${id}')`;
export default async ({ ev, key, mouse, go, ok, send, sleep, site }) => {
  const U = `${site}/aparat/`;
  await go(U);
  const title = () => ev(`${$('patchCurrent')}.textContent`);
  const n = () => ev('aparat.rack.modules.size');
  // single module drag by its title still pushes neighbours
  const t = await ev(`(() => { const m=[...aparat.rack.modules.values()][1]; const r=m.el.querySelector('.title').getBoundingClientRect(); return {x:r.left+20,y:r.top+8}; })()`);
  await mouse('mousePressed', t.x, t.y);
  for (let i=1;i<=6;i++) await mouse('mouseMoved', t.x + i*40, t.y);
  await mouse('mouseReleased', t.x+240, t.y); await sleep(600);
  const xs = await ev(`[...aparat.rack.modules.values()].map(m=>m.type+'@'+m.x).join(' ')`);
  ok(/vco@8/.test(xs), `single drag: ${xs}`);
  ok(await title() === 'default *', 'moving makes it dirty');
  // cable: drag from lfo-less patch: vco tri -> scope in (ctrl for a new cable)
  const j = await ev(`(() => { const r=aparat.rack; const f=t=>[...r.modules.values()].find(m=>m.type===t); const c=e=>{const b=e.getBoundingClientRect(); return [b.left+b.width/2,b.top+b.height/2];}; return {a:c(f('vco').jacks.out[1].el), b:c(f('output').jacks.in[2].el)}; })()`);
  await mouse('mousePressed', ...j.a); await mouse('mouseMoved', (j.a[0]+j.b[0])/2, j.a[1]+40); await mouse('mouseMoved', ...j.b); await mouse('mouseReleased', ...j.b);
  ok(await ev('aparat.rack.cables.list.length') === 9, 'dragging jack to jack adds a cable');
  // knob drag
  const k = await ev(`(() => { const m=[...aparat.rack.modules.values()].find(m=>m.type==='vcf'); const b=m.knobs[0].el.getBoundingClientRect(); return {x:b.left+24,y:b.top+20,v:m.values[0]}; })()`);
  await mouse('mousePressed', k.x, k.y); await mouse('mouseMoved', k.x, k.y-40); await mouse('mouseReleased', k.x, k.y-40);
  ok(await ev(`[...aparat.rack.modules.values()].find(m=>m.type==='vcf').values[0]`) > k.v, 'knob drag turns the knob');
  ok(await ev('aparat.rack.selection.size') === 1, 'one module selected');
  // store under a name: clean; change: dirty; ctrl+s: clean
  await sleep(500);
  await ev(`(() => { const i=${$('patchName')}; i.value='mine'; i.dispatchEvent(new Event('input')); ${$('patchStore')}.click(); })()`); await sleep(600);
  ok(await title() === 'mine' && await ev('location.pathname') === '/aparat/patch/mine', `stored: "${await title()}"`);
  ok(await ev(`localStorage.getItem('aparat.autosave')`) === null, 'no autosave once stored');
  await ev(`aparat.rack.add('noise'); 0`); await sleep(600);
  ok(await title() === 'mine *', 'changed after storing');
  await key('s','KeyS',2); await sleep(600);
  ok(await title() === 'mine', 'ctrl+s stores');
  // another patch from the menu, then back by reload: no leftovers
  await ev(`[...${$('patchItems')}.querySelectorAll('button')].find(b=>b.dataset.name==='drones').click()`); await sleep(800);
  ok(await title() === 'drones', `loaded drones: "${await title()}"`);
  await go(U + 'patch/mine');
  ok(await title() === 'mine' && await n() === 8, `reload of a stored patch: ${await n()} modules, "${await title()}"`);
  // unsaved changes of "mine" do not show up in another patch, and survive visiting it
  await ev(`aparat.rack.add('lfo'); 0`); await sleep(600);
  await go(U + 'patch/idm');
  ok(await title() === 'idm', `other patch is clean: "${await title()}"`);
  await go(U + 'patch/mine');
  ok(await title() === 'mine *' && await n() === 9, `changes to mine are still there: ${await n()} modules`);
  // right-click menu on a selection of two
  await ev(`(() => { const r=aparat.rack; const l=[...r.modules.values()]; r.select(l[0]); r.select(l[1], true); l[1].el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:200})); })()`);
  ok(await ev(`${$('ctxTitle')}.textContent`) === '2 modules', 'menu for the selection');
  await ev(`[...${$('ctxItems')}.children].find(b=>b.textContent==='duplicate').click()`); await sleep(300);
  ok(await n() === 11, `duplicate of two: ${await n()}`);
};
