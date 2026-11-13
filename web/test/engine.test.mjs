// Engine tests, run with node (no browser): node --test web/test/
// The audio worklet is loaded with a stand-in for the worklet globals and
// driven block by block.

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';

const SR = 48000;
const BLOCK = 128;

let Processor;
globalThis.sampleRate = SR;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = { postMessage: (m) => this.posted.push(m), onmessage: null };
    this.posted = [];
  }
};
globalThis.registerProcessor = (name, cls) => {
  Processor = cls;
};
await import('../engine/processor.js');
const { defs, registry } = await import('../modules/index.js');
const { newPatch } = await import('../ui/new-patch.js');

// An engine with a patch in the format of patch files.
function engine(patch = { modules: [], cables: [] }) {
  const p = new Processor();
  const send = (m) => p.port.onmessage({ data: m });
  const errors = () => p.posted.filter((m) => m.type === 'error').map((m) => m.message);
  for (const m of patch.modules) {
    const def = registry[m.type];
    const params = Object.entries(def.params).map(([k, d]) => m.params?.[k] ?? d.default);
    send({ op: 'add', id: m.id, type: m.type, params });
  }
  const type = (id) => registry[patch.modules.find((m) => m.id === id).type];
  patch.cables.forEach((c, slot) => {
    const from = [c.from[0], type(c.from[0]).outputs.indexOf(c.from[1])];
    const to = [c.to[0], Object.keys(type(c.to[0]).inputs).indexOf(c.to[1])];
    assert.ok(from[1] >= 0 && to[1] >= 0, `cable ${JSON.stringify(c)}`);
    send({ op: 'connect', slot, from, to });
  });
  // renders seconds of audio, returns channel 0 (and all channels as .all)
  const render = (seconds, channels = 2) => {
    const n = Math.round((seconds * SR) / BLOCK);
    const all = Array.from({ length: channels }, () => new Float32Array(n * BLOCK));
    for (let b = 0; b < n; b++) {
      const out = all.map(() => new Float32Array(BLOCK));
      p.process([[]], [out]);
      out.forEach((ch, c) => all[c].set(ch, b * BLOCK));
    }
    assert.deepEqual(errors(), []);
    return Object.assign(all[0], { all });
  };
  return { send, render, midi: (...bytes) => send({ op: 'midi', bytes }) };
}

const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
// rising edges above 1 V, of a signal scaled by the output module (level / 5)
const edges = (a, level = 0.1) => {
  let n = 0;
  for (let i = 1; i < a.length; i++) if (a[i - 1] <= level && a[i] > level) n++;
  return n;
};
const out = (id, from, to = ['1']) => to.map((ch) => ({ from, to: [id, ch] }));

test('every module runs with any setting without producing nan', () => {
  let seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let round = 0; round < 3; round++) {
    const modules = defs.map((d, i) => ({
      id: i + 1,
      type: d.name,
      params: Object.fromEntries(Object.entries(d.params).map(([k, p]) => {
        if (k === 'bypass') return [k, 0];
        const v = p.min + rnd() * (p.max - p.min);
        return [k, p.step ? p.min + Math.round((v - p.min) / p.step) * p.step : v];
      })),
    }));
    // every input gets some output, so modules see audio, gates and cv
    const sources = modules.flatMap((m) => registry[m.type].outputs.map((o) => [m.id, o]));
    const cables = modules.flatMap((m) =>
      Object.keys(registry[m.type].inputs).map((name) => ({ from: sources[Math.floor(rnd() * sources.length)], to: [m.id, name] })));
    const e = engine({ modules, cables });
    const a = e.render(0.5);
    assert.ok(a.every(Number.isFinite), `round ${round}`);
    assert.ok(peak(a) <= 1.0001);
  }
});

test('the new patch is silent until a note arrives, then plays it', () => {
  const e = engine(newPatch);
  assert.equal(peak(e.render(0.2)), 0);
  e.midi(0x90, 57, 100);
  assert.ok(peak(e.render(0.3)) > 0.1);
  e.midi(0x80, 57, 0);
  e.render(1.5);
  assert.ok(peak(e.render(0.1)) < 0.01);
});

test('div divides and multiplies a clock', () => {
  const patch = (output) => ({
    modules: [
      { id: 1, type: 'lfo', params: { rate: 8 } },
      { id: 2, type: 'div' },
      { id: 3, type: 'output', params: { level: 1 } },
    ],
    cables: [{ from: [1, 'squ'], to: [2, 'clock'] }, ...out(3, [2, output])],
  });
  const count = (output) => edges(engine(patch(output)).render(4), 0.5);
  assert.ok(Math.abs(count('/2') - 16) <= 1);
  assert.ok(Math.abs(count('/4') - 8) <= 1);
  assert.ok(Math.abs(count('x2') - 64) <= 3);
  assert.ok(Math.abs(count('x4') - 128) <= 6);
});

test('logic, compare and switch', () => {
  const e = engine({
    modules: [
      { id: 1, type: 'atten', params: { offset1: 10, offset2: 0 } },
      { id: 2, type: 'logic' },
      { id: 3, type: 'compare', params: { level: 5 } },
      { id: 4, type: 'output', params: { level: 0.5 } },
    ],
    cables: [
      { from: [1, '1'], to: [2, 'a'] },
      { from: [1, '2'], to: [2, 'b'] },
      { from: [1, '1'], to: [3, 'in'] },
      { from: [2, 'and'], to: [4, '1'] },
      { from: [2, 'or'], to: [4, '2'] },
      { from: [2, 'xor'], to: [4, '3'] },
      { from: [3, 'above'], to: [4, '4'] },
    ],
  });
  // the output's dc blocker lets the step through at first
  const { all } = e.render(0.01, 4);
  assert.deepEqual(all.map((ch) => peak(ch) > 0.5), [false, true, true, true]);

  const s = engine({
    modules: [
      { id: 1, type: 'lfo', params: { rate: 10 } },
      { id: 2, type: 'vco' },
      { id: 3, type: 'switch', params: { steps: 2 } },
      { id: 4, type: 'output' },
    ],
    cables: [
      { from: [1, 'squ'], to: [3, 'clock'] },
      { from: [2, 'saw'], to: [3, '1'] },
      ...out(4, [3, 'out']),
    ],
  });
  const a = s.render(0.4);
  // input 2 is silent: every other 0.1 s there is no sound
  assert.ok(peak(a.subarray(0, 4000)) > 0.1);
  assert.ok(peak(a.subarray(5500, 9000)) < 0.02);
});

test('sampler plays its file on a trigger, at the pitch asked for', () => {
  const patch = {
    modules: [
      { id: 1, type: 'atten', params: { offset1: 10, offset2: 1 } },
      { id: 2, type: 'sampler', params: { level: 1 } },
      { id: 3, type: 'output', params: { level: 1 } },
    ],
    cables: [{ from: [1, '1'], to: [2, 'trig'] }, ...out(3, [2, 'out'])],
  };
  // a file of one second of 100 hz at 24 khz
  const samples = Float32Array.from({ length: 24000 }, (_, i) => Math.sin((2 * Math.PI * 100 * i) / 24000));
  const crossings = (a) => edges(a, 0);

  const silent = engine(patch);
  assert.equal(peak(silent.render(0.2)), 0);

  const e = engine(patch);
  e.send({ op: 'data', id: 2, data: { samples, sr: 24000 } });
  const a = e.render(1.5);
  assert.ok(Math.abs(crossings(a.subarray(0, SR)) - 100) <= 2);
  assert.ok(peak(a.subarray(SR + 2000)) < 0.01, 'stops at the end');

  patch.cables.push({ from: [1, '2'], to: [2, 'pitch'] });
  const up = engine(patch);
  up.send({ op: 'data', id: 2, data: { samples, sr: 24000 } });
  const b = up.render(1);
  assert.ok(Math.abs(crossings(b.subarray(0, SR / 2)) - 100) <= 2, 'an octave up: twice as fast');
  assert.ok(peak(b.subarray(SR / 2 + 2000)) < 0.01);
});

test('midi in voices share out the notes of a chord', () => {
  const voice = (n, of) => [
    { id: n * 10, type: 'midi in', params: { voice: n, of } },
    { id: n * 10 + 1, type: 'vco' },
    { id: n * 10 + 2, type: 'vca' },
  ];
  const wires = (n) => [
    { from: [n * 10, 'pitch'], to: [n * 10 + 1, 'pitch'] },
    { from: [n * 10, 'gate'], to: [n * 10 + 2, 'cv'] },
    { from: [n * 10 + 1, 'sin'], to: [n * 10 + 2, 'in'] },
    { from: [n * 10 + 2, 'out'], to: [99, String(n)] },
  ];
  const e = engine({
    modules: [...voice(1, 3), ...voice(2, 3), ...voice(3, 3), { id: 99, type: 'output', params: { level: 1 } }],
    cables: [...wires(1), ...wires(2), ...wires(3)],
  });
  const hz = (ch) => edges(ch, 0) / (ch.length / SR);
  e.midi(0x90, 69, 100); // a4 440
  e.midi(0x90, 81, 100); // a5 880
  let { all } = e.render(1, 3);
  assert.ok(Math.abs(hz(all[0]) - 440) < 3);
  assert.ok(Math.abs(hz(all[1]) - 880) < 3);
  assert.equal(peak(all[2]), 0);
  // releasing the first note leaves the second on its voice
  e.midi(0x80, 69, 0);
  e.midi(0x90, 57, 100); // a3 220 goes to the free third voice
  e.render(0.2, 3);
  ({ all } = e.render(1, 3));
  assert.ok(peak(all[0]) < 0.01);
  assert.ok(Math.abs(hz(all[1]) - 880) < 3);
  assert.ok(Math.abs(hz(all[2]) - 220) < 3);
});

test('delay follows a clock at sync', () => {
  // a click every 0.5 s, echoed after the time between the pulses of a 4 hz clock
  const e = engine({
    modules: [
      { id: 1, type: 'lfo', params: { rate: 4 } },
      { id: 2, type: 'atten', params: { offset1: 0 } },
      { id: 3, type: 'delay', params: { time: 1.7, fb: 0, mix: 1 } },
      { id: 4, type: 'output', params: { level: 1 } },
      { id: 5, type: 'midi in' },
    ],
    cables: [
      { from: [1, 'squ'], to: [3, 'sync'] },
      { from: [5, 'gate'], to: [3, 'in'] },
      ...out(4, [3, 'out']),
    ],
  });
  e.render(1);
  e.midi(0x90, 60, 100);
  const a = e.render(1);
  const first = a.findIndex((v) => v > 0.5);
  assert.ok(Math.abs(first / SR - 0.25) < 0.01, `echo after ${first / SR} s`);
});

test('meter reads level and pitch, vco sync follows the master', () => {
  const s = registry.meter.create(SR);
  const o = [0];
  for (let i = 0; i < SR; i++) registry.meter.process(s, [5 * Math.sin((2 * Math.PI * 440 * i) / SR)], o);
  const d = registry.meter.display(s);
  assert.ok(Math.abs(d[0] - 5) < 0.01 && Math.abs(d[1] - 5 / Math.SQRT2) < 0.01);
  assert.ok(Math.abs(d[2] - 440) < 0.5);
  assert.deepEqual(registry.meter.displayText(d).slice(2), ['a4 +0 ct', '440.0 hz']);

  const e = engine({
    modules: [
      { id: 1, type: 'vco', params: { tune: -1 } },
      { id: 2, type: 'vco', params: { tune: 0.4 } },
      { id: 3, type: 'meter' },
      { id: 4, type: 'output' },
    ],
    cables: [{ from: [1, 'squ'], to: [2, 'sync'] }, ...out(4, [2, 'saw'])],
  });
  // the synced saw repeats at the master's 130.8 hz: the same waveform some
  // periods on (apart from the samples right at the jumps)
  const a = e.render(0.5);
  const period = SR / 130.815;
  let diff = 0;
  for (let i = 10000; i < 12000; i++) diff += Math.abs(a[i] - a[Math.round(i + period * 20)]) / 2000;
  assert.ok(diff < 0.02, `synced: ${diff}`);
});

// The factory patches live with the server. "default" is what the app starts
// with; "new patch" in the menu is the same patch from web/ui/new-patch.js,
// which also works without the server. They must not drift apart.
const factory = new URL('../../server/patches/', import.meta.url);

test('the default patch is the new patch', async () => {
  assert.deepEqual(JSON.parse(await readFile(new URL('default.json', factory), 'utf8')), newPatch);
});

test('the factory patches run', async () => {
  for (const file of await readdir(factory)) {
    const patch = JSON.parse(await readFile(new URL(file, factory), 'utf8'));
    for (const m of patch.modules) assert.ok(registry[m.type], `${file}: module ${m.type}`);
    const a = engine(patch).render(1);
    assert.ok(a.every(Number.isFinite), file);
  }
});
