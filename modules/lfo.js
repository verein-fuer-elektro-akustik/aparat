const TAU = Math.PI * 2;

export default {
  name: 'lfo',
  hp: 6,
  inputs: { rate: 0, reset: 0 },
  outputs: ['sin', 'tri', 'saw', 'squ'],
  params: {
    rate: { min: 0.01, max: 100, default: 1, curve: 'exp', format: (v) => `${v.toFixed(2)} hz` },
  },
  create: (sr) => ({ sr, phase: 0, high: false }),
  process(s, i, o, p) {
    const high = i[1] > 1;
    if (high && !s.high) s.phase = 0;
    s.high = high;
    let t = s.phase + (p[0] * Math.pow(2, i[0])) / s.sr;
    if (t >= 1) t -= Math.floor(t);
    s.phase = t;
    o[0] = 5 * Math.sin(TAU * t);
    o[1] = 5 * (4 * Math.abs(t - 0.5) - 1);
    o[2] = 5 * (2 * t - 1);
    o[3] = t < 0.5 ? 5 : -5;
  },
};
