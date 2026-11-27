// Gate and pitch jacks look different and name their kind.

export default async ({ ev, go, ok, shot, sleep }) => {
  await go('/aparat/patch/acid'); await sleep(800);
  const n = await ev(`[document.querySelectorAll('.jack.gate').length, document.querySelectorAll('.jack.pitch').length]`);
  ok(n[0] > 20 && n[1] > 2, `gate jacks ${n[0]}, pitch jacks ${n[1]}`);
  const title = await ev(`[...aparat.top.modules.values()].find(m => m.type === 'vco').jacks.in[0].el.parentElement.title`);
  ok(title === 'pitch, 1 V/oct', `hover names it: ${title}`);
  await shot('kinds');
  await go('/aparat/help.html#m-clock'); await sleep(600);
  const ref = await ev(`document.getElementById('m-clock').textContent`);
  ok(/reset gate/.test(ref), 'help reference names kinds');
};
