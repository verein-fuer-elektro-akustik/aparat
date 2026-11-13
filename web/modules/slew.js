// Slew limiter / glide: the output follows the input with separate rise and
// fall times. On a pitch line it gives portamento, on gates soft edges.

import { pole } from './lib/dsp.js';

const time = { min: 0.0005, max: 2, default: 0.05, curve: 'exp', format: (v) => `${(v * 1000).toFixed(1)} ms` };

export default {
  name: 'slew',
  cols: 2,
  inputs: { in: 0 },
  outputs: ['out'],
  params: { rise: time, fall: time },
  create: (sr) => ({ sr, y: 0, rise: 0, fall: 0, cr: 1, cf: 1 }),
  process(s, i, o, p) {
    if (p[0] !== s.rise) {
      s.rise = p[0];
      s.cr = pole(p[0], s.sr);
    }
    if (p[1] !== s.fall) {
      s.fall = p[1];
      s.cf = pole(p[1], s.sr);
    }
    const x = i[0];
    s.y += (x - s.y) * (x > s.y ? s.cr : s.cf);
    o[0] = s.y;
  },
};
