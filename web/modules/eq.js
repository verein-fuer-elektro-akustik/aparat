// Four-band equaliser: a low shelf, two peaks and a high shelf, each a biquad
// from the RBJ audio EQ cookbook. The panel draws the response from the
// knobs.

const freq = (def) => ({ min: 20, max: 20000, default: def, curve: 'exp', format: (v) => (v < 1000 ? `${Math.round(v)} hz` : `${(v / 1000).toFixed(v < 10000 ? 2 : 1)} khz`) });
const gain = { min: -15, max: 15, default: 0, format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} db` };
const q = { min: 0.3, max: 8, default: 1, curve: 'exp', format: (v) => `q ${v.toFixed(2)}` };

const LOW = 0;
const PEAK = 1;
const HIGH = 2;
const TYPES = [LOW, PEAK, PEAK, HIGH];
// slope of the shelves (S = 1, as steep as they go without a bump)
const SHELF_Q = Math.SQRT1_2;

// [b0, b1, b2, a1, a2], normalised by a0
function coeffs(type, f, db, qq, sr) {
  const fc = Math.min(f, sr * 0.45);
  const A = Math.pow(10, db / 40);
  const w = (2 * Math.PI * fc) / sr;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * (type === PEAK ? qq : SHELF_Q));
  let b0, b1, b2, a0, a1, a2;
  if (type === PEAK) {
    b0 = 1 + alpha * A;
    b1 = -2 * cos;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cos;
    a2 = 1 - alpha / A;
  } else {
    const s = 2 * Math.sqrt(A) * alpha;
    const sign = type === LOW ? 1 : -1;
    b0 = A * (A + 1 - sign * (A - 1) * cos + s);
    b1 = sign * 2 * A * (A - 1 - sign * (A + 1) * cos);
    b2 = A * (A + 1 - sign * (A - 1) * cos - s);
    a0 = A + 1 + sign * (A - 1) * cos + s;
    a1 = -sign * 2 * (A - 1 + sign * (A + 1) * cos);
    a2 = A + 1 + sign * (A - 1) * cos - s;
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

// the gain in dB of a biquad at frequency f
function response(c, f, sr) {
  const w = (2 * Math.PI * f) / sr;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const nr = c[0] + c[1] * c1 + c[2] * c2;
  const ni = -(c[1] * s1 + c[2] * s2);
  const dr = 1 + c[3] * c1 + c[4] * c2;
  const di = -(c[3] * s1 + c[4] * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

// the knobs of band k: frequency, gain, q (the shelves have none)
const band = (p, k) => [p[k], p[4 + k], k === 1 ? p[8] : k === 2 ? p[9] : SHELF_Q];

const DRAW_SR = 48000;
const RANGE = 18; // dB from the middle to the top of the display
const toX = (f) => Math.log(f / 20) / Math.log(1000);

export default {
  name: 'eq',
  doc: 'Four-band equaliser: low shelf, two peaks (lo mid, hi mid) with their own width (q) and a high shelf, each ±15 dB. The panel shows the response.',
  cols: 4,
  inputs: { in: 0 },
  outputs: ['out'],
  bypass: { out: 'in' },
  params: {
    'low f': freq(100),
    'lm f': freq(400),
    'hm f': freq(2500),
    'high f': freq(8000),
    'low g': gain,
    'lm g': gain,
    'hm g': gain,
    'high g': gain,
    'lm q': q,
    'hm q': q,
  },
  create: (sr) => ({
    sr,
    // per band: the knobs the coefficients were made for, the coefficients
    // and the filter's two states
    bands: TYPES.map(() => ({ key: [NaN, NaN, NaN], c: [1, 0, 0, 0, 0], z1: 0, z2: 0 })),
  }),
  process(s, i, o, p) {
    let x = i[0];
    for (let k = 0; k < 4; k++) {
      const b = s.bands[k];
      const [f, g, qq] = band(p, k);
      if (f !== b.key[0] || g !== b.key[1] || qq !== b.key[2]) {
        b.key[0] = f;
        b.key[1] = g;
        b.key[2] = qq;
        b.c = coeffs(TYPES[k], f, g, qq, s.sr);
      }
      const c = b.c;
      // transposed direct form II
      const y = c[0] * x + b.z1;
      b.z1 = c[1] * x - c[3] * y + b.z2;
      b.z2 = c[2] * x - c[4] * y;
      x = y;
    }
    o[0] = x;
  },
  shape(p) {
    const cs = TYPES.map((t, k) => coeffs(t, ...band(p, k), DRAW_SR));
    const n = 160;
    const curve = new Float32Array(n);
    for (let j = 0; j < n; j++) {
      const f = 20 * Math.pow(1000, j / (n - 1));
      let db = 0;
      for (let k = 0; k < 4; k++) if (p[4 + k] !== 0) db += response(cs[k], f, DRAW_SR);
      curve[j] = Math.min(1, Math.max(0, 0.5 + db / (2 * RANGE)));
    }
    return { curve, marks: [0, 1, 2, 3].map((k) => toX(p[k])), lines: [0.5] };
  },
};
