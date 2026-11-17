// Low frequency oscillator. pw sets the width of the square, so it can also
// give short clock pulses.

const TAU = Math.PI * 2;

export default {
  name: 'lfo',
  cols: 2,
  inputs: { rate: 0, reset: 0 },
  outputs: ['sin', 'tri', 'saw', 'squ'],
  params: {
    rate: { min: 0.01, max: 100, default: 1, curve: 'exp', format: (v) => `${v.toFixed(2)} hz` },
    pw: { min: 0.05, max: 0.95, default: 0.5, format: (v) => `${Math.round(v * 100)}%` },
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
    o[3] = t < p[1] ? 5 : -5;
  },
};
