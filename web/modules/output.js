// Sound card output. Several can share a rack, their signals sum per channel.
// The engine applies NaN guard, DC blocker and limiter after the sum.

export default {
  name: 'output',
  cols: 4,
  inputs: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 },
  outputs: [],
  params: {
    first: { min: 1, max: 25, default: 1, step: 1, format: (v) => `${v}-${v + 7}` },
    level: { min: 0, max: 1, default: 0.5 },
  },
  create: (sr, host) => ({ host }),
  process(s, i, o, p) {
    const at = p[0] - 1;
    const gain = p[1] / 5;
    const out = s.host.out;
    for (let k = 0; k < 8; k++) out[at + k] += i[k] * gain;
  },
};
