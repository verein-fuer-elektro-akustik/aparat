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
  hp: 6,
  inputs: { gate: 0 },
  outputs: ['out'],
  params: {
    a: time(0.005),
    d: time(0.2),
    s: { min: 0, max: 1, default: 0.3 },
    r: time(0.3),
  },
  create: (sr) => ({ sr, v: 0, stage: IDLE, gate: false, ta: 0, td: 0, tr: 0, ca: 0, cd: 0, cr: 0 }),
  process(s, i, o, p) {
    const high = i[0] > 1;
    if (high && !s.gate) s.stage = ATTACK;
    else if (!high && s.gate) s.stage = RELEASE;
    s.gate = high;

    if (p[0] !== s.ta) {
      s.ta = p[0];
      s.ca = 1 - Math.exp(-1 / (s.ta * s.sr));
    }
    if (p[1] !== s.td) {
      s.td = p[1];
      s.cd = 1 - Math.exp(-1 / (s.td * s.sr));
    }
    if (p[3] !== s.tr) {
      s.tr = p[3];
      s.cr = 1 - Math.exp(-1 / (s.tr * s.sr));
    }

    if (s.stage === ATTACK) {
      s.v += (1.2 - s.v) * s.ca;
      if (s.v >= 1) {
        s.v = 1;
        s.stage = DECAY;
      }
    } else if (s.stage === DECAY) {
      s.v += (p[2] - s.v) * s.cd;
    } else if (s.stage === RELEASE) {
      s.v -= s.v * s.cr;
      if (s.v < 1e-5) {
        s.v = 0;
        s.stage = IDLE;
      }
    }
    o[0] = s.v * 10;
  },
};
