// Level meter and tuner. Shows peak and rms level (0 db is 5 V, the level of
// an oscillator) and the pitch, measured between upward zero crossings, which
// is right for plain waveforms and jumps around on noisy or chord-like ones.

const NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const db = (v) => (v > 1e-4 ? `${(20 * Math.log10(v / 5)).toFixed(1)} db` : '-inf db');

export default {
  name: 'meter',
  cols: 3,
  inputs: { in: 0 },
  outputs: ['thru'],
  params: {},
  create: (sr) => ({
    sr,
    window: Math.round(sr / 8),
    n: 0,
    peak: 0,
    sum: 0,
    prev: 0,
    first: 0,
    last: 0,
    crossings: 0,
    shown: new Float32Array(3),
    fresh: false,
  }),
  process(s, i, o) {
    const v = i[0];
    o[0] = v;
    const a = v < 0 ? -v : v;
    if (a > s.peak) s.peak = a;
    s.sum += v * v;
    if (s.prev <= 0 && v > 0) {
      // where between the two samples the signal crossed zero
      const at = s.n - v / (v - s.prev);
      if (s.crossings === 0) s.first = at;
      s.last = at;
      s.crossings++;
    }
    s.prev = v;
    if (++s.n < s.window) return;
    s.shown[0] = s.peak;
    s.shown[1] = Math.sqrt(s.sum / s.n);
    s.shown[2] = s.crossings > 1 ? ((s.crossings - 1) * s.sr) / (s.last - s.first) : 0;
    s.fresh = true;
    s.n = 0;
    s.peak = 0;
    s.sum = 0;
    s.crossings = 0;
  },
  display(s) {
    if (!s.fresh) return null;
    s.fresh = false;
    return s.shown;
  },
  // the lines shown on the panel for what display() returned
  displayText(d) {
    const f = d[2];
    if (!(f > 0) || d[1] < 1e-3) return [`peak ${db(d[0])}`, `rms  ${db(d[1])}`, '', ''];
    const midi = 69 + 12 * Math.log2(f / 440);
    const near = Math.round(midi);
    const cents = Math.round((midi - near) * 100);
    const name = `${NAMES[((near % 12) + 12) % 12]}${Math.floor(near / 12) - 1}`;
    return [
      `peak ${db(d[0])}`,
      `rms  ${db(d[1])}`,
      `${name} ${cents < 0 ? '' : '+'}${cents} ct`,
      `${f < 100 ? f.toFixed(2) : f.toFixed(1)} hz`,
    ];
  },
};
