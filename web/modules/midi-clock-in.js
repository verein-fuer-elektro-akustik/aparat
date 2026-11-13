const PULSE_SECONDS = 0.002;

export default {
  name: 'midi clock in',
  cols: 3,
  inputs: {},
  outputs: ['clock', 'start', 'stop'],
  params: {},
  create: (sr) => ({ width: Math.round(sr * PULSE_SECONDS), clock: 0, start: 0, stop: 0 }),
  onMidi(s, d) {
    if (d[0] === 0xf8) s.clock = s.width;
    else if (d[0] === 0xfa || d[0] === 0xfb) s.start = s.width;
    else if (d[0] === 0xfc) s.stop = s.width;
  },
  process(s, i, o) {
    o[0] = s.clock > 0 ? 10 : 0;
    o[1] = s.start > 0 ? 10 : 0;
    o[2] = s.stop > 0 ? 10 : 0;
    if (s.clock > 0) s.clock--;
    if (s.start > 0) s.start--;
    if (s.stop > 0) s.stop--;
  },
};
