// White, pink and brown noise. Pink uses Paul Kellet's economy filter, brown
// is white noise through a leaky integrator (-6 dB per octave above 20 Hz, so
// it does not drift). Pink and brown are scaled to the same loudness.

import { seed, white } from './lib/dsp.js';

const BROWN_CORNER = 20; // hz
const RMS = 1.9; // volts, the level of the pink output

export default {
  name: 'noise',
  cols: 2,
  inputs: {},
  outputs: ['white', 'pink', 'brown'],
  params: {},
  create(sr) {
    // A one-pole lowpass y += c (x - y) on white noise (variance 1/3) has
    // variance c / (2 - c) / 3; the gain brings that to RMS volts.
    const c = 1 - Math.exp((-2 * Math.PI * BROWN_CORNER) / sr);
    return { x: seed(), b0: 0, b1: 0, b2: 0, br: 0, c, gain: RMS / Math.sqrt(c / (2 - c) / 3) };
  },
  process(s, i, o) {
    const w = white(s);
    s.b0 = 0.99765 * s.b0 + w * 0.099046;
    s.b1 = 0.963 * s.b1 + w * 0.2965164;
    s.b2 = 0.57 * s.b2 + w * 1.0526913;
    s.br += s.c * (w - s.br);
    o[0] = w * 5;
    o[1] = (s.b0 + s.b1 + s.b2 + w * 0.1848) * 1.1;
    o[2] = s.br * s.gain;
  },
};
