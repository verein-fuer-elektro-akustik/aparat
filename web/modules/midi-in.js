const CHANNEL = { min: 0, max: 16, default: 0, step: 1, format: (v) => (v ? `${v}` : 'all') };

export default {
  name: 'midi in',
  cols: 3,
  inputs: {},
  outputs: ['pitch', 'gate', 'vel', 'mod', 'bend'],
  params: { channel: CHANNEL },
  create: () => ({ held: [], pitch: 0, gate: 0, vel: 0, mod: 0, bend: 0 }),
  onMidi(s, d, p) {
    const status = d[0] & 0xf0;
    if (d[0] >= 0xf0) return;
    if (p[0] && (d[0] & 15) + 1 !== p[0]) return;
    if (status === 0x90 && d[2] > 0) {
      s.held = s.held.filter((n) => n !== d[1]);
      s.held.push(d[1]);
      s.pitch = (d[1] - 60) / 12;
      s.vel = (d[2] / 127) * 10;
      s.gate = 10;
    } else if (status === 0x80 || status === 0x90) {
      s.held = s.held.filter((n) => n !== d[1]);
      if (s.held.length) s.pitch = (s.held[s.held.length - 1] - 60) / 12;
      else s.gate = 0;
    } else if (status === 0xb0 && d[1] === 1) {
      s.mod = (d[2] / 127) * 10;
    } else if (status === 0xe0) {
      s.bend = (((d[2] << 7) | d[1]) - 8192) / 1638.4;
    }
  },
  process(s, i, o) {
    o[0] = s.pitch;
    o[1] = s.gate;
    o[2] = s.vel;
    o[3] = s.mod;
    o[4] = s.bend;
  },
};
