// Bit crusher: holds the input at a lower sample rate and rounds it to fewer
// bits over the ±5 V range. The aliasing is the point. Rate input 1 V/oct,
// bits input one bit per volt.

export default {
  name: 'crush',
  cols: 2,
  inputs: { in: 0, rate: 0, bits: 0 },
  outputs: ['out'],
  bypass: { out: 'in' },
  params: {
    rate: { min: 100, max: 48000, default: 8000, curve: 'exp', format: (v) => `${Math.round(v)} hz` },
    bits: { min: 1, max: 16, default: 8, format: (v) => v.toFixed(1) },
    mix: { min: 0, max: 1, default: 1 },
  },
  create: (sr) => ({ sr, ph: 1, held: 0 }),
  process(s, i, o, p) {
    s.ph += (p[0] * Math.pow(2, i[1])) / s.sr;
    if (s.ph >= 1) {
      s.ph -= Math.floor(s.ph);
      let bits = p[1] + i[2];
      if (bits < 1) bits = 1;
      else if (bits > 16) bits = 16;
      const q = Math.pow(2, bits - 1);
      s.held = (Math.round((i[0] / 5) * q) / q) * 5;
    }
    o[0] = i[0] * (1 - p[2]) + s.held * p[2];
  },
};
