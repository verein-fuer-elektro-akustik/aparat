// Checkboxes and lists are drawn in the page's style in both themes.

export default async ({ ev, go, ok, shot, send, sleep }) => {
  for (const theme of ['dark', 'light']) {
    await go('/aparat/'); await sleep(700);
    await ev(`localStorage.setItem('aparat.theme','${theme}'); document.documentElement.dataset.theme='${theme}'; 0`);
    // composite dialog with two boxes ticked
    await ev(`(() => { const r=aparat.rack; r.select(null); for (const m of r.modules.values()) if (['vcf','env'].includes(m.type)) r.select(m,true);
      const m=[...r.modules.values()].find(m=>m.type==='vcf'); const t=m.el.querySelector('.title').getBoundingClientRect();
      m.el.querySelector('.title').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:t.left+10,clientY:t.top+5}));
      [...document.querySelectorAll('#ctxItems button')].find(b=>b.textContent.startsWith('make composite')).click();
      document.querySelectorAll('#composeKnobs input')[0].checked=true; document.querySelectorAll('#composeKnobs input')[3].checked=true; })(); 0`);
    await sleep(200);
    ok(await ev(`getComputedStyle(document.querySelector('#composeKnobs input')).appearance`) === 'none', `${theme}: own checkbox`);
    await shot(`forms-${theme}-check`);
    await ev(`document.getElementById('composeCancel').click(); 0`);
    // open the view menu and its theme select, hover the second option
    await ev(`[...document.querySelectorAll('nav button, header button')].find(b=>b.textContent.trim()==='view').click(); 0`); await sleep(150);
    const r = await ev(`(() => { const s=document.getElementById('theme'); s.focus(); const r=s.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r[0], y: r[1], button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r[0], y: r[1], button: 'left', clickCount: 1 });
    await sleep(200);
    const o = await ev(`(() => { const o=document.querySelectorAll('#theme option')[1].getBoundingClientRect(); return [o.left+o.width/2, o.top+o.height/2, o.height]; })()`);
    ok(o[2] > 0, `${theme}: the list is drawn in the page (styled)`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: o[0], y: o[1] }); await sleep(150);
    await shot(`forms-${theme}-select`);
  }
};
