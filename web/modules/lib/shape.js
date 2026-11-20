// Helpers for drawing module shapes on the panel (see shape() in
// modules/index.js).

// The width of a stage of t seconds, growing with the log of the time, so
// that 1 ms and 10 s both show.
export const width = (t) => 1 + Math.log10(1 + t / 0.005);

// samples a shape of stages (relative widths, level(u) for u 0..1)
export function drawStages(widths, level, n = 160) {
  const total = widths.reduce((a, b) => a + b, 0);
  const rel = widths.map((w) => w / total);
  const start = [];
  let x = 0;
  for (const w of rel) {
    start.push(x);
    x += w;
  }
  const y = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const pos = k / (n - 1);
    let seg = rel.length - 1;
    while (seg > 0 && pos < start[seg]) seg--;
    y[k] = level[seg](rel[seg] > 0 ? Math.min(1, (pos - start[seg]) / rel[seg]) : 1);
  }
  return { y, start, widths: rel, marks: start.slice(1) };
}

