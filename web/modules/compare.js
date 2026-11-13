// Comparator: a gate while the input is above (or below) ref + level. Turns
// an lfo or envelope into gates.

export default {
  name: 'compare',
  cols: 2,
  inputs: { in: 0, ref: 0 },
  outputs: ['above', 'below'],
  params: { level: { min: -10, max: 10, default: 0, format: (v) => `${v.toFixed(2)} v` } },
  create: () => ({}),
  process(s, i, o, p) {
    const above = i[0] > i[1] + p[0];
    o[0] = above ? 10 : 0;
    o[1] = above ? 0 : 10;
  },
};
