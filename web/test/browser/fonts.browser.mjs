// The bundled Inter loads in both weights, on the app and the help page.

export default async ({ ev, go, ok, shot, sleep }) => {
  for (const url of ['/aparat/', '/aparat/help.html']) {
    await go(url); await sleep(1200);
    const loaded = await ev(`document.fonts.ready.then(() => JSON.stringify([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight)))`).then(JSON.parse);
    const res = await ev(`JSON.stringify(performance.getEntriesByType('resource').filter(r => /woff2/.test(r.name)).map(r => r.name.split('/').pop()))`).then(JSON.parse);
    console.log(url, loaded, res);
    ok(loaded.includes('Inter 400'), 'Inter 400 loaded');
    if (url.includes('help')) ok(loaded.includes('Inter 600'), 'Inter 600 loaded on help');
  }
  await go('/aparat/'); await sleep(1200); await shot('inter');
};
