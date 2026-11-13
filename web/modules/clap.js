// Hand clap: band-passed noise, three short bursts `spread` apart and then a
// decaying tail.

import { seed, svf, svfTick, tanG, white } from './lib/dsp.js';

export default {
  name: 'clap',
  cols: 2,
  inputs: { trig: 0 },
  outputs: ['out'],
  params: {
    decay: { min: 0.03, max: 1.5, default: 0.18, curve: 'exp', format: (v) => `${(v * 1000).toFixed(0)} ms` },
    tone: { min: 400, max: 6000, default: 1200, curve: 'exp', format: (v) => `${Math.round(v)} hz` },
    spread: { min: 0.004, max: 0.03, default: 0.011, curve: 'exp', format: (v) => `${(v * 1000).toFixed(1)} ms` },
  },
  create: (sr) => ({ sr, x: seed(), t: 1e9, trig: false, f: svf() }),
  process(s, i, o, p) {
    const trig = i[0] > 1;
    if (trig && !s.trig) s.t = 0;
    s.trig = trig;
    const sr = s.sr;
    const spread = p[2] * sr;
    const tail = s.t - 3 * spread;
    const env = tail < 0 ? Math.exp(-(s.t % spread) / (0.004 * sr)) : Math.exp(-tail / (p[0] * sr));
    if (env < 1e-5) {
      // idle until the next trigger, also if decay is turned up later
      s.t = 1e9;
      o[0] = 0;
      return;
    }
    s.t++;
    svfTick(s.f, white(s), tanG(p[1], sr), 0.7);
    o[0] = 7 * s.f.bp * env;
  },
};
