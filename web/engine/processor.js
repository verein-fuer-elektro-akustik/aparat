// The whole patch runs here, one sample at a time.
// Every cable has a 1-sample delay, so module order does not matter and
// feedback loops need no special handling.

import { registry } from '../modules/index.js';

const MAX_PORTS = 16384;
const MAX_CABLES = 8192;
const MAX_CHANNELS = 32;
const RAIL = 12;
const FRAME_RATE = 30;
const BYPASS_FADE = 0.005; // seconds, so switching bypass does not click

function pool() {
  return { top: 0, free: new Map() };
}

function alloc(p, n) {
  if (n === 0) return 0;
  const list = p.free.get(n);
  if (list && list.length) return list.pop();
  if (p.top + n > MAX_PORTS) throw new Error('out of ports');
  const at = p.top;
  p.top += n;
  return at;
}

function release(p, at, n) {
  if (n === 0) return;
  if (!p.free.has(n)) p.free.set(n, []);
  p.free.get(n).push(at);
}

class Aparat extends AudioWorkletProcessor {
  constructor() {
    super();
    this.inBuf = new Float64Array(MAX_PORTS);
    this.outBuf = new Float64Array(MAX_PORTS);
    this.defaults = new Float64Array(MAX_PORTS);
    this.inPool = pool();
    this.outPool = pool();

    this.mods = [];
    this.byId = new Map();
    this.midiMods = [];
    this.displayMods = [];

    this.from = new Int32Array(MAX_CABLES);
    this.to = new Int32Array(MAX_CABLES);
    this.active = new Int32Array(MAX_CABLES);
    this.activePos = new Int32Array(MAX_CABLES).fill(-1);
    this.nActive = 0;
    this.peaks = new Float32Array(MAX_CABLES);
    this.peakLen = 0;

    this.smooth = [];
    this.smoothCoef = 1 - Math.exp(-1 / (0.01 * sampleRate));

    this.midiQueue = new Uint8Array(3 * 1024);
    this.midiLen = 0;
    this.host = {
      out: new Float64Array(MAX_CHANNELS),
      in: new Float64Array(MAX_CHANNELS),
      midi: (a, b, c) => {
        if (this.midiLen + 3 > this.midiQueue.length) return;
        this.midiQueue[this.midiLen++] = a;
        this.midiQueue[this.midiLen++] = b;
        this.midiQueue[this.midiLen++] = c;
      },
    };

    this.dcX = new Float64Array(MAX_CHANNELS);
    this.dcY = new Float64Array(MAX_CHANNELS);
    this.limit = new Float64Array(MAX_CHANNELS);
    this.limitRelease = Math.exp(-1 / (0.1 * sampleRate));
    this.dcCoef = 1 - (2 * Math.PI * 10) / sampleRate;
    this.clip = new Uint8Array(MAX_CHANNELS);

    this.framePeriod = Math.round(sampleRate / FRAME_RATE);
    this.sinceFrame = 0;
    this.busy = 0;
    this.recording = false;

    this.port.onmessage = (e) => {
      try {
        this.handle(e.data);
      } catch (err) {
        this.port.postMessage({ type: 'error', message: String(err.message ?? err) });
      }
    };
  }

  handle(m) {
    switch (m.op) {
      case 'add':
        this.add(m);
        break;
      case 'remove':
        this.remove(m.id);
        break;
      case 'connect':
        this.connect(m);
        break;
      case 'disconnect':
        this.disconnect(m.slot);
        break;
      case 'param':
        this.setParam(m.id, m.i, m.v);
        break;
      case 'midi':
        for (const mod of this.midiMods) mod.def.onMidi(mod.state, m.bytes, mod.param);
        break;
      case 'clear':
        for (const id of [...this.byId.keys()]) this.remove(id);
        for (let k = this.nActive - 1; k >= 0; k--) this.disconnect(this.active[k]);
        break;
      case 'record':
        this.recording = m.on;
        break;
    }
  }

  add({ id, type, params }) {
    const def = registry[type];
    if (!def) throw new Error(`unknown module: ${type}`);
    const inputs = Object.values(def.inputs);
    const nIn = inputs.length;
    const nOut = def.outputs.length;
    const inAt = alloc(this.inPool, nIn);
    const outAt = alloc(this.outPool, nOut);
    inputs.forEach((v, k) => {
      this.defaults[inAt + k] = v;
      this.inBuf[inAt + k] = v;
    });
    this.outBuf.fill(0, outAt, outAt + nOut);
    const mod = {
      id,
      def,
      process: def.process,
      state: def.create(sampleRate, this.host),
      in: this.inBuf.subarray(inAt, inAt + nIn),
      out: this.outBuf.subarray(outAt, outAt + nOut),
      param: Float64Array.from(params),
      paramDefs: Object.values(def.params),
      inAt,
      outAt,
      nIn,
      nOut,
      bypass: null,
    };
    if (def.bypass) {
      const names = Object.keys(def.inputs);
      mod.bypass = {
        p: Object.keys(def.params).indexOf('bypass'),
        src: Int32Array.from(def.outputs, (o) => (o in def.bypass ? names.indexOf(def.bypass[o]) : -1)),
        mix: 0,
        step: 1 / (BYPASS_FADE * sampleRate),
      };
    }
    this.mods.push(mod);
    this.byId.set(id, mod);
    if (def.onMidi) this.midiMods.push(mod);
    if (def.display) this.displayMods.push(mod);
  }

  remove(id) {
    const mod = this.byId.get(id);
    if (!mod) return;
    this.byId.delete(id);
    this.mods.splice(this.mods.indexOf(mod), 1);
    this.midiMods = this.midiMods.filter((m) => m !== mod);
    this.displayMods = this.displayMods.filter((m) => m !== mod);
    this.smooth = this.smooth.filter((e) => e.arr !== mod.param);
    release(this.inPool, mod.inAt, mod.nIn);
    release(this.outPool, mod.outAt, mod.nOut);
  }

  connect({ slot, from, to }) {
    const a = this.byId.get(from[0]);
    const b = this.byId.get(to[0]);
    if (!a || !b) return;
    if (slot >= MAX_CABLES) throw new Error('out of cables');
    if (this.activePos[slot] >= 0) this.disconnect(slot);
    this.from[slot] = a.outAt + from[1];
    this.to[slot] = b.inAt + to[1];
    this.activePos[slot] = this.nActive;
    this.active[this.nActive++] = slot;
    if (slot + 1 > this.peakLen) this.peakLen = slot + 1;
  }

  disconnect(slot) {
    const pos = this.activePos[slot];
    if (pos < 0) return;
    const last = this.active[--this.nActive];
    this.active[pos] = last;
    this.activePos[last] = pos;
    this.activePos[slot] = -1;
    this.peaks[slot] = 0;
    const to = this.to[slot];
    this.inBuf[to] = this.defaults[to];
  }

  setParam(id, i, v) {
    const mod = this.byId.get(id);
    if (!mod) return;
    const pd = mod.paramDefs[i];
    if (pd.step) {
      mod.param[i] = v;
      return;
    }
    const entry = this.smooth.find((e) => e.arr === mod.param && e.i === i);
    if (entry) entry.target = v;
    else this.smooth.push({ arr: mod.param, i, target: v, eps: (pd.max - pd.min) * 1e-5 });
  }

  runSmoothing() {
    const list = this.smooth;
    const c = this.smoothCoef;
    for (let k = list.length - 1; k >= 0; k--) {
      const e = list[k];
      const diff = e.target - e.arr[e.i];
      if (diff < e.eps && diff > -e.eps) {
        e.arr[e.i] = e.target;
        list[k] = list[list.length - 1];
        list.pop();
      } else {
        e.arr[e.i] += diff * c;
      }
    }
  }

  postFrame() {
    const displays = [];
    for (const m of this.displayMods) {
      const data = m.def.display(m.state);
      if (data) displays.push({ id: m.id, data: data.slice() });
    }
    this.port.postMessage({
      type: 'frame',
      peaks: this.peaks.slice(0, this.peakLen),
      clip: this.clip.slice(0, MAX_CHANNELS),
      displays,
      busy: this.busy,
      span: (this.framePeriod / sampleRate) * 1000,
    });
    this.peaks.fill(0, 0, this.peakLen);
    this.clip.fill(0);
    this.busy = 0;
  }

  process(inputs, outputs) {
    const t0 = Date.now();
    const out = outputs[0];
    const frames = out[0].length;
    const channels = Math.min(out.length, MAX_CHANNELS);
    const input = inputs[0] || [];
    const inChannels = Math.min(input.length, MAX_CHANNELS);

    const { mods, inBuf, outBuf, from, to, active, peaks, host, dcX, dcY, limit, clip } = this;
    const { limitRelease, dcCoef } = this;
    const hostIn = host.in;
    const hostOut = host.out;
    const nMods = mods.length;
    const nCables = this.nActive;

    for (let f = 0; f < frames; f++) {
      for (let c = 0; c < inChannels; c++) hostIn[c] = input[c][f];
      if (this.smooth.length) this.runSmoothing();

      for (let i = 0; i < nMods; i++) {
        const m = mods[i];
        const b = m.bypass;
        if (b === null || (b.mix === 0 && m.param[b.p] === 0)) {
          m.process(m.state, m.in, m.out, m.param);
          continue;
        }
        // bypass: fade between the module and its inputs; fully bypassed
        // modules are not run at all
        const target = m.param[b.p];
        if (b.mix !== target) b.mix = target > b.mix ? Math.min(1, b.mix + b.step) : Math.max(0, b.mix - b.step);
        const mi = m.in;
        const mo = m.out;
        const src = b.src;
        if (b.mix === 1) {
          for (let k = 0; k < src.length; k++) mo[k] = src[k] < 0 ? 0 : mi[src[k]];
          continue;
        }
        m.process(m.state, mi, mo, m.param);
        const w = b.mix;
        for (let k = 0; k < src.length; k++) mo[k] = mo[k] * (1 - w) + (src[k] < 0 ? 0 : mi[src[k]] * w);
      }

      // A patched input is the sum of its cables; the default only applies
      // while nothing is patched (disconnect restores it).
      for (let k = 0; k < nCables; k++) inBuf[to[active[k]]] = 0;
      for (let k = 0; k < nCables; k++) {
        const slot = active[k];
        let v = outBuf[from[slot]];
        if (v !== v) v = 0;
        else if (v > RAIL) v = RAIL;
        else if (v < -RAIL) v = -RAIL;
        inBuf[to[slot]] += v;
        const a = v < 0 ? -v : v;
        if (a > peaks[slot]) peaks[slot] = a;
      }

      for (let c = 0; c < MAX_CHANNELS; c++) {
        let x = hostOut[c];
        hostOut[c] = 0;
        if (c >= channels) continue;
        if (x !== x || x === Infinity || x === -Infinity) x = 0;
        const y = x - dcX[c] + dcCoef * dcY[c];
        dcX[c] = x;
        dcY[c] = y < 1e-20 && y > -1e-20 ? 0 : y;
        const a = y < 0 ? -y : y;
        let env = limit[c] * limitRelease;
        if (a > env) env = a;
        limit[c] = env;
        if (env > 1) clip[c] = 1;
        out[c][f] = env > 1 ? y / env : y;
      }
    }

    if (this.midiLen) {
      this.port.postMessage({ type: 'midi', data: this.midiQueue.slice(0, this.midiLen) });
      this.midiLen = 0;
    }

    if (this.recording) {
      const data = new Float32Array(frames * channels);
      for (let c = 0; c < channels; c++) {
        const buf = out[c];
        for (let f = 0; f < frames; f++) data[f * channels + c] = buf[f];
      }
      this.port.postMessage({ type: 'rec', channels, data }, [data.buffer]);
    }

    this.busy += Date.now() - t0;
    this.sinceFrame += frames;
    if (this.sinceFrame >= this.framePeriod) {
      this.sinceFrame -= this.framePeriod;
      this.postFrame();
    }
    return true;
  }
}

registerProcessor('aparat', Aparat);
