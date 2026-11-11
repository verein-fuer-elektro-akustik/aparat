// Sound card input. The UI asks for microphone access when this is added.

export default {
  name: 'input',
  hp: 6,
  inputs: {},
  outputs: ['1', '2', '3', '4'],
  params: {
    first: { min: 1, max: 29, default: 1, step: 1, format: (v) => `${v}-${v + 3}` },
    gain: { min: 0, max: 4, default: 1 },
  },
  create: (sr, host) => ({ host }),
  process(s, i, o, p) {
    const at = p[0] - 1;
    const scale = 5 * p[1];
    const input = s.host.in;
    o[0] = input[at] * scale;
    o[1] = input[at + 1] * scale;
    o[2] = input[at + 2] * scale;
    o[3] = input[at + 3] * scale;
  },
};
