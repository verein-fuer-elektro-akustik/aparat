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
import clock from './clock.js';
import euclid from './euclid.js';
import steps from './steps.js';
import kick from './kick.js';
import hat from './hat.js';
import clap from './clap.js';
import drive from './drive.js';
import slew from './slew.js';
import reverb from './reverb.js';
import atten from './atten.js';
import chance from './chance.js';
import crush from './crush.js';
import quant from './quant.js';

// order of the add-module menu: sources, timing, drums, shaping, effects,
// utilities, i/o
export const defs = [
  vco, lfo, noise, chaos,
  clock, seq, steps, euclid, chance, env,
  kick, hat, clap,
  vcf, vca, mixer, matrix, fold, drive, crush, slew, sampleHold, quant,
  delay, reverb, granular,
  atten, scope,
  input, output,
  midiIn, midiCcIn, midiClockIn, midiOut, midiCcOut, midiClockOut,
];

// A module with a `bypass` map ({output: input}) gets an on/off bypass
// parameter. While it is on, the engine copies those inputs straight to the
// outputs and does not run the module (see processor.js).
const BYPASS = { min: 0, max: 1, default: 0, step: 1, format: (v) => (v ? 'on' : 'off') };
for (const d of defs) if (d.bypass) d.params = { ...d.params, bypass: BYPASS };

export const registry = Object.fromEntries(defs.map((d) => [d.name, d]));
