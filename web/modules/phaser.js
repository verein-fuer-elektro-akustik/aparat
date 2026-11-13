// Phaser: four all-pass stages swept by an lfo between 200 hz and 3.2 khz,
// mixed with the dry signal. Feedback sharpens the notches.

const TAU = Math.PI * 2;

export default {
  name: 'phaser',
  cols: 3,
  inputs: { in: 0, cv: 0 },
  outputs: ['out'],
  bypass: { out: 'in' },
  params: {
    rate: { min: 0.02, max: 10, default: 0.3, curve: 'exp', format: (v) => `${v.toFixed(2)} hz` },
    depth: { min: 0, max: 1, default: 0.8 },
    fb: { min: 0, max: 0.95, default: 0.4 },
    mix: { min: 0, max: 1, default: 0.5 },
  },
  create: (sr) => ({ sr, phase: 0, z: new Float64Array(4), last: 0 }),
  process(s, i, o, p) {
    s.phase += p[0] / s.sr;
    if (s.phase >= 1) s.phase -= 1;
    // 0..4 octaves above 200 hz; the cv adds 1 octave per volt
    let oct = 2 + 2 * p[1] * Math.sin(TAU * s.phase) + i[1];
    if (oct < 0) oct = 0;
    else if (oct > 6) oct = 6;
    const t = Math.tan((Math.PI * Math.min(200 * Math.pow(2, oct), s.sr * 0.45)) / s.sr);
    const a = (t - 1) / (t + 1);
    let x = i[0] + s.last * p[2];
    const z = s.z;
    for (let k = 0; k < 4; k++) {
      const y = a * x + z[k];
      z[k] = x - a * y;
      if (z[k] < 1e-20 && z[k] > -1e-20) z[k] = 0;
      x = y;
    }
    s.last = x;
    o[0] = i[0] * (1 - p[3] * 0.5) + x * p[3] * 0.5;
  },
};
