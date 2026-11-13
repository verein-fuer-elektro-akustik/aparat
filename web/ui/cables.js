// One canvas above the panels. Every cable changes on every frame, so it is
// redrawn whole. Alpha values are bucketed to keep the number of strokes small.

const SEGMENTS = 32;
const BUCKETS = 8;
const BASE = 0.12;
const WAVE_K = 0.7;
const WAVE_SPEED = 7;
// Hovered cables get colour so they stand out from the grey patch. Several
// cables on one jack each get their own, starting with the velak accent.
const HOVER_COLOURS = ['#ed2c3e', '#f5a623', '#3ec7e0', '#7ed957', '#b48cff', '#ff7ab8'];

function curve(x0, y0, x1, y1) {
  const pts = new Float32Array((SEGMENTS + 1) * 2);
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const sag = Math.min(140, dist * 0.35 + 24);
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    pts[i * 2] = (a + b) * x0 + (c + d) * x1;
    pts[i * 2 + 1] = a * y0 + b * (y0 + sag) + c * (y1 + sag) + d * y1;
  }
  return pts;
}

export class CableLayer {
  constructor(canvas, scroller) {
    this.canvas = canvas;
    this.scroller = scroller;
    this.ctx = canvas.getContext('2d');
    this.list = [];
    this.bySlot = [];
    this.ghost = null;
    this.zoom = 1;
    this.highlight = new Set();
    this.selected = null;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    const loop = (ms) => {
      this.draw(ms / 1000);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  resize() {
    const dpr = devicePixelRatio || 1;
    this.dpr = dpr;
    this.canvas.width = Math.round(this.canvas.clientWidth * dpr);
    this.canvas.height = Math.round(this.canvas.clientHeight * dpr);
  }

  add(cable) {
    cable.hist = new Float32Array(SEGMENTS);
    cable.head = 0;
    this.list.push(cable);
    this.bySlot[cable.slot] = cable;
  }

  remove(cable) {
    this.list.splice(this.list.indexOf(cable), 1);
    this.bySlot[cable.slot] = undefined;
    this.highlight.delete(cable);
    if (this.selected === cable) this.selected = null;
  }

  // cables drawn in colour on top, e.g. those on a hovered jack
  setHighlight(list) {
    this.highlight = new Set(list ?? []);
  }

  // The cable whose curve passes within tol of (x, y) in rack coordinates.
  hit(x, y, tol) {
    let best = null;
    let bestD = tol * tol;
    for (const c of this.list) {
      const p = c.pts;
      for (let i = 0; i < SEGMENTS; i++) {
        const ax = p[i * 2];
        const ay = p[i * 2 + 1];
        const dx = p[i * 2 + 2] - ax;
        const dy = p[i * 2 + 3] - ay;
        const len = dx * dx + dy * dy;
        let t = len ? ((x - ax) * dx + (y - ay) * dy) / len : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + t * dx - x;
        const ey = ay + t * dy - y;
        const d = ex * ex + ey * ey;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    return best;
  }

  // after audio stops: no level, so no animation
  clearLevels() {
    for (const c of this.list) c.hist.fill(0);
  }

  setPoints(cable, a, b) {
    cable.pts = curve(a.x, a.y, b.x, b.y);
  }

  setGhost(a, b) {
    this.ghost = a ? curve(a.x, a.y, b.x, b.y) : null;
  }

  setPeaks(peaks) {
    for (const c of this.list) {
      const peak = c.slot < peaks.length ? peaks[c.slot] : 0;
      c.head = (c.head + SEGMENTS - 1) % SEGMENTS;
      c.hist[c.head] = Math.min(1, Math.sqrt(peak / 5));
    }
  }

  draw(t) {
    const { ctx, scroller, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    ctx.translate(-scroller.scrollLeft, -scroller.scrollTop);
    ctx.scale(this.zoom, this.zoom);
    ctx.lineCap = 'round';

    const base = new Path2D();
    const buckets = Array.from({ length: BUCKETS }, () => new Path2D());
    const moving = !this.reduced.matches;

    for (const c of this.list) {
      const pts = c.pts;
      base.moveTo(pts[0], pts[1]);
      for (let i = 1; i <= SEGMENTS; i++) base.lineTo(pts[i * 2], pts[i * 2 + 1]);
      for (let i = 0; i < SEGMENTS; i++) {
        const level = c.hist[(c.head + i) % SEGMENTS];
        if (level < 0.02) continue;
        const wave = moving ? 0.6 + 0.4 * Math.sin(i * WAVE_K - t * WAVE_SPEED) : 1;
        const bucket = Math.min(BUCKETS - 1, Math.floor(level * wave * BUCKETS));
        const path = buckets[bucket];
        path.moveTo(pts[i * 2], pts[i * 2 + 1]);
        path.lineTo(pts[i * 2 + 2], pts[i * 2 + 3]);
      }
    }

    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(128, 128, 128, ${BASE + 0.25})`;
    ctx.stroke(base);

    ctx.lineWidth = 2.5;
    for (let b = 0; b < BUCKETS; b++) {
      ctx.strokeStyle = `rgba(200, 200, 200, ${(b + 1) / BUCKETS})`;
      ctx.stroke(buckets[b]);
    }

    // the selected cable stays lit in the accent colour, hovered ones on top
    const shown = [...this.highlight];
    if (this.selected && !this.highlight.has(this.selected)) shown.unshift(this.selected);
    if (shown.length) {
      const lit = shown.map((c) => {
        const path = new Path2D();
        path.moveTo(c.pts[0], c.pts[1]);
        for (let i = 1; i <= SEGMENTS; i++) path.lineTo(c.pts[i * 2], c.pts[i * 2 + 1]);
        return path;
      });
      // dark halo first, so a lit cable reads clearly where it crosses others
      ctx.lineWidth = 7;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      for (const path of lit) ctx.stroke(path);
      ctx.lineWidth = 3.5;
      lit.forEach((path, k) => {
        ctx.strokeStyle = HOVER_COLOURS[k % HOVER_COLOURS.length];
        ctx.stroke(path);
      });
    }

    if (this.ghost) {
      const g = this.ghost;
      ctx.beginPath();
      ctx.moveTo(g[0], g[1]);
      for (let i = 1; i <= SEGMENTS; i++) ctx.lineTo(g[i * 2], g[i * 2 + 1]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#9c9c9c';
      ctx.stroke();
    }
  }
}
