// The bundled patches have coloured modules.

export default async ({ ev, go, ok, shot, sleep }) => {
  for (const name of ['acid', 'idm', 'default']) {
    await go(`/aparat/patch/${name}`); await sleep(900);
    const n = await ev(`[...aparat.top.modules.values()].filter(m => m.color).length + '/' + aparat.top.modules.size`);
    const [a, b] = n.split('/');
    ok(a === b, `${name}: ${n} coloured`);
    await shot(`factory-${name}`);
  }
};
