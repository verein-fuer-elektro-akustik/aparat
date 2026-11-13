# aparat

A modular synth in the browser, built in the context of [velak](https://velak.klingt.org/).
Panels like a real modular, flat monotone design, feedback patching as a first-class feature.

## Decisions

- Plain JS, ES modules, no framework, no build step. The frontend in `web/` runs
  from any static host; a small Node service adds presets.
- One `AudioWorkletProcessor` runs the whole patch, sample by sample.
- Multichannel audio output.
- MIDI input and output.
- Animated cables that show the signal passing through.
- Chromium is the supported browser, for Web MIDI and `AudioContext.setSinkId`.
  Safari has no Web MIDI. Multichannel on Linux is unresolved, see open risks.

## Layout

```
web/                frontend, static
  index.html
  engine/           worklet processor, graph, ops
  modules/          one file per module, no DOM, imported by both UI and worklet
  ui/               rack, panels, knobs, cables, midi, patch files, preset client
  test/             hardware and budget test page
server/             Node service, no dependencies
  server.js         serves web/ and the preset API
  presets.js        preset store, one JSON file per preset
  test/             node --test
data/presets/       stored presets (git-ignored)
```

## Preset service

- `GET /api/presets` lists `{name, updated}`, `GET|PUT|DELETE /api/presets/:name`
  loads, stores (overwrites) or deletes the patch JSON.
- Names: 1-64 letters of any script, digits, spaces and `- _ . ( ) + , ' & #`.
  The file name is the URL-encoded name, so a name maps to exactly one file
  inside the directory. Writes go to a temp file and are renamed into place.
- Body limit 1 MB; a patch must be an object with a `modules` list.
- Also serves `web/` with `cache-control: no-cache`, so edited modules are never
  stale, and refuses paths outside `web/`.
- Factory presets are read straight from `server/presets/`, never copied.
  Storing under a factory name writes your version to the presets directory,
  which wins; deleting it ("revert" in the UI) brings the factory one back. A
  factory preset without a stored version cannot be deleted (403). The list
  reports `factory` and `stored` per name.
  `hardtekno` (175 bpm freetekno: distorted kick, rolling bass in the gaps,
  offbeat hats, clap on 2 and 4, acid line through slew, drive and delay) and
  `idm` (118 bpm, endless and glitchy: polymetric euclid tracks and sequences,
  pattern density driven by a slow Lorenz attractor and a 90 s LFO, chance
  gates on kick and snare, random steps throwing crush rate, grain pitch and
  delay time around, quantized random blips in D minor) and `drones`
  (ambient in D minor, no clock: a root voice of detuned saws and a sub, a
  fifth, a voice that glides through D minor every 20 s from Lorenz into
  sample & hold and quantizer, an FM shimmer, filtered noise wind and grains,
  each swelling and opening on its own 0.004-0.05 Hz LFO, into a long delay
  and a big reverb).
- No authentication: it listens on 127.0.0.1 unless `HOST` is set.
  `PORT` (default 8000) and `PRESETS_DIR` (default `data/presets`) configure it.
- `GET /preset/:name` serves the app with `<base href="../">` so its relative
  URLs resolve; the page reads the name from the path and loads the preset.
- The frontend shows the preset controls only when the API answers, so static
  hosting keeps working. Files can still be exported and imported.

## Engine

- Every cable has a 1-sample delay. Execution order does not matter, so there is
  no graph sort and feedback loops just work.
- One signal type: floats in VCV-style volts (audio ±5V, pitch 1V/oct).
  Anything patches into anything. Multiple cables into one input are summed.
- An unpatched input holds the default from its module definition.
- No allocation in the audio loop. State lives in pre-allocated typed arrays.
- UI talks to the engine with `postMessage` ops: `add`, `remove`, `connect`,
  `disconnect`, `setParam`, `event`. No `SharedArrayBuffer`, so no COOP/COEP headers.
- Knob changes are smoothed in the engine.

### Module definition

Panels are generated from this. There is no per-module UI code.

```js
// modules/vca.js
export default {
  name: 'vca',
  cols: 2,                     // width in grid cells
  inputs: { in: 0, cv: 10 },   // name: value when unpatched
  outputs: ['out'],
  params: { gain: { min: 0, max: 1, default: 1 } },
  process(state, input, output, param) {
    output[0] = input[0] * param[0] * (input[1] / 10);
  },
};
```

## Multichannel output

- At startup set `destination.channelCount = destination.maxChannelCount`, with
  `channelCountMode = 'explicit'` and `channelInterpretation = 'discrete'`.
- `AudioWorkletNode` channel count is fixed at construction, so create it with
  `outputChannelCount: [maxChannelCount]` and leave unused channels silent.
  Switching device rebuilds the node and reloads the patch.
- Device choice through `AudioContext.setSinkId`, remembered per machine.
- `output` module: 8 inputs and a first-channel param, so `first = 9` feeds 9-16.
  Several can share a rack. Their signals are summed per channel.
- Every physical channel gets a NaN guard, DC blocker and limiter after the sum,
  because feedback patches will blow up and a PA is attached.
- Audio input the same way: `getUserMedia` with echo cancellation, noise
  suppression and auto gain off, into an `input` module.

## MIDI

Web MIDI is only available on the main thread, so everything goes through the UI thread.

- Input: `onmidimessage` -> `event` op -> module `onEvent` in the worklet, applied
  at the next block. UI stalls add jitter, so cable drawing must stay cheap.
- Output: modules push bytes into a per-block queue, the worklet posts it, the UI
  calls `output.send()`. Add timestamped sends with a fixed lookahead for MIDI
  clock if jitter turns out to matter.
- Ports are stored by name in the patch and re-matched on `onstatechange`, so
  devices can be replugged.
- Requires a secure context (https or localhost).

Modules:

| Module | Direction | Signals |
|---|---|---|
| `midi in` | in | pitch, gate, velocity, mod wheel, pitch bend; channel param, last-note priority |
| `midi cc in` | in | CC number param -> 0..10V |
| `midi clock in` | in | clock, start and stop as gates |
| `midi out` | out | pitch, gate, velocity -> note on/off on gate edges |
| `midi cc out` | out | 0..10V -> CC, sent only on change |
| `midi clock out` | out | gate -> clock |

Also MIDI learn at UI level: arm a knob, move a controller, stored in the patch.

Cables carry one voice. No polyphony for now.

## UI

- Menu bar (`web/ui/menubar.js`): file (new, import, export), presets (list,
  click loads; name field with load/store/delete-or-revert), edit (undo, redo,
  add module, duplicate, random, reset, remove for the selection), view
  (zoom), audio (output device, device names), midi (enable, in/out ports).
  Click a title to open, hover switches menus, arrows and esc work. Always
  visible: + module, start/stop audio, record, the loaded preset's name, and
  zoom, channels, cpu and clip lamps on the right.
- Shortcuts: ctrl+z / ctrl+shift+z / ctrl+y, ctrl+d duplicate, ctrl+s store
  the named preset (or export without the service), del, shift+a, + - 0.

- The rack fills the window below the toolbar and shows a grid of 48 px cells.
  Every module is 8 cells tall; its width in cells is its number of knob and
  jack columns (`cols` in the definition). Modules snap to the grid in rows
  8 cells high. There are always enough rows to fill the view plus one free row.
- Dragging a module by its title pushes the row's other modules aside, so
  modules can be reordered; leaving a row lets it spring back, Escape cancels.
- Zoom 25-200 %: ctrl+wheel or pinch at the pointer, `+ - 0`, view menu.
  The rack is scaled with a CSS transform inside a sizer that gives the scroll
  area; zoom is stored per browser, not in the patch.
- Pan by dragging empty rack space, or middle-drag anywhere.
- Hovering a jack draws its cables on top, each in its own colour (red, amber, cyan, green, violet, pink) with a dark halo. Hovering a cable itself lights it red.
- On/off parameters (min 0, max 1, step 1) are square buttons with a lamp (light grey when on): click, space or enter flips them.
- Undo/redo (ctrl+z, ctrl+shift+z or ctrl+y, edit menu): patch
  snapshots, recorded 400 ms after things settle, so a knob drag is one step.
  Undo applies the snapshot by diff (`rack.apply`), so modules that stay keep
  their engine state. Loading a preset or "new" is one undoable step.
- Click a cable to select it (lit red), also where it crosses a panel; delete
  removes it, esc deselects. Right-click a cable for its menu. Knobs, jacks,
  buttons and title bars take clicks before cables.
- Bypass button on drive, fold, crush, vcf, delay, reverb, granular (`bypass: {output: input}` in the module definition adds it). The engine fades over 5 ms and skips process() while bypassed. Random leaves bypass alone.
- Right-click a module: random (every parameter through its normalised range,
  so curves and steps hold), reset, duplicate (placed right of it), remove.
  Right-click a knob is midi learn, right-click empty space the add menu.
- Warnings are a stack at the top right below the toolbar; click or 8 s closes.
- Audio is started and stopped with one button; starting replays the patch.
- shift+a opens the module menu at the pointer (type to filter, Enter adds) and
  the module goes into the cell under the pointer. The toolbar has a button too.
- Cables on one canvas overlay above the panels. Every cable changes on every
  frame, so one redraw is simpler and cheaper than updating SVG. Cables are
  picked up by their ports, so no hit testing on the curves.
- Patches as JSON: presets on the service, export and import as files. The
  patch is not kept in the URL; `/preset/<name>` loads a preset, and loading or
  storing one shows that link in the address bar. A reload of `/` starts with
  the default patch.

### Cable animation

- The engine tracks the peak absolute value per cable in the copy step and posts
  all peaks as one `Float32Array` at about 30 Hz.
- The UI keeps a short history per cable and draws each cable as about 32 segments.
  Segment `i` takes its level from `history[i]`, so level changes travel from
  output to input:

  ```
  alpha = base + level[i] * (0.6 + 0.4 * sin(i * k - t * speed))
  ```

- The sine term keeps a steady tone visibly moving. An envelope is a single pulse
  running down the cable, an LFO a slow wave, a silent cable flat and still.
- Monotone: grey only, brightness carries the signal. Red stays reserved for
  clipping and selection.
- `prefers-reduced-motion`: drop the sine term and show level as brightness only.

### Colours (velak `style.css`)

| Element | Value |
|---|---|
| Rack background | `#0c0c0c` |
| Panel / panel edge | `#181818` / `#272727` |
| Labels, knobs, cables | `#808080` |
| Values, hover | `#9c9c9c` |
| Inactive, non-text only | `#595959` |
| Accent, clipping and selection only | `#ed2c3e` |

Type: Inter with lowercase labels, Roboto Mono for values.
Idea: reuse the drifting turbulence lines from the velak homepage on empty rack space.

## Status

Prototype built: all steps below exist. Run with `node server/server.js`
(or `npm start` in `server/`) and open <http://localhost:8000/>.
Tests: `npm test` in `server/`.

## Modules

35 modules. Sources: vco, lfo, noise, chaos. Timing: clock (bpm, swing),
seq (8 steps), steps (16 on/off trigger steps, current step outlined), euclid (4 Euclidean tracks, hit count CV), chance (Bernoulli
gate), env. Drums: kick, hat, clap. Shaping: vcf, vca, mixer, matrix, fold,
drive, crush, slew, sample hold, quant (scales). Effects:
delay, reverb, granular. Utility: atten, scope. I/O: input, output, 6 midi.
Shared DSP helpers (SVF, noise, one-pole) in `web/modules/lib/dsp.js`.

Still missing for a full system: random/turing source, clock
divider and logic, comparator, crossfader, sidechain ducker/compressor,
sampler. Features: copy/paste of several modules, typing knob values,
tempo-synced delay, oversampling for the distortions, polyphony, scenes.

## Build order

1. **Hardware and budget test, on the real interface.** Print `maxChannelCount`,
   play a distinct tone on every channel, send and receive MIDI, and count how
   many dummy modules fit in a 128-sample block (2.67 ms at 48 kHz) with per-cable
   peak tracking on. Multichannel is the main risk, so it goes first.
2. **Engine and first modules:** vco (polyBLEP), vcf (SVF), vca, env, lfo, noise,
   mixer, delay, scope, output.
3. **Rack UI:** panels, knobs, dragging, cables with animation.
4. **Patches:** JSON presets on the service and as files.
5. **MIDI modules** and MIDI learn.
6. **velak layer:** audio input, wavefolder, sample & hold, chaos oscillator,
   feedback matrix, granular, recording.

If step 1 shows the budget is too tight: run the graph in internal blocks of 8-16
samples. Cable delay grows to that length, which trades away the tightest feedback.

## Open risks

- **Multichannel on Linux is failing.** Chromium 156 (headless, PipeWire) reports
  `maxChannelCount: 2` on an 8-channel virtual sink, whether selected by device ID
  or used as the system default, with aux or 7.1 channel maps. Not yet tested:
  headed Chromium on a real multichannel interface, Firefox, macOS or Windows.
  The engine is DOM-free, so a different audio output path would not change it.

## Measured in step 1

- Budget: about 455 mixed modules at 50% load, 955 at 100% (Chromium 156, 48 kHz,
  128-sample blocks). Plain JS at one sample per cable is enough.
- Posting cable peaks at 30 Hz has no measurable cost.
- MIDI send and receive work through `Midi Through`, including timestamped sends.
