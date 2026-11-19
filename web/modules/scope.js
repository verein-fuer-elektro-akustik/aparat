// Oscilloscope with a frequency analyser. In wave mode it shows one sweep of
// `time`, started on a rising zero crossing. In fft mode it shows the spectrum
// from 20 Hz to the Nyquist frequency on a log scale, -90 to 0 dB (0 dB is a
// ±5 V sine), and `time` sets how long the spectrum is averaged.
//
// The spectrum is drawn as BARS bars, the wave as a trace of POINTS points.
// The grid: in wave mode every 2 V and a twentieth of `time`, in fft mode
// every 10 dB and at 30, 40 … 90, 100, 200 … 900, 1000, 2000 … Hz.

const POINTS = 256;
const BARS = 64;
const N = 2048; // fft size
const LOW = 20; // hz, the left edge of the spectrum
const FLOOR = -90; // db, the bottom of the spectrum

const WAVE_GRID = {
  x: Array.from({ length: 19 }, (_, k) => (k + 1) / 20),
  y: Array.from({ length: 11 }, (_, k) => (k * 2 - 10 + 12) / 24),
};

// in place radix-2 fft, re and im of length n (a power of two)
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    const wr = Math.cos(a);
    const wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k;
        const q = p + len / 2;
        const tr = re[q] * cr - im[q] * ci;
        const ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr;
        im[q] = im[p] - ti;
        re[p] += tr;
        im[p] += ti;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

export default {
  name: 'scope',
  doc: 'Oscilloscope; with fft on, a frequency analyser.',
  cols: 4,
  inputs: { in: 0 },
  outputs: ['thru'],
  params: {
    time: { min: 0.002, max: 2, default: 0.02, curve: 'exp', format: (v) => `${(v * 1000).toFixed(1)} ms` },
    fft: { min: 0, max: 1, default: 0, step: 1, format: (v) => (v ? 'on' : 'off') },
  },
  create(sr) {
    // the bins each bar of the spectrum covers, log spaced
    const lo = new Float32Array(BARS);
    const hi = new Float32Array(BARS);
    const top = sr / 2;
    for (let k = 0; k < BARS; k++) {
      const f0 = LOW * (top / LOW) ** (k / BARS);
      const f1 = LOW * (top / LOW) ** ((k + 1) / BARS);
      lo[k] = (f0 * N) / sr;
      hi[k] = Math.min((f1 * N) / sr, N / 2);
    }
    const window = new Float32Array(N);
    for (let i = 0; i < N; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    const decade = (f) => Math.log(f / LOW) / Math.log(top / LOW);
    return {
      sr,
      fftGrid: {
        x: [10, 100, 1000, 10000]
          .flatMap((d) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => k * d))
          .filter((f) => f > LOW && f < top)
          .map(decade),
        y: [-10, -20, -30, -40, -50, -60, -70, -80].map((db) => (db - FLOOR) / -FLOOR),
      },
      write: new Float32Array(POINTS),
      shown: new Float32Array(POINTS),
      fresh: false,
      n: POINTS,
      acc: 0,
      waited: 0,
      prev: 0,
      // fft mode
      mode: 0,
      time: 0.02,
      ring: new Float32Array(N),
      at: 0,
      since: 0,
      re: new Float64Array(N),
      im: new Float64Array(N),
      power: new Float64Array(N / 2 + 1),
      bars: new Float32Array(BARS),
      window,
      lo,
      hi,
    };
  },
  process(s, i, o, p) {
    const v = i[0];
    o[0] = v;
    s.time = p[0];
    s.mode = p[1];
    if (s.mode) {
      s.ring[s.at] = v;
      s.at = (s.at + 1) & (N - 1);
      s.since++;
      return;
    }
    if (s.n >= POINTS) {
      s.waited++;
      if ((s.prev <= 0 && v > 0) || s.waited > s.sr * 0.1) {
        s.n = 0;
        s.acc = 0;
        s.waited = 0;
      }
    }
    s.prev = v;
    if (s.n < POINTS) {
      s.acc += POINTS / (p[0] * s.sr);
      if (s.acc >= 1) {
        s.acc -= Math.floor(s.acc);
        s.write[s.n++] = v;
        if (s.n === POINTS) {
          s.shown.set(s.write);
          s.fresh = true;
        }
      }
    }
  },
  display(s) {
    if (s.mode) return spectrum(s);
    if (!s.fresh) return null;
    s.fresh = false;
    return { trace: s.shown, grid: WAVE_GRID };
  },
};

function spectrum(s) {
  if (!s.since) return null;
  const { re, im, ring, window, power } = s;
  for (let i = 0; i < N; i++) {
    re[i] = ring[(s.at + i) & (N - 1)] * window[i];
    im[i] = 0;
  }
  fft(re, im);
  // average the power over `time`, with one step per frame
  const c = 1 - Math.exp(-s.since / (s.time * s.sr));
  s.since = 0;
  // a ±5 V sine through the hann window peaks at 5 N / 4
  const norm = (4 / (5 * N)) ** 2;
  for (let k = 0; k <= N / 2; k++) power[k] += c * ((re[k] * re[k] + im[k] * im[k]) * norm - power[k]);
  for (let k = 0; k < BARS; k++) {
    // the loudest bin within the bar, or between two bins interpolated
    let pw = 0;
    const a = Math.ceil(s.lo[k]);
    const b = Math.ceil(s.hi[k]);
    if (b > a) {
      for (let j = a; j < b; j++) pw = Math.max(pw, power[j]);
    } else {
      const x = (s.lo[k] + s.hi[k]) / 2;
      const j = Math.floor(x);
      pw = power[j] + (x - j) * (power[Math.min(j + 1, N / 2)] - power[j]);
    }
    const db = Math.max(FLOOR, 10 * Math.log10(pw + 1e-20));
    s.bars[k] = (db - FLOOR) / -FLOOR;
  }
  return { bars: s.bars, grid: s.fftGrid };
}
