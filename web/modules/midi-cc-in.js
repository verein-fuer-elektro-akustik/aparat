import { pole } from './lib/dsp.js';

export default {
  name: 'midi cc in',
  cols: 2,
  inputs: {},
  outputs: ['out'],
  params: {
    cc: { min: 0, max: 127, default: 1, step: 1, format: (v) => `cc ${v}` },
    channel: { min: 0, max: 16, default: 0, step: 1, format: (v) => (v ? `${v}` : 'all') },
  },
  create: (sr) => ({ target: 0, v: 0, coef: pole(0.005, sr) }),
  onMidi(s, d, p) {
    if ((d[0] & 0xf0) !== 0xb0 || d[1] !== p[0]) return;
    if (p[1] && (d[0] & 15) + 1 !== p[1]) return;
    s.target = (d[2] / 127) * 10;
  },
  process(s, i, o) {
    let v = s.v + (s.target - s.v) * s.coef;
    if (v < 1e-20) v = 0; // no denormals when settling on 0
    s.v = v;
    o[0] = v;
  },
};
