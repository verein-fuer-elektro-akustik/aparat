export default {
  name: 'fold',
  hp: 6,
  inputs: { in: 0, drive: 0 },
  outputs: ['out'],
  params: {
    drive: { min: 0.1, max: 8, default: 1 },
    bias: { min: -1, max: 1, default: 0 },
  },
  create: () => ({}),
  process(s, i, o, p) {
    let drive = p[0] + i[1] * 0.5;
    if (drive < 0) drive = 0;
    o[0] = 5 * Math.sin(((i[0] / 5) * drive + p[1]) * (Math.PI / 2));
  },
};
