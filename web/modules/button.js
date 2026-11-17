// A push button: the gate is high while the button is held down, `trig` is a
// short pulse when it is pressed. For firing envelopes by hand, like the
// trigger switch of the Korg MS-50. The button is not stored in the patch.

export default {
  name: 'button',
  cols: 2,
  inputs: {},
  outputs: ['gate', 'trig'],
  params: { push: { min: 0, max: 1, default: 0, step: 1, momentary: true, format: (v) => (v ? 'on' : 'off') } },
  create: (sr) => ({ pulse: Math.round(sr * 0.005), left: 0, high: false }),
  process(s, i, o, p) {
    const high = p[0] === 1;
    if (high && !s.high) s.left = s.pulse;
    s.high = high;
    o[0] = high ? 10 : 0;
    o[1] = s.left > 0 ? 10 : 0;
    if (s.left > 0) s.left--;
  },
};
