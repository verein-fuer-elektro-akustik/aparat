// Clock divider and multiplier. The divided outputs pass every 2nd, 3rd, 4th
// and 8th clock pulse, starting with the first one after a reset. The
// multiplied outputs fit 2 or 4 pulses into the time between the last two
// clock pulses, so they follow tempo changes one pulse late.

export default {
  name: 'div',
  cols: 3,
  inputs: { clock: 0, reset: 0 },
  outputs: ['/2', '/3', '/4', '/8', 'x2', 'x4'],
  params: {},
  create: () => ({ n: -1, clock: false, reset: false, since: 0, period: 0, seen: false }),
  process(s, i, o) {
    const clock = i[0] > 1;
    const reset = i[1] > 1;
    if (reset && !s.reset) s.n = -1;
    if (clock && !s.clock) {
      s.n = (s.n + 1) % 24;
      s.period = s.seen ? s.since : 0;
      s.seen = true;
      s.since = 0;
    }
    s.clock = clock;
    s.reset = reset;
    const n = s.n;
    const on = clock && n >= 0;
    o[0] = on && n % 2 === 0 ? 10 : 0;
    o[1] = on && n % 3 === 0 ? 10 : 0;
    o[2] = on && n % 4 === 0 ? 10 : 0;
    o[3] = on && n % 8 === 0 ? 10 : 0;
    // t runs 0..1 between clock pulses, and stops when the clock does
    const t = s.period > 0 && s.since < s.period ? s.since / s.period : -1;
    o[4] = t >= 0 && (t * 2) % 1 < 0.5 ? 10 : 0;
    o[5] = t >= 0 && (t * 4) % 1 < 0.5 ? 10 : 0;
    s.since++;
  },
};
