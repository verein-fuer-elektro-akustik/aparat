// Only composites have the mark, which opens their edit view.

export default async ({ ev, go, ok, shot, send, sleep }) => {
  await go('/aparat/'); await sleep(800);
  await ev(`localStorage.clear(); 0`);
  await go('/aparat/'); await sleep(800);
  await ev(`(() => { const r=aparat.rack; r.select(null); for (const m of r.modules.values()) if (['vco','vcf','env','vca'].includes(m.type)) r.select(m,true);
    const m=[...r.modules.values()].find(m=>m.type==='vcf'); const t=m.el.querySelector('.title').getBoundingClientRect();
    m.el.querySelector('.title').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:t.left+10,clientY:t.top+5}));
    [...document.querySelectorAll('#ctxItems button')].find(b=>b.textContent==='make composite').click();
    const n=document.getElementById('composeName'); n.value='voice'; n.dispatchEvent(new Event('input')); document.getElementById('composeOk').click(); })(); 0`);
  await sleep(500);
  ok(await ev(`document.querySelectorAll('#content .title button.open').length`) === 1, 'only the composite has the mark');
  await ev(`aparat.rack.select(null); 0`);
  await shot('mark');
  // a real click on the mark opens it, and does not start a drag
  const r = await ev(`(() => { const r=document.querySelector('#content .title button.open').getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r[0], y: r[1], button: 'left', clickCount: 1 });
  await sleep(300);
  ok(!await ev(`document.getElementById('inner').hidden`), 'clicking the mark opens the edit view');
};
