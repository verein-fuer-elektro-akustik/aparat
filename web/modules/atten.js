// Two attenuverters: out = in * gain + offset. With nothing patched in, the
// offset alone makes a constant voltage.

const gain = { min: -1, max: 1, default: 1 };
const offset = { min: -10, max: 10, default: 0, format: (v) => `${v.toFixed(2)} v` };

export default {
  name: 'atten',
  cols: 2,
  inputs: { 1: 0, 2: 0 },
  outputs: ['1', '2'],
  params: { gain1: gain, gain2: gain, offset1: offset, offset2: offset },
  create: () => ({}),
  process(s, i, o, p) {
    o[0] = i[0] * p[0] + p[2];
    o[1] = i[1] * p[1] + p[3];
  },
};
