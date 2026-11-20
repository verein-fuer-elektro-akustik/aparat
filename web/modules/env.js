// ADSR envelope. The panel draws its shape from the knobs, with a dot where
// it is while it runs.

import { pole } from './lib/dsp.js';
import { drawStages, width } from './lib/shape.js';

const IDLE = 0;
const ATTACK = 1;
const DECAY = 2;
const RELEASE = 3;

const time = (def) => ({
  min: 0.001,
  max: 10,
  default: def,
  curve: 'exp',
  format: (v) => `${v.toFixed(3)} s`,
});

export default {
  name: 'env',
  doc: 'ADSR envelope: rises while the gate is high, holds at sustain, falls when it ends. 0 to 10 V.',
  cols: 2,
  inputs: { gate: 0 },
  outputs: ['out'],
  params: {
    a: time(0.005),
    d: time(0.2),
    s: { min: 0, max: 1, default: 0.3 },
    r: time(0.3),
  },
  create: (sr) => ({ sr, v: 0, stage: IDLE, gate: false, ta: 0, td: 0, tr: 0, ca: 0, cd: 0, cr: 0, el: 0, live: new Float32Array(3), was: -1 }),
  process(s, i, o, p) {
    const high = i[0] > 1;
    const stage = s.stage;
    if (high && !s.gate) s.stage = ATTACK;
    else if (!high && s.gate) s.stage = RELEASE;
    s.gate = high;

    if (p[0] !== s.ta) {
      s.ta = p[0];
      s.ca = pole(s.ta, s.sr);
    }
    if (p[1] !== s.td) {
      s.td = p[1];
      s.cd = pole(s.td, s.sr);
    }
    if (p[3] !== s.tr) {
      s.tr = p[3];
      s.cr = pole(s.tr, s.sr);
    }

    if (s.stage === ATTACK) {
      s.v += (1.2 - s.v) * s.ca;
      if (s.v >= 1) {
        s.v = 1;
        s.stage = DECAY;
      }
    } else if (s.stage === DECAY) {
      s.v += (p[2] - s.v) * s.cd;
      if (s.v < 1e-20) s.v = 0; // sustain 0 would otherwise end in denormals
    } else if (s.stage === RELEASE) {
      s.v -= s.v * s.cr;
      if (s.v < 1e-5) {
        s.v = 0;
        s.stage = IDLE;
      }
    }
    // samples since the stage began, for the dot on the panel
    s.el = s.stage === stage ? s.el + 1 : 0;
    o[0] = s.v * 10;
  },
  // [stage, seconds in it, level], while it runs and once when it stops
  display(s) {
    if (s.stage === IDLE && s.was === IDLE) return null;
    s.was = s.stage;
    s.live[0] = s.stage;
    s.live[1] = s.el / s.sr;
    s.live[2] = s.v;
    return s.live;
  },
  // The shape drawn on the panel. Each stage gets a width that grows with
  // the log of its time, so 1 ms and 10 s both stay readable. The attack runs
  // towards 1.2 and stops at 1 (1.79 time constants), decay and release are
  // drawn to 1% (4.6 time constants), sustain gets a fixed width.
  shape(p, live) {
    const [a, d, sus, r] = p;
    const times = [1.79 * a, 4.6 * d, 0, 4.6 * r];
    const level = [
      (u) => Math.min(1, 1.2 * (1 - Math.exp(-u * 1.79))),
      (u) => sus + (1 - sus) * Math.exp(-u * 4.6),
      () => sus,
      (u) => sus * Math.exp(-u * 4.6),
    ];
    const widths = [width(times[0]), width(times[1]), 1.5, width(times[3])];
    const curve = drawStages(widths, level);
    let dot = null;
    if (live && live[0] !== IDLE) {
      const [stage, secs, v] = live;
      let seg;
      let at;
      if (stage === ATTACK) {
        // from the level, since a retrigger starts the attack part way up
        seg = 0;
        at = -Math.log(1 - Math.min(v, 1.19) / 1.2) / 1.79;
      } else if (stage === DECAY && secs < times[1]) {
        seg = 1;
        at = secs / times[1];
      } else if (stage === DECAY) {
        seg = 2; // sustaining
        at = 0.5;
      } else {
        seg = 3;
        at = secs / times[3];
      }
      dot = [curve.start[seg] + curve.widths[seg] * Math.min(1, at), v];
    }
    return { curve: curve.y, marks: curve.marks, dot };
  },
};

