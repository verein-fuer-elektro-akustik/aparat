// The camera as control voltages. The page reads the camera (it only exists
// there, see ui/camera.js) and sends onCamera(s, values, p) for each video
// frame: brightness, motion, where the motion is (x, y; NaN when nothing
// moves) and the motion in each of 3×3 zones, from the top left. The panel
// shows the camera's picture as the page sees it.

import { pole } from './lib/dsp.js';

const ZONES = 9;
const OUTPUTS = ['bright', 'motion', 'x', 'y', 'gate', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const MOTION = 1;
const GATE = 4;
const SCALE = 100; // a hand waved across the picture is a few volts at gain 1

export default {
  name: 'camera',
  doc: 'The camera as control voltages: bright is how light the picture is, motion how much moves, x and y where it moves, gate is high while motion is above thresh, and 1 to 9 are the motion in each of 3×3 zones, from the top left. gain sets how much motion makes how many volts, smooth slows everything down, mirror flips left and right like a mirror. The camera only runs while audio is on.',
  cols: 4,
  inputs: {},
  outputs: OUTPUTS,
  lights: ['motion', 'gate', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
  params: {
    gain: { min: 0.1, max: 10, default: 1, curve: 'exp', format: (v) => `${v.toFixed(2)}x` },
    thresh: { min: 0.1, max: 10, default: 1, curve: 'exp', format: (v) => `${v.toFixed(2)} v` },
    smooth: { min: 0.005, max: 2, default: 0.05, curve: 'exp', format: (v) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`) },
    mirror: { min: 0, max: 1, default: 1, step: 1, format: (v) => (v ? 'on' : 'off') },
  },
  displayHeight: 112,
  create: (sr) => ({
    sr,
    raw: null,
    x: 0.5,
    y: 0.5,
    target: new Float64Array(OUTPUTS.length),
    v: new Float64Array(OUTPUTS.length),
    smooth: -1,
    coef: 1,
    gate: false,
    dirty: false,
  }),
  onCamera(s, values) {
    s.raw = values;
    s.dirty = true;
  },
  process(s, i, o, p) {
    const [gain, thresh, smooth, mirror] = p;
    if (smooth !== s.smooth) {
      s.smooth = smooth;
      s.coef = pole(smooth, s.sr);
    }
    // a new frame: the voltages it asks for (the knobs apply from the next one)
    if (s.dirty) {
      s.dirty = false;
      const r = s.raw;
      const t = s.target;
      t[0] = r[0] * 10;
      t[1] = Math.min(10, r[1] * gain * SCALE);
      if (r[2] === r[2]) s.x = mirror ? 1 - r[2] : r[2];
      if (r[3] === r[3]) s.y = r[3];
      t[2] = s.x * 10;
      t[3] = s.y * 10;
      for (let z = 0; z < ZONES; z++) {
        const col = z % 3;
        const from = mirror ? z - col + (2 - col) : z;
        t[5 + z] = Math.min(10, r[4 + from] * gain * SCALE);
      }
    }
    const { v, target, coef } = s;
    for (let k = 0; k < OUTPUTS.length; k++) {
      if (k === GATE) continue;
      let x = v[k] + (target[k] - v[k]) * coef;
      if (x < 1e-20 && x > -1e-20) x = 0;
      v[k] = x;
      o[k] = x;
    }
    // with a little hysteresis, so it does not chatter at the threshold
    const m = v[MOTION];
    if (m > thresh) s.gate = true;
    else if (m < thresh * 0.7) s.gate = false;
    o[GATE] = s.gate ? 10 : 0;
  },
  // the picture the page hands the panel ({luma, diff}), flipped like the
  // voltages; without one, a note why it is dark
  shape: (p, live) => ({ image: live, mirror: p[3] === 1 }),
};
