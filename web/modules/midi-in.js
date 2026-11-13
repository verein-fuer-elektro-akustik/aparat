// Notes from midi (or the computer keyboard) as pitch, gate and velocity.
//
// One module plays one note at a time; with several keys down the last one
// sounds. For chords, use one module per voice and set `of` to the number of
// voices and `voice` to 1, 2, 3...: each module then plays one of the held
// notes. The modules of a group (same channel, same `of`) share one note
// allocation, kept here.

const CHANNEL = { min: 0, max: 16, default: 0, step: 1, format: (v) => (v ? `${v}` : 'all') };
const VOICE = { min: 1, max: 8, default: 1, step: 1, format: (v) => `${v}` };

// Which voice a note goes to: the one already playing that note, else the one
// released longest ago, else the one that has played longest. Every module of
// the group gets the same midi message (the same array), so the first to see
// it decides and the others read the result.
const groups = new Map();

function allocate(key, n, d, on) {
  let g = groups.get(key);
  if (!g) {
    g = { voices: Array.from({ length: 8 }, () => ({ note: -1, on: false, t: 0 })), count: 0, last: null, voice: -1 };
    groups.set(key, g);
  }
  if (g.last === d) return g.voice;
  g.last = d;
  const list = g.voices;
  let at = -1;
  if (on) {
    for (let k = 0; k < n; k++) if (list[k].on && list[k].note === d[1]) at = k;
    if (at < 0) {
      for (let k = 0; k < n; k++) {
        if (!list[k].on && (at < 0 || list[k].t < list[at].t)) at = k;
      }
    }
    if (at < 0) {
      at = 0;
      for (let k = 1; k < n; k++) if (list[k].t < list[at].t) at = k;
    }
    list[at].note = d[1];
    list[at].on = true;
    list[at].t = ++g.count;
  } else {
    for (let k = 0; k < 8; k++) {
      if (list[k].on && list[k].note === d[1]) {
        list[k].on = false;
        list[k].t = ++g.count;
        at = k;
      }
    }
  }
  g.voice = at;
  return at;
}

export default {
  name: 'midi in',
  cols: 3,
  inputs: {},
  outputs: ['pitch', 'gate', 'vel', 'mod', 'bend'],
  params: { channel: CHANNEL, voice: VOICE, of: VOICE },
  create: () => ({ held: [], pitch: 0, gate: 0, vel: 0, mod: 0, bend: 0, retrig: false }),
  onMidi(s, d, p) {
    const status = d[0] & 0xf0;
    if (d[0] >= 0xf0) return;
    if (p[0] && (d[0] & 15) + 1 !== p[0]) return;
    const on = status === 0x90 && d[2] > 0;
    if (on || status === 0x80 || status === 0x90) {
      if (p[2] > 1) {
        const voice = allocate(`${p[0]}:${p[2]}`, p[2], d, on);
        if (voice !== p[1] - 1) return;
        if (on) {
          s.retrig = s.gate > 0;
          s.pitch = (d[1] - 60) / 12;
          s.vel = (d[2] / 127) * 10;
          s.gate = 10;
        } else {
          s.gate = 0;
        }
        return;
      }
      s.held = s.held.filter((n) => n !== d[1]);
      if (on) {
        s.held.push(d[1]);
        s.pitch = (d[1] - 60) / 12;
        s.vel = (d[2] / 127) * 10;
        s.gate = 10;
      } else if (s.held.length) {
        s.pitch = (s.held[s.held.length - 1] - 60) / 12;
      } else {
        s.gate = 0;
      }
    } else if (status === 0xb0 && d[1] === 1) {
      s.mod = (d[2] / 127) * 10;
    } else if (status === 0xe0) {
      s.bend = (((d[2] << 7) | d[1]) - 8192) / 1638.4;
    }
  },
  process(s, i, o) {
    o[0] = s.pitch;
    // a stolen voice drops its gate for one sample, so envelopes restart
    o[1] = s.retrig ? 0 : s.gate;
    s.retrig = false;
    o[2] = s.vel;
    o[3] = s.mod;
    o[4] = s.bend;
  },
};
