// The patch menu: open… loads a file in place of the patch, save downloads it,
// import… adds a file's modules and their cables to the patch.

export default async ({ ev, go, ok, send, sleep }) => {
  await go('/aparat/');
  await sleep(600);
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  const labels = await ev(`['load', 'save', 'merge'].map((id) => document.getElementById(id).textContent).join(' | ')`);
  ok(labels === 'open… | save | import…', `menu: ${labels}`);

  const file = { modules: [
    { id: 1, type: 'lfo', x: 0, row: 0, params: { rate: 3 } },
    { id: 2, type: 'vca', x: 4, row: 0 },
    { id: 3, type: 'nonesuch', x: 8, row: 0 },
  ], cables: [{ from: [1, 'sin'], to: [2, 'cv'] }] };
  const pick = (button) => ev(`(() => {
    document.getElementById('${button}').click();
    const t = new DataTransfer();
    t.items.add(new File([${JSON.stringify(JSON.stringify(file))}], 'two.json', { type: 'application/json' }));
    const input = document.getElementById('file');
    input.files = t.files;
    input.dispatchEvent(new Event('change'));
    return 0;
  })()`);
  const count = () => ev('[aparat.rack.modules.size, aparat.rack.cables.list.length]');

  const [mods, cables] = await count();
  await pick('merge');
  await sleep(400);
  const [mods2, cables2] = await count();
  ok(mods2 === mods + 2 && cables2 === cables + 1, `import adds two modules and their cable: ${mods}/${cables} -> ${mods2}/${cables2}`);
  ok(await ev(`[...aparat.rack.selection].map((m) => m.type).sort().join()`) === 'lfo,vca', 'the imported modules are selected');
  ok(/2 modules imported from two\.json, 1 left out/.test(await ev(`document.body.textContent`)), 'it says what came in');
  ok(/\*/.test(await ev(`document.querySelector('header h1').textContent`)), 'the patch counts as changed');

  await pick('load');
  await sleep(400);
  ok(JSON.stringify(await count()) === '[2,1]', `open replaces the patch: ${await count()}`);
};
