import vco from './vco.js';
import lfo from './lfo.js';
import noise from './noise.js';
import chaos from './chaos.js';
import seq from './seq.js';
import env from './env.js';
import vcf from './vcf.js';
import vca from './vca.js';
import mixer from './mixer.js';
import matrix from './matrix.js';
import fold from './fold.js';
import sampleHold from './sample-hold.js';
import delay from './delay.js';
import granular from './granular.js';
import scope from './scope.js';
import input from './input.js';
import output from './output.js';
import midiIn from './midi-in.js';
import midiCcIn from './midi-cc-in.js';
import midiClockIn from './midi-clock-in.js';
import midiOut from './midi-out.js';
import midiCcOut from './midi-cc-out.js';
import midiClockOut from './midi-clock-out.js';

export const defs = [
  vco, lfo, noise, chaos, seq, env, vcf, vca, mixer, matrix, fold, sampleHold,
  delay, granular, scope, input, output,
  midiIn, midiCcIn, midiClockIn, midiOut, midiCcOut, midiClockOut,
];

export const registry = Object.fromEntries(defs.map((d) => [d.name, d]));
