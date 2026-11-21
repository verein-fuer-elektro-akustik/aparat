import vco from './vco.js';
import lfo from './lfo.js';
import noise from './noise.js';
import chaos from './chaos.js';
import seq from './seq.js';
import env from './env.js';
import vcf from './vcf.js';
import eq from './eq.js';
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
import quant from './quantize.js';
import div from './div.js';
import logic from './logic.js';
import compare from './compare.js';
import seqSwitch from './switch.js';
import pan from './pan.js';
import xfade from './xfade.js';
import note from './note.js';
import chorus from './chorus.js';
import phaser from './phaser.js';
import meter from './meter.js';
import sampler from './sampler.js';
import hdar from './hdar.js';
import follow from './follow.js';
import button from './button.js';
import pad from './pad.js';
import gamepad from './gamepad.js';
import camera from './camera.js';

// A module is a plain object, imported by both the UI and the audio worklet,
// so it must not touch the DOM:
//
//   name, cols           menu name, panel width in grid cells
//   doc                  a sentence or two for the add-module menu
//   inputs               {name: value while unpatched}
//   outputs              [names]
//   params               {name: {min, max, default, step?, curve?, format?}};
//                        min 0, max 1, step 1 shows as an on/off button;
//                        with momentary: true it is on only while held, and
//                        not stored in the patch
//   create(sr, host)     the state; host has in (sound card), out, midi()
//   process(s, in, out, p)  one sample; in, out and p are arrays in the
//                        order of inputs, outputs and params
//   onMidi(s, data, p)   optional, incoming midi bytes
//   onGamepad(s, pads, p)  optional, the game controllers whenever one
//                        changes: [null or {name, axes, buttons}] (values in
//                        the browser's standard mapping)
//   onCamera(s, values, p)  optional, each camera frame (see ui/camera.js);
//                        the page runs the camera while such a module exists
//   pad                  optional, [x, y, pressure]: names of params set by
//                        a touch surface drawn in the display instead of
//                        knobs; shape() returns {pad: [x, y, pressure]}
//   display(s)           optional, data drawn on the panel at frame rate: an
//                        array drawn as a trace (±12), or an object with
//                        trace or bars (0 to 1, from the bottom) and an
//                        optional grid {x, y} (lines at 0 to 1 from the left
//                        and from the bottom); or {steps: [rows]}, rows of
//                        steps drawn as cells (bit 1 lit, 2 current, 4 firing)
//   displayKnob          optional, display() returns the knob to outline
//   displayText(data)    optional, the lines of text to show for display()'s
//                        data instead of a trace
//   displayHeight        optional, the display's height in px (110)
//   shape(p, live, peaks)  optional, what the display shows, worked out in
//                        the page from the knobs (p) and the last display()
//                        data (live, null while audio is off), so it follows
//                        the knobs also without sound. peaks: the waveform of
//                        a file module's file. Returns a display object as
//                        above, or {curve, marks, lines, dot} (a line 0 to 1
//                        from the bottom, vertical lines, horizontal lines,
//                        a point [x, y]), or
//                        {wave, from, to, head} (min/max pairs, the bright
//                        part, a playhead, all 0 to 1 across)
//   file                 optional, the panel can load an audio file, which
//                        arrives as onData(s, {samples, sr}) (null: none)
//   text                 optional, the panel is a text field kept in the patch
//   lights               optional, [output names] whose jacks light up with
//                        their level (fully at 5 V): gates, triggers and
//                        controllers, so their events show
//   destroy(s)           optional, called when the module is removed
//   bypass               optional {output: input}, see below
//
// Voltages follow VCV Rack: audio ±5 V, 1 V/oct, gates and triggers 10 V
// (read as high above 1 V).

// The modules by kind, as the help page lists them (the add-module menu
// lists them by name).
export const groups = [
  ['sources', [vco, lfo, noise, chaos, sampler]],
  ['timing and envelopes', [clock, div, seq, steps, euclid, chance, env, hdar, seqSwitch, button]],
  ['drums', [kick, hat, clap]],
  ['filters, mixing and shaping', [vcf, eq, vca, mixer, matrix, pan, xfade, fold, drive, crush, slew, sampleHold, quant]],
  ['effects', [delay, reverb, chorus, phaser, granular]],
  ['utilities', [atten, logic, compare, scope, meter, note]],
  ['sound card', [input, follow, output]],
  ['controllers', [pad, gamepad, camera]],
  ['midi', [midiIn, midiCcIn, midiClockIn, midiOut, midiCcOut, midiClockOut]],
];

export const defs = groups.flatMap(([, list]) => list);

// A module with a `bypass` map ({output: input}) gets an on/off bypass
// parameter. While it is on, the engine copies those inputs straight to the
// outputs and does not run the module (see processor.js).
const BYPASS = { min: 0, max: 1, default: 0, step: 1, format: (v) => (v ? 'on' : 'off') };
for (const d of defs) if (d.bypass) d.params = { ...d.params, bypass: BYPASS };

export const registry = Object.fromEntries(defs.map((d) => [d.name, d]));
