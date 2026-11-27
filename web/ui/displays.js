// What a module's display shows, drawn on its canvas in the theme's colours:
// the kinds of display data are listed in modules/index.js (display, shape).

import { colours } from './theme.js';

// a colour from the theme (#rrggbb or rgb()) as [r, g, b]
function rgb(c) {
  const hex = /^#([0-9a-f]{6})$/i.exec(c ?? '');
  if (hex) return [0, 2, 4].map((k) => parseInt(hex[1].slice(k, k + 2), 16));
  const m = (c ?? '').match(/[\d.]+/g);
  return m ? m.slice(0, 3).map(Number) : [128, 128, 128];
}

let pixels = null; // a small canvas the camera picture is put together on

// a line from 0 (bottom) to 1, with vertical marks, horizontal lines and
// a dot on it
function drawCurve(g, w, h, { curve, marks = [], lines = [], dot }, dpr) {
  const line = Math.max(1, Math.round(dpr));
  const pad = 4 * dpr; // room for the dot at the top and bottom
  const y = (v) => h - pad - v * (h - 2 * pad);
  g.fillStyle = colours.edge;
  for (const x of marks) g.fillRect(Math.round(x * w), 0, line, h);
  for (const v of lines) g.fillRect(0, Math.round(y(v)), w, line);
  g.strokeStyle = colours['f-high'];
  g.lineWidth = dpr;
  g.beginPath();
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * w;
    if (i) g.lineTo(x, y(curve[i]));
    else g.moveTo(x, y(curve[i]));
  }
  g.stroke();
  if (dot) {
    g.fillStyle = colours['f-high'];
    g.beginPath();
    g.arc(dot[0] * w, y(dot[1]), 3 * dpr, 0, 2 * Math.PI);
    g.fill();
  }
}

// A small grey picture ({image: {luma, diff}, mirror}) as big pixels in the
// theme's colours, what moves in the brightest, with lines between the
// 3×3 zones. Without a picture, why there is none.
function drawImage(g, w, h, { image, mirror }, dpr) {
  if (!image) {
    g.fillStyle = colours['f-med'];
    g.font = `${10 * dpr}px "JetBrains Mono", monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('camera runs with audio', w / 2, h / 2);
    g.textAlign = 'start';
    return;
  }
  const { luma, diff } = image;
  const n = luma.length;
  const pw = image.w ?? 48;
  const ph = n / pw;
  // dark stays dark in both themes; what moves is drawn in f-high
  const lum = (c) => c[0] * 0.3 + c[1] * 0.6 + c[2] * 0.1;
  const [lo, hi] = [rgb(colours['f-low']), rgb(colours['f-med'])].sort((a, b) => lum(a) - lum(b));
  const top = rgb(colours['f-high']);
  const pix = (pixels ??= document.createElement('canvas'));
  pix.width = pw;
  pix.height = ph;
  const pg = pix.getContext('2d');
  const img = pg.createImageData(pw, ph);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const k = y * pw + (mirror ? pw - 1 - x : x);
      const l = luma[k] / 255;
      const d = Math.min(1, diff[k] / 64);
      const o = 4 * (y * pw + x);
      for (let c = 0; c < 3; c++) {
        const base = lo[c] + (hi[c] - lo[c]) * l;
        img.data[o + c] = base + (top[c] - base) * d;
      }
      img.data[o + 3] = 255;
    }
  }
  pg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(pix, 0, 0, w, h);
  const line = Math.max(1, Math.round(dpr));
  g.fillStyle = colours.edge;
  for (const k of [1 / 3, 2 / 3]) {
    g.fillRect(Math.round(k * w), 0, line, h);
    g.fillRect(0, Math.round(k * h), w, line);
  }
}

// a touch surface: a crosshair through the point, which grows when pressed
function drawPad(g, w, h, [x, y, press], dpr) {
  const line = Math.max(1, Math.round(dpr));
  const inset = 4 * dpr;
  const px = inset + x * (w - 2 * inset);
  const py = h - inset - y * (h - 2 * inset);
  g.fillStyle = colours.edge;
  for (const k of [0.25, 0.5, 0.75]) {
    g.fillRect(Math.round(k * w), 0, line, h);
    g.fillRect(0, Math.round(k * h), w, line);
  }
  g.fillStyle = colours['f-med'];
  g.fillRect(Math.round(px), 0, line, h);
  g.fillRect(0, Math.round(py), w, line);
  g.fillStyle = colours['f-high'];
  g.beginPath();
  g.arc(px, py, (3 + 5 * press) * dpr, 0, 2 * Math.PI);
  g.fill();
}

// a waveform from min/max pairs, brighter between from and to, with a
// playhead
function drawWave(g, w, h, { wave, from, to, head }, dpr) {
  const line = Math.max(1, Math.round(dpr));
  g.fillStyle = colours.edge;
  g.fillRect(0, Math.round(h / 2), w, line);
  if (!wave) return;
  const n = wave.length / 2;
  const mid = h / 2;
  for (let x = 0; x < w; x += line) {
    // the peaks under this column
    const a = Math.floor((x / w) * n);
    const b = Math.max(a + 1, Math.floor(((x + line) / w) * n));
    let lo = 1;
    let hi = -1;
    for (let k = a; k < b && k < n; k++) {
      lo = Math.min(lo, wave[2 * k]);
      hi = Math.max(hi, wave[2 * k + 1]);
    }
    if (hi < lo) continue;
    const u = x / w;
    g.fillStyle = u >= from && u <= to ? colours['f-high'] : colours['f-low'];
    const top = Math.round(mid - hi * mid * 0.95);
    g.fillRect(x, top, line, Math.max(line, Math.round(mid - lo * mid * 0.95) - top));
  }
  g.fillStyle = colours['f-med'];
  g.fillRect(Math.round(from * w), 0, line, h);
  g.fillRect(Math.min(w - line, Math.round(to * w)), 0, line, h);
  if (head !== null && head !== undefined) {
    g.fillStyle = colours['f-high'];
    g.fillRect(Math.round(head * w), 0, 2 * line, h);
  }
}

// rows of steps, each row stretched over the width: unlit steps small,
// lit ones filled, the current one outlined, bright while it fires
function drawSteps(g, w, h, rows, dpr) {
  const rh = h / rows.length;
  const pad = Math.max(1, Math.round(dpr));
  rows.forEach((row, r) => {
    const cw = w / row.length;
    const y = Math.round(r * rh + pad);
    const ch = Math.round(rh - 2 * pad);
    for (let k = 0; k < row.length; k++) {
      const v = row[k];
      const x = Math.round(k * cw + pad);
      const cwk = Math.max(1, Math.round((k + 1) * cw - pad) - x);
      if (v & 4) g.fillStyle = colours['f-high'];
      else if (v & 1) g.fillStyle = colours['f-low'];
      else g.fillStyle = colours.edge;
      if (v & 1 || v & 4) g.fillRect(x, y, cwk, ch);
      else g.fillRect(x, y + Math.round(ch / 2) - pad, cwk, 2 * pad);
      if (v & 2) {
        g.strokeStyle = colours['f-high'];
        g.lineWidth = pad;
        g.strokeRect(x + pad / 2, y + pad / 2, cwk - pad, ch - pad);
      }
    }
  });
}

// lines of text; with a meter ({peak, rms, hold, marks}, 0 to 1), a level
// bar below them
function drawText(g, w, h, lines, meter, dpr) {
  g.fillStyle = colours['f-high'];
  g.font = `${11 * dpr}px "JetBrains Mono", monospace`;
  g.textBaseline = 'middle';
  const textH = meter ? h - 30 * dpr : h;
  lines.forEach((line, i) => g.fillText(line, 8 * dpr, ((i + 0.5) * textH) / lines.length));
  if (meter) drawMeter(g, w, h, meter, dpr);
}

// a level bar at the bottom: rms filled, peak to its right a step lighter,
// the held peak as a tick, the scale's marks below
function drawMeter(g, w, h, { peak, rms, hold, marks }, dpr) {
  const x0 = 8 * dpr;
  const bw = w - 16 * dpr;
  const bh = 8 * dpr;
  const y = h - 26 * dpr;
  const line = Math.max(1, Math.round(dpr));
  g.fillStyle = colours.edge;
  g.fillRect(x0, y, bw, bh);
  g.fillStyle = colours['f-med'];
  g.fillRect(x0, y, Math.round(peak * bw), bh);
  g.fillStyle = colours['f-high'];
  g.fillRect(x0, y, Math.round(rms * bw), bh);
  if (hold !== null) g.fillRect(x0 + Math.round(hold * bw) - line, y - 2 * dpr, 2 * line, bh + 4 * dpr);
  g.fillStyle = colours['f-med'];
  g.font = `${8 * dpr}px "JetBrains Mono", monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  for (const [at, label] of marks) {
    const x = x0 + Math.round(at * bw);
    g.fillRect(x, y + bh, line, 3 * dpr);
    g.fillText(String(label), x, y + bh + 5 * dpr);
  }
  g.textAlign = 'start';
}

// a trace (±12) or bars (0 to 1 from the bottom) over a grid
function drawTrace(g, w, h, data, dpr) {
  const grid = data.grid ?? { x: [], y: [0.5] };
  g.fillStyle = colours.edge;
  const line = Math.max(1, Math.round(dpr));
  for (const x of grid.x) g.fillRect(Math.round(x * w), 0, line, h);
  for (const y of grid.y) g.fillRect(0, Math.round((1 - y) * h), w, line);
  if (data.bars) {
    const n = data.bars.length;
    g.fillStyle = colours['f-high'];
    for (let i = 0; i < n; i++) {
      const x0 = Math.round((i / n) * w);
      const x1 = Math.round(((i + 1) / n) * w) - line;
      const bh = Math.round(Math.min(1, Math.max(0, data.bars[i])) * h);
      if (bh > 0 && x1 > x0) g.fillRect(x0, h - bh, x1 - x0, bh);
    }
    return;
  }
  const trace = data.trace ?? data;
  g.strokeStyle = colours['f-high'];
  g.lineWidth = dpr;
  g.beginPath();
  for (let i = 0; i < trace.length; i++) {
    const x = (i / (trace.length - 1)) * w;
    const y = h / 2 - (trace[i] / 12) * (h / 2);
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.stroke();
}

// Draw display data on a canvas. Its pixels follow the zoom, so it stays
// sharp. text: {lines, meter} to show instead (def.displayText, displayMeter).
export function paintDisplay(canvas, data, zoom, text) {
  const dpr = (devicePixelRatio || 1) * zoom;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, w, h);
  if (text) drawText(g, w, h, text.lines, text.meter, dpr);
  else if (data.steps) drawSteps(g, w, h, data.steps, dpr);
  else if (data.curve) drawCurve(g, w, h, data, dpr);
  else if (data.pad) drawPad(g, w, h, data.pad, dpr);
  else if ('image' in data) drawImage(g, w, h, data, dpr);
  else if ('wave' in data) drawWave(g, w, h, data, dpr);
  else drawTrace(g, w, h, data, dpr);
}
