const MAX_SECONDS = 4;

export default {
  name: 'delay',
  hp: 8,
  inputs: { in: 0, time: 0, fb: 0 },
  outputs: ['out'],
  params: {
    time: { min: 0.001, max: 2, default: 0.25, curve: 'exp', format: (v) => `${v.toFixed(3)} s` },
    fb: { min: 0, max: 1.1, default: 0.4 },
    mix: { min: 0, max: 1, default: 0.3 },
  },
  create: (sr) => ({ sr, buf: new Float32Array(Math.ceil(sr * MAX_SECONDS)), w: 0 }),
  process(s, i, o, p) {
    const len = s.buf.length;
    let d = p[0] * Math.pow(2, i[1]) * s.sr;
    if (d < 1) d = 1;
    else if (d > len - 2) d = len - 2;
    let r = s.w - d;
    if (r < 0) r += len;
    const a = r | 0;
    const b = a + 1 === len ? 0 : a + 1;
    const wet = s.buf[a] + (s.buf[b] - s.buf[a]) * (r - a);
    let x = i[0] + wet * (p[1] + i[2] * 0.1);
    if (x > 15) x = 15;
    else if (x < -15) x = -15;
    s.buf[s.w] = x;
    s.w = s.w + 1 === len ? 0 : s.w + 1;
    o[0] = i[0] * (1 - p[2]) + wet * p[2];
  },
};
