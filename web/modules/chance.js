// Bernoulli gate: on every rising edge a coin is thrown. With probability
// `prob` the gate goes to a, otherwise to b. The prob input adds 10% per volt.

import { seed, white } from './lib/dsp.js';

export default {
  name: 'chance',
  cols: 2,
  inputs: { in: 0, prob: 0 },
  outputs: ['a', 'b'],
  params: {
    prob: { min: 0, max: 1, default: 0.5, format: (v) => `${Math.round(v * 100)}%` },
  },
  create: () => ({ x: seed(), high: false, pick: 0 }),
  process(s, i, o, p) {
    const high = i[0] > 1;
    if (high && !s.high) s.pick = white(s) * 0.5 + 0.5 < p[0] + i[1] * 0.1 ? 1 : 2;
    s.high = high;
    o[0] = high && s.pick === 1 ? i[0] : 0;
    o[1] = high && s.pick === 2 ? i[0] : 0;
  },
};
