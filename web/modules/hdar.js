// Delay, attack, hold, release envelope, after the second envelope of the
// Korg MS-50. A trigger starts the delay; when it is over, `dtrig` goes high
// and the attack rises to 10 V. The envelope stays there while the gate is
// held and for `hold` after it ends, then falls with the release. So even a
// short trigger gives a full envelope, and `dtrig` fires another envelope
// later. `inv` is the envelope upside down, for pitch bends.

import { pole } from './lib/dsp.js';
import { drawStages, width } from './lib/shape.js';

const time = (d) => ({ min: 0.001, max: 10, default: d, curve: 'exp', format: (v) => (v < 1 ? `${(v * 1000).toFixed(0)} ms` : `${v.toFixed(2)} s`) });

const IDLE = 0;
const DELAY = 1;
const ATTACK = 2;
const HOLD = 3;
const RELEASE = 4;

export default {
  name: 'hdar',
  doc: 'Delay, attack, hold, release envelope. A trigger starts the delay, dtrig fires when the attack begins, inv is the envelope upside down.',
  cols: 2,
  inputs: { trig: 0 },
  outputs: ['out', 'inv', 'dtrig'],
  params: { delay: time(0.3), attack: time(0.5), hold: time(0.2), release: time(0.5) },
  create: (sr) => ({ sr, stage: IDLE, t: 0, v: 0, high: false, live: new Float32Array(3), was: -1 }),
  process(s, i, o, p) {
    const high = i[0] > 1;
    if (high && !s.high) {
      s.stage = DELAY;
      s.t = 0;
    }
    s.high = high;
    const dt = 1 / s.sr;
    switch (s.stage) {
      case DELAY:
        s.t += dt;
        if (s.t >= p[0]) s.stage = ATTACK;
        break;
      case ATTACK:
        s.v += dt / p[1];
        if (s.v >= 1) {
          s.v = 1;
          s.stage = HOLD;
          s.t = 0;
        }
        break;
      case HOLD:
        // the hold time counts from the end of the gate
        if (high) s.t = 0;
        else if ((s.t += dt) >= p[2]) {
          s.stage = RELEASE;
          s.t = 0;
        }
        break;
      case RELEASE:
        s.t += dt;
        s.v -= s.v * pole(p[3] / 4, s.sr);
        if (s.v < 1e-4) {
          s.v = 0;
          s.stage = IDLE;
        }
        break;
    }
    o[0] = s.v * 10;
    o[1] = -s.v * 10;
    o[2] = s.stage === ATTACK || s.stage === HOLD ? 10 : 0;
  },
  // [stage, seconds in it (hold: since the gate ended), level], while it
  // runs and once when it stops
  display(s) {
    if (s.stage === IDLE && s.was === IDLE) return null;
    s.was = s.stage;
    s.live[0] = s.stage;
    s.live[1] = s.t;
    s.live[2] = s.v;
    return s.live;
  },
  // The shape on the panel, stage widths growing with the log of their time
  // (see lib/shape.js). The release is drawn to 1%.
  shape(p, live) {
    const [delay, attack, hold, release] = p;
    const curve = drawStages(
      [width(delay), width(attack), width(hold), width(1.15 * release)],
      [() => 0, (u) => u, () => 1, (u) => Math.exp(-u * 4.6)],
    );
    let dot = null;
    if (live && live[0] !== IDLE) {
      const [stage, secs, v] = live;
      const seg = stage - 1;
      // the attack by its level, the others by their time
      const at = stage === ATTACK ? v : secs / [delay, 0, hold, 1.15 * release][seg];
      dot = [curve.start[seg] + curve.widths[seg] * Math.min(1, at), v];
    }
    return { curve: curve.y, marks: curve.marks, dot };
  },
};
