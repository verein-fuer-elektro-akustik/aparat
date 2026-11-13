// Trigger sequencer: 16 on/off steps in four rows of four. Every rising clock
// edge moves one step; on a lit step the gate is high while the clock is.
// `len` shortens the loop, `end` is high on the last step (chain or reset
// other sequencers with it). The current step is outlined on the panel.

const toggle = { min: 0, max: 1, default: 0, step: 1, format: (v) => (v ? 'on' : 'off') };
const on = { ...toggle, default: 1 };

const params = {};
for (let k = 1; k <= 16; k++) params[`s${k}`] = k % 4 === 1 ? on : toggle;
params.len = { min: 1, max: 16, default: 16, step: 1, format: (v) => `${v}` };

export default {
  name: 'steps',
  cols: 4,
  inputs: { clock: 0, reset: 0 },
  outputs: ['gate', 'end'],
  params,
  // display() returns the index of the knob to mark as current, -1 for none
  displayKnob: true,
  create: () => ({ pos: -1, clock: false, reset: false, shown: new Float32Array(1) }),
  process(s, i, o, p) {
    const clock = i[0] > 1;
    const reset = i[1] > 1;
    if (reset && !s.reset) s.pos = -1;
    const n = Math.max(1, Math.round(p[16]));
    if (clock && !s.clock) s.pos = (s.pos + 1) % n;
    else if (s.pos >= n) s.pos %= n;
    s.clock = clock;
    s.reset = reset;
    const at = s.pos;
    o[0] = clock && at >= 0 && p[at] > 0.5 ? 10 : 0;
    o[1] = clock && at === n - 1 ? 10 : 0;
  },
  display(s) {
    s.shown[0] = s.pos;
    return s.shown;
  },
};
