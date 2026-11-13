// Hardware and budget test worklet: per-channel tones, message round trip,
// and a per-sample module graph with realistic dummy DSP.

const TAU = Math.PI * 2;

const now = typeof performance !== 'undefined' && performance.now
  ? () => performance.now()
  : () => Date.now();
const clockName = typeof performance !== 'undefined' && performance.now
  ? 'performance.now'
  : 'Date.now (1 ms steps, averages are still valid, single-block values are coarse)';

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const defs = [
  {
    name: 'vco',
    inputs: { pitch: 0, fm: 0 },
    outputs: ['out'],
    params: { tune: { min: -2, max: 2 } },
    create: (sr) => ({ sr, phase: 0 }),
    process(s, i, o, p) {
      const f = Math.min(12000, Math.abs(261.63 * Math.pow(2, i[0] + p[0]) * (1 + i[1] * 0.1)));
      const dt = f / s.sr;
      s.phase += dt;
      if (s.phase >= 1) s.phase -= 1;
      const t = s.phase;
      let v = 2 * t - 1;
      if (t < dt) {
        const x = t / dt;
        v -= x + x - x * x - 1;
      } else if (t > 1 - dt) {
        const x = (t - 1) / dt;
        v -= x * x + x + x + 1;
      }
      o[0] = v * 5;
    },
  },
  {
    name: 'lfo',
    inputs: { rate: 0 },
    outputs: ['out'],
    params: { rate: { min: 0.05, max: 20 } },
    create: (sr) => ({ sr, phase: 0 }),
    process(s, i, o, p) {
      s.phase += (p[0] * (1 + i[0] * 0.1)) / s.sr;
      if (s.phase >= 1) s.phase -= 1;
      else if (s.phase < 0) s.phase += 1;
      o[0] = 5 * Math.sin(TAU * s.phase);
    },
  },
  {
    name: 'vca',
    inputs: { in: 0, cv: 5 },
    outputs: ['out'],
    params: { gain: { min: 0, max: 1 } },
    create: () => ({}),
    process(s, i, o, p) {
      o[0] = i[0] * p[0] * (i[1] / 5);
    },
  },
  {
    name: 'svf',
    inputs: { in: 0, cutoff: 0 },
    outputs: ['out'],
    params: { cutoff: { min: 40, max: 8000 }, damp: { min: 0.2, max: 2 } },
    create: (sr) => ({ sr, ic1: 0, ic2: 0 }),
    process(s, i, o, p) {
      const f = clamp(p[0] * Math.pow(2, i[1]), 20, s.sr * 0.45);
      const g = Math.tan((Math.PI * f) / s.sr);
      const a1 = 1 / (1 + g * (g + p[1]));
      const a2 = g * a1;
      const a3 = g * a2;
      const v3 = i[0] - s.ic2;
      const v1 = a1 * s.ic1 + a2 * v3;
      const v2 = s.ic2 + a2 * s.ic1 + a3 * v3;
      s.ic1 = 2 * v1 - s.ic1;
      s.ic2 = 2 * v2 - s.ic2;
      o[0] = v2;
    },
  },
  {
    name: 'env',
    inputs: { gate: 0 },
    outputs: ['out'],
    params: { attack: { min: 0.001, max: 0.02 }, release: { min: 0.0001, max: 0.002 } },
    create: () => ({ v: 0, gate: false }),
    process(s, i, o, p) {
      s.gate = i[0] > 1;
      s.v += ((s.gate ? 1 : 0) - s.v) * (s.gate ? p[0] : p[1]);
      o[0] = s.v * 10;
    },
  },
  {
    name: 'noise',
    inputs: {},
    outputs: ['out'],
    params: {},
    create: () => ({ x: 2463534242 }),
    process(s, i, o) {
      s.x ^= s.x << 13;
      s.x ^= s.x >>> 17;
      s.x ^= s.x << 5;
      o[0] = ((s.x | 0) / 2147483648) * 5;
    },
  },
  {
    name: 'mixer',
    inputs: { a: 0, b: 0, c: 0, d: 0 },
    outputs: ['out'],
    params: { level: { min: 0, max: 1 } },
    create: () => ({}),
    process(s, i, o, p) {
      o[0] = (i[0] + i[1] + i[2] + i[3]) * p[0];
    },
  },
  {
    name: 'delay',
    inputs: { in: 0, feedback: 0 },
    outputs: ['out'],
    params: { time: { min: 0.001, max: 0.24 } },
    create: (sr) => ({ sr, buf: new Float32Array(Math.ceil(sr * 0.25)), w: 0 }),
    process(s, i, o, p) {
      const len = s.buf.length;
      const d = p[0] * s.sr;
      let r = s.w - d;
      if (r < 0) r += len;
      const a = r | 0;
      const b = a + 1 === len ? 0 : a + 1;
      const frac = r - a;
      const v = s.buf[a] + (s.buf[b] - s.buf[a]) * frac;
      s.buf[s.w] = i[0] + v * i[1] * 0.05;
      s.w = s.w + 1 === len ? 0 : s.w + 1;
      o[0] = v;
    },
  },
  {
    name: 'fold',
    inputs: { in: 0, amount: 0 },
    outputs: ['out'],
    params: { drive: { min: 0.1, max: 3 } },
    create: () => ({}),
    process(s, i, o, p) {
      o[0] = 5 * Math.sin(i[0] * (1 + p[0] * (1 + i[1] * 0.1)));
    },
  },
];

function build(count, sr) {
  const r = rng(1234);
  const specs = [];
  let nIn = 0;
  let nOut = 0;
  for (let n = 0; n < count; n++) {
    const def = defs[n % defs.length];
    const inputs = Object.values(def.inputs);
    specs.push({ def, inputs, inAt: nIn, outAt: nOut });
    nIn += inputs.length;
    nOut += def.outputs.length;
  }
  const inBuf = new Float64Array(nIn);
  const outBuf = new Float64Array(nOut);
  const defaults = new Float64Array(nIn);
  const mods = specs.map(({ def, inputs, inAt, outAt }) => {
    inputs.forEach((v, k) => {
      defaults[inAt + k] = v;
      inBuf[inAt + k] = v;
    });
    const params = Object.values(def.params);
    const param = new Float64Array(params.length);
    params.forEach((q, k) => {
      param[k] = q.min + r() * (q.max - q.min);
    });
    return {
      process: def.process,
      state: def.create(sr),
      in: inBuf.subarray(inAt, inAt + inputs.length),
      out: outBuf.subarray(outAt, outAt + def.outputs.length),
      param,
    };
  });
  const from = [];
  const to = [];
  for (let k = 0; k < nIn; k++) {
    if (r() < 0.7) {
      from.push(Math.floor(r() * nOut));
      to.push(k);
    }
  }
  return {
    mods,
    inBuf,
    outBuf,
    defaults,
    from: Int32Array.from(from),
    to: Int32Array.from(to),
    peaks: new Float32Array(from.length),
  };
}

function step(g, frames) {
  const { mods, inBuf, outBuf, defaults, from, to, peaks } = g;
  const n = mods.length;
  const c = from.length;
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < n; i++) {
      const m = mods[i];
      m.process(m.state, m.in, m.out, m.param);
    }
    for (let k = 0; k < c; k++) {
      inBuf[to[k]] = defaults[to[k]];
    }
    for (let k = 0; k < c; k++) {
      let v = outBuf[from[k]];
      if (v !== v) v = 0;
      else if (v > 10) v = 10;
      else if (v < -10) v = -10;
      inBuf[to[k]] += v;
      const a = v < 0 ? -v : v;
      if (a > peaks[k]) peaks[k] = a;
    }
  }
}

class TestProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.reported = false;
    this.gain = 0;
    this.gainTarget = 0;
    this.phase = new Float64Array(32);
    this.env = new Float64Array(32);
    this.target = new Float64Array(32);
    this.bench = null;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    switch (m.type) {
      case 'gain':
        this.gainTarget = m.value;
        break;
      case 'tone':
        this.target[m.ch] = m.on ? 1 : 0;
        break;
      case 'allOff':
        this.target.fill(0);
        break;
      case 'ping':
        this.port.postMessage({ type: 'pong', t: m.t });
        break;
      case 'bench':
        this.target.fill(0);
        this.bench = {
          graph: build(m.modules, sampleRate),
          modules: m.modules,
          warm: Math.floor(0.75 * sampleRate),
          left: Math.floor(1.5 * sampleRate),
          postEvery: Math.round(sampleRate / 30),
          sincePost: 0,
          sum: 0,
          blocks: 0,
          max: 0,
          over: 0,
          postSum: 0,
          posts: 0,
        };
        break;
    }
  }

  runBench(frames) {
    const b = this.bench;
    const warming = b.warm > 0;
    const t0 = now();
    step(b.graph, frames);
    let posted = false;
    if (warming) {
      b.graph.peaks.fill(0);
    } else {
      b.sincePost += frames;
      if (b.sincePost >= b.postEvery) {
        b.sincePost -= b.postEvery;
        this.port.postMessage({ type: 'peaks', peaks: b.graph.peaks.slice() });
        b.graph.peaks.fill(0);
        posted = true;
      }
    }
    const dt = now() - t0;
    if (warming) {
      b.warm -= frames;
      return;
    }
    const budget = (frames / sampleRate) * 1000;
    b.sum += dt;
    b.blocks++;
    if (dt > b.max) b.max = dt;
    if (dt > budget) b.over++;
    if (posted) {
      b.postSum += dt;
      b.posts++;
    }
    b.left -= frames;
    if (b.left <= 0) {
      const plain = b.blocks - b.posts;
      this.port.postMessage({
        type: 'benchResult',
        modules: b.modules,
        cables: b.graph.from.length,
        avgMs: b.sum / b.blocks,
        budgetMs: budget,
        maxMs: b.max,
        over: b.over,
        blocks: b.blocks,
        postAvgMs: b.posts ? b.postSum / b.posts : 0,
        plainAvgMs: plain ? (b.sum - b.postSum) / plain : 0,
        posts: b.posts,
        clock: clockName,
      });
      this.bench = null;
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const frames = out[0].length;
    if (!this.reported) {
      this.reported = true;
      this.port.postMessage({
        type: 'started',
        channels: out.length,
        frames,
        sampleRate,
      });
    }
    if (this.bench) this.runBench(frames);
    for (let ch = 0; ch < out.length && ch < 32; ch++) {
      if (this.env[ch] === 0 && this.target[ch] === 0) continue;
      const buf = out[ch];
      const inc = (110 * Math.pow(2, ch / 6)) / sampleRate;
      let phase = this.phase[ch];
      let env = this.env[ch];
      let gain = this.gain;
      const target = this.target[ch];
      for (let i = 0; i < frames; i++) {
        env += (target - env) * 0.003;
        gain += (this.gainTarget - gain) * 0.003;
        phase += inc;
        if (phase >= 1) phase -= 1;
        buf[i] = Math.sin(TAU * phase) * env * gain;
      }
      this.phase[ch] = phase;
      this.env[ch] = target === 0 && env < 1e-5 ? 0 : env;
    }
    this.gain += (this.gainTarget - this.gain) * 0.3;
    return true;
  }
}

registerProcessor('test', TestProcessor);
