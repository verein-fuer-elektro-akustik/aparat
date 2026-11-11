const level = { min: 0, max: 1, default: 0.8 };

export default {
  name: 'mixer',
  hp: 8,
  knobCols: 2,
  inputs: { a: 0, b: 0, c: 0, d: 0 },
  outputs: ['out'],
  params: { a: level, b: level, c: level, d: level, master: { min: 0, max: 1, default: 1 } },
  create: () => ({}),
  process(s, i, o, p) {
    o[0] = (i[0] * p[0] + i[1] * p[1] + i[2] * p[2] + i[3] * p[3]) * p[4];
  },
};
