// Kick drum: a sine with a fast downward pitch sweep, a noise click on the
// attack and tanh drive. The decay is applied after the drive, so drive changes
// the tone and not the length.

import { seed, white } from './lib/dsp.js';

const TAU = Math.PI * 2;
const sec = (min, max, def) => ({ min, max, default: def, curve: 'exp', format: (v) => `${(v * 1000).toFixed(0)} ms` });

export default {
  name: 'kick',
  cols: 3,
  inputs: { trig: 0, pitch: 0, decay: 0 },
  outputs: ['out'],
  params: {
    pitch: { min: 25, max: 150, default: 50, curve: 'exp', format: (v) => `${v.toFixed(1)} hz` },
    bend: { min: 0, max: 6, default: 3, format: (v) => `${v.toFixed(1)} oct` },
    sweep: sec(0.003, 0.3, 0.03),
    decay: sec(0.03, 3, 0.3),
    drive: { min: 1, max: 30, default: 2, curve: 'exp', format: (v) => `${v.toFixed(1)}x` },
    click: { min: 0, max: 1, default: 0.3 },
  },
  create: (sr) => ({ sr, x: seed(), phase: 0, amp: 0, bend: 0, t: 1e9, trig: false }),
  process(s, i, o, p) {
    const trig = i[0] > 1;
    if (trig && !s.trig) {
      s.amp = 1;
      s.bend = 1;
      s.phase = 0;
      s.t = 0;
    }
    s.trig = trig;
    if (s.amp < 1e-6 && s.t > s.sr) {
      o[0] = 0;
      return;
    }
    const sr = s.sr;
    const f = p[0] * Math.pow(2, i[1] + p[1] * s.bend);
    s.phase += f / sr;
    if (s.phase >= 1) s.phase -= Math.floor(s.phase);
    let x = Math.sin(TAU * s.phase);
    const clickLen = sr * 0.002;
    if (s.t < clickLen) x += white(s) * p[5] * (1 - s.t / clickLen);
    s.t++;
    o[0] = (5 * s.amp * Math.tanh(x * p[4])) / Math.tanh(p[4]);
    s.bend *= Math.exp(-1 / (p[2] * sr));
    s.amp *= Math.exp(-1 / (p[3] * Math.pow(2, i[2] / 5) * sr));
  },
};
