// Sequential switch: passes one of its inputs and steps to the next on each
// clock pulse. Like seq, a reset arms it, and the next pulse selects input 1.

export default {
  name: 'switch',
  cols: 3,
  inputs: { 1: 0, 2: 0, 3: 0, 4: 0, clock: 0, reset: 0 },
  outputs: ['out'],
  params: { steps: { min: 2, max: 4, default: 4, step: 1, format: (v) => `${v}` } },
  create: () => ({ pos: -1, clock: false, reset: false }),
  process(s, i, o, p) {
    const clock = i[4] > 1;
    const reset = i[5] > 1;
    if (reset && !s.reset) s.pos = -1;
    if (clock && !s.clock) s.pos = (s.pos + 1) % p[0];
    else if (s.pos >= p[0]) s.pos %= p[0];
    s.clock = clock;
    s.reset = reset;
    o[0] = i[s.pos < 0 ? 0 : s.pos];
  },
};
