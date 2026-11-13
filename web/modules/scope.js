const POINTS = 256;

export default {
  name: 'scope',
  cols: 4,
  inputs: { in: 0 },
  outputs: ['thru'],
  params: {
    time: { min: 0.002, max: 2, default: 0.02, curve: 'exp', format: (v) => `${(v * 1000).toFixed(1)} ms` },
  },
  create: (sr) => ({
    sr,
    write: new Float32Array(POINTS),
    shown: new Float32Array(POINTS),
    fresh: false,
    n: POINTS,
    acc: 0,
    waited: 0,
    prev: 0,
  }),
  process(s, i, o, p) {
    const v = i[0];
    o[0] = v;
    if (s.n >= POINTS) {
      s.waited++;
      if ((s.prev <= 0 && v > 0) || s.waited > s.sr * 0.1) {
        s.n = 0;
        s.acc = 0;
        s.waited = 0;
      }
    }
    s.prev = v;
    if (s.n < POINTS) {
      s.acc += POINTS / (p[0] * s.sr);
      if (s.acc >= 1) {
        s.acc -= Math.floor(s.acc);
        s.write[s.n++] = v;
        if (s.n === POINTS) {
          s.shown.set(s.write);
          s.fresh = true;
        }
      }
    }
  },
  display(s) {
    if (!s.fresh) return null;
    s.fresh = false;
    return s.shown;
  },
};
