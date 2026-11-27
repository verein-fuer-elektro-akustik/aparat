// Low sample rates start and show in the header.

export default async ({ ev, go, ok, sleep }) => {
  await go('/aparat/'); await sleep(800);
  const head = () => ev(`document.getElementById('channels').textContent`);
  for (const r of ['8000', '11025', '16000', '22050', '24000', '32000']) {
    await ev(`(() => { const s=document.getElementById('rate'); s.value='${r}'; s.dispatchEvent(new Event('change')); })()`);
    if (r === '8000') await ev(`document.getElementById('start').click(); 0`);
    await sleep(1200);
    ok(new RegExp(` ${r} hz`).test(await head()), `${r}: ${await head()}`);
  }
};
