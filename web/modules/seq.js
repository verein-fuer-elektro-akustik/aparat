// Eight-step pitch sequencer. Like steps and euclid, a reset (and the start)
// arms it before step 1, and the next rising clock edge plays step 1. The
// playing step's knob is outlined on the panel.

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
  // display() returns the index of the knob to mark as current, -1 for none
  displayKnob: true,
  create: () => ({ pos: -1, clock: false, reset: false, shown: new Float32Array(1) }),
  process(s, i, o, p) {
    const clock = i[0] > 1;
    const reset = i[1] > 1;
    if (reset && !s.reset) s.pos = -1;
    const n = Math.max(1, Math.round(p[8]));
    if (clock && !s.clock) s.pos = (s.pos + 1) % n;
    else if (s.pos >= n) s.pos %= n;
    s.clock = clock;
    s.reset = reset;
    // armed (-1) holds the last step, as if a loop had just ended
    const v = p[s.pos < 0 ? n - 1 : s.pos];
    o[0] = p[9] ? Math.round(v * 12) / 12 : v;
    o[1] = clock ? 10 : 0;
  },
  display(s) {
    s.shown[0] = s.pos;
    return s.shown;
  },
};
