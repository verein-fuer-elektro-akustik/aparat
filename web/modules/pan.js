// Equal-power pan, mono to stereo. The cv moves the position, 5 V is all the
// way from the middle to one side.

export default {
  name: 'pan',
  cols: 2,
  inputs: { in: 0, pan: 0 },
  outputs: ['l', 'r'],
  params: { pan: { min: -1, max: 1, default: 0 } },
  create: () => ({}),
  process(s, i, o, p) {
    let x = p[0] + i[1] / 5;
    if (x < -1) x = -1;
    else if (x > 1) x = 1;
    const a = ((x + 1) * Math.PI) / 4;
    o[0] = i[0] * Math.cos(a) * Math.SQRT2;
    o[1] = i[0] * Math.sin(a) * Math.SQRT2;
  },
};
