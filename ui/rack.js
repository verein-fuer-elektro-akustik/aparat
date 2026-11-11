import { registry } from '../modules/index.js';
import { makeKnob } from './knob.js';

const HP = 15;
const ROW = 384;
const SPARE = 600;

function div(className, parent) {
  const el = document.createElement('div');
  el.className = className;
  parent?.append(el);
  return el;
}

export class Rack {
  constructor({ scroller, content, cables, send, onChange }) {
    this.scroller = scroller;
    this.content = content;
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
    content.addEventListener('pointerdown', (e) => {
      if (e.target === content) this.select(null);
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
    const spot = x === undefined ? this.findSpot(def.hp) : { x, row };
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
      v: 1,
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
    for (const p of patch.modules ?? []) this.add(p.type, p);
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
    el.style.width = `${def.hp * HP}px`;
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

    if (def.display) {
      m.canvas = document.createElement('canvas');
      m.canvas.className = 'display';
      el.append(m.canvas);
    }

    if (m.keys.length) {
      const knobs = div('knobs', el);
      knobs.style.setProperty('--cols', def.knobCols ?? Math.min(2, m.keys.length));
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
    });
  }

  measure(m) {
    const box = m.el.getBoundingClientRect();
    for (const list of [m.jacks.in, m.jacks.out]) {
      for (const j of list) {
        const r = j.el.getBoundingClientRect();
        j.x = r.left + r.width / 2 - box.left;
        j.y = r.top + r.height / 2 - box.top;
      }
    }
  }

  place(m) {
    m.el.style.left = `${m.x * HP}px`;
    m.el.style.top = `${m.row * ROW}px`;
  }

  select(m) {
    this.selected?.el.classList.remove('selected');
    this.selected = m;
    m?.el.classList.add('selected');
  }

  // layout helpers

  overlaps(hp, x, row, ignore) {
    for (const m of this.modules.values()) {
      if (m === ignore || m.row !== row) continue;
      if (x < m.x + m.def.hp && m.x < x + hp) return true;
    }
    return false;
  }

  findSpot(hp) {
    const perRow = Math.max(hp, Math.floor(this.scroller.clientWidth / HP) - 1);
    for (let row = 0; row < 64; row++) {
      for (let x = 0; x + hp <= perRow; x++) {
        if (!this.overlaps(hp, x, row)) return { x, row };
      }
    }
    return { x: 0, row: 64 };
  }

  updateExtent() {
    let w = 0;
    let h = 0;
    for (const m of this.modules.values()) {
      w = Math.max(w, (m.x + m.def.hp) * HP);
      h = Math.max(h, (m.row + 1) * ROW);
    }
    this.content.style.width = `${w + SPARE}px`;
    this.content.style.height = `${h + SPARE}px`;
  }

  jackPos(ref, dir) {
    const j = ref.m.jacks[dir][ref.i];
    return { x: ref.m.x * HP + j.x, y: ref.m.row * ROW + j.y };
  }

  layoutCable(c) {
    this.cables.setPoints(c, this.jackPos(c.from, 'out'), this.jackPos(c.to, 'in'));
  }

  pointer(e) {
    const r = this.content.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // gestures

  startMove(e, m) {
    if (e.button !== 0 || e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    const origin = { x: m.x, row: m.row };
    const start = this.pointer(e);
    const move = (ev) => {
      const p = this.pointer(ev);
      const x = Math.max(0, origin.x + Math.round((p.x - start.x) / HP));
      const row = Math.max(0, origin.row + Math.round((p.y - start.y) / ROW));
      if (this.overlaps(m.def.hp, x, row, m)) return;
      m.x = x;
      m.row = row;
      this.place(m);
      for (const c of this.cables.list) {
        if (c.from.m === m || c.to.m === m) this.layoutCable(c);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.updateExtent();
      this.onChange();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
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
    if (!m?.canvas) return;
    const c = m.canvas;
    const dpr = devicePixelRatio || 1;
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
