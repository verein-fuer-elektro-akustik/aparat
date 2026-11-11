export default {
  name: 'midi out',
  hp: 6,
  inputs: { pitch: 0, gate: 0, vel: 8 },
  outputs: [],
  params: {
    channel: { min: 1, max: 16, default: 1, step: 1, format: (v) => `${v}` },
  },
  create: (sr, host) => ({ host, note: -1, high: false }),
  process(s, i, o, p) {
    const high = i[1] > 1;
    if (high === s.high) return;
    s.high = high;
    const ch = p[0] - 1;
    if (high) {
      const note = Math.min(127, Math.max(0, Math.round(60 + i[0] * 12)));
      const vel = Math.min(127, Math.max(1, Math.round((i[2] / 10) * 127)));
      s.note = note;
      s.host.midi(0x90 | ch, note, vel);
    } else if (s.note >= 0) {
      s.host.midi(0x80 | ch, s.note, 0);
      s.note = -1;
    }
  },
};
