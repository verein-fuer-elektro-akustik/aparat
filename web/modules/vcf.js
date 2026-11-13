// Trapezoidal state variable filter (lib/dsp.js), cutoff and resonance under CV.

import { svf, svfTick, tanG } from './lib/dsp.js';

export default {
  name: 'vcf',
  cols: 3,
  inputs: { in: 0, cutoff: 0, res: 0 },
  outputs: ['lp', 'bp', 'hp'],
  bypass: { lp: 'in', bp: 'in', hp: 'in' },
  params: {
    cutoff: { min: 20, max: 20000, default: 800, curve: 'exp', format: (v) => `${Math.round(v)} hz` },
    res: { min: 0, max: 1, default: 0.3 },
    cv: { min: 0, max: 1, default: 0.5 },
  },
  create: (sr) => ({ sr, f: svf() }),
  process(s, i, o, p) {
    let f = p[0] * Math.pow(2, i[1] * p[2]);
    if (f < 10) f = 10;
    let res = p[1] + i[2] * 0.1;
    if (res < 0) res = 0;
    else if (res > 1) res = 1;
    const k = 2 - 1.98 * res;
    svfTick(s.f, i[0], tanG(f, s.sr), k);
    o[0] = s.f.lp;
    o[1] = s.f.bp;
    o[2] = s.f.hp;
  },
};
