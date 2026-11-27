// The output module names its jacks by channel from its first knob and turns
// off those the sound card does not have: they take no new cable, cables
// already there stay. The count is kept for the next visit, before start.

export default async ({ ev, go, ok, sleep, mouse }) => {
  await go('/aparat/');
  await ev(`localStorage.removeItem('aparat.device'); 0`);
  await go('/aparat/');
  const out = `[...aparat.rack.modules.values()].find((m) => m.type === 'output')`;
  const ports = () => ev(`[...${out}.el.querySelectorAll('.inputs .port')].map((p) => p.querySelector('span').textContent + (p.classList.contains('off') ? '-' : '')).join(' ')`);
  ok(await ports() === '1 2 3 4 5 6 7 8', `all eight before the card is known: ${await ports()}`);

  await ev(`document.getElementById('start').click(); 0`);
  await sleep(1500);
  const n = await ev(`aparat.audio ? aparat.audio.channels : JSON.parse(localStorage.getItem('aparat.device')).out`);
  ok(n >= 1 && n <= 8, `the card has ${n} channels`);
    // the default patch's cables go to 1 and 2; one more to 5
  await ev(`(() => { const r = aparat.rack; const vco = [...r.modules.values()].find((m) => m.type === 'vco'); r.connect({ m: vco, i: 0 }, { m: ${out}, i: 4 }); return 0; })()`);
  await sleep(100);
  const shown = await ports();
  ok(shown.split(' ').every((p, i) => i < n ? p === `${i + 1}` : p.endsWith('-')), `channels beyond the card turned off: ${shown}`);
  if (n < 5) {
    ok(shown.split(' ')[4] === '5-' && await ev(`aparat.rack.cablesAt(${out}, 'in', 4).length`) === 1, 'a cable to a channel beyond the card stays');
    ok(/not on this sound card/.test(await ev(`${out}.el.querySelectorAll('.inputs .port')[4].title`)), 'it says why on hover');
    ok(await ev(`getComputedStyle(${out}.el.querySelectorAll('.inputs .port')[7]).visibility`) === 'visible', 'turned off jacks are still shown');
    // a drag from vco's sin to channel 6 (off) adds nothing
    const before = await ev('aparat.rack.cables.list.length');
    const centre = (sel) => ev(`(() => { const r = ${sel}.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    const from = await centre(`[...aparat.rack.modules.values()].find((m) => m.type === 'vco').jacks.out[1].el`);
    const to = await centre(`${out}.jacks.in[5].el`);
    await mouse('mousePressed', from[0], from[1]);
    for (let k = 1; k <= 8; k++) await mouse('mouseMoved', from[0] + ((to[0] - from[0]) * k) / 8, from[1] + ((to[1] - from[1]) * k) / 8);
    await mouse('mouseReleased', to[0], to[1]);
    await sleep(100);
    ok(await ev('aparat.rack.cables.list.length') === before, 'a turned off jack takes no new cable');
  }

  // first moves the channels along
  await ev(`(() => { const m = ${out}; m.knobs[m.keys.indexOf('first')].setNorm(2 / 24); return 0; })()`);
  await sleep(100);
  ok((await ports()).startsWith('3'), `first 3 names the jacks from 3: ${await ports()}`);
  await ev(`(() => { const m = ${out}; m.knobs[m.keys.indexOf('first')].setNorm(0); return 0; })()`);

  await ev(`document.getElementById('start').click(); 0`);
  await sleep(300);
  await go('/aparat/');
  ok(JSON.parse(await ev(`localStorage.getItem('aparat.device')`)).out === n && (await ports()) === shown, `known on the next visit, before start: ${await ports()}`);
  await ev(`localStorage.removeItem('aparat.device'); 0`);
};
