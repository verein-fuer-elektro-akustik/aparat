// While playing, the header fades away and the rack takes its space without
// anything moving on screen; the top edge brings it back; the view menu
// switches it off. A hovered jack dims the other cables.

export default async ({ ev, go, ok, mouse, sleep }) => {
  await go('/aparat/');
  const vco = `[...aparat.rack.modules.values()].find((m) => m.type === 'vco').el`;
  const at = () => ev(`(() => { const r = ${vco}.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; })()`);
  const away = () => ev(`document.querySelector('header').classList.contains('gone')`);

  await mouse('mouseMoved', 700, 600, { buttons: 0 });
  await sleep(4000);
  ok(!(await away()), 'stays while audio is off');

  await ev(`document.getElementById('start').click(); 0`);
  await mouse('mouseMoved', 700, 600, { buttons: 0 });
  const before = await at();
  const stage = await ev(`document.getElementById('stage').clientHeight`);
  await sleep(3800);
  ok(await away(), 'gone after a few seconds of playing');
  ok(await ev(`document.getElementById('stage').clientHeight`) > stage, 'the rack takes its space');
  ok(JSON.stringify(await at()) === JSON.stringify(before), `panels stay where they were: ${before} -> ${await at()}`);

  await mouse('mouseMoved', 700, 5, { buttons: 0 });
  await sleep(300);
  ok(!(await away()) && (await ev(`getComputedStyle(document.querySelector('header')).opacity`)) === '1', 'the top edge brings it back');
  ok(JSON.stringify(await at()) === JSON.stringify(before), `panels still in place: ${await at()}`);

  await ev(`document.getElementById('autohide').click(); 0`);
  ok(/off$/.test(await ev(`document.getElementById('autohide').textContent`)), 'switched off in the view menu');
  await mouse('mouseMoved', 700, 600, { buttons: 0 });
  await sleep(3800);
  ok(!(await away()), 'stays when switched off');
  await ev(`document.getElementById('autohide').click(); localStorage.removeItem('aparat.autohide'); 0`);

  await ev(`document.getElementById('start').click(); 0`);
  await sleep(300);
  ok(!(await away()), 'shown when stopped');

  // hovering a jack with cables dims the others
  const jack = await ev(`(() => { const m = [...aparat.rack.modules.values()].find((m) => m.type === 'vcf'); const r = m.el.querySelector('.jack[data-dir="in"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await mouse('mouseMoved', jack[0], jack[1], { buttons: 0 });
  await sleep(500);
  ok(Math.abs((await ev('aparat.rack.cables.dim')) - 0.3) < 0.02, `others dimmed on a jack: ${await ev('aparat.rack.cables.dim')}`);
  await mouse('mouseMoved', 700, 600, { buttons: 0 });
  await sleep(500);
  ok((await ev('aparat.rack.cables.dim')) === 1, 'back to full away from it');
};
