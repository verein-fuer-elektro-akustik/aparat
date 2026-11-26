// Four channel strips with a fader, mute and solo each, and a master fader.
// Mute and solo fade over a few milliseconds, so switching them does not
// click. While any channel is soloed, only the soloed ones are heard.

const FADE = 0.005; // seconds
const level = { min: 0, max: 1, default: 0.8, fader: true };
const onOff = (label) => ({ min: 0, max: 1, default: 0, step: 1, label, format: (v) => (v ? 'on' : 'off') });
const CH = ['a', 'b', 'c', 'd'];

export default {
  name: 'mixer',
  doc: 'Four channel mixer with faders, mute and solo, and a master fader, for audio and control voltages.',
  cols: 5,
  inputs: { a: 0, b: 0, c: 0, d: 0 },
  outputs: ['out'],
  // the levels first, so patches from before mute and solo keep their values
  params: {
    a: level, b: level, c: level, d: level,
    master: { min: 0, max: 1, default: 1, fader: true },
    ...Object.fromEntries(CH.map((c) => [`mute ${c}`, onOff('M')])),
    ...Object.fromEntries(CH.map((c) => [`solo ${c}`, onOff('S')])),
  },
  strips: [...CH.map((c) => [`mute ${c}`, `solo ${c}`, c]), [null, null, 'master']],
  create: (sr) => ({ g: new Float32Array(4).fill(1), k: 1 - Math.exp(-1 / (FADE * sr)) }),
  process(s, i, o, p) {
    const solo = p[9] + p[10] + p[11] + p[12] > 0;
    const g = s.g;
    let sum = 0;
    for (let c = 0; c < 4; c++) {
      const on = p[5 + c] === 0 && (!solo || p[9 + c] === 1) ? 1 : 0;
      g[c] += (on - g[c]) * s.k;
      sum += i[c] * p[c] * g[c];
    }
    o[0] = sum * p[4];
  },
};
