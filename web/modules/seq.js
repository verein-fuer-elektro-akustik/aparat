const step = { min: -2, max: 2, default: 0 };

export default {
  name: 'seq',
  cols: 4,
  inputs: { clock: 0, reset: 0 },
  outputs: ['pitch', 'gate'],
  params: {
    s1: step, s2: step, s3: step, s4: step,
    s5: step, s6: step, s7: step, s8: step,
    length: { min: 1, max: 8, default: 8, step: 1, format: (v) => `${v}` },
    quant: { min: 0, max: 1, default: 1, step: 1, format: (v) => (v ? 'on' : 'off') },
  },
  create: () => ({ pos: 0, clock: false, reset: false }),
  process(s, i, o, p) {
    const clock = i[0] > 1;
    const reset = i[1] > 1;
    if (reset && !s.reset) s.pos = 0;
    else if (clock && !s.clock) s.pos = (s.pos + 1) % p[8];
    if (s.pos >= p[8]) s.pos = 0;
    s.clock = clock;
    s.reset = reset;
    const v = p[s.pos];
    o[0] = p[9] ? Math.round(v * 12) / 12 : v;
    o[1] = clock ? 10 : 0;
  },
};
