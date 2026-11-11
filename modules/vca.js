// Negative cv is allowed on purpose: the vca doubles as a ring modulator.

export default {
  name: 'vca',
  hp: 4,
  inputs: { in: 0, cv: 10 },
  outputs: ['out'],
  params: { gain: { min: 0, max: 1, default: 1 } },
  create: () => ({}),
  process(s, i, o, p) {
    o[0] = i[0] * p[0] * (i[1] / 10);
  },
};
