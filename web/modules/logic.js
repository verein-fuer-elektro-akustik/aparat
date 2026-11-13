// Gate logic. Inputs count as high above 1 V, outputs are 0 or 10 V.

export default {
  name: 'logic',
  cols: 2,
  inputs: { a: 0, b: 0 },
  outputs: ['and', 'or', 'xor', 'not a'],
  params: {},
  create: () => ({}),
  process(s, i, o) {
    const a = i[0] > 1;
    const b = i[1] > 1;
    o[0] = a && b ? 10 : 0;
    o[1] = a || b ? 10 : 0;
    o[2] = a !== b ? 10 : 0;
    o[3] = a ? 0 : 10;
  },
};
