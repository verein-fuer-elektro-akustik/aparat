// Level meter and tuner. Shows peak and rms level (0 db is 5 V, the level of
// an oscillator) and the pitch, measured between upward zero crossings, which
// is right for plain waveforms and jumps around on noisy or chord-like ones.
// The numbers change 8 times a second, so they can be read; the bar below
// them follows every frame, falling back like a hardware meter, with the
// highest peak of the last moments held as a tick.

const NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const db = (v) => (v > 1e-4 ? `${(20 * Math.log10(v / 5)).toFixed(1)} db` : '-inf db');
const toDb = (v) => (v > 1e-6 ? 20 * Math.log10(v / 5) : -120);

// the bar: its range, how fast it falls, how long a peak stays held
export const BAR_MIN = -60;
export const BAR_MAX = 6;
const FALL = 24; // db per second
const RMS_TIME = 0.3; // seconds
const HOLD = 1.5; // seconds
const bar = (d) => Math.min(1, Math.max(0, (d - BAR_MIN) / (BAR_MAX - BAR_MIN)));

export default {
  name: 'meter',
  doc: 'Level meter and tuner: peak and rms level and the pitch of a signal.',
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
    shown: new Float32Array(6),
    // since the last frame: samples, loudest, sum of squares
    fn: 0,
    fpeak: 0,
    fsum: 0,
    // the bar, in db
    peakDb: -120,
    rmsDb: -120,
    holdDb: -120,
    held: 0,
  }),
  process(s, i, o) {
    const v = i[0];
    o[0] = v;
    const a = v < 0 ? -v : v;
    if (a > s.peak) s.peak = a;
    s.sum += v * v;
    s.fn++;
    if (a > s.fpeak) s.fpeak = a;
    s.fsum += v * v;
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
    s.n = 0;
    s.peak = 0;
    s.sum = 0;
    s.crossings = 0;
  },
  // every frame: [peak, rms, pitch] of the last eighth of a second, then the
  // bar's peak, rms and held peak in db
  display(s) {
    const dt = s.fn / s.sr;
    if (dt > 0) {
      s.peakDb = Math.max(toDb(s.fpeak), s.peakDb - FALL * dt);
      const target = toDb(Math.sqrt(s.fsum / s.fn));
      s.rmsDb += (target - s.rmsDb) * (1 - Math.exp(-dt / RMS_TIME));
      s.held += dt;
      // a new high is held; after a while the tick falls with the bar
      if (s.peakDb >= s.holdDb) {
        s.holdDb = s.peakDb;
        s.held = 0;
      } else if (s.held > HOLD) {
        s.holdDb = s.peakDb;
      }
    }
    s.fn = 0;
    s.fpeak = 0;
    s.fsum = 0;
    s.shown[3] = s.peakDb;
    s.shown[4] = s.rmsDb;
    s.shown[5] = s.holdDb;
    return s.shown;
  },
  // the bar under the text, 0 to 1 from the left, with the scale's marks
  displayMeter: (d) => ({ peak: bar(d[3]), rms: bar(d[4]), hold: d[5] > BAR_MIN ? bar(d[5]) : null, marks: [-48, -36, -24, -12, 0].map((m) => [bar(m), m]) }),
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
