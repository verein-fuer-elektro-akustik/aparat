// Chorus: two delay lines swept by an lfo, a quarter cycle apart for the two
// sides. Mono in, stereo out.

const TAU = Math.PI * 2;
const BASE = 0.012; // seconds
const SWEEP = 0.006;

export default {
  name: 'chorus',
  cols: 3,
  inputs: { in: 0 },
  outputs: ['l', 'r'],
  bypass: { l: 'in', r: 'in' },
  params: {
    rate: { min: 0.05, max: 8, default: 0.6, curve: 'exp', format: (v) => `${v.toFixed(2)} hz` },
    depth: { min: 0, max: 1, default: 0.5 },
    mix: { min: 0, max: 1, default: 0.5 },
  },
  create: (sr) => ({ sr, buf: new Float32Array(Math.ceil(sr * 0.05)), w: 0, phase: 0 }),
  process(s, i, o, p) {
    const { buf } = s;
    const len = buf.length;
    buf[s.w] = i[0];
    s.phase += p[0] / s.sr;
    if (s.phase >= 1) s.phase -= 1;
    for (let k = 0; k < 2; k++) {
      const d = (BASE + SWEEP * p[1] * Math.sin(TAU * (s.phase + k * 0.25))) * s.sr;
      let r = s.w - d;
      if (r < 0) r += len;
      const a = r | 0;
      const b = a + 1 === len ? 0 : a + 1;
      const wet = buf[a] + (buf[b] - buf[a]) * (r - a);
      o[k] = i[0] * (1 - p[2] * 0.5) + wet * p[2];
    }
    s.w = s.w + 1 === len ? 0 : s.w + 1;
  },
};
