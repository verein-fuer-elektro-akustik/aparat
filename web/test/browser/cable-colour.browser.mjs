// A cable has the colour of the module its signal comes from, both its jack
// rings too; from a grey module it stays grey even into a coloured one.

export default async ({ ev, go, ok, sleep, shot }) => {
  await go('/aparat/');
  // vco is blue in the default patch; take the colour off vcf so vco -> vcf
  // and vcf -> vca can be told apart
  await ev(`(() => { const r = aparat.rack; const vcf = [...r.modules.values()].find((m) => m.type === 'vcf'); r.setColour(vcf, null); return 0; })()`);
  await sleep(200);
  const rings = (from, to) => ev(`(() => {
    const c = aparat.rack.cables.list.find((c) => c.from.m.type === '${from}' && c.to.m.type === '${to}');
    return [c.from.m.jacks.out[c.from.i].el.style.getPropertyValue('--plug'), c.to.m.jacks.in[c.to.i].el.style.getPropertyValue('--plug'), JSON.stringify(aparat.rack.cables.colourOf(c))];
  })()`);
  const [out, inp, col] = await rings('vco', 'vcf');
  ok(out && out === inp, `vco -> vcf: both rings in vco's colour (${out}, ${inp})`);
  ok(col === JSON.stringify([0x3f, 0x78, 0xc4]), `the cable has vco's colour: ${col}`);
  const [o2, i2, c2] = await rings('vcf', 'vca');
  ok(c2 === 'null' && !o2 && !i2, `vcf (no colour) -> vca (blue): grey, plain rings (${c2}, "${o2}", "${i2}")`);
  await shot('cable-colour');
};
