// Plays an audio file (load one with the button on the panel, or drop it on
// the module). A trigger starts it at `start`, pitch follows 1 V/oct, `end`
// sends a pulse when the sound is over. With loop on it repeats the part
// between start and start + length. The file is kept in this browser and is
// not part of the patch, which only remembers its name.
//
// The panel shows the file's waveform, the part between start and
// start + length brighter, and the playhead while it plays.

export default {
  name: 'sampler',
  doc: 'Plays an audio file, loaded with the button or dropped on the panel. A trigger starts it, pitch follows 1 V/oct, loop repeats a part.',
  cols: 3,
  inputs: { trig: 0, pitch: 0 },
  outputs: ['out', 'end'],
  kinds: { in: { trig: 'gate', pitch: 'pitch' }, out: { end: 'gate' } },
  lights: ['end'],
  params: {
    tune: { min: -2, max: 2, default: 0, format: (v) => `${(v * 12).toFixed(1)} st` },
    start: { min: 0, max: 1, default: 0 },
    length: { min: 0.001, max: 1, default: 1 },
    level: { min: 0, max: 1, default: 0.8 },
    loop: { min: 0, max: 1, default: 0, step: 1, format: (v) => (v ? 'on' : 'off') },
  },
  file: true,
  create: (sr) => ({ sr, buf: null, rate: 1, pos: -1, high: false, pulse: 0, head: new Float32Array(1), shown: -2 }),
  // data: { samples: Float32Array (mono, -1..1), sr }
  onData(s, data) {
    s.buf = data?.samples ?? null;
    s.rate = data ? data.sr / s.sr : 1;
    s.pos = -1;
  },
  process(s, i, o, p) {
    const high = i[0] > 1;
    const buf = s.buf;
    o[1] = s.pulse > 0 ? 10 : 0;
    if (s.pulse > 0) s.pulse--;
    if (buf === null) {
      s.high = high;
      o[0] = 0;
      return;
    }
    const n = buf.length;
    const from = p[1] * (n - 1);
    let to = from + p[2] * n;
    if (to > n - 1) to = n - 1;
    if (high && !s.high) s.pos = from;
    s.high = high;
    if (s.pos < 0) {
      o[0] = 0;
      return;
    }
    if (s.pos >= to) {
      if (p[4] && to - from >= 1) {
        s.pos = from;
      } else {
        s.pos = -1;
        s.pulse = Math.round(s.sr * 0.005);
        o[0] = 0;
        return;
      }
    }
    const a = s.pos | 0;
    const x = buf[a] + (buf[a + 1 < n ? a + 1 : a] - buf[a]) * (s.pos - a);
    o[0] = x * 5 * p[3];
    let step = s.rate * Math.pow(2, i[1] + p[0]);
    if (step > 64) step = 64;
    s.pos += step;
  },
  // [playhead, 0 to 1 in the file], -1 while stopped; only when it moved
  display(s) {
    const head = s.buf && s.pos >= 0 ? s.pos / Math.max(1, s.buf.length - 1) : -1;
    if (head === s.shown) return null;
    s.shown = head;
    s.head[0] = head;
    return s.head;
  },
  // peaks: the loaded file's waveform from the panel (min, max pairs)
  shape(p, live, peaks) {
    return {
      wave: peaks,
      from: p[1],
      to: Math.min(1, p[1] + p[2]),
      head: live && live[0] >= 0 ? live[0] : null,
    };
  },
};
