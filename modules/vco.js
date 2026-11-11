const TAU = Math.PI * 2;
const C4 = 261.63;

function blep(t, dt) {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

export default {
  name: 'vco',
  hp: 10,
  inputs: { pitch: 0, fm: 0, pw: 0 },
  outputs: ['sin', 'tri', 'saw', 'squ'],
  params: {
    tune: { min: -4, max: 4, default: 0, format: (v) => `${(C4 * 2 ** v).toFixed(1)} hz` },
    fm: { min: 0, max: 1, default: 0 },
    pw: { min: 0.05, max: 0.95, default: 0.5 },
  },
  create: (sr) => ({ sr, phase: 0 }),
  process(s, i, o, p) {
    let f = C4 * Math.pow(2, i[0] + p[0]) * (1 + i[1] * p[1] * 0.2);
    const limit = s.sr * 0.45;
    if (f > limit) f = limit;
    else if (f < -limit) f = -limit;
    const dt = f / s.sr;
    const adt = dt < 0 ? -dt : dt;
    let t = s.phase + dt;
    if (t >= 1) t -= 1;
    else if (t < 0) t += 1;
    s.phase = t;

    let pw = p[2] + i[2] * 0.09;
    if (pw < 0.02) pw = 0.02;
    else if (pw > 0.98) pw = 0.98;
    let edge = t - pw;
    if (edge < 0) edge += 1;
    const square = (t < pw ? 1 : -1) + blep(t, adt) - blep(edge, adt);

    o[0] = 5 * Math.sin(TAU * t);
    o[1] = 5 * (4 * Math.abs(t - 0.5) - 1);
    o[2] = 5 * (2 * t - 1 - blep(t, adt));
    o[3] = 5 * square;
  },
};
