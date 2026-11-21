// A touch surface: drag on it for x and y, press is the pressure of a pen or
// finger (a mouse presses fully), gate is high while it is touched. x and y
// are kept in the patch like knobs; press is not. The page draws the surface
// and sets the three hidden parameters named in `pad`.

const unit = (v) => v.toFixed(2);

export default {
  name: 'pad',
  doc: 'A touch surface: drag on it for x and y, press follows the pressure of a pen or finger (a mouse presses fully), gate is high while it is touched. glide slows x and y down, bipolar makes them ±5 V instead of 0 to 10 V.',
  cols: 4,
  inputs: {},
  outputs: ['x', 'y', 'press', 'gate'],
  lights: ['press', 'gate'],
  params: {
    x: { min: 0, max: 1, default: 0.5, format: unit },
    y: { min: 0, max: 1, default: 0.5, format: unit },
    // stepped, so the engine sets it at once and the gate is not late
    press: { min: 0, max: 1, default: 0, step: 0.001, momentary: true, format: unit },
    glide: { min: 0, max: 2, default: 0, format: (v) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`) },
    bipolar: { min: 0, max: 1, default: 0, step: 1, format: (v) => (v ? '±5 v' : '0-10 v') },
  },
  pad: ['x', 'y', 'press'],
  displayHeight: 179,
  create: (sr) => ({ sr, x: 0.5, y: 0.5, press: 0, glide: -1, coef: 1, pressCoef: 1 - Math.exp(-1 / (0.002 * sr)) }),
  process(s, i, o, p) {
    if (p[3] !== s.glide) {
      s.glide = p[3];
      s.coef = p[3] > 0 ? 1 - Math.exp(-1 / (p[3] * s.sr)) : 1;
    }
    s.x += (p[0] - s.x) * s.coef;
    s.y += (p[1] - s.y) * s.coef;
    let pr = s.press + (p[2] - s.press) * s.pressCoef;
    if (pr < 1e-9) pr = 0;
    s.press = pr;
    const off = p[4] ? 0.5 : 0;
    o[0] = (s.x - off) * 10;
    o[1] = (s.y - off) * 10;
    o[2] = pr * 10;
    o[3] = p[2] > 0 ? 10 : 0;
  },
  shape: (p) => ({ pad: [p[0], p[1], p[2]] }),
};
