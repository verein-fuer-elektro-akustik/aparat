// Master clock in bpm. Gates at 50% duty for bar, quarter, eighth and
// sixteenth notes. Swing delays every second sixteenth. Starting (run going
// high) or a reset trigger restarts at the top of the bar and sends a short
// reset pulse, so sequencers can follow. On a restart the gates are low for
// one sample, so the first step always starts with a rising edge, even when a
// gate was high at the moment of the reset.

const pct = (v) => `${Math.round(v * 100)}%`;

export default {
  name: 'clock',
  cols: 3,
  inputs: { run: 10, reset: 0 },
  outputs: ['bar', '4th', '8th', '16th', 'reset'],
  params: {
    bpm: { min: 30, max: 300, default: 120, format: (v) => `${v.toFixed(1)} bpm` },
    swing: { min: 0, max: 0.5, default: 0, format: pct },
    run: { min: 0, max: 1, default: 1, step: 1, format: (v) => (v ? 'on' : 'off') },
  },
  create: (sr) => ({ sr, ph: 0, running: false, reset: false, pulse: 0 }),
  process(s, i, o, p) {
    const run = p[2] > 0.5 && i[0] > 1;
    const reset = i[1] > 1;
    const restart = (run && !s.running) || (reset && !s.reset);
    if (restart) {
      s.ph = 0;
      s.pulse = Math.round(s.sr * 0.005);
    }
    s.running = run;
    s.reset = reset;
    o[4] = s.pulse > 0 ? 10 : 0;
    if (s.pulse > 0) s.pulse--;
    if (!run || restart) {
      o[0] = o[1] = o[2] = o[3] = 0;
      return;
    }
    // ph counts sixteenths
    const ph = s.ph;
    const pair = ph % 2;
    const odd = 1 + p[1];
    o[0] = ph % 16 < 8 ? 10 : 0;
    o[1] = ph % 4 < 2 ? 10 : 0;
    o[2] = pair < 1 ? 10 : 0;
    o[3] = pair < 0.5 || (pair >= odd && pair < odd + 0.5) ? 10 : 0;
    s.ph += (p[0] * 4) / 60 / s.sr;
    if (s.ph >= 64) s.ph -= 64;
  },
};
