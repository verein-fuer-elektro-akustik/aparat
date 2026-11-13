import { registry } from '../modules/index.js';
import { makeKnob } from './knob.js';

// The rack is a grid of square cells. A module is CELLS cells tall, so the
// rack is made of rows CELLS cells high. A module is as many cells wide as it
// has columns of knobs and jacks (def.cols). Keep in sync with --cell in style.css.
export const CELL = 48;
const CELLS = 8;
const ROW = CELL * CELLS;
const EDGE = 40;
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;

function div(className, parent) {
  const el = document.createElement('div');
  el.className = className;
  parent?.append(el);
  return el;
}

export class Rack {
  constructor({ scroller, sizer, content, cables, send, onChange, onContextMenu }) {
    this.onContextMenu = onContextMenu ?? (() => {});
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
    this.selected = null;
    this.learning = null;
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
      if (e.button === 1 || (e.button === 0 && e.target === content)) this.startPan(e);
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

  add(type, { id, x, row, params } = {}) {
    const def = registry[type];
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
      knobs: [],
      jacks: { in: [], out: [] },
    };
    this.nextId = Math.max(this.nextId, m.id + 1);
    this.buildPanel(m);
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

  remove(m) {
    for (const c of [...this.cables.list]) {
      if (c.from.m === m || c.to.m === m) this.disconnect(c);
    }
    this.midiMap = this.midiMap.filter((e) => e.id !== m.id);
    if (this.learning?.m === m) this.learning = null;
    if (this.selected === m) this.selected = null;
    this.send({ op: 'remove', id: m.id });
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
    this.onChange();
    return cable;
  }

  disconnect(cable) {
    this.cables.remove(cable);
    this.freeSlots.push(cable.slot);
    this.send({ op: 'disconnect', slot: cable.slot });
    this.onChange();
  }

  clear() {
    for (const m of [...this.modules.values()]) this.remove(m);
    this.freeSlots = [];
    this.nextSlot = 0;
    this.nextId = 1;
    this.midiMap = [];
  }

  // Add a module at a grid cell, pushing the row's modules aside.
  insert(type, { x, row }, params) {
    const m = this.add(type, { params });
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
    m.knobs.forEach((k, i) => {
      if (m.keys[i] !== 'bypass') k.setNorm(Math.random());
    });
  }

  resetParams(m) {
    for (const k of m.knobs) k.reset();
  }

  // A copy with the same settings, right of the original.
  duplicate(m) {
    const params = Object.fromEntries(m.keys.map((k, i) => [k, m.values[i]]));
    const copy = this.insert(m.type, { x: m.x + m.def.cols, row: m.row }, params);
    this.select(copy);
    return copy;
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
    this.updateExtent();
    this.scroller.scrollLeft = px * z - ax;
    this.scroller.scrollTop = py * z - ay;
  }

  // engine

  sendAdd(m) {
    this.send({ op: 'add', id: m.id, type: m.type, params: m.values });
  }

  sendConnect(c) {
    this.send({ op: 'connect', slot: c.slot, from: [c.from.m.id, c.from.i], to: [c.to.m.id, c.to.i] });
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
      })),
      cables: this.cables.list.map((c) => ({
        from: [c.from.m.id, c.from.m.def.outputs[c.from.i]],
        to: [c.to.m.id, Object.keys(c.to.m.def.inputs)[c.to.i]],
      })),
      midiMap: this.midiMap,
    };
  }

  load(patch) {
    this.clear();
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
    const want = new Map(patch.modules.map((p) => [p.id, p]));
    for (const m of [...this.modules.values()]) {
      if (want.get(m.id)?.type !== m.type) this.remove(m);
    }
    for (const p of patch.modules) {
      const m = this.modules.get(p.id);
      if (!m) {
        this.add(p.type, p);
        continue;
      }
      m.x = p.x;
      m.row = p.row;
      this.place(m);
      m.keys.forEach((k, i) => {
        const v = p.params?.[k] ?? m.def.params[k].default;
        if (v === m.values[i]) return;
        m.values[i] = v;
        m.knobs[i].setValue(v);
        this.send({ op: 'param', id: m.id, i, v });
      });
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
    const el = div('module', this.content);
    el.style.width = `${def.cols * CELL}px`;
    el.style.height = `${ROW}px`;
    el.style.setProperty('--cols', def.cols);
    m.el = el;

    const title = div('title', el);
    const name = document.createElement('span');
    name.textContent = m.type;
    const close = document.createElement('button');
    close.textContent = '×';
    close.setAttribute('aria-label', `remove ${m.type}`);
    close.addEventListener('click', () => this.remove(m));
    title.append(name, close);
    title.addEventListener('pointerdown', (e) => this.startMove(e, m));
    el.addEventListener('pointerdown', () => this.select(m));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.select(m);
      this.onContextMenu(e, m);
    });

    if (def.display && !def.displayKnob) {
      m.canvas = document.createElement('canvas');
      m.canvas.className = 'display';
      el.append(m.canvas);
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
            m.values[i] = v;
            this.send({ op: 'param', id: m.id, i, v });
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

  // One thing is selected: a module or a cable (delete removes it).
  select(m) {
    this.selected?.el.classList.remove('selected');
    this.selected = m;
    m?.el.classList.add('selected');
    if (m) this.cables.selected = null;
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
    if (e.target !== this.content && e.target.closest('.knob, .jack, button, .title, canvas')) return null;
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

  updateExtent() {
    let cols = 0;
    let used = -1;
    for (const m of this.modules.values()) {
      cols = Math.max(cols, m.x + m.def.cols);
      used = Math.max(used, m.row);
    }
    // A view's worth of free space right of and below the modules, so there is
    // always room to place things and to zoom around the pointer.
    const z = this.zoom;
    const viewW = this.scroller.clientWidth / z;
    const viewH = this.scroller.clientHeight / z;
    this.rows = used + 1 + Math.max(1, Math.ceil(viewH / ROW));
    const width = Math.ceil(cols * CELL + viewW);
    this.content.style.width = `${width}px`;
    this.content.style.height = `${this.rows * ROW}px`;
    // the transform does not change layout size, the sizer gives the scroll area
    this.sizer.style.width = `${Math.ceil(width * z)}px`;
    this.sizer.style.height = `${Math.ceil(this.rows * ROW * z)}px`;
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

  startMove(e, m) {
    if (e.button !== 0 || e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    const snap = new Map([...this.modules.values()].map((o) => [o, { x: o.x, row: o.row }]));
    const start = this.pointer(e);
    const grab = { x: start.x - m.left, y: start.y - m.top };
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
      this.drop.style.left = `${m.x * CELL}px`;
      this.drop.style.top = `${m.row * ROW}px`;
      this.relayoutCables();
    };
    const end = (cancel) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key);
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
    this.select(m);
    let fixed = { dir, ref: { m, i } };
    if (dir === 'in' && !e.ctrlKey) {
      const existing = this.cables.list.filter((c) => c.to.m === m && c.to.i === i).pop();
      if (existing) {
        fixed = { dir: 'out', ref: existing.from };
        this.disconnect(existing);
      }
    }
    const anchor = this.jackPos(fixed.ref, fixed.dir);
    const draw = (p) => {
      if (fixed.dir === 'out') this.cables.setGhost(anchor, p);
      else this.cables.setGhost(p, anchor);
    };
    draw(this.pointer(e));
    const move = (ev) => draw(this.pointer(ev));
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.cables.setGhost(null);
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
  }

  // displays

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
    const c = m.canvas;
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
    g.strokeStyle = '#272727';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    g.stroke();
    g.strokeStyle = '#9c9c9c';
    g.lineWidth = dpr;
    g.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * w;
      const y = h / 2 - (data[i] / 12) * (h / 2);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
  }
}
