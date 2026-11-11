# aparat

A modular synth in the browser, built in the context of [velak](https://velak.klingt.org/).
Panels like a real modular, flat monotone design, feedback patching as a first-class feature.

## Decisions

- Plain JS, ES modules, no framework, no build step. Static hosting.
- One `AudioWorkletProcessor` runs the whole patch, sample by sample.
- Multichannel audio output.
- MIDI input and output.
- Animated cables that show the signal passing through.
- Chromium is the supported browser, for Web MIDI and `AudioContext.setSinkId`.
  Safari has no Web MIDI. Multichannel on Linux is unresolved, see open risks.

## Layout

```
index.html
engine/    worklet processor, graph, ops
modules/   one file per module, no DOM, imported by both UI and worklet
ui/        rack, panels, knobs, cables, midi, patch files
```

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

- Rack on an HP-width grid, DOM panels, drag to move.
- Cables on one canvas overlay above the panels. Every cable changes on every
  frame, so one redraw is simpler and cheaper than updating SVG. Cables are
  picked up by their ports, so no hit testing on the curves.
- Patches as JSON, in the URL hash and as files.

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

Prototype built: all steps below exist. Run with
`python -m http.server -b 127.0.0.1 8000 -d .` and open <http://localhost:8000/>.

## Build order

1. **Hardware and budget test, on the real interface.** Print `maxChannelCount`,
   play a distinct tone on every channel, send and receive MIDI, and count how
   many dummy modules fit in a 128-sample block (2.67 ms at 48 kHz) with per-cable
   peak tracking on. Multichannel is the main risk, so it goes first.
2. **Engine and first modules:** vco (polyBLEP), vcf (SVF), vca, env, lfo, noise,
   mixer, delay, scope, output.
3. **Rack UI:** panels, knobs, dragging, cables with animation.
4. **Patches:** JSON in the URL hash and as files.
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
