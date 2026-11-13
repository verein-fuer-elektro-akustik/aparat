// Distortion: tanh saturation with bias for even harmonics, a low-pass tone
// control and an output level. The drive input adds 1 octave of drive per 2 V.

import { pole } from './lib/dsp.js';

export default {
  name: 'drive',
  cols: 2,
  inputs: { in: 0, drive: 0 },
  outputs: ['out'],
  bypass: { out: 'in' },
  params: {
    drive: { min: 1, max: 50, default: 4, curve: 'exp', format: (v) => `${v.toFixed(1)}x` },
    bias: { min: -1, max: 1, default: 0 },
    tone: { min: 200, max: 20000, default: 12000, curve: 'exp', format: (v) => `${Math.round(v)} hz` },
    level: { min: 0, max: 1, default: 0.8 },
  },
  create: (sr) => ({ sr, y: 0, tone: 0, c: 1 }),
  process(s, i, o, p) {
    if (p[2] !== s.tone) {
      s.tone = p[2];
      s.c = Math.min(1, pole(1 / (2 * Math.PI * p[2]), s.sr));
    }
    const drive = p[0] * Math.pow(2, i[1] / 2);
    const x = Math.tanh((i[0] / 5) * drive + p[1]) - Math.tanh(p[1]);
    let y = s.y + (x - s.y) * s.c;
    if (y < 1e-20 && y > -1e-20) y = 0; // no denormals when settling on 0
    s.y = y;
    o[0] = 5 * p[3] * y;
  },
};
