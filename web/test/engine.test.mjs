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
const { defFinder, flattenPatch, makeComposite, ungroup, insidePatch, specFromInside, renamePanel, instancePrefixes, IN_TYPE, OUT_TYPE } = await import('../ui/composite.js');

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
  // outputs: a module's output voltages now
  return { send, render, midi: (...bytes) => send({ op: 'midi', bytes }), outputs: (id) => [...p.byId.get(id).out], posted: () => p.posted };
}

const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
// rising edges above 1 V, of a signal scaled by the output module (level / 5)
const edges = (a, level = 0.1) => {
  let n = 0;
  for (let i = 1; i < a.length; i++) if (a[i - 1] <= level && a[i] > level) n++;
  return n;
};
const out = (id, from, to = ['1']) => to.map((ch) => ({ from, to: [id, ch] }));

test('every module has a name and a doc', () => {
  for (const d of defs) assert.ok(d.name && typeof d.doc === 'string' && d.doc.length > 10, d.name);
  assert.equal(new Set(defs.map((d) => d.name)).size, defs.length);
});

test('kinds and lights name real jacks', () => {
  for (const d of defs) {
    for (const [name, kind] of Object.entries(d.kinds?.in ?? {})) assert.ok(name in d.inputs && ['gate', 'pitch'].includes(kind), `${d.name} in ${name}`);
    for (const [name, kind] of Object.entries(d.kinds?.out ?? {})) assert.ok(d.outputs.includes(name) && ['gate', 'pitch'].includes(kind), `${d.name} out ${name}`);
    for (const name of d.lights ?? []) assert.ok(d.outputs.includes(name), `${d.name} light ${name}`);
  }
});

test('every module runs with any setting without producing nan', () => {
  let seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // at the default rate, and at the lowest and highest in the audio menu
  for (const [round, rate] of [[0, SR], [1, SR], [2, SR], [3, 8000], [4, 11025], [5, 96000]]) {
    globalThis.sampleRate = rate;
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
    assert.ok(a.every(Number.isFinite), `round ${round} at ${rate} hz`);
    assert.ok(peak(a) <= 1.0001);
  }
  globalThis.sampleRate = SR;
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
  // the bar: peak at 0 db; held while the level falls in silence, then let go
  assert.ok(Math.abs(d[3]) < 0.01, `bar peak ${d[3]}`);
  const frame = (n) => {
    for (let i = 0; i < n; i++) registry.meter.process(s, [0], o);
    return [...registry.meter.display(s)];
  };
  const soon = frame(SR / 2);
  assert.ok(soon[3] < -11 && soon[3] > -13 && Math.abs(soon[5]) < 0.01, `falling ${soon[3]}, held ${soon[5]}`);
  for (let k = 0; k < 4; k++) frame(SR / 2);
  const later = frame(SR / 30);
  assert.ok(later[5] < -50 && later[4] < -50, `let go ${later[5]} ${later[4]}`);

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

// runs a module definition directly, without the engine and its dc blocking
function run(def, params = {}) {
  const p = Object.entries(def.params).map(([k, d]) => params[k] ?? d.default);
  const s = def.create(SR, {});
  const o = new Float64Array(def.outputs.length);
  return {
    p,
    // seconds with these input values, returns the outputs at the end
    for(seconds, ...inputs) {
      for (let n = Math.round(seconds * SR); n > 0; n--) def.process(s, inputs, o, p);
      return [...o];
    },
  };
}

// the gain in dB the eq gives a sine of frequency f
function eqGain(params, f) {
  const def = registry.eq;
  const p = Object.entries(def.params).map(([k, d]) => params[k] ?? d.default);
  const s = def.create(SR, {});
  const o = new Float64Array(1);
  let peak = 0;
  const n = SR; // one second, the second half measured
  for (let k = 0; k < n; k++) {
    def.process(s, [5 * Math.sin((2 * Math.PI * f * k) / SR)], o, p);
    if (k > n / 2) peak = Math.max(peak, Math.abs(o[0]));
  }
  return 20 * Math.log10(peak / 5);
}

test('eq: flat passes the signal, each band boosts and cuts its own range', () => {
  for (const f of [50, 1000, 12000]) assert.ok(Math.abs(eqGain({}, f)) < 0.05, `flat at ${f}`);
  const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) < tol, `${what}: ${a.toFixed(2)} dB`);
  near(eqGain({ 'low g': 12 }, 30), 12, 0.5, 'low shelf below');
  near(eqGain({ 'low g': 12 }, 5000), 0, 0.3, 'low shelf far above');
  near(eqGain({ 'high g': -12 }, 18000), -12, 1, 'high shelf above');
  near(eqGain({ 'high g': -12 }, 100), 0, 0.3, 'high shelf far below');
  near(eqGain({ 'lm g': 9, 'lm f': 400 }, 400), 9, 0.3, 'peak at its frequency');
  near(eqGain({ 'lm g': 9, 'lm f': 400, 'lm q': 4 }, 2000), 0, 0.5, 'narrow peak far away');
  near(eqGain({ 'hm g': -15, 'hm f': 3000 }, 3000), -15, 0.5, 'cut at its frequency');
});

test('eq: the drawn response matches what it does', () => {
  const def = registry.eq;
  const params = { 'low g': 6, 'lm g': -9, 'hm g': 4, 'high g': -3 };
  const p = Object.entries(def.params).map(([k, d]) => params[k] ?? d.default);
  const { curve } = def.shape(p);
  for (const f of [40, 400, 2500, 10000]) {
    const j = Math.round((Math.log(f / 20) / Math.log(1000)) * (curve.length - 1));
    const drawn = (curve[j] - 0.5) * 36;
    const fj = 20 * Math.pow(1000, j / (curve.length - 1));
    assert.ok(Math.abs(drawn - eqGain(params, fj)) < 0.6, `${f} hz: drawn ${drawn.toFixed(2)}, measured ${eqGain(params, fj).toFixed(2)}`);
  }
});

test('button, hdar: a short press gives a delayed, held envelope', () => {
  const b = run(registry.button);
  b.p[0] = 1;
  assert.deepEqual(b.for(0.001), [10, 10]);
  assert.deepEqual(b.for(0.01), [10, 0]); // trig is a short pulse, gate stays
  b.p[0] = 0;
  assert.deepEqual(b.for(0.001), [0, 0]);

  const h = run(registry.hdar, { delay: 0.1, attack: 0.1, hold: 0.1, release: 0.1 });
  h.for(0.01, 10); // a short trigger
  assert.deepEqual(h.for(0.05, 0), [0, -0, 0]); // 0.06 s: still in the delay
  const [rising, , dtrig] = h.for(0.1, 0); // 0.16 s: on the way up
  assert.ok(rising > 4 && rising < 7 && dtrig === 10, `attack ${rising} ${dtrig}`);
  assert.deepEqual(h.for(0.1, 0), [10, -10, 10]); // 0.26 s: held at the top
  assert.ok(h.for(0.5, 0)[0] < 0.01); // 0.76 s: released
  // while the gate is held, it stays up
  h.for(0.6, 10);
  assert.equal(h.for(0.6, 10)[0], 10);
});

test('pad: x and y as voltages, gate while pressed, glide', () => {
  const pad = run(registry.pad, { x: 0.25, y: 1 });
  assert.deepEqual(pad.for(0.01), [2.5, 10, 0, 0]);
  pad.p[2] = 0.5; // pressed
  const [, , press, gate] = pad.for(0.02);
  assert.ok(Math.abs(press - 5) < 1e-3 && gate === 10, `${press} ${gate}`);
  pad.p[2] = 0;
  assert.equal(pad.for(1 / SR)[3], 0); // the gate closes at once
  pad.p[4] = 1; // bipolar
  assert.deepEqual(pad.for(0.01).slice(0, 2), [-2.5, 5]);
  pad.p[3] = 0.5; // glide: halfway after about 0.35 s
  pad.p[0] = 1;
  const x = pad.for(0.1)[0];
  assert.ok(x > -2.5 && x < 2.5, `gliding ${x}`);
});

test('gamepad: sticks, triggers and buttons of the controllers switched on', () => {
  const e = engine({ modules: [{ id: 1, type: 'gamepad' }], cables: [] });
  const buttons = Array(17).fill(0);
  const out = registry.gamepad.outputs;
  const level = () => {
    e.render(0.1);
    const o = e.outputs(1);
    return [o[out.indexOf('ly')], o[out.indexOf('a')]];
  };
  assert.deepEqual(level(), [0, 0]); // no controller yet
  e.send({ op: 'gamepad', pads: [null, { name: 'test', axes: [0, -1, 0, 0], buttons: [1, ...buttons.slice(1)] }, null, null] });
  assert.deepEqual(level(), [0, 0]); // it is pad 2, the module listens to pad 1
  e.send({ op: 'param', id: 1, i: 0, v: 0 });
  e.send({ op: 'param', id: 1, i: 1, v: 1 });
  const [up, a] = level();
  // stick up is +5 V, a button 10 V
  assert.ok(Math.abs(up - 5) < 0.01 && a === 10, `${up} ${a}`);
  // pads 2 and 3 together: sticks add up (and clip), buttons of either count
  e.send({ op: 'gamepad', pads: [null, { name: 'p2', axes: [0, -0.5, 0, 0], buttons }, { name: 'p3', axes: [0, -1, 0, 0], buttons: [1, ...buttons.slice(1)] }, null] });
  e.send({ op: 'param', id: 1, i: 2, v: 1 });
  const [both, either] = level();
  assert.ok(Math.abs(both - 5) < 0.01 && either === 10, `${both} ${either}`);
  e.send({ op: 'param', id: 1, i: 1, v: 0 });
  e.send({ op: 'param', id: 1, i: 2, v: 0 });
  const none = level();
  assert.ok(Math.abs(none[0]) < 1e-6 && none[1] === 0, `none switched on: ${none}`);
  // a module added later hears the last state at once
  const g = registry.gamepad;
  const s = g.create(SR, {});
  g.onGamepad(s, [{ name: 'x', axes: [0.05, 0, 1, 0], buttons: [0, 0, 0, 0, 0, 0, 0.5, 1] }], [1, 0, 0, 0]);
  const o = new Float64Array(g.outputs.length);
  for (let n = 0; n < SR * 0.05; n++) g.process(s, [], o, [1, 0, 0, 0]);
  assert.equal(o[0], 0); // inside the dead zone
  assert.ok(Math.abs(o[2] - 5) < 0.01 && Math.abs(o[4] - 5) < 0.01 && Math.abs(o[5] - 10) < 0.01, [...o].join(' '));
});

test('camera: brightness, motion, where and which zone, mirrored', () => {
  const e = engine({ modules: [{ id: 1, type: 'camera', params: { smooth: 0.005, thresh: 0.5 } }], cables: [] });
  const out = registry.camera.outputs;
  const at = (name) => e.outputs(1)[out.indexOf(name)];
  // motion at the right of the top row
  const zones = [0, 0, 0.03, 0, 0, 0, 0, 0, 0];
  e.send({ op: 'camera', values: [0.4, 0.01, 0.9, 0.8, ...zones] });
  e.render(0.1);
  assert.ok(Math.abs(at('bright') - 4) < 0.01, `bright ${at('bright')}`);
  assert.ok(Math.abs(at('motion') - 1) < 0.01 && at('gate') === 10, `motion ${at('motion')} ${at('gate')}`);
  // mirrored by default: the right of the picture is the left of the room
  assert.ok(Math.abs(at('x') - 1) < 0.01 && Math.abs(at('y') - 8) < 0.01, `x ${at('x')} y ${at('y')}`);
  assert.ok(Math.abs(at('1') - 3) < 0.01 && at('3') < 0.01, `zones ${at('1')} ${at('3')}`);
  // nothing moves: the gate closes, x and y stay where the motion was
  e.send({ op: 'camera', values: [0.4, 0, NaN, NaN, ...zones.map(() => 0)] });
  e.render(0.1);
  assert.ok(at('gate') === 0 && Math.abs(at('x') - 1) < 0.01, `still ${at('gate')} ${at('x')}`);
});

test('portal: what one sends, the others on its channel put out', () => {
  const e = engine({
    modules: [{ id: 1, type: 'button' }, { id: 2, type: 'portal' }, { id: 3, type: 'portal' }, { id: 4, type: 'portal', params: { channel: 2 } }],
    cables: [{ from: [1, 'gate'], to: [2, '1'] }],
  });
  // the page's part: keep what each portal sends, hand all of it back
  const senders = new Map();
  let seen = 0;
  const relay = () => {
    const posted = e.posted();
    for (; seen < posted.length; seen++) {
      const m = posted[seen];
      if (m.type !== 'outbox') continue;
      for (const x of m.list) {
        const key = `t:${x.id}`;
        if (x.gone) senders.delete(key);
        else senders.set(key, { key, tab: null, ...x });
      }
      e.send({ op: 'portal', senders: [...senders.values()], fresh: m.list.map((x) => `t:${x.id}`) });
    }
  };
  const play = (seconds) => {
    for (let t = 0; t < seconds; t += 0.01) {
      e.render(0.01);
      relay();
    }
  };
  e.send({ op: 'param', id: 1, i: 0, v: 1 });
  play(0.05);
  assert.equal(e.outputs(3)[0], 10, 'same channel: the gate arrives');
  assert.equal(e.outputs(4)[0], 0, 'other channel: nothing');
  assert.equal(e.outputs(2)[0], 0, 'a portal does not hear itself');
  e.send({ op: 'param', id: 1, i: 0, v: 0 });
  play(0.05);
  assert.equal(e.outputs(3)[0], 0);
  // a trigger shorter than a block still arrives as a pulse
  const def = registry.portal;
  const s = def.create(SR, {});
  const from = { key: 'x:9', tab: 'x', id: 9, ch: 1, last: [0, 0, 0, 0], peak: [10, 0, 0, 0] };
  def.onPortal(s, { senders: [from], fresh: ['x:9'] }, [1], 1);
  const o = new Float64Array(4);
  def.process(s, [0, 0, 0, 0], o, [1]);
  assert.equal(o[0], 10);
  for (let n = 0; n < SR * 0.003; n++) def.process(s, [0, 0, 0, 0], o, [1]);
  assert.equal(o[0], 0);
  // handed over again without being fresh, it does not fire again
  def.onPortal(s, { senders: [from], fresh: [] }, [1], 1);
  def.process(s, [0, 0, 0, 0], o, [1]);
  assert.equal(o[0], 0);
});

test('bypass passes the input straight through, and the module comes back', () => {
  // slew with a long rise: bypassed, a step goes through at once
  const e = engine({ modules: [{ id: 1, type: 'button' }, { id: 2, type: 'slew', params: { rise: 2, bypass: 1 } }], cables: [{ from: [1, 'gate'], to: [2, 'in'] }] });
  e.send({ op: 'param', id: 1, i: 0, v: 1 });
  e.render(0.02);
  assert.equal(e.outputs(2)[0], 10);
  // switched back on, it starts over and glides up from 0
  e.send({ op: 'param', id: 2, i: 2, v: 0 });
  e.render(0.1);
  const gliding = e.outputs(2)[0];
  assert.ok(gliding > 0 && gliding < 2, `gliding ${gliding}`);
});

test('lit outputs report their loudest in each frame', () => {
  const e = engine({ modules: [{ id: 1, type: 'button' }, { id: 2, type: 'vco' }], cables: [] });
  e.render(0.05);
  const frames = () => e.posted().filter((m) => m.type === 'frame');
  // a module without lights is never reported; a silent one is not either
  assert.ok(frames().every((f) => f.lights.length === 0));
  e.send({ op: 'param', id: 1, i: 0, v: 1 });
  e.render(0.05);
  const lit = frames().at(-1).lights;
  assert.deepEqual(lit.map((l) => [l.id, ...l.v]), [[1, 10, 0]]); // gate held, the trigger is over
  const pulse = frames().find((f) => f.lights[0]?.v[1] === 10);
  assert.ok(pulse, 'the short trigger shows in its frame');
  e.send({ op: 'param', id: 1, i: 0, v: 0 });
  e.render(0.1);
  // once more as silent, then not at all
  const after = frames().slice(-4).map((f) => f.lights.map((l) => [...l.v]));
  assert.deepEqual(after.slice(-2), [[], []]);
  assert.ok(after.some((l) => l.length && l[0][0] === 0), 'one silent report');
});

test('follow turns loudness into a cv and a gate', () => {
  const f = run(registry.follow, { thresh: 3 });
  const tone = (seconds, amp) => {
    let last;
    for (let n = 0; n < seconds * SR; n++) last = f.for(1 / SR, amp * Math.sin((2 * Math.PI * 220 * n) / SR));
    return last;
  };
  const [, env, gate] = tone(0.2, 5);
  assert.ok(env > 9 && env <= 10 && gate === 10, `loud ${env} ${gate}`);
  const [, quiet, closed] = tone(1, 0.5);
  assert.ok(quiet < 1.2 && closed === 0, `quiet ${quiet} ${closed}`);
});

test('lfo pulse width', () => {
  const e = engine({
    modules: [{ id: 1, type: 'lfo', params: { rate: 10, pw: 0.2 } }, { id: 2, type: 'output', params: { level: 0.2 } }],
    cables: out(2, [1, 'squ']),
  });
  const a = e.render(1);
  const high = a.filter((v) => v > 0).length / a.length;
  assert.ok(Math.abs(high - 0.2) < 0.01, `high ${high}`);
});

// the starter patch with its voice (vco, vcf, env, vca) made into a composite
function voicePatch() {
  const ids = newPatch.modules.filter((m) => ['vco', 'vcf', 'env', 'vca'].includes(m.type)).map((m) => m.id);
  const vcf = newPatch.modules.find((m) => m.type === 'vcf').id;
  return makeComposite(newPatch, ids, 'voice', [{ id: vcf, param: 'cutoff' }], defFinder(registry, {}));
}

test('a composite keeps the patch playing', () => {
  const patch = voicePatch();
  const voice = patch.modules.find((m) => m.type === 'voice');
  assert.equal(patch.modules.length, newPatch.modules.length - 3);
  assert.deepEqual(Object.keys(voice.params), ['cutoff']);
  const def = defFinder(registry, patch.composites)('voice');
  // midi in's pitch and gate come in, the vca's out goes to output and scope
  assert.deepEqual(Object.keys(def.inputs).sort(), ['gate', 'pitch']);
  assert.deepEqual(def.outputs, ['out']);
  // the jacks keep the kinds of the jacks they lead to
  assert.deepEqual(def.kinds, { in: { pitch: 'pitch', gate: 'gate' }, out: {} });
  const e = engine(flattenPatch(patch, registry));
  assert.equal(peak(e.render(0.2)), 0);
  e.midi(0x90, 57, 100);
  assert.ok(peak(e.render(0.3)) > 0.1);
});

test('the composite knob reaches the inner module', () => {
  const patch = voicePatch();
  const bright = structuredClone(patch);
  bright.modules.find((m) => m.type === 'voice').params.cutoff = 8000;
  const dark = structuredClone(patch);
  dark.modules.find((m) => m.type === 'voice').params.cutoff = 100;
  const loud = (p) => {
    const e = engine(flattenPatch(p, registry));
    e.midi(0x90, 57, 100);
    const a = e.render(0.3);
    return Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  };
  assert.ok(loud(bright) > loud(dark) * 2, `${loud(bright)} ${loud(dark)}`);
});

test('ungroup gives back the same modules and cables', () => {
  const patch = voicePatch();
  const voice = patch.modules.find((m) => m.type === 'voice');
  const back = ungroup(patch, voice.id, defFinder(registry, patch.composites));
  const sig = (p) => {
    const type = new Map(p.modules.map((m) => [m.id, m.type]));
    return {
      modules: p.modules.map((m) => `${m.type} ${JSON.stringify(m.params ?? {})}`).sort(),
      cables: p.cables.map((c) => `${type.get(c.from[0])}.${c.from[1]}>${type.get(c.to[0])}.${c.to[1]}`).sort(),
    };
  };
  assert.deepEqual(sig(back), sig(newPatch));
});

test('key links follow knobs into a composite and back out', () => {
  const vcf = newPatch.modules.find((m) => m.type === 'vcf').id;
  const vco = newPatch.modules.find((m) => m.type === 'vco').id;
  const start = { ...newPatch, keyMap: [{ id: vcf, param: 'bypass', key: 'KeyQ' }, { id: vco, param: 'tune', key: 'KeyR' }] };
  const ids = newPatch.modules.filter((m) => ['vco', 'vcf', 'env', 'vca'].includes(m.type)).map((m) => m.id);
  const patch = makeComposite(start, ids, 'voice', [{ id: vcf, param: 'bypass' }], defFinder(registry, {}));
  const voice = patch.modules.find((m) => m.type === 'voice');
  // the brought-out switch keeps its key, the hidden knob loses its link
  assert.deepEqual(patch.keyMap, [{ id: voice.id, param: 'bypass', key: 'KeyQ' }]);
  const back = ungroup(patch, voice.id, defFinder(registry, patch.composites));
  const bypass = back.modules.find((m) => m.type === 'vcf').id;
  assert.deepEqual(back.keyMap, [{ id: bypass, param: 'bypass', key: 'KeyQ' }]);
});

test('a composite inside a composite', () => {
  const inner = voicePatch();
  const voice = inner.modules.find((m) => m.type === 'voice').id;
  const midi = inner.modules.find((m) => m.type === 'midi in').id;
  const outer = makeComposite(inner, [voice, midi], 'synth', [{ id: voice, param: 'cutoff' }], defFinder(registry, inner.composites));
  assert.ok(outer.composites.synth && outer.composites.voice);
  const e = engine(flattenPatch(outer, registry));
  e.midi(0x90, 57, 100);
  assert.ok(peak(e.render(0.3)) > 0.1);
});

test('the edit view gives back the composite it shows', () => {
  const patch = voicePatch();
  const spec = patch.composites.voice;
  const inside = insidePatch(spec, patch.composites);
  assert.equal(inside.modules.filter((m) => m.type === IN_TYPE || m.type === OUT_TYPE).length, 2);
  const back = specFromInside(inside, spec);
  const strip = (s) => ({ ...s, layout: undefined, modules: s.modules.map((m) => ({ ...m, x: undefined })) });
  assert.deepEqual(strip(back), strip(spec));
});

test('the edit view adds a jack from +, drops one without cables', () => {
  const patch = voicePatch();
  const spec = patch.composites.voice;
  const inside = insidePatch(spec, patch.composites);
  const IN = inside.modules.find((m) => m.type === IN_TYPE).id;
  const OUT = inside.modules.find((m) => m.type === OUT_TYPE).id;
  const vcf = spec.modules.find((m) => m.type === 'vcf').id;
  const env = spec.modules.find((m) => m.type === 'env').id;
  // a new input to the filter's res, a new output from the envelope
  inside.cables.push({ from: [IN, '+'], to: [vcf, 'res'] }, { from: [env, 'out'], to: [OUT, '+'] });
  // the gate input loses its cable
  inside.cables = inside.cables.filter((c) => !(c.from[0] === IN && c.from[1] === 'gate'));
  const back = specFromInside(inside, spec);
  assert.deepEqual(back.inputs.map((j) => j.name), ['pitch', 'res']);
  assert.deepEqual(back.outputs.map((j) => j.name), ['out', 'out 2']);
  assert.deepEqual(back.outputs[1].from, [env, 'out']);
});

test('renaming a composite jack and knob keeps the patch wired', () => {
  const patch = voicePatch();
  const renamed = renamePanel(patch, 'voice', { inputs: { pitch: 'v/oct' }, outputs: { out: 'audio' }, params: { cutoff: 'tone' } });
  const voice = renamed.modules.find((m) => m.type === 'voice');
  assert.deepEqual(Object.keys(voice.params), ['tone']);
  assert.ok(renamed.cables.some((c) => c.to[0] === voice.id && c.to[1] === 'v/oct'));
  assert.ok(renamed.cables.some((c) => c.from[0] === voice.id && c.from[1] === 'audio'));
  const e = engine(flattenPatch(renamed, registry));
  e.midi(0x90, 57, 100);
  assert.ok(peak(e.render(0.3)) > 0.1);
});

test('instance prefixes reach composites inside composites', () => {
  const inner = voicePatch();
  const voice = inner.modules.find((m) => m.type === 'voice').id;
  const midi = inner.modules.find((m) => m.type === 'midi in').id;
  const outer = makeComposite(inner, [voice, midi], 'synth', [], defFinder(registry, inner.composites));
  const synth = outer.modules.find((m) => m.type === 'synth').id;
  assert.deepEqual(instancePrefixes('voice', outer.modules, outer.composites), [`${synth}/${voice}`]);
  assert.deepEqual(instancePrefixes('synth', outer.modules, outer.composites), [`${synth}`]);
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
