// Four Euclidean rhythm tracks: each spreads `hits` as evenly as possible over
// `len` steps, rotated by `rot`. Every track has its own length, so tracks can
// run polymetric. A gate goes out while the clock is high on a hit step.
//
// Techno at 16 steps: 4 hits = four on the floor, 4 hits rot 2 = offbeats,
// 2 hits rot 4 = backbeat, 12 hits rot 15 = the gaps between the kicks.
//
// h1-h4 add hits: 10 V adds a full track length, so slow CV makes patterns
// thin out and fill up over time.

const len = { min: 1, max: 32, default: 16, step: 1, format: (v) => `${v}` };
const hits = { min: 0, max: 32, default: 4, step: 1, format: (v) => `${v}` };
const rot = { min: 0, max: 31, default: 0, step: 1, format: (v) => `${v}` };

function euclidHit(step, n, h, r) {
  if (h <= 0) return false;
  if (h > n) h = n;
  const idx = (((step - r) % n) + n) % n;
  return (idx * h) % n < h;
}

export default {
  name: 'euclid',
  doc: 'Four euclidean rhythms: hits spread evenly over len steps, rotated by rot. Different lengths run polymetric.',
  cols: 4,
  inputs: { clock: 0, reset: 0, h1: 0, h2: 0, h3: 0, h4: 0 },
  outputs: ['1', '2', '3', '4'],
  kinds: { in: { clock: 'gate', reset: 'gate' }, out: { '1': 'gate', '2': 'gate', '3': 'gate', '4': 'gate' } },
  lights: ['1', '2', '3', '4'],
  params: {
    len1: len, len2: len, len3: len, len4: len,
    hits1: hits, hits2: hits, hits3: hits, hits4: hits,
    rot1: rot, rot2: rot, rot3: rot, rot4: rot,
  },
  displayHeight: 56,
  create: () => ({
    pos: new Int32Array(4).fill(-1),
    clock: false,
    reset: false,
    // what the display shows: length, hits, rotation and gate per track
    n: new Int32Array(4),
    h: new Int32Array(4),
    r: new Int32Array(4),
    on: new Uint8Array(4),
    shown: '',
  }),
  process(s, i, o, p) {
    const clock = i[0] > 1;
    const reset = i[1] > 1;
    if (reset && !s.reset) s.pos.fill(-1);
    const edge = clock && !s.clock;
    s.clock = clock;
    s.reset = reset;
    for (let t = 0; t < 4; t++) {
      const n = Math.max(1, Math.round(p[t]));
      let pos = s.pos[t];
      if (edge) pos = (pos + 1) % n;
      else if (pos >= n) pos %= n;
      s.pos[t] = pos;
      const h = Math.round(p[4 + t] + (i[2 + t] / 10) * n);
      const r = Math.round(p[8 + t]);
      const on = clock && pos >= 0 && euclidHit(pos, n, h, r);
      o[t] = on ? 10 : 0;
      s.n[t] = n;
      s.h[t] = h;
      s.r[t] = r;
      s.on[t] = on ? 1 : 0;
    }
  },
  // one row of steps per track: 1 = hit, 2 = the current step, 4 = its gate
  // is high. Only sent when something changed.
  display(s) {
    const key = `${s.pos}|${s.n}|${s.h}|${s.r}|${s.on}`;
    if (key === s.shown) return null;
    s.shown = key;
    const steps = [];
    for (let t = 0; t < 4; t++) {
      const row = new Uint8Array(s.n[t]);
      for (let k = 0; k < row.length; k++) {
        row[k] = (euclidHit(k, s.n[t], s.h[t], s.r[t]) ? 1 : 0) | (k === s.pos[t] ? 2 | (s.on[t] ? 4 : 0) : 0);
      }
      steps.push(row);
    }
    return { steps };
  },
};
