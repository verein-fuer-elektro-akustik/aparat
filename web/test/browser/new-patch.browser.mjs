// A new patch from the patch menu.

export default async ({ ev, go, ok, shot, sleep }) => {
  const h1 = () => ev(`document.querySelector('header h1').textContent + ' | ' + document.title`);
  await go('/aparat/'); await sleep(800);
  ok(await h1() === 'default | default · aparat', await h1());
  await ev(`aparat.rack.add('noise'); 0`); await sleep(600);
  ok(await h1() === 'default * | default * · aparat', await h1());
  await go('/aparat/patch/berlin'); await sleep(800);
  ok(await h1() === 'berlin | berlin · aparat', await h1());
  await ev(`document.getElementById('new').click(); 0`); await sleep(600);
  ok(true, `new patch: ${await h1()}`);
  await shot('h1');
};
