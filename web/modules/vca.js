// Negative cv is allowed on purpose: the vca doubles as a ring modulator.

export default {
  name: 'vca',
  doc: 'Amplifier: the cv sets the level, 10 V is full. A bipolar cv makes it a ring modulator.',
  cols: 2,
  inputs: { in: 0, cv: 10 },
  outputs: ['out'],
  params: { gain: { min: 0, max: 1, default: 1 } },
  create: () => ({}),
  process(s, i, o, p) {
    o[0] = i[0] * p[0] * (i[1] / 10);
  },
};
