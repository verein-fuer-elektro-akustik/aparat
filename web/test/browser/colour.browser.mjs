// Module colours from the right-click menu, undo and redo, any colour, reload and paste.

export default async ({ ev, go, ok, shot, sleep }) => {
  const open = (types) => ev(`(() => { const r=aparat.rack; r.select(null); for (const m of r.modules.values()) if (${JSON.stringify(types)}.includes(m.type)) r.select(m,true);
    const m=[...r.selection][0]; const t=m.el.querySelector('.title').getBoundingClientRect();
    m.el.querySelector('.title').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:t.left+10,clientY:t.top+5})); })(); 0`);
  const colours = () => ev(`Object.fromEntries([...aparat.rack.modules.values()].map(m=>[m.type, m.color]))`);
  let vcaBefore;
  for (const theme of ['dark', 'light']) {
    // each theme from the default patch, not what the last one left
    await go('/aparat/'); await sleep(300);
    await ev(`localStorage.removeItem('aparat.autosave'); 0`);
    await go('/aparat/'); await sleep(700);
    await ev(`localStorage.setItem('aparat.theme','${theme}'); document.documentElement.dataset.theme='${theme}'; 0`);
    const before = await colours();
    await open(['vco', 'vcf']); await sleep(100);
    ok(await ev(`document.querySelectorAll('#ctxItems .swatches button').length`) === 9, `${theme}: none + 8 swatches`);
    // the default patch's modules are blue (#3f78c4): purple
    await ev(`document.querySelectorAll('#ctxItems .swatches button')[7].click(); 0`); await sleep(100);
    let c = await colours();
    ok(c.vco === '#7e5cc4' && c.vcf === '#7e5cc4' && c.env === before.env, `${theme}: both selected coloured, env kept ${before.env}`);
    ok(await ev(`getComputedStyle([...aparat.rack.modules.values()].find(m=>m.type==='vco').el).backgroundColor`) !== await ev(`getComputedStyle([...aparat.rack.modules.values()].find(m=>m.type==='env').el).backgroundColor`), `${theme}: panel tinted`);
    // any colour on env
    await open(['env']); await sleep(100);
    await ev(`(() => { const i=document.querySelector('#ctxItems .swatches input'); i.value='#e05010'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); })(); 0`);
    vcaBefore = (await colours()).vca;
    await open(['vca']); await sleep(100);
    await ev(`document.querySelectorAll('#ctxItems .swatches button')[2].click(); 0`); await sleep(100);
    await ev(`aparat.rack.select(null); 0`);
    await sleep(100);
    await shot(`colour-${theme}`);
  }
  let c = await colours();
  ok(c.env === '#e05010' && c.vca === '#d98b2b', `any colour: ${c.env}`);
  // undo, reload, copy/paste, composite keeps inner colours
  await sleep(600);
  await ev(`document.getElementById('undo').click(); 0`); await sleep(300);
  ok((await colours()).vca === vcaBefore, `undo takes the colour back to ${vcaBefore}`);
  await ev(`document.getElementById('redo').click(); 0`); await sleep(300);
  ok((await colours()).vca === '#d98b2b', 'redo');
  await sleep(600);
  await go('/aparat/'); await sleep(900);
  ok((await colours()).env === '#e05010', 'kept after reload');
  await open(['env']); await sleep(100);
  await ev(`document.querySelector('#ctxItems .swatches .none').click(); 0`); await sleep(100);
  ok(!(await colours()).env, 'no colour');
  const vco = await ev(`[...aparat.rack.modules.values()].find(m=>m.type==='vco').color`);
  await ev(`(() => { const r=aparat.rack; const m=[...r.modules.values()].find(m=>m.type==='vco'); r.select(m); r.paste(r.copy()); })(); 0`); await sleep(200);
  const cols = await ev(`[...aparat.rack.modules.values()].filter(m=>m.type==='vco').map(m=>m.color)`);
  ok(cols.length === 2 && cols.every((c) => c === vco), `paste keeps the colour ${vco}: ${cols}`);
};
