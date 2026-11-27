// The manifest is valid and the app installable, as fullscreen.

export default async ({ go, ok, send, logs, sleep }) => {
  for (const url of ['/aparat/', '/aparat/patch/default']) {
    await go(url); await sleep(1500);
    const m = (await send('Page.getAppManifest', {})).result;
    ok(m.url?.endsWith('/aparat/manifest.json') && !m.errors?.length, `${url}: manifest ${m.url} errors ${JSON.stringify(m.errors)}`);
    const parsed = JSON.parse(m.data || '{}');
    ok(parsed.display === 'fullscreen', 'display fullscreen');
    const inst = (await send('Page.getInstallabilityErrors', {})).result;
    ok(!inst.installabilityErrors?.length, `installable: ${JSON.stringify(inst.installabilityErrors)}`);
  }
  ok(!logs.some((l) => /error/i.test(l)), 'no errors');
};
