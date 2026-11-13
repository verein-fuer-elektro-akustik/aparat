// Sends a note while the gate is high. The note off goes out on the channel
// the note was sent on, also if the channel is changed while it is held.

function noteOff(s) {
  if (s.note < 0) return;
  s.host.midi(0x80 | s.ch, s.note, 0);
  s.note = -1;
}

export default {
  name: 'midi out',
  cols: 3,
  inputs: { pitch: 0, gate: 0, vel: 8 },
  outputs: ['pitch', 'gate', 'vel'],
  params: {
    channel: { min: 1, max: 16, default: 1, step: 1, format: (v) => `${v}` },
  },
  create: (sr, host) => ({ host, note: -1, ch: 0, high: false }),
  process(s, i, o, p) {
    o[0] = i[0];
    o[1] = i[1];
    o[2] = i[2];
    const high = i[1] > 1;
    if (high === s.high) return;
    s.high = high;
    if (high) {
      const note = Math.min(127, Math.max(0, Math.round(60 + i[0] * 12)));
      const vel = Math.min(127, Math.max(1, Math.round((i[2] / 10) * 127)));
      s.note = note;
      s.ch = p[0] - 1;
      s.host.midi(0x90 | s.ch, note, vel);
    } else {
      noteOff(s);
    }
  },
  // removed while a note is held
  destroy: noteOff,
};
