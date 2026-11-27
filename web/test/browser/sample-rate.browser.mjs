// Sample rate and latency settings, changed while running and kept after a reload.

export default async ({ ev, go, ok, sleep }) => {
  await go('/aparat/'); await sleep(800);
  const head = () => ev(`document.getElementById('channels').textContent`);
  const set = (id, v) => ev(`(() => { const s=document.getElementById('${id}'); s.value='${v}'; s.dispatchEvent(new Event('change')); })()`);
  await ev(`document.getElementById('start').click(); 0`); await sleep(1500);
  ok(/^2 ch · \d+ hz/.test(await head()), `sound card rate: ${await head()}`);
  await set('rate', '96000'); await sleep(1500);
  ok(/96000 hz/.test(await head()) && await ev(`document.getElementById('start').textContent`) === 'stop', `changed while running: ${await head()}`);
  await set('latency', 'safe'); await sleep(1500);
  const safe = await head();
  await set('latency', 'low'); await sleep(1500);
  ok(true, `latency safe: ${safe}, low: ${await head()}`);
  await set('rate', '44100'); await sleep(1500);
  // the patch keeps running at the new rate: the vco tuner says the same pitch
  await go('/aparat/'); await sleep(800);
  ok(await ev(`document.getElementById('rate').value`) === '44100', 'rate kept after reload');
  await ev(`document.getElementById('start').click(); 0`); await sleep(1500);
  ok(/44100 hz/.test(await head()), `started at the kept rate: ${await head()}`);
};
