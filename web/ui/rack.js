import { registry } from '../modules/index.js';
import { makeKnob } from './knob.js';
import { colours } from './theme.js';
import { defFinder, dependents, flatten, usedComposites } from './composite.js';

// The rack is a grid of square cells. A module is CELLS cells tall, so the
// rack is made of rows CELLS cells high. A module is as many cells wide as it
// has columns of knobs and jacks (def.cols). Keep in sync with --cell in style.css.
const CELL = 48;
const CELLS = 8;
const ROW = CELL * CELLS;
const EDGE = 40;
const CABLE_MARGIN = 8; // room for the cable stroke at the edge of the rack
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;

function div(className, parent) {
  const el = document.createElement('div');
  el.className = className;
  parent?.append(el);
  return el;
}

// A waveform as 512 min/max pairs, for drawing; worked out once per file.
const peakCache = new WeakMap();
function peaksOf(samples) {
  let peaks = peakCache.get(samples);
  if (peaks) return peaks;
  const n = 512;
  peaks = new Float32Array(2 * n);
  const per = samples.length / n;
  for (let k = 0; k < n; k++) {
    let lo = 0;
    let hi = 0;
    const end = Math.min(samples.length, Math.ceil((k + 1) * per));
    for (let i = Math.floor(k * per); i < end; i++) {
      const v = samples[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    peaks[2 * k] = lo;
    peaks[2 * k + 1] = hi;
  }
  peakCache.set(samples, peaks);
  return peaks;
}

export class Rack {
  constructor({ scroller, sizer, content, cables, send, onChange, onContextMenu, onOpen, files, onFile }) {
    this.onContextMenu = onContextMenu ?? (() => {});
    this.onOpen = onOpen ?? (() => {}); // double-click on a module's title
    // audio files of modules like the sampler: files.get(name) is the loaded
    // file or undefined, onFile(m, file) is asked to load one (file: a dropped
    // File, or null to let the user choose)
    this.files = files ?? { get: () => undefined };
    this.onFile = onFile ?? (() => {});
    this.scroller = scroller;
    this.sizer = sizer;
    this.content = content;
    this.zoom = 1;
    this.cables = cables;
    this.send = send;
    this.onChange = onChange;
    this.modules = new Map();
    this.nextId = 1;
    this.freeSlots = [];
    this.nextSlot = 0;
    // the patch's composites by name, and the def of any type
    this.composites = {};
    this.extraDefs = {}; // types only this rack knows (the edit view's jack panels)
    this.defOf = defFinder(registry, {});
    this.selection = new Set();
    this.learning = null;
    this.dragging = false; // a module or cable is being dragged
    this.midiMap = [];
    this.rows = 1;
    this.drop = div('drop', content);
    this.drop.hidden = true;
    // next frame: resizing inside the observer callback would loop
    let resizeQueued = false;
    new ResizeObserver(() => {
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(() => {
        resizeQueued = false;
        this.updateExtent();
      });
    }).observe(scroller);
    // Pan: left-drag on empty rack space, middle-drag anywhere. Capture phase,
    // so a middle-drag over a knob or jack pans instead of turning or patching.
    scroller.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && this.cableAt(e)) {
        // cables are drawn over the panels, so a click on one selects it, also
        // where it crosses a module (but not over a knob, jack or button)
        e.preventDefault();
        e.stopPropagation();
        this.selectCable(this.cableAt(e));
        return;
      }
      if (e.button === 0 && e.target === content && e.shiftKey) this.startBand(e);
      else if (e.button === 1 || (e.button === 0 && e.target === content)) this.startPan(e);
    }, true);
    // stop the browser's middle-click autoscroll
    scroller.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    // Hovering a cable lights it. Jacks light their own cables, so they win.
    this.hoverCable = null;
    scroller.addEventListener('pointermove', (e) => {
      if (e.buttons || e.target.classList.contains('jack')) return;
      // lit only where a click would select it
      const c = this.cableAt(e);
      if (c === this.hoverCable) return;
      this.hoverCable = c;
      this.cables.setHighlight(c ? [c] : null);
    });
    scroller.addEventListener('pointerleave', () => {
      if (!this.hoverCable) return;
      this.hoverCable = null;
      this.cables.setHighlight(null);
    });
    this.updateExtent();
  }

  // patch editing

  add(type, { id, x, row, params, data, color } = {}) {
    const def = this.defOf(type);
    if (!def) return null;
    const keys = Object.keys(def.params);
    const defsList = Object.values(def.params);
    const values = keys.map((k, i) => params?.[k] ?? defsList[i].default);
    const m = {
      id: id ?? this.nextId++,
      type,
      def,
      x: 0,
      row: 0,
      keys,
      values,
      data: data ?? null, // what a note or a file module keeps: {text} or {name}
      knobs: [],
      jacks: { in: [], out: [] },
    };
    this.nextId = Math.max(this.nextId, m.id + 1);
    this.buildPanel(m);
    this.paintColour(m, color);
    const spot = x === undefined ? this.findSpot(def.cols) : { x, row };
    m.x = spot.x;
    m.row = spot.row;
    this.place(m);
    this.modules.set(m.id, m);
    this.measure(m);
    this.sendAdd(m);
    this.updateExtent();
    this.onChange();
    return m;
  }

  // A module's own colour (a #rrggbb, or none): its panel is tinted with it
  // (see .module.coloured in style.css), so it works in both themes.
  setColour(m, color) {
    if (!this.live(m)) return;
    this.paintColour(m, color);
    this.onChange();
  }

  paintColour(m, color) {
    m.color = /^#[0-9a-f]{6}$/i.test(color ?? '') ? color.toLowerCase() : null;
    m.el.classList.toggle('coloured', !!m.color);
    if (m.color) m.el.style.setProperty('--tone', m.color);
    else m.el.style.removeProperty('--tone');
  }

  // Undo and redo rebuild modules as new objects with the same id, so a menu
  // opened before may still hold the old one; operations ignore those.
  live(m) {
    return !!m && this.modules.get(m.id) === m;
  }

  remove(m) {
    if (!this.live(m)) return;
    for (const c of [...this.cables.list]) {
      if (c.from.m === m || c.to.m === m) this.disconnect(c);
    }
    this.midiMap = this.midiMap.filter((e) => e.id !== m.id);
    if (this.learning?.m === m) this.learning = null;
    this.selection.delete(m);
    this.sendRemove(m);
    m.el.remove();
    this.modules.delete(m.id);
    this.updateExtent();
    this.onChange();
  }

  connect(from, to) {
    const exists = this.cables.list.some(
      (c) => c.from.m === from.m && c.from.i === from.i && c.to.m === to.m && c.to.i === to.i,
    );
    if (exists) return null;
    const slot = this.freeSlots.length ? this.freeSlots.pop() : this.nextSlot++;
    const cable = { slot, from, to };
    this.cables.add(cable);
    this.layoutCable(cable);
    this.sendConnect(cable);
    this.updateExtent();
    this.onChange();
    return cable;
  }

  disconnect(cable) {
    this.cables.remove(cable);
    for (const slot of [cable.slot, ...(cable.extra ?? [])]) {
      this.freeSlots.push(slot);
      this.send({ op: 'disconnect', slot });
    }
    this.updateExtent();
    this.onChange();
  }

  clear() {
    for (const m of [...this.modules.values()]) this.remove(m);
    this.freeSlots = [];
    this.nextSlot = 0;
    this.setComposites({});
    this.nextId = 1;
    this.midiMap = [];
  }

  // Add a module at a grid cell, pushing the row's modules aside.
  insert(type, { x, row }, params, data) {
    const m = this.add(type, { params, data });
    if (!m) return null;
    const snap = new Map([...this.modules.values()].map((o) => [o, { x: o.x, row: o.row }]));
    this.arrange(m, x, row, snap, true);
    this.place(m);
    this.relayoutCables();
    this.updateExtent();
    this.onChange();
    return m;
  }

  // Every parameter except bypass to a random value (randomly switching an
  // effect off is not a sound). Going through the knob's normalised
  // range respects exponential curves and steps, and sends each to the engine.
  randomize(m) {
    if (!this.live(m)) return;
    m.knobs.forEach((k, i) => {
      if (m.keys[i] !== 'bypass') k.setNorm(Math.random());
    });
  }

  resetParams(m) {
    if (!this.live(m)) return;
    for (const k of m.knobs) k.reset();
  }

  // A copy with the same settings, right of the original.
  duplicate(m) {
    if (!this.live(m) || m.def.boundary) return null;
    const params = Object.fromEntries(m.keys.map((k, i) => [k, m.values[i]]));
    const copy = this.insert(m.type, { x: m.x + m.def.cols, row: m.row }, params, m.data && { ...m.data });
    if (copy) this.paintColour(copy, m.color);
    this.select(copy);
    return copy;
  }

  // The given modules (default: the selection) with the cables between them,
  // in the format of patch files.
  copy(mods = [...this.selection]) {
    const ids = new Set(mods.filter((m) => this.live(m) && !m.def.boundary).map((m) => m.id));
    const all = this.toJSON();
    const modules = all.modules.filter((m) => ids.has(m.id));
    return {
      modules,
      cables: all.cables.filter((c) => ids.has(c.from[0]) && ids.has(c.to[0])),
      composites: usedComposites(modules, this.composites),
    };
  }

  // Composites from elsewhere (paste): a name already used for a different
  // composite gets a number. Returns the names as they are here.
  mergeComposites(incoming = {}) {
    const rename = {};
    const merged = { ...this.composites };
    for (const [name, spec] of Object.entries(incoming)) {
      let n = name;
      for (let k = 2; (merged[n] || registry[n]) && JSON.stringify(merged[n]) !== JSON.stringify(spec); k++) n = `${name} ${k}`;
      rename[name] = n;
    }
    // inner references follow the renames
    for (const [name, spec] of Object.entries(incoming)) {
      merged[rename[name]] = { ...spec, modules: spec.modules.map((m) => ({ ...m, type: rename[m.type] ?? m.type })) };
    }
    this.setComposites(merged);
    return rename;
  }

  // Add what copy() returned, also from another patch: in new rows below the
  // rack, laid out as they were, and selected.
  paste(data) {
    const rename = this.mergeComposites(data?.composites);
    const list = (data?.modules ?? []).map((p) => ({ ...p, type: rename[p.type] ?? p.type })).filter((p) => this.defOf(p.type));
    if (!list.length) return [];
    const top = Math.min(...list.map((p) => p.row ?? 0));
    const left = Math.min(...list.map((p) => p.x ?? 0));
    const below = Math.max(-1, ...[...this.modules.values()].map((m) => m.row)) + 1;
    const made = new Map();
    for (const p of list) {
      const spot = { x: (p.x ?? 0) - left, row: (p.row ?? 0) - top + below };
      made.set(p.id, this.add(p.type, { ...spot, params: p.params, data: p.data && { ...p.data }, color: p.color }));
    }
    this.unoverlap();
    for (const c of data.cables ?? []) {
      const a = made.get(c.from[0]);
      const b = made.get(c.to[0]);
      if (!a || !b) continue;
      const i = a.def.outputs.indexOf(c.from[1]);
      const j = Object.keys(b.def.inputs).indexOf(c.to[1]);
      if (i >= 0 && j >= 0) this.connect({ m: a, i }, { m: b, i: j });
    }
    const mods = [...made.values()];
    this.select(null);
    for (const m of mods) this.select(m, true);
    mods[0].el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return mods;
  }

  selectAll() {
    this.select(null);
    for (const m of this.modules.values()) this.select(m, true);
  }

  // The grid cell under a point on screen, or null outside the rack.
  cellAt(clientX, clientY) {
    const view = this.scroller.getBoundingClientRect();
    if (clientX < view.left || clientX > view.right || clientY < view.top || clientY > view.bottom) return null;
    const p = this.pointer({ clientX, clientY });
    return {
      x: Math.max(0, Math.floor(p.x / CELL)),
      row: Math.min(this.rows - 1, Math.max(0, Math.floor(p.y / ROW))),
    };
  }

  // zoom

  // Scale the rack. The point under (clientX, clientY), default the middle of
  // the view, stays where it is.
  setZoom(z, clientX, clientY) {
    z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
    const view = this.scroller.getBoundingClientRect();
    const ax = (clientX ?? view.left + view.width / 2) - view.left;
    const ay = (clientY ?? view.top + view.height / 2) - view.top;
    const px = (this.scroller.scrollLeft + ax) / this.zoom;
    const py = (this.scroller.scrollTop + ay) / this.zoom;
    this.zoom = z;
    this.cables.zoom = z;
    this.content.style.transform = z === 1 ? '' : `scale(${z})`;
    // displays draw at the zoomed size, to stay sharp
    for (const m of this.modules.values()) if (m.canvas) this.queuePaint(m);
    this.updateExtent();
    this.scroller.scrollLeft = px * z - ax;
    this.scroller.scrollTop = py * z - ay;
  }

  // engine

  slot() {
    return this.freeSlots.length ? this.freeSlots.pop() : this.nextSlot++;
  }

  // A composite goes to the engine as its inner modules and cables (see
  // composite.js); m.flat says where its jacks and knobs lead.
  sendAdd(m) {
    if (!m.def.composite) {
      this.send({ op: 'add', id: m.id, type: m.type, params: m.values });
      this.sendFile(m);
      return;
    }
    const values = Object.fromEntries(m.keys.map((k, i) => [k, m.values[i]]));
    m.flat = flatten(m.def.composite, String(m.id), values, this.defOf);
    m.innerSlots ??= m.flat.cables.map(() => this.slot());
    for (const x of m.flat.modules) {
      this.send({ op: 'add', id: x.id, type: x.type, params: x.params });
      if (registry[x.type].file && x.data?.name) this.send({ op: 'data', id: x.id, data: this.files.get(x.data.name) ?? null });
    }
    m.flat.cables.forEach((c, k) => this.send({ op: 'connect', slot: m.innerSlots[k], from: c.from, to: c.to }));
  }

  sendRemove(m) {
    if (!m.flat) {
      this.send({ op: 'remove', id: m.id });
      return;
    }
    for (const slot of m.innerSlots ?? []) {
      this.send({ op: 'disconnect', slot });
      this.freeSlots.push(slot);
    }
    m.innerSlots = null;
    for (const x of m.flat.modules) this.send({ op: 'remove', id: x.id });
  }

  sendParam(m, i, v) {
    const at = m.flat ? m.flat.params[i] : [m.id, i];
    if (at) this.send({ op: 'param', id: at[0], i: at[1], v });
  }

  sendFile(m) {
    if (!m.def.file) return;
    const file = m.data?.name ? this.files.get(m.data.name) : undefined;
    this.send({ op: 'data', id: m.id, data: file ?? null });
    m.peaks = file ? peaksOf(file.samples) : null;
    if (m.def.shape) this.queuePaint(m);
    if (m.fileButton) {
      m.fileButton.textContent = m.data?.name ? `${m.data.name}${file ? '' : ' (missing)'}` : 'load file…';
      m.fileButton.title = m.data?.name && !file ? 'this file is not in this browser, click to load it again' : '';
    }
  }

  // The module plays this file from now on (it has to be in `files`).
  setFile(m, name) {
    if (!this.live(m)) return;
    m.data = { name };
    this.sendFile(m);
    this.onChange();
  }

  // A file was loaded: the modules that use it get it.
  fileLoaded(name) {
    for (const m of this.modules.values()) if (m.data?.name === name) this.sendFile(m);
  }

  // names of the files the patch uses
  fileNames() {
    return [...new Set([...this.modules.values()].filter((m) => m.def.file && m.data?.name).map((m) => m.data.name))];
  }

  // A cable into a composite may lead to several inner inputs; the first one
  // uses the cable's slot, the others get slots of their own.
  sendConnect(c) {
    const from = c.from.m.flat ? c.from.m.flat.outputs[c.from.i] : [c.from.m.id, c.from.i];
    const to = c.to.m.flat ? c.to.m.flat.inputs[c.to.i] ?? [] : [[c.to.m.id, c.to.i]];
    if (!from) return;
    c.extra ??= [];
    while (c.extra.length < to.length - 1) c.extra.push(this.slot());
    to.forEach((t, k) => this.send({ op: 'connect', slot: k ? c.extra[k - 1] : c.slot, from, to: t }));
  }

  replay() {
    this.send({ op: 'clear' });
    for (const m of this.modules.values()) this.sendAdd(m);
    for (const c of this.cables.list) this.sendConnect(c);
  }

  // patch files

  toJSON() {
    return {
      v: 2,
      modules: [...this.modules.values()].map((m) => ({
        id: m.id,
        type: m.type,
        x: m.x,
        row: m.row,
        params: Object.fromEntries(m.keys.map((k, i) => [k, m.values[i]])),
        ...(m.data ? { data: m.data } : {}),
        ...(m.color ? { color: m.color } : {}),
      })),
      cables: this.cables.list.map((c) => ({
        from: [c.from.m.id, c.from.m.def.outputs[c.from.i]],
        to: [c.to.m.id, Object.keys(c.to.m.def.inputs)[c.to.i]],
      })),
      midiMap: this.midiMap,
      composites: usedComposites([...this.modules.values()], this.composites),
    };
  }

  setComposites(composites) {
    this.composites = { ...composites };
    const find = defFinder(registry, this.composites);
    this.defOf = (type) => this.extraDefs[type] ?? find(type);
  }

  load(patch) {
    this.clear();
    this.setComposites(patch.composites ?? {});
    // version 1 placed modules on a 15 px grid
    const scale = (patch.v ?? 1) < 2 ? 15 / CELL : 1;
    for (const p of patch.modules ?? []) {
      this.add(p.type, { ...p, x: p.x === undefined ? undefined : Math.round(p.x * scale), row: p.row ?? 0 });
    }
    this.unoverlap();
    for (const c of patch.cables ?? []) {
      const a = this.modules.get(c.from[0]);
      const b = this.modules.get(c.to[0]);
      if (!a || !b) continue;
      const i = a.def.outputs.indexOf(c.from[1]);
      const j = Object.keys(b.def.inputs).indexOf(c.to[1]);
      if (i >= 0 && j >= 0) this.connect({ m: a, i }, { m: b, i: j });
    }
    this.midiMap = (patch.midiMap ?? []).filter((e) => this.modules.has(e.id));
    for (const e of this.midiMap) this.knobFor(e)?.el.classList.add('mapped');
    this.select(null);
  }

  // Bring the rack to a patch by changing only what differs (undo/redo).
  // Modules that stay keep their engine state, so undoing a knob turn does
  // not cut the reverb tail or reset an oscillator.
  apply(patch) {
    // modules of a composite whose inside changed are made anew
    const before = this.composites;
    const after = patch.composites ?? {};
    // a composite has changed when it or one it contains has
    const changedSet = new Set();
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (name in after && JSON.stringify(before[name]) !== JSON.stringify(after[name])) {
        for (const n of dependents(name, { ...before, ...after })) changedSet.add(n);
      }
    }
    const changed = (type) => changedSet.has(type);
    const want = new Map(patch.modules.map((p) => [p.id, p]));
    for (const m of [...this.modules.values()]) {
      if (want.get(m.id)?.type !== m.type || (m.def.composite && changed(m.type))) this.remove(m);
    }
    this.setComposites({ ...before, ...after });
    for (const p of patch.modules) {
      const m = this.modules.get(p.id);
      if (!m) {
        this.add(p.type, p);
        continue;
      }
      m.x = p.x;
      m.row = p.row;
      this.place(m);
      if ((p.color ?? null) !== m.color) this.paintColour(m, p.color);
      if (JSON.stringify(m.data) !== JSON.stringify(p.data ?? null)) {
        m.data = p.data ?? null;
        if (m.textArea) m.textArea.value = m.data?.text ?? '';
        this.sendFile(m);
      }
      m.keys.forEach((k, i) => {
        const v = p.params?.[k] ?? m.def.params[k].default;
        if (v === m.values[i]) return;
        m.values[i] = v;
        m.knobs[i].setValue(v);
        this.sendParam(m, i, v);
      });
      if (m.def.shape) this.queuePaint(m);
    }
    const key = (a, i, b, j) => `${a}:${i}>${b}:${j}`;
    const wanted = new Map();
    for (const c of patch.cables ?? []) {
      const a = this.modules.get(c.from[0]);
      const b = this.modules.get(c.to[0]);
      if (!a || !b) continue;
      const i = a.def.outputs.indexOf(c.from[1]);
      const j = Object.keys(b.def.inputs).indexOf(c.to[1]);
      if (i >= 0 && j >= 0) wanted.set(key(a.id, i, b.id, j), [{ m: a, i }, { m: b, i: j }]);
    }
    for (const c of [...this.cables.list]) {
      const k = key(c.from.m.id, c.from.i, c.to.m.id, c.to.i);
      if (wanted.has(k)) wanted.delete(k);
      else this.disconnect(c);
    }
    for (const [from, to] of wanted.values()) this.connect(from, to);
    for (const e of this.midiMap) this.knobFor(e)?.el.classList.remove('mapped');
    this.midiMap = (patch.midiMap ?? []).filter((e) => this.modules.has(e.id));
    for (const e of this.midiMap) this.knobFor(e)?.el.classList.add('mapped');
    this.relayoutCables();
    this.updateExtent();
    this.onChange();
  }

  // midi learn

  knobFor(entry) {
    const m = this.modules.get(entry.id);
    const i = m ? m.keys.indexOf(entry.param) : -1;
    return i >= 0 ? m.knobs[i] : null;
  }

  armLearn(m, i) {
    const same = this.learning?.m === m && this.learning.i === i;
    if (this.learning) this.learning.m.knobs[this.learning.i].el.classList.remove('learn');
    this.learning = same ? null : { m, i };
    if (this.learning) m.knobs[i].el.classList.add('learn');
    const entry = { id: m.id, param: m.keys[i] };
    if (same) {
      this.midiMap = this.midiMap.filter((e) => e.id !== entry.id || e.param !== entry.param);
      m.knobs[i].el.classList.remove('mapped');
      this.onChange();
    }
  }

  handleCc(channel, cc, value) {
    if (this.learning) {
      const { m, i } = this.learning;
      const knob = m.knobs[i];
      knob.el.classList.remove('learn');
      knob.el.classList.add('mapped');
      this.midiMap = this.midiMap.filter((e) => e.id !== m.id || e.param !== m.keys[i]);
      this.midiMap.push({ id: m.id, param: m.keys[i], channel, cc });
      this.learning = null;
      this.onChange();
    }
    for (const e of this.midiMap) {
      if (e.channel === channel && e.cc === cc) this.knobFor(e)?.setNorm(value / 127);
    }
  }

  // panels

  buildPanel(m) {
    const { def } = m;
    const el = div(def.boundary ? 'module boundary' : 'module', this.content);
    el.style.width = `${def.cols * CELL}px`;
    el.style.height = `${ROW}px`;
    el.style.setProperty('--cols', def.cols);
    m.el = el;

    const title = div('title', el);
    const name = document.createElement('span');
    name.textContent = def.boundary ? def.name : m.type;
    const close = document.createElement('button');
    close.textContent = '×';
    close.setAttribute('aria-label', `remove ${m.type}`);
    close.addEventListener('click', () => this.remove(m));
    const label = document.createElement('div');
    label.className = 'name';
    label.append(name);
    // a composite is marked with two stacked squares, which also open it
    if (def.composite) {
      const open = document.createElement('button');
      open.className = 'open';
      open.title = 'composite: click to edit its inside';
      open.setAttribute('aria-label', `edit composite ${m.type}`);
      open.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="6" height="6"/><rect x="3.5" y="3.5" width="6" height="6"/></svg>';
      open.addEventListener('click', () => this.onOpen(m));
      label.append(open);
    }
    title.append(label, close);
    title.addEventListener('pointerdown', (e) => this.startMove(e, m));
    title.addEventListener('dblclick', (e) => {
      if (!e.target.closest('button')) this.onOpen(m);
    });
    // shift or ctrl adds to (or takes from) the selection; a module that is
    // part of a selection keeps it, so the group can be dragged or right-clicked
    el.addEventListener('pointerdown', (e) => {
      if ((e.shiftKey || e.ctrlKey || e.metaKey) && !e.target.closest('.knob, .jack, button, textarea')) this.select(m, true);
      else if (!this.selection.has(m)) this.select(m);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!this.selection.has(m)) this.select(m);
      this.onContextMenu(e, m);
    });

    if (def.text) {
      const text = document.createElement('textarea');
      text.className = 'text';
      text.spellcheck = false;
      text.placeholder = 'note';
      text.setAttribute('aria-label', 'note');
      text.value = m.data?.text ?? '';
      text.addEventListener('input', () => {
        m.data = text.value ? { text: text.value } : null;
        this.onChange();
      });
      m.textArea = text;
      el.append(text);
    }
    if (def.file) {
      const button = document.createElement('button');
      button.className = 'file';
      button.addEventListener('click', () => this.onFile(m, null));
      m.fileButton = button;
      el.append(button);
      el.addEventListener('dragover', (e) => e.preventDefault());
      el.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files[0];
        // a patch file is left to the window, which loads it
        if (!file || /\.json$/i.test(file.name)) return;
        e.preventDefault();
        this.onFile(m, file);
      });
    }

    if ((def.display && !def.displayKnob) || def.shape) {
      m.canvas = document.createElement('canvas');
      m.canvas.className = 'display';
      if (def.displayHeight) m.canvas.style.height = `${def.displayHeight}px`;
      el.append(m.canvas);
      if (def.shape) this.queuePaint(m);
    }

    if (m.keys.length) {
      const knobs = div('knobs', el);
      const list = Object.values(def.params);
      m.keys.forEach((key, i) => {
        const knob = makeKnob({
          name: key,
          def: list[i],
          value: m.values[i],
          onChange: (v) => {
            this.sendParam(m, i, v);
            if (m.def.shape) this.queuePaint(m);
            // a push button plays, it does not change the patch
            if (list[i].momentary) return;
            m.values[i] = v;
            this.onChange();
          },
          onLearn: () => this.armLearn(m, i),
        });
        knobs.append(knob.el);
        m.knobs.push(knob);
      });
    }

    const inputs = Object.keys(def.inputs);
    const inBox = div('ports inputs', el);
    const outBox = div('ports outputs', el);
    this.buildJacks(m, inBox, 'in', inputs);
    this.buildJacks(m, outBox, 'out', def.outputs);
    if (!inputs.length) inBox.remove();
    if (!def.outputs.length) outBox.remove();
    if (!inputs.length && def.outputs.length) outBox.style.marginTop = 'auto';
  }

  buildJacks(m, box, dir, names) {
    names.forEach((name, i) => {
      const port = div('port', box);
      const jack = div('jack', port);
      jack.setAttribute('aria-label', `${m.type} ${dir === 'in' ? 'input' : 'output'} ${name}`);
      const label = document.createElement('span');
      label.textContent = name;
      port.append(label);
      m.jacks[dir][i] = { el: jack, x: 0, y: 0 };
      jack.dataset.module = m.id;
      jack.dataset.dir = dir;
      jack.dataset.index = i;
      jack.addEventListener('pointerdown', (e) => this.startCable(e, m, dir, i));
      jack.addEventListener('pointerenter', () => {
        this.hoverCable = null;
        this.cables.setHighlight(this.cablesAt(m, dir, i));
      });
      jack.addEventListener('pointerleave', () => this.cables.setHighlight(null));
    });
  }

  cablesAt(m, dir, i) {
    const end = dir === 'out' ? 'from' : 'to';
    return this.cables.list.filter((c) => c[end].m === m && c[end].i === i);
  }

  measure(m) {
    const box = m.el.getBoundingClientRect();
    for (const list of [m.jacks.in, m.jacks.out]) {
      for (const j of list) {
        const r = j.el.getBoundingClientRect();
        j.x = (r.left + r.width / 2 - box.left) / this.zoom;
        j.y = (r.top + r.height / 2 - box.top) / this.zoom;
      }
    }
  }

  place(m) {
    this.setPixels(m, m.x * CELL, m.row * ROW);
  }

  setPixels(m, left, top) {
    m.left = left;
    m.top = top;
    m.el.style.left = `${left}px`;
    m.el.style.top = `${top}px`;
  }

  // Selected are modules or one cable (delete removes them). select(m) selects
  // just m (null: nothing); with add it toggles m in the selection.
  select(m, add = false) {
    if (!add) {
      for (const o of this.selection) o.el.classList.remove('selected');
      this.selection.clear();
    }
    if (!m) return;
    this.cables.selected = null;
    if (add && this.selection.has(m)) {
      this.selection.delete(m);
      m.el.classList.remove('selected');
    } else {
      this.selection.add(m);
      m.el.classList.add('selected');
    }
  }

  // the selected module while exactly one is, else null
  get selected() {
    return this.selection.size === 1 ? this.selection.values().next().value : null;
  }

  // drop modules that are gone (after undo)
  pruneSelection() {
    for (const m of [...this.selection]) if (!this.live(m)) this.selection.delete(m);
  }

  selectCable(c) {
    this.select(null);
    this.cables.selected = c;
  }

  get selectedCable() {
    return this.cables.selected;
  }

  // The cable under the pointer, unless the pointer is on something that
  // takes clicks itself.
  cableAt(e) {
    if (e.target !== this.content && e.target.closest('.knob, .jack, button, .title, canvas, textarea')) return null;
    if (!this.content.contains(e.target)) return null;
    const p = this.pointer(e);
    return this.cables.hit(p.x, p.y, 6 / this.zoom);
  }

  // "vco saw → vcf in"
  cableName(c) {
    return `${c.from.m.type} ${c.from.m.def.outputs[c.from.i]} → ${c.to.m.type} ${Object.keys(c.to.m.def.inputs)[c.to.i]}`;
  }

  // layout helpers

  overlaps(cols, x, row, ignore) {
    for (const m of this.modules.values()) {
      if (m === ignore || m.row !== row) continue;
      if (x < m.x + m.def.cols && m.x < x + cols) return true;
    }
    return false;
  }

  findSpot(cols) {
    const perRow = Math.max(cols, Math.floor(this.scroller.clientWidth / this.zoom / CELL));
    const used = Math.max(-1, ...[...this.modules.values()].map((m) => m.row));
    for (let row = 0; row <= used; row++) {
      for (let x = 0; x + cols <= perRow; x++) {
        if (!this.overlaps(cols, x, row)) return { x, row };
      }
    }
    return { x: 0, row: used + 1 };
  }

  // Push modules right until nothing overlaps, e.g. after loading an old patch.
  unoverlap() {
    const list = [...this.modules.values()].sort((a, b) => a.row - b.row || a.x - b.x);
    let row = -1;
    let cursor = 0;
    for (const m of list) {
      if (m.row !== row) {
        row = m.row;
        cursor = 0;
      }
      m.x = Math.max(m.x, cursor);
      cursor = m.x + m.def.cols;
      this.place(m);
    }
    this.relayoutCables();
    this.updateExtent();
  }

  // Put m at x in row and push the row's other modules out of the way:
  // those whose centre is left of m's centre move left, the rest right.
  // Positions start from the snapshot taken when the drag began, so a row
  // springs back once the module leaves it.
  // byStart (inserting): modules starting at or right of x make room to the
  // right, so a new module lands exactly at x.
  arrange(m, x, row, snap, byStart = false) {
    const cols = m.def.cols;
    for (const [o, s] of snap) {
      o.x = s.x;
      o.row = s.row;
    }
    const others = [...snap.keys()].filter((o) => o !== m && o.row === row);
    let right = others;
    for (let pass = 0; pass < 4; pass++) {
      const centre = x + cols / 2;
      const left = others.filter((o) => (byStart ? o.x < x : o.x + o.def.cols / 2 < centre)).sort((a, b) => b.x - a.x);
      right = others.filter((o) => !left.includes(o)).sort((a, b) => a.x - b.x);
      for (const o of others) o.x = snap.get(o).x;
      let cursor = x;
      for (const o of left) {
        o.x = Math.min(o.x, cursor - o.def.cols);
        cursor = o.x;
      }
      if (cursor >= 0) break;
      x -= cursor;
    }
    let cursor = x + cols;
    for (const o of right) {
      o.x = Math.max(o.x, cursor);
      cursor = o.x + o.def.cols;
    }
    m.x = x;
    m.row = row;
    for (const o of snap.keys()) if (o !== m) this.place(o);
  }

  relayoutCables() {
    for (const c of this.cables.list) this.layoutCable(c);
  }

  autoScroll(e) {
    const r = this.scroller.getBoundingClientRect();
    const step = (d) => (d < EDGE ? Math.ceil((EDGE - d) / 4) : 0);
    this.scroller.scrollLeft += step(r.right - e.clientX) - step(e.clientX - r.left);
    this.scroller.scrollTop += step(r.bottom - e.clientY) - step(e.clientY - r.top);
  }

  // The scroll area is the space the modules and the cables hanging between
  // them take, at least the view, so there are scrollbars only when the patch
  // reaches beyond the view. While
  // dragging, `ahead` ({right, bottom} in rack pixels) grows it in front of the
  // dragged module, so it can be pushed further out (with auto-scroll).
  updateExtent(ahead = null) {
    let right = 0;
    let bottom = 0;
    for (const m of this.modules.values()) {
      right = Math.max(right, (m.x + m.def.cols) * CELL);
      bottom = Math.max(bottom, (m.row + 1) * ROW);
    }
    // cables sag below the jacks they connect, also below the last row
    for (const c of this.cables.list) {
      const pts = c.pts;
      for (let k = 0; k < pts.length; k += 2) {
        right = Math.max(right, Math.ceil(pts[k] + CABLE_MARGIN));
        bottom = Math.max(bottom, Math.ceil(pts[k + 1] + CABLE_MARGIN));
      }
    }
    if (ahead) {
      right = Math.max(right, ahead.right);
      bottom = Math.max(bottom, ahead.bottom);
    }
    const apply = () => {
      const z = this.zoom;
      const width = Math.max(right, Math.floor(this.scroller.clientWidth / z));
      const height = Math.max(bottom, Math.floor(this.scroller.clientHeight / z));
      // rows a module can be dropped into, including a partly visible last one
      this.rows = Math.max(1, Math.ceil(height / ROW));
      this.content.style.width = `${width}px`;
      this.content.style.height = `${height}px`;
      // the transform does not change layout size, the sizer gives the scroll area
      this.sizer.style.width = `${Math.round(width * z)}px`;
      this.sizer.style.height = `${Math.round(height * z)}px`;
    };
    // a scrollbar appearing or going away changes the view size, so once more
    const w = this.scroller.clientWidth;
    const h = this.scroller.clientHeight;
    apply();
    if (this.scroller.clientWidth !== w || this.scroller.clientHeight !== h) apply();
  }

  jackPos(ref, dir) {
    const j = ref.m.jacks[dir][ref.i];
    return { x: ref.m.left + j.x, y: ref.m.top + j.y };
  }

  layoutCable(c) {
    this.cables.setPoints(c, this.jackPos(c.from, 'out'), this.jackPos(c.to, 'in'));
  }

  pointer(e) {
    const r = this.content.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.zoom, y: (e.clientY - r.top) / this.zoom };
  }

  // gestures

  startPan(e) {
    e.preventDefault();
    e.stopPropagation();
    const { scroller } = this;
    const start = { x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
    let moved = false;
    const move = (ev) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      document.body.classList.add('panning');
      scroller.scrollLeft = start.left - dx;
      scroller.scrollTop = start.top - dy;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.classList.remove('panning');
      // a left click on empty space without dragging deselects
      if (moved || e.button !== 0) return;
      this.select(null);
      this.cables.selected = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // Shift-drag on empty space: select the modules the rectangle touches.
  startBand(e) {
    e.preventDefault();
    e.stopPropagation();
    const start = this.pointer(e);
    const band = div('band', this.content);
    this.select(null);
    this.cables.selected = null;
    const move = (ev) => {
      this.autoScroll(ev);
      const p = this.pointer(ev);
      const x0 = Math.min(start.x, p.x);
      const y0 = Math.min(start.y, p.y);
      const x1 = Math.max(start.x, p.x);
      const y1 = Math.max(start.y, p.y);
      band.style.left = `${x0}px`;
      band.style.top = `${y0}px`;
      band.style.width = `${x1 - x0}px`;
      band.style.height = `${y1 - y0}px`;
      for (const m of this.modules.values()) {
        const hit = m.left < x1 && x0 < m.left + m.def.cols * CELL && m.top < y1 && y0 < m.top + ROW;
        if (hit !== this.selection.has(m)) this.select(m, true);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      band.remove();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // Dragging one module of a selection moves them all, by whole cells, as far
  // as they fit between the other modules (which do not make room).
  startGroupMove(e) {
    const group = [...this.selection];
    const origin = new Map(group.map((o) => [o, { x: o.x, row: o.row }]));
    const start = this.pointer(e);
    const fits = (dx, drow) => group.every((o) => {
      const x = origin.get(o).x + dx;
      const row = origin.get(o).row + drow;
      if (x < 0 || row < 0) return false;
      for (const other of this.modules.values()) {
        if (origin.has(other) || other.row !== row) continue;
        if (x < other.x + other.def.cols && other.x < x + o.def.cols) return false;
      }
      return true;
    });
    const put = (dx, drow) => {
      for (const o of group) {
        o.x = origin.get(o).x + dx;
        o.row = origin.get(o).row + drow;
        this.place(o);
      }
      this.relayoutCables();
    };
    this.dragging = true;
    for (const o of group) o.el.classList.add('dragging');
    const move = (ev) => {
      this.autoScroll(ev);
      const p = this.pointer(ev);
      const dx = Math.round((p.x - start.x) / CELL);
      const drow = Math.round((p.y - start.y) / ROW);
      if (fits(dx, drow)) put(dx, drow);
      this.updateExtent({ right: p.x + 2 * CELL, bottom: p.y + ROW });
    };
    const end = (cancel) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key);
      this.dragging = false;
      for (const o of group) o.el.classList.remove('dragging');
      if (cancel) put(0, 0);
      this.updateExtent();
      if (!cancel) this.onChange();
    };
    const up = () => end(false);
    const key = (ev) => {
      if (ev.key === 'Escape') end(true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', key);
  }

  startMove(e, m) {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    if (this.selection.size > 1 && this.selection.has(m) && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      this.startGroupMove(e);
      return;
    }
    const snap = new Map([...this.modules.values()].map((o) => [o, { x: o.x, row: o.row }]));
    const start = this.pointer(e);
    const grab = { x: start.x - m.left, y: start.y - m.top };
    this.dragging = true;
    m.el.classList.add('dragging');
    this.drop.style.width = `${m.def.cols * CELL}px`;
    this.drop.style.height = `${ROW}px`;
    this.drop.hidden = false;
    const move = (ev) => {
      this.autoScroll(ev);
      const p = this.pointer(ev);
      const left = Math.max(0, p.x - grab.x);
      const top = Math.max(0, p.y - grab.y);
      const row = Math.min(this.rows - 1, Math.max(0, Math.round(top / ROW)));
      this.arrange(m, Math.round(left / CELL), row, snap);
      this.setPixels(m, left, top);
      this.relayoutCables();
      this.updateExtent({ right: left + (m.def.cols + 2) * CELL, bottom: top + 2 * ROW });
      this.drop.style.left = `${m.x * CELL}px`;
      this.drop.style.top = `${m.row * ROW}px`;
    };
    const end = (cancel) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key);
      this.dragging = false;
      if (cancel) {
        for (const [o, s] of snap) {
          o.x = s.x;
          o.row = s.row;
          this.place(o);
        }
      }
      this.drop.hidden = true;
      m.el.classList.remove('dragging');
      this.place(m);
      this.relayoutCables();
      this.updateExtent();
      if (!cancel) this.onChange();
    };
    const up = () => end(false);
    const key = (ev) => {
      if (ev.key === 'Escape') end(true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', key);
  }

  startCable(e, m, dir, i) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (!this.selection.has(m)) this.select(m);
    // Both ends work alike: dragging a jack that has cables picks up the
    // latest one, to move it to another jack or drop it to remove it. Ctrl
    // starts a new cable instead (an output feeds any number of inputs, an
    // input sums its cables).
    let fixed = { dir, ref: { m, i } };
    if (!e.ctrlKey && !e.metaKey) {
      const end = dir === 'in' ? 'to' : 'from';
      const existing = this.cables.list.filter((c) => c[end].m === m && c[end].i === i).pop();
      if (existing) {
        fixed = dir === 'in' ? { dir: 'out', ref: existing.from } : { dir: 'in', ref: existing.to };
        this.disconnect(existing);
      }
    }
    const anchor = this.jackPos(fixed.ref, fixed.dir);
    const draw = (p) => {
      if (fixed.dir === 'out') this.cables.setGhost(anchor, p);
      else this.cables.setGhost(p, anchor);
    };
    draw(this.pointer(e));
    this.dragging = true;
    const move = (ev) => draw(this.pointer(ev));
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.dragging = false;
      this.cables.setGhost(null);
      if (ev.type === 'pointercancel') return;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!el?.classList.contains('jack')) return;
      const target = this.modules.get(Number(el.dataset.module));
      const ref = { m: target, i: Number(el.dataset.index) };
      if (el.dataset.dir === fixed.dir) return;
      if (fixed.dir === 'out') this.connect(fixed.ref, ref);
      else this.connect(ref, fixed.ref);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // displays

  // a line from 0 (bottom) to 1, with vertical marks and a dot on it
  drawCurve(g, w, h, { curve, marks = [], dot }, dpr) {
    const line = Math.max(1, Math.round(dpr));
    const pad = 4 * dpr; // room for the dot at the top and bottom
    const y = (v) => h - pad - v * (h - 2 * pad);
    g.fillStyle = colours.edge;
    for (const x of marks) g.fillRect(Math.round(x * w), 0, line, h);
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

  // a waveform from min/max pairs, brighter between from and to, with a
  // playhead
  drawWave(g, w, h, { wave, from, to, head }, dpr) {
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
  drawSteps(g, w, h, rows, dpr) {
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

  redrawDisplays() {
    for (const m of this.modules.values()) if (m.canvas) this.paint(m);
  }

  // audio stopped: the displays drop what the engine last sent (playheads,
  // envelope dots); shapes stay
  clearLive() {
    for (const m of this.modules.values()) {
      m.live = null;
      if (m.def.shape) this.paint(m);
    }
  }

  // one paint per module and frame, however many changes come in
  queuePaint(m) {
    this.toPaint ??= new Set();
    if (!this.toPaint.size) {
      requestAnimationFrame(() => {
        const list = [...this.toPaint];
        this.toPaint.clear();
        for (const one of list) this.paint(one);
      });
    }
    this.toPaint.add(m);
  }

  drawText(m, lines) {
    const c = m.canvas;
    const dpr = (devicePixelRatio || 1) * this.zoom;
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    g.fillStyle = colours['f-high'];
    g.font = `${11 * dpr}px "JetBrains Mono", monospace`;
    g.textBaseline = 'middle';
    lines.forEach((line, i) => g.fillText(line, 8 * dpr, ((i + 0.5) * h) / lines.length));
  }

  drawDisplay(id, data) {
    const m = this.modules.get(id);
    if (m?.def.displayKnob) {
      const at = data[0];
      if (m.current === at) return;
      m.knobs[m.current]?.el.classList.remove('current');
      m.knobs[at]?.el.classList.add('current');
      m.current = at;
      return;
    }
    if (!m?.canvas) return;
    m.live = data; // also drawn again on a theme change, zoom or knob turn
    this.paint(m);
  }

  // Draws a module's display: its shape() from the knobs and the live data,
  // or the live data itself.
  paint(m) {
    if (!m.canvas || this.modules.get(m.id) !== m) return;
    const data = m.def.shape ? m.def.shape(m.values, m.live ?? null, m.peaks ?? null) : m.live;
    if (!data) return;
    const c = m.canvas;
    if (m.def.displayText) {
      this.drawText(m, m.def.displayText(data));
      return;
    }
    // canvas pixels follow the zoom so the trace stays sharp
    const dpr = (devicePixelRatio || 1) * this.zoom;
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    if (data.steps) {
      this.drawSteps(g, w, h, data.steps, dpr);
      return;
    }
    if (data.curve) {
      this.drawCurve(g, w, h, data, dpr);
      return;
    }
    if ('wave' in data) {
      this.drawWave(g, w, h, data, dpr);
      return;
    }
    const grid = data.grid ?? { x: [], y: [0.5] };
    g.fillStyle = colours.edge;
    const line = Math.max(1, Math.round(dpr));
    for (const x of grid.x) g.fillRect(Math.round(x * w), 0, line, h);
    for (const y of grid.y) g.fillRect(0, Math.round((1 - y) * h), w, line);
    if (data.bars) {
      const n = data.bars.length;
      const gap = Math.max(1, Math.round(dpr));
      g.fillStyle = colours['f-high'];
      for (let i = 0; i < n; i++) {
        const x0 = Math.round((i / n) * w);
        const x1 = Math.round(((i + 1) / n) * w) - gap;
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
}
