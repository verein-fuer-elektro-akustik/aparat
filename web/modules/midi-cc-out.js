const SENDS_PER_SECOND = 100;

export default {
  name: 'midi cc out',
  cols: 2,
  inputs: { in: 0 },
  outputs: ['thru'],
  params: {
    cc: { min: 0, max: 127, default: 1, step: 1, format: (v) => `cc ${v}` },
    channel: { min: 1, max: 16, default: 1, step: 1, format: (v) => `${v}` },
  },
  create: (sr, host) => ({ host, period: Math.round(sr / SENDS_PER_SECOND), wait: 0, last: -1 }),
  process(s, i, o, p) {
    o[0] = i[0];
    if (--s.wait > 0) return;
    s.wait = s.period;
    const value = Math.min(127, Math.max(0, Math.round((i[0] / 10) * 127)));
    if (value === s.last) return;
    s.last = value;
    s.host.midi(0xb0 | (p[1] - 1), p[0], value);
  },
};
