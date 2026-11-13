// Trapezoidal state variable filter.

export default {
  name: 'vcf',
  cols: 3,
  inputs: { in: 0, cutoff: 0, res: 0 },
  outputs: ['lp', 'bp', 'hp'],
  bypass: { lp: 'in', bp: 'in', hp: 'in' },
  params: {
    cutoff: { min: 20, max: 20000, default: 800, curve: 'exp', format: (v) => `${Math.round(v)} hz` },
    res: { min: 0, max: 1, default: 0.3 },
    cv: { min: 0, max: 1, default: 0.5 },
  },
  create: (sr) => ({ sr, ic1: 0, ic2: 0 }),
  process(s, i, o, p) {
    let f = p[0] * Math.pow(2, i[1] * p[2]);
    if (f < 10) f = 10;
    else if (f > s.sr * 0.45) f = s.sr * 0.45;
    let res = p[1] + i[2] * 0.1;
    if (res < 0) res = 0;
    else if (res > 1) res = 1;
    const k = 2 - 1.98 * res;
    const g = Math.tan((Math.PI * f) / s.sr);
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = i[0] - s.ic2;
    const v1 = a1 * s.ic1 + a2 * v3;
    const v2 = s.ic2 + a2 * s.ic1 + a3 * v3;
    s.ic1 = 2 * v1 - s.ic1;
    s.ic2 = 2 * v2 - s.ic2;
    if (s.ic1 < 1e-20 && s.ic1 > -1e-20) s.ic1 = 0;
    if (s.ic2 < 1e-20 && s.ic2 > -1e-20) s.ic2 = 0;
    o[0] = v2;
    o[1] = v1;
    o[2] = i[0] - k * v1 - v2;
  },
};
