export default {
  name: 'sample hold',
  doc: 'Sample and hold: each trigger takes the input voltage and holds it. Noise in gives random steps.',
  cols: 2,
  inputs: { in: 0, trig: 0 },
  outputs: ['out'],
  params: {},
  create: () => ({ held: 0, high: false }),
  process(s, i, o) {
    const high = i[1] > 1;
    if (high && !s.high) s.held = i[0];
    s.high = high;
    o[0] = s.held;
  },
};
