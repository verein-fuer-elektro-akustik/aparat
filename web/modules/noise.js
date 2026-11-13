// White and pink noise (pink: Paul Kellet's economy filter).

import { seed, white } from './lib/dsp.js';

export default {
  name: 'noise',
  cols: 2,
  inputs: {},
  outputs: ['white', 'pink'],
  params: {},
  create: () => ({ x: seed(), b0: 0, b1: 0, b2: 0 }),
  process(s, i, o) {
    const w = white(s);
    s.b0 = 0.99765 * s.b0 + w * 0.099046;
    s.b1 = 0.963 * s.b1 + w * 0.2965164;
    s.b2 = 0.57 * s.b2 + w * 1.0526913;
    o[0] = w * 5;
    o[1] = (s.b0 + s.b1 + s.b2 + w * 0.1848) * 1.1;
  },
};
