// Hi-hat: six detuned square waves (the 808 recipe) mixed with noise, through
// a band-pass and a high-pass at `tone`, with an exponential decay. Short decay
// for closed hats, long for open.

import { seed, svf, svfTick, tanG, white } from './lib/dsp.js';

const FREQS = [205.3, 304.4, 369.6, 522.7, 540, 800];

export default {
  name: 'hat',
  cols: 2,
  inputs: { trig: 0, decay: 0 },
  outputs: ['out'],
  params: {
    decay: { min: 0.01, max: 2, default: 0.06, curve: 'exp', format: (v) => `${(v * 1000).toFixed(0)} ms` },
    tone: { min: 2000, max: 16000, default: 8000, curve: 'exp', format: (v) => `${Math.round(v)} hz` },
    metal: { min: 0, max: 1, default: 0.5 },
  },
  create: (sr) => ({ sr, x: seed(), ph: new Float64Array(6), env: 0, trig: false, bp: svf(), hp: svf() }),
  process(s, i, o, p) {
    const trig = i[0] > 1;
    if (trig && !s.trig) s.env = 1;
    s.trig = trig;
    if (s.env < 1e-5) {
      o[0] = 0;
      return;
    }
    let metal = 0;
    for (let k = 0; k < 6; k++) {
      let ph = s.ph[k] + (FREQS[k] * 2) / s.sr;
      if (ph >= 1) ph -= 1;
      s.ph[k] = ph;
      metal += ph < 0.5 ? 1 : -1;
    }
    const x = (metal / 6) * p[2] + white(s) * (1 - p[2]);
    svfTick(s.bp, x, tanG(p[1], s.sr), 0.8);
    svfTick(s.hp, s.bp.bp, tanG(p[1] * 0.7, s.sr), 1.4);
    s.env *= Math.exp(-1 / (p[0] * Math.pow(2, i[1] / 5) * s.sr));
    o[0] = 13 * s.hp.hp * s.env;
  },
};
