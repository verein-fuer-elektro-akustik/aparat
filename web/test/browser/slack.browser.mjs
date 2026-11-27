// The cable slack slider in the view menu: cables follow it while it moves,
// every one keeps a bow, double-click goes back, it is kept after a reload.

export default async ({ ev, go, ok, sleep, shot }) => {
  await go('/aparat/');
  // the lowest point of every cable below its higher end, in rack pixels
  const sags = () => ev(`aparat.rack.cables.list.map((c) => { let low = -Infinity; for (let k = 1; k < c.pts.length; k += 2) low = Math.max(low, c.pts[k]); return Math.round(low - Math.max(c.pts[1], c.pts.at(-1))); })`);
  const pick = (v, type = 'change') => ev(`(() => { const s = document.getElementById('slack'); s.value = '${v}'; s.dispatchEvent(new Event('${type}')); return 0; })()`);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  ok(await ev(`document.getElementById('slack').value`) === '1', 'the usual slack at first');
  const normal = await sags();
  await pick(0.2); await sleep(100);
  const tight = await sags();
  await shot('slack-tight');
  await pick(1.5, 'input'); await sleep(50);
  const between = await sags();
  ok(sum(between) > sum(normal) && (await ev(`localStorage.getItem('aparat.slack')`)) !== '1.5', `cables follow while dragging (${sum(between)}), saved only when let go`);
  await pick(2); await sleep(100);
  const loose = await sags();
  await shot('slack-loose');
  ok(sum(tight) < sum(normal) && sum(between) < sum(loose), `tight ${sum(tight)} < normal ${sum(normal)} < loose ${sum(loose)}`);
  ok(Math.min(...tight) > 0, `every cable keeps a bow when tight: ${Math.min(...tight)}`);
  await go('/aparat/');
  ok(await ev(`document.getElementById('slack').value`) === '2' && sum(await sags()) === sum(loose), 'kept after a reload');
  await ev(`document.getElementById('slack').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); 0`); await sleep(100);
  ok(sum(await sags()) === sum(normal) && await ev(`localStorage.getItem('aparat.slack')`) === '1', 'double-click goes back to the usual');
  await ev(`localStorage.removeItem('aparat.slack'); 0`);
};
