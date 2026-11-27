// The theme setting: system at first, canvas colours follow, kept after a reload.

export default async ({ ev, go, ok, shot, send, sleep }) => {
  const bg = () => ev(`getComputedStyle(document.body).backgroundColor`);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await go('/aparat/'); await sleep(800);
  ok(await bg() === 'rgb(243, 243, 243)', `system light: ${await bg()}`);
  ok(await ev(`document.getElementById('theme').value`) === 'system', 'menu says system');
  await ev(`document.getElementById('start').click(); 0`); await sleep(1500);
  await shot('theme-light');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }); await sleep(200);
  ok(await bg() === 'rgb(12, 12, 12)', `system dark follows at once: ${await bg()}`);
  ok(await ev(`import('/aparat/ui/theme.js').then((m) => m.colours['f-high'])`) === '#9c9c9c', 'canvas colours follow');
  // choose light in the menu: overrides the dark system, survives a reload without a flash
  await ev(`(() => { const s=document.getElementById('theme'); s.value='light'; s.dispatchEvent(new Event('change')); })()`); await sleep(200);
  ok(await bg() === 'rgb(243, 243, 243)', 'light chosen over a dark system');
  await go('/aparat/'); 
  ok(await ev(`document.documentElement.dataset.theme`) === 'light' && await ev(`document.getElementById('theme').value`) === 'light', 'kept after reload');
  await ev(`(() => { const s=document.getElementById('theme'); s.value='system'; s.dispatchEvent(new Event('change')); })()`); await sleep(200);
  ok(await bg() === 'rgb(12, 12, 12)' && await ev(`localStorage.getItem('aparat.theme')`) === null, 'back to system');
  await ev(`document.getElementById('start').click(); 0`); await sleep(1500);
  await shot('theme-dark');
};
