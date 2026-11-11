// Records its input into a ring and replays short overlapping windows of it.

const SECONDS = 4;
const GRAINS = 16;
const WINDOW = 256;

const hann = new Float32Array(WINDOW + 1);
for (let n = 0; n <= WINDOW; n++) hann[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / WINDOW);

export default {
  name: 'granular',
  hp: 12,
  knobCols: 3,
  inputs: { in: 0, pos: 0, pitch: 0 },
  outputs: ['out'],
  params: {
    density: { min: 1, max: 200, default: 20, curve: 'exp', format: (v) => `${v.toFixed(1)} hz` },
    size: { min: 0.005, max: 0.5, default: 0.08, curve: 'exp', format: (v) => `${v.toFixed(3)} s` },
    pos: { min: 0, max: 1, default: 0.2 },
    spread: { min: 0, max: 1, default: 0.1 },
    pitch: { min: -2, max: 2, default: 0 },
    mix: { min: 0, max: 1, default: 0.7 },
  },
  create(sr) {
    return {
      sr,
      buf: new Float32Array(Math.ceil(sr * SECONDS)),
      w: 0,
      wait: 0,
      read: new Float64Array(GRAINS),
      inc: new Float64Array(GRAINS),
      age: new Float64Array(GRAINS),
      span: new Float64Array(GRAINS),
    };
  },
  process(s, i, o, p) {
    const len = s.buf.length;
    s.buf[s.w] = i[0];
    s.w = s.w + 1 === len ? 0 : s.w + 1;

    if (--s.wait <= 0) {
      s.wait = s.sr / p[0];
      for (let g = 0; g < GRAINS; g++) {
        if (s.span[g] !== 0) continue;
        const inc = Math.pow(2, p[4] + i[2]);
        const span = p[1] * s.sr;
        // keep clear of the write head, also when the grain plays faster than time
        const room = span * Math.max(inc, 1) + 2;
        let back = (p[2] + i[1] * 0.1 + (Math.random() - 0.5) * p[3]) * (len - room * 2);
        if (back < 0) back = 0;
        back += room;
        if (back > len - 2) back = len - 2;
        let at = s.w - back;
        if (at < 0) at += len;
        s.read[g] = at;
        s.inc[g] = inc;
        s.age[g] = 0;
        s.span[g] = span;
        break;
      }
    }

    let sum = 0;
    for (let g = 0; g < GRAINS; g++) {
      const span = s.span[g];
      if (span === 0) continue;
      const r = s.read[g];
      const a = r | 0;
      const b = a + 1 >= len ? 0 : a + 1;
      const v = s.buf[a] + (s.buf[b] - s.buf[a]) * (r - a);
      sum += v * hann[((s.age[g] / span) * WINDOW) | 0];
      let next = r + s.inc[g];
      if (next >= len) next -= len;
      s.read[g] = next;
      s.age[g] += 1;
      if (s.age[g] >= span) s.span[g] = 0;
    }
    o[0] = i[0] * (1 - p[5]) + sum * 0.5 * p[5];
  },
};
