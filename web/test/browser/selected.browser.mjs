// Selected panels look different, plain and coloured, in both themes.

export default async ({ ev, go, ok, shot, sleep }) => {
  await go(`/aparat/`); await sleep(1000);
  for (const theme of ['dark', 'light']) {
    await ev(`(document.querySelector('#theme').value = '${theme}', document.querySelector('#theme').dispatchEvent(new Event('change')), 0)`); await sleep(200);
    const c = await ev(`(() => { const r = aparat.top; const get = (t) => [...r.modules.values()].find(m => m.type === t);
      const vco = get('vco'), vcf = get('vcf'); r.setColour(vco, null); r.select(null);
      const bg = (m) => getComputedStyle(m.el).backgroundColor + ' / ' + getComputedStyle(m.el.querySelector('.outputs') ?? m.el).backgroundColor;
      const before = [bg(vco), bg(vcf)]; r.select(vco); r.select(vcf, true); const after = [bg(vco), bg(vcf)];
      return JSON.stringify({ before, after }); })()`).then(JSON.parse);
    console.log(theme, c);
    ok(c.before[0] !== c.after[0] && c.before[1] !== c.after[1], `${theme}: selected panels change, plain and coloured`);
    await shot(`selbg-${theme}`);
  }
};
