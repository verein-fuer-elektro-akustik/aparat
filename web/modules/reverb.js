// Reverb after Freeverb: eight damped comb filters and four all-passes per
// side, the right side detuned for stereo. Mono in, stereo out.

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];
const SPREAD = 23;

function lines(sizes, sr, offset) {
  return sizes.map((n) => ({ buf: new Float32Array(Math.round(((n + offset) * sr) / 44100)), i: 0, store: 0 }));
}

function side(s, x, combs, alls, fb, damp) {
  let out = 0;
  for (const c of combs) {
    const y = c.buf[c.i];
    c.store = y * (1 - damp) + c.store * damp;
    c.buf[c.i] = x + c.store * fb;
    if (++c.i === c.buf.length) c.i = 0;
    out += y;
  }
  for (const a of alls) {
    const b = a.buf[a.i];
    a.buf[a.i] = out + b * 0.5;
    if (++a.i === a.buf.length) a.i = 0;
    out = b - out;
  }
  return out;
}

export default {
  name: 'reverb',
  cols: 3,
  inputs: { in: 0 },
  outputs: ['l', 'r'],
  bypass: { l: 'in', r: 'in' },
  params: {
    size: { min: 0, max: 1, default: 0.7 },
    damp: { min: 0, max: 1, default: 0.4 },
    mix: { min: 0, max: 1, default: 0.3 },
  },
  create: (sr) => ({
    combsL: lines(COMBS, sr, 0),
    combsR: lines(COMBS, sr, SPREAD),
    allsL: lines(ALLPASSES, sr, 0),
    allsR: lines(ALLPASSES, sr, SPREAD),
  }),
  process(s, i, o, p) {
    const fb = p[0] * 0.28 + 0.7;
    const damp = p[1] * 0.4;
    const x = i[0] * 0.015;
    const l = side(s, x, s.combsL, s.allsL, fb, damp);
    const r = side(s, x, s.combsR, s.allsR, fb, damp);
    o[0] = i[0] * (1 - p[2]) + l * 3 * p[2];
    o[1] = i[0] * (1 - p[2]) + r * 3 * p[2];
  },
};
