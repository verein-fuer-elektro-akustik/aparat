// Lorenz attractor as a modulation or audio source.

export default {
  name: 'chaos',
  hp: 6,
  inputs: { rate: 0 },
  outputs: ['x', 'y', 'z'],
  params: {
    rate: { min: 0.1, max: 2000, default: 20, curve: 'exp' },
    rho: { min: 20, max: 40, default: 28 },
  },
  create: (sr) => ({ sr, x: 0.1, y: 0, z: 20 }),
  process(s, i, o, p) {
    let dt = (p[0] * Math.pow(2, i[0])) / (s.sr * 100);
    if (dt > 0.01) dt = 0.01;
    const dx = 10 * (s.y - s.x);
    const dy = s.x * (p[1] - s.z) - s.y;
    const dz = s.x * s.y - (8 / 3) * s.z;
    s.x += dx * dt;
    s.y += dy * dt;
    s.z += dz * dt;
    o[0] = s.x * 0.25;
    o[1] = s.y * 0.2;
    o[2] = (s.z - 25) * 0.2;
  },
};
