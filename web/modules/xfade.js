// Crossfade between two signals. The cv adds to the knob, 10 V is all the way.

export default {
  name: 'xfade',
  cols: 2,
  inputs: { a: 0, b: 0, mix: 0 },
  outputs: ['out'],
  params: { mix: { min: 0, max: 1, default: 0.5 } },
  create: () => ({}),
  process(s, i, o, p) {
    let x = p[0] + i[2] / 10;
    if (x < 0) x = 0;
    else if (x > 1) x = 1;
    o[0] = i[0] * (1 - x) + i[1] * x;
  },
};
