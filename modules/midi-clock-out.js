export default {
  name: 'midi clock out',
  hp: 6,
  inputs: { clock: 0, start: 0, stop: 0 },
  outputs: [],
  params: {},
  create: (sr, host) => ({ host, clock: false, start: false, stop: false }),
  process(s, i) {
    const clock = i[0] > 1;
    const start = i[1] > 1;
    const stop = i[2] > 1;
    if (start && !s.start) s.host.midi(0xfa, 0, 0);
    if (stop && !s.stop) s.host.midi(0xfc, 0, 0);
    if (clock && !s.clock) s.host.midi(0xf8, 0, 0);
    s.clock = clock;
    s.start = start;
    s.stop = stop;
  },
};
