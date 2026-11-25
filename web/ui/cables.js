// One canvas above the panels. Every cable changes on every frame, so it is
// redrawn whole. Alpha values are bucketed to keep the number of strokes small.

// colours follows the theme; the cables are drawn every frame anyway
import { colours } from './theme.js';

const SEGMENTS = 32;
const BUCKETS = 8;
const BASE = 0.12;
const WAVE_K = 0.7;
const WAVE_SPEED = 7;
// Hovered cables get colour so they stand out from the grey patch. Several
// cables on one jack each get their own, starting with the velak accent.
const HOVER_COLOURS = ['#ed2c3e', '#f5a623', '#3ec7e0', '#7ed957', '#b48cff', '#ff7ab8'];

// A cable takes on a colour: at an end whose module has a colour of its own,
// that one; else the colour of what it carries (gates, pitch; see def.kinds
// and --cable-gate, --cable-pitch); else it is grey. A cable with two colours
// fades from the one at its start to the one at its end. Colours are toned
// with the theme's cable greys, so they sit with the rest.
const TONE_BASE = 0.7; // share of the colour in the resting cable
const TONE_SIGNAL = 0.55; // and in the signal running along it
const CORE_ALPHA = 0.8;
const CORE = 2.5; // line widths: the cable,
const OUTLINE = 4.5; // its darker edge,
const SHADOW = 1.5; // and how far below its shadow falls
const rgbCache = new Map();
function rgb(hex) {
  if (!rgbCache.has(hex)) rgbCache.set(hex, [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)));
  return rgbCache.get(hex);
}
const parse = (s) => s.split(',').map(Number);
const mix = (a, b, k) => a.map((v, i) => Math.round(v * k + b[i] * (1 - k)));
// the resting and the signal colour of a cable end of colour c ([r, g, b])
function tone(c) {
  const base = parse(colours['cable-base']);
  const signal = parse(colours['cable-signal']);
  if (!c) return { base, signal };
  return { base: mix(c, base, TONE_BASE), signal: mix(c, signal, TONE_SIGNAL) };
}

// what a cable carries: the kind of its output, else of its input, or null
function kindOf(c) {
  const out = c.from.m.def.kinds?.out?.[c.from.m.def.outputs[c.from.i]];
  return out ?? c.to.m.def.kinds?.in?.[Object.keys(c.to.m.def.inputs)[c.to.i]] ?? null;
}

const pathOf = (pts) => {
  const path = new Path2D();
  path.moveTo(pts[0], pts[1]);
  for (let i = 1; i <= SEGMENTS; i++) path.lineTo(pts[i * 2], pts[i * 2 + 1]);
  return path;
};

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
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.list = [];
    this.bySlot = [];
    this.ghost = null;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 }; // the rack's origin in the view (Rack.applyView)
    this.fresh = false; // drawn by redraw() since the last frame
    this.plugs = new Map(); // jack element -> the colour its ring has
    this.highlight = new Set();
    this.selected = null;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    // a frame already drawn by redraw() is not drawn again
    const loop = (ms) => {
      if (this.fresh) this.fresh = false;
      else this.draw(ms / 1000);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // Setting the canvas size clears it, and resize observers run after this
  // frame's draw, so draw again at once: otherwise every step of a window
  // resize shows a frame without cables.
  resize() {
    const dpr = devicePixelRatio || 1;
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (w === this.canvas.width && h === this.canvas.height && dpr === this.dpr) return;
    this.dpr = dpr;
    this.canvas.width = w;
    this.canvas.height = h;
    this.draw(performance.now() / 1000);
  }

  // Draw now, not on the next frame: the view moved, and the panels move
  // with it at once (see Rack.applyView).
  redraw() {
    this.draw(performance.now() / 1000);
    this.fresh = true;
  }

  add(cable) {
    cable.kind = kindOf(cable);
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

  // the colour ([r, g, b]) of a cable's end ('from' or 'to'), or null: grey
  endColour(c, end) {
    const hex = c[end].m?.color;
    if (hex) return rgb(hex);
    return c.kind ? parse(colours[`cable-${c.kind}`]) : null;
  }

  draw(t) {
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    ctx.translate(this.pan.x, this.pan.y);
    ctx.scale(this.zoom, this.zoom);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const moving = !this.reduced.matches;

    // every cable, for the shadow and the edge drawn under all of them
    const all = new Path2D();
    const grey = new Path2D();
    const buckets = Array.from({ length: BUCKETS }, () => new Path2D());
    const coloured = [];
    const plugs = new Map();
    for (const c of this.list) {
      const path = pathOf(c.pts);
      all.addPath(path);
      const from = this.endColour(c, 'from');
      const to = this.endColour(c, 'to');
      if (from || to) {
        const one = { c, path, a: tone(from), b: tone(to) };
        coloured.push(one);
        if (from) plugs.set(c.from.m.jacks.out[c.from.i]?.el, `rgb(${one.a.base})`);
        if (to) plugs.set(c.to.m.jacks.in[c.to.i]?.el, `rgb(${one.b.base})`);
        continue;
      }
      grey.addPath(path);
      this.addSignal(c, t, moving, (k) => buckets[k]);
    }

    ctx.save();
    ctx.translate(0, SHADOW);
    ctx.lineWidth = CORE + 1;
    ctx.strokeStyle = `rgba(${colours['cable-shadow']})`;
    ctx.stroke(all);
    ctx.restore();
    ctx.lineWidth = OUTLINE;
    ctx.strokeStyle = `rgba(${colours['cable-edge']})`;
    ctx.stroke(all);

    ctx.lineWidth = CORE;
    ctx.strokeStyle = `rgba(${colours['cable-base']}, ${CORE_ALPHA})`;
    ctx.stroke(grey);
    ctx.lineWidth = CORE - 0.5;
    for (let k = 0; k < BUCKETS; k++) {
      ctx.strokeStyle = `rgba(${colours['cable-signal']}, ${(k + 1) / BUCKETS})`;
      ctx.stroke(buckets[k]);
    }

    for (const one of coloured) this.drawColoured(one, t, moving);
    this.setPlugs(plugs);

    // the selected cable stays lit in the accent colour, hovered ones on top
    const shown = [...this.highlight];
    if (this.selected && !this.highlight.has(this.selected)) shown.unshift(this.selected);
    if (shown.length) {
      const lit = shown.map((c) => pathOf(c.pts));
      // a halo in the background colour first, so a lit cable reads clearly
      // where it crosses others
      ctx.lineWidth = 7;
      ctx.strokeStyle = `rgba(${colours.halo}, 0.75)`;
      for (const path of lit) ctx.stroke(path);
      ctx.lineWidth = 3.5;
      lit.forEach((path, k) => {
        ctx.strokeStyle = HOVER_COLOURS[k % HOVER_COLOURS.length];
        ctx.stroke(path);
      });
    }

    this.drawGhost();
  }

  // the signal along a cable, its segments sorted into paths by brightness
  // (bucket(k) gives the path of brightness k)
  addSignal(c, t, moving, bucket) {
    const pts = c.pts;
    for (let i = 0; i < SEGMENTS; i++) {
      const level = c.hist[(c.head + i) % SEGMENTS];
      if (level < 0.02) continue;
      const wave = moving ? 0.6 + 0.4 * Math.sin(i * WAVE_K - t * WAVE_SPEED) : 1;
      const path = bucket(Math.min(BUCKETS - 1, Math.floor(level * wave * BUCKETS)));
      path.moveTo(pts[i * 2], pts[i * 2 + 1]);
      path.lineTo(pts[i * 2 + 2], pts[i * 2 + 3]);
    }
  }

  // a cable with a colour at one end or both, as a gradient along it
  drawColoured({ c, path, a, b }, t, moving) {
    const { ctx } = this;
    const pts = c.pts;
    const n = SEGMENTS * 2;
    const gradient = (from, to, alpha) => {
      const g = ctx.createLinearGradient(pts[0], pts[1], pts[n], pts[n + 1]);
      g.addColorStop(0, `rgba(${from}, ${alpha})`);
      g.addColorStop(1, `rgba(${to}, ${alpha})`);
      return g;
    };
    ctx.lineWidth = CORE;
    ctx.strokeStyle = gradient(a.base, b.base, CORE_ALPHA);
    ctx.stroke(path);
    const buckets = [];
    this.addSignal(c, t, moving, (k) => (buckets[k] ??= new Path2D()));
    ctx.lineWidth = CORE - 0.5;
    buckets.forEach((p, k) => {
      if (!p) return;
      ctx.strokeStyle = gradient(a.signal, b.signal, (k + 1) / BUCKETS);
      ctx.stroke(p);
    });
  }

  // A jack with a coloured cable gets its ring in the colour of the cable's
  // end (style.css, --plug); only changes are written to the page.
  setPlugs(plugs) {
    plugs.delete(undefined);
    for (const [el, colour] of this.plugs) if (plugs.get(el) !== colour) el.style.removeProperty('--plug');
    for (const [el, colour] of plugs) if (this.plugs.get(el) !== colour) el.style.setProperty('--plug', colour);
    this.plugs = plugs;
  }

  drawGhost() {
    const { ctx } = this;
    if (this.ghost) {
      const g = this.ghost;
      ctx.beginPath();
      ctx.moveTo(g[0], g[1]);
      for (let i = 1; i <= SEGMENTS; i++) ctx.lineTo(g[i * 2], g[i * 2 + 1]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = colours['f-high'];
      ctx.stroke();
    }
  }
}
