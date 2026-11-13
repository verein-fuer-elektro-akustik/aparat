// Quantizer: snaps a 1 V/oct voltage to the nearest note of a scale. trig
// sends a short pulse whenever the output note changes.

const SCALES = [
  ['chromatic', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
  ['major', [0, 2, 4, 5, 7, 9, 11]],
  ['minor', [0, 2, 3, 5, 7, 8, 10]],
  ['dorian', [0, 2, 3, 5, 7, 9, 10]],
  ['phrygian', [0, 1, 3, 5, 7, 8, 10]],
  ['min pent', [0, 3, 5, 7, 10]],
  ['maj pent', [0, 2, 4, 7, 9]],
];
const NOTES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
// the degrees with the octave above, so notes near the top snap upwards
const DEGREES = SCALES.map(([, d]) => [...d, 12]);

function quantize(v, scale, root) {
  const degrees = DEGREES[scale];
  const semis = v * 12 - root;
  const oct = Math.floor(semis / 12);
  const within = semis - oct * 12;
  let best = 0;
  let dist = Infinity;
  for (const d of degrees) {
    const e = Math.abs(within - d);
    if (e < dist) {
      dist = e;
      best = d;
    }
  }
  return (oct * 12 + best + root) / 12;
}

export default {
  name: 'quant',
  cols: 2,
  inputs: { in: 0 },
  outputs: ['out', 'trig'],
  params: {
    scale: { min: 0, max: SCALES.length - 1, default: 2, step: 1, format: (v) => SCALES[v][0] },
    root: { min: 0, max: 11, default: 0, step: 1, format: (v) => NOTES[v] },
  },
  create: (sr) => ({ sr, last: NaN, pulse: 0 }),
  process(s, i, o, p) {
    const v = quantize(i[0], Math.round(p[0]), Math.round(p[1]));
    if (s.last !== s.last) s.last = v; // first sample: nothing changed yet
    if (v !== s.last) {
      s.last = v;
      s.pulse = Math.round(s.sr * 0.002);
    }
    o[0] = v;
    o[1] = s.pulse > 0 ? 10 : 0;
    if (s.pulse > 0) s.pulse--;
  },
};
