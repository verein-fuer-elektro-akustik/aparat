// 4x4 mixing matrix with bipolar gains, meant for feedback networks.

const gain = { min: -1, max: 1, default: 0 };
const params = {};
for (const out of [1, 2, 3, 4]) {
  for (const input of ['a', 'b', 'c', 'd']) params[`${input}${out}`] = gain;
}

export default {
  name: 'matrix',
  cols: 4,
  inputs: { a: 0, b: 0, c: 0, d: 0 },
  outputs: ['1', '2', '3', '4'],
  params,
  create: () => ({}),
  process(s, i, o, p) {
    o[0] = i[0] * p[0] + i[1] * p[1] + i[2] * p[2] + i[3] * p[3];
    o[1] = i[0] * p[4] + i[1] * p[5] + i[2] * p[6] + i[3] * p[7];
    o[2] = i[0] * p[8] + i[1] * p[9] + i[2] * p[10] + i[3] * p[11];
    o[3] = i[0] * p[12] + i[1] * p[13] + i[2] * p[14] + i[3] * p[15];
  },
};
