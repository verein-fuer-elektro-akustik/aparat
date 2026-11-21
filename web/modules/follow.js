// Envelope follower, after the audio amplifier of the Korg MS-50: an outside
// sound (from the input module) is amplified, its loudness becomes a control
// voltage, and a gate is high while it is louder than `thresh`. So a voice or
// a drum can open filters and fire envelopes.

import { pole } from './lib/dsp.js';

export default {
  name: 'follow',
  doc: 'Envelope follower: the loudness of a sound becomes a voltage (env), and gate is high while it is louder than thresh.',
  cols: 2,
  inputs: { in: 0 },
  outputs: ['out', 'env', 'gate'],
  kinds: { out: { gate: 'gate' } },
  lights: ['gate'],
  params: {
    gain: { min: 0, max: 8, default: 1 },
    release: { min: 0.01, max: 2, default: 0.15, curve: 'exp', format: (v) => `${(v * 1000).toFixed(0)} ms` },
    thresh: { min: 0, max: 10, default: 2, format: (v) => `${v.toFixed(2)} v` },
  },
  create: (sr) => ({ sr, env: 0, open: false, attack: pole(0.002, sr), rel: 0, cr: 1 }),
  process(s, i, o, p) {
    const x = i[0] * p[0];
    if (p[1] !== s.rel) {
      s.rel = p[1];
      s.cr = pole(p[1], s.sr);
    }
    // a 5 V peak gives 10 V, like an envelope at full level
    const a = Math.min(Math.abs(x) * 2, 10);
    s.env += (a - s.env) * (a > s.env ? s.attack : s.cr);
    if (s.env < 1e-9) s.env = 0;
    // a little hysteresis, so a decaying sound does not chatter
    if (s.env > p[2] + 0.1) s.open = true;
    else if (s.env < p[2] * 0.7) s.open = false;
    o[0] = Math.max(-12, Math.min(12, x));
    o[1] = s.env;
    o[2] = s.open ? 10 : 0;
  },
};
