// The help page: module entries, jacks, anchors, opened at a module.

export default async ({ ev, go, ok, shot, send, key, sleep, site }) => {
  await go('/aparat/help.html'); await sleep(600);
  // one entry per module, one contents line per group of the registry
  const [defs, groups] = await ev(`import('/aparat/modules/index.js').then((m) => [m.defs.length, m.groups.length])`);
  const n = await ev(`document.querySelectorAll('#reference article').length`);
  ok(n === defs, `module entries: ${n} of ${defs}`);
  ok(await ev(`document.querySelectorAll('#toc-modules li').length`) === groups, `${groups} groups in the contents`);
  ok(await ev(`document.getElementById('m-sample-hold')?.textContent.includes('trig')`), 'sample hold entry with its jacks');
  ok(await ev(`document.getElementById('m-vca').textContent.includes('cv (10 V)')`), 'unpatched value shown');
  // every link inside the page leads somewhere
  const broken = await ev(`[...document.querySelectorAll('a[href^="#"]')].map(a=>a.getAttribute('href')).filter(h=>!document.getElementById(h.slice(1)))`);
  ok(broken.length === 0, `broken anchors: ${broken}`);
  await shot('help-dark');
  await go('/aparat/help.html#m-hdar'); await sleep(600);
  ok(await ev(`Math.abs(document.getElementById('m-hdar').getBoundingClientRect().top) < 40`), 'opened at a module entry');
  await shot('help-entry');
  // from the app: patch page, right-click menu has help, ? opens a tab
  await go('/aparat/patch/default'); await sleep(800);
  await ev(`window.__opened = []; window.open = (u, n) => { window.__opened.push(new URL(u, document.baseURI).href + ' ' + n); return null; }; 0`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '?', code: 'Slash', modifiers: 8 });
  await ev(`document.querySelector('[data-help="keys"]').click(); 0`);
  await ev(`(() => { const m=[...aparat.rack.modules.values()].find(m=>m.type==='vcf'); const r=m.el.querySelector('.title').getBoundingClientRect(); m.el.querySelector('.title').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+10,clientY:r.top+5})); })(); 0`);
  await sleep(100);
  await ev(`[...document.querySelectorAll('#ctxItems button')].find(b=>b.textContent==='help')?.click(); 0`);
  const opened = await ev(`window.__opened`);
  ok(opened.join() === ['start', 'keys', 'm-vcf'].map((h) => `${site}/aparat/help.html#${h} aparat-help`).join(), `opened: ${opened.join(' | ')}`);
};
