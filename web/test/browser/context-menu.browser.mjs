// The right-click menu: swatches last, the first item focused.

export default async ({ ev, go, ok, shot, sleep }) => {
  await go('/aparat/'); await sleep(700);
  await ev(`(() => { const r=aparat.rack; const m=[...r.modules.values()].find(m=>m.type==='vcf'); r.select(m); const t=m.el.querySelector('.title').getBoundingClientRect();
    m.el.querySelector('.title').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:t.left+10,clientY:t.top+5})); })(); 0`);
  await sleep(100);
  ok(await ev(`document.getElementById('ctxItems').lastElementChild.classList.contains('swatches')`), 'swatches last');
  ok(await ev(`document.activeElement.textContent`) === 'random', 'first item still focused');
  await shot('ctx');
};
