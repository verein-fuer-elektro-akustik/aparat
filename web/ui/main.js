import { defs } from '../modules/index.js';
import { AudioEngine, listOutputs } from './audio.js';
import { CableLayer } from './cables.js';
import { newPatch } from './new-patch.js';
import { watchGamepads } from './gamepads.js';
import { Camera, W as CAMERA_W } from './camera.js';
import { makePortals } from './portal.js';
import { menubar } from './menubar.js';
import { Midi } from './midi.js';
import { patches } from './patches.js';
import { Rack, ZOOM_MAX, ZOOM_MIN, keyName } from './rack.js';
import { makeKeys } from './keys.js';
import { makeRecorder } from './recorder.js';
import { samples } from './samples.js';
import { patchFromHash, patchToHash } from './share.js';
import { getTheme, onThemeChange, setTheme } from './theme.js';
import { boundaryDefs, dependents, insidePatch, instancePrefixes, makeComposite, renamePanel, sameBuild, specFromInside, ungroup } from './composite.js';
import { download, guarded, showError, showInfo, stamp } from './toast.js';

const $ = (id) => document.getElementById(id);

const audio = new AudioEngine(onEngineMessage);
const cables = new CableLayer($('cables'), $('rack'));

// The camera runs while audio does and a camera module is in the patch (also
// inside a composite). Each frame goes to the engine and to the panels.
const camera = new Camera(({ values, luma, diff }) => {
  audio.send({ op: 'camera', values });
  const picture = { w: CAMERA_W, luma, diff };
  for (const r of editing ? [top, inner] : [top]) {
    for (const m of r.modules.values()) if (m.type === 'camera') r.drawDisplay(m.id, picture);
  }
});

const usesCamera = () => [...top.modules.values()].some((m) => m.type === 'camera' || m.flat?.modules.some((x) => x.type === 'camera'));

function syncCamera() {
  const want = audio.running && usesCamera();
  if (want && !camera.on) {
    camera.start().then(syncCamera, showError);
  } else if (!want && camera.on) {
    camera.stop();
    for (const r of [top, inner]) {
      for (const m of r.modules.values()) if (m.type === 'camera') r.drawDisplay(m.id, null);
    }
  }
}

const midi = new Midi({
  inSelect: $('midiIn'),
  outSelect: $('midiOut'),
  onMessage: onMidiMessage,
});

// The right-click menu of a module, in the patch or in a composite's edit
// view. It works on the selection, which the right-clicked module is part of.
function moduleMenu(e, m) {
  if (m.def.boundary) return;
  openContext(e.clientX, e.clientY, rack.selection.size > 1 ? `${rack.selection.size} modules` : m.type, [
    ['random', () => selected().forEach((o) => rack.randomize(o))],
    ['reset', () => selected().forEach((o) => rack.resetParams(o))],
    ['duplicate', duplicateSelection],
    ['copy', copySelection],
    ['remove', removeSelection],
    ['make composite', () => openCompose(selected())],
    ...(m.def.composite && rack.selection.size <= 1 ? [['edit composite', () => openComposite(m)], ['ungroup composite', () => ungroupModule(m)]] : []),
    ['help', () => openHelp(m.def.composite ? 'composites' : `m-${m.type.replace(/\s+/g, '-')}`)],
    swatches(selected()),
  ]);
}

// The patch's rack. `rack` is the one in view: this one, or the edit view's
// while a composite is open (see "editing composites" below).
const top = new Rack({
  scroller: $('rack'),
  sizer: $('sizer'),
  content: $('content'),
  cables,
  send: (m) => audio.send(m),
  onChange: () => {
    undo.changed();
    syncCamera();
  },
  files: samples,
  onFile: (m, file) => (file ? loadSample(m, file) : chooseSample(m)),
  onContextMenu: moduleMenu,
  onOpen: (m) => openComposite(m),
});
let rack = top;
const innerCables = new CableLayer($('innerCables'), $('innerRack'));
innerCables.setPeaks(new Float32Array(0));
const inner = new Rack({
  scroller: $('innerRack'),
  sizer: $('innerSizer'),
  content: $('innerContent'),
  cables: innerCables,
  send: (m) => forwardInner(m),
  onChange: () => scheduleSync(),
  files: samples,
  onFile: (m, file) => (file ? loadSample(m, file) : chooseSample(m)),
  onContextMenu: moduleMenu,
  onOpen: (m) => openComposite(m),
});
const recorder = makeRecorder({ audio, button: $('record') });

// undo / redo
//
// The history holds patch snapshots. Changes are recorded once things settle
// (a knob drag is one step, not hundreds). Undo applies the snapshot to the
// rack, which only touches what differs.

const undo = {
  stack: [],
  at: -1,
  timer: 0,
  quiet: false,
  snapshot: () => JSON.stringify(top.toJSON()),
  reset() {
    clearTimeout(this.timer);
    this.stack = [this.snapshot()];
    this.at = 0;
    this.buttons();
    patchChanged();
  },
  changed() {
    if (this.quiet) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.commit(), 400);
  },
  commit() {
    clearTimeout(this.timer);
    const s = this.snapshot();
    if (s === this.stack[this.at]) return;
    this.stack.length = this.at + 1;
    this.stack.push(s);
    if (this.stack.length > 200) this.stack.shift();
    this.at = this.stack.length - 1;
    this.buttons();
    patchChanged();
  },
  go(dir) {
    this.commit();
    const to = this.at + dir;
    if (to < 0 || to >= this.stack.length) return;
    // menus opened before may refer to modules that apply() replaces
    closeContext();
    closeMenu();
    this.at = to;
    this.quiet = true;
    try {
      top.apply(JSON.parse(this.stack[to]));
    } finally {
      this.quiet = false;
    }
    // module and cable order can differ after apply; keep what the rack now says
    this.stack[to] = this.snapshot();
    top.pruneSelection();
    if (editing) reloadInside();
    this.buttons();
    patchChanged();
    restoreSamples();
  },
  buttons() {
    $('undo').disabled = this.at <= 0;
    $('redo').disabled = this.at >= this.stack.length - 1;
  },
};
$('undo').addEventListener('click', () => undo.go(-1));
$('redo').addEventListener('click', () => undo.go(1));

// menu bar

const bar = menubar($('menubar'), {
  onOpen: (name) => {
    if (name !== 'edit') return;
    const none = !rack.selection.size;
    for (const id of ['editDuplicate', 'editCopy', 'editRandom', 'editReset']) $(id).disabled = none;
    $('editPaste').disabled = !clipboard();
    $('editRemove').disabled = none && !rack.selectedCable;
  },
});
$('editAdd').addEventListener('click', () => {
  const r = $('add').getBoundingClientRect();
  openMenu(r.left, r.bottom + 4, null);
});
$('editDuplicate').addEventListener('click', () => duplicateSelection());
$('editCopy').addEventListener('click', () => copySelection());
$('editPaste').addEventListener('click', () => pasteClipboard());
$('editSelectAll').addEventListener('click', () => rack.selectAll());
$('editRandom').addEventListener('click', () => selected().forEach((m) => rack.randomize(m)));
$('editReset').addEventListener('click', () => selected().forEach((m) => rack.resetParams(m)));
$('editRemove').addEventListener('click', () => removeSelection());

// selection: the edit menu, the right-click menu and the keys work on all
// selected modules

function selected() {
  return [...rack.selection];
}

function removeSelection() {
  if (rack.selectedCable) rack.disconnect(rack.selectedCable);
  else selected().filter((m) => !m.def.boundary).forEach((m) => rack.remove(m));
}

function added(mods) {
  restoreSamples();
  if (mods.some((m) => m?.type === 'input')) audio.openInput().catch(showError);
}

// one module lands next to the original, several below the rack
function duplicateSelection() {
  if (rack.selection.size === 1) added([rack.duplicate(rack.selected)]);
  else added(rack.paste(rack.copy()));
}

// Copied modules go to localStorage, not to the system clipboard: that needs
// no permission, and pasting works in another patch or tab of aparat.
function clipboard() {
  try {
    return JSON.parse(localStorage.getItem('aparat.clipboard'));
  } catch {
    return null;
  }
}

function copySelection() {
  if (!rack.selection.size) return;
  try {
    localStorage.setItem('aparat.clipboard', JSON.stringify(rack.copy()));
  } catch (err) {
    showError(`could not copy: ${err.message}`);
  }
}

function pasteClipboard() {
  const data = clipboard();
  if (data) added(rack.paste(data));
}

// composites: modules made of modules (see composite.js). The rack is
// brought to the changed patch with apply(), so the other modules keep
// playing undisturbed.

function applyPatch(patch, select) {
  rack.apply(patch);
  rack.unoverlap();
  rack.select(null);
  for (const id of select) {
    const m = rack.modules.get(id);
    if (m) rack.select(m, true);
  }
}

function openCompose(mods) {
  mods = mods.filter((m) => !m.def.boundary);
  if (!mods.length) return;
  closeContext();
  const box = $('compose');
  box.mods = mods;
  $('composeName').value = '';
  $('composeKnobs').replaceChildren(...mods.flatMap((m) => {
    const keys = m.keys.filter((k) => k !== 'bypass');
    if (!keys.length) return [];
    const group = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = m.type;
    group.append(legend, ...keys.map((k) => {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.dataset.id = m.id;
      box.dataset.param = k;
      label.append(box, ` ${k}`);
      return label;
    }));
    return [group];
  }));
  composeCheck();
  box.hidden = false;
  $('composeName').focus();
}

// The name decides what "make" does: a new composite, or replacing the
// inside of an existing one everywhere it is used.
function composeCheck() {
  const name = $('composeName').value.trim();
  let note = '';
  if (!name) note = 'give it a name';
  else if (defs.some((d) => d.name === name)) note = 'that is the name of a built-in module';
  else if (openNow().has(name)) note = 'that composite is open, or contains the one that is';
  else if (rack.composites[name]) note = `replaces the composite "${name}" everywhere in this patch`;
  $('composeNote').textContent = note;
  $('composeOk').disabled = !name || defs.some((d) => d.name === name) || openNow().has(name);
  $('composeOk').textContent = rack.composites[name] ? 'replace' : 'make';
}

function closeCompose() {
  $('compose').hidden = true;
}

$('composeName').addEventListener('input', composeCheck);
$('composeCancel').addEventListener('click', closeCompose);
$('compose').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') closeCompose();
  if (e.key === 'Enter' && !$('composeOk').disabled) $('composeOk').click();
});
$('composeOk').addEventListener('click', guarded(() => {
  const mods = $('compose').mods.filter((m) => rack.live(m));
  const name = $('composeName').value.trim();
  const exposed = [...$('composeKnobs').querySelectorAll('input:checked')].map((b) => ({ id: Number(b.dataset.id), param: b.dataset.param }));
  closeCompose();
  if (!mods.length) return;
  const next = makeComposite(rack.toJSON(), mods.map((m) => m.id), name, exposed, rack.defOf);
  const made = next.modules[next.modules.length - 1];
  applyPatch(next, [made.id]);
}));

function ungroupModule(m) {
  if (!rack.live(m)) return;
  const { newIds, ...next } = ungroup(rack.toJSON(), m.id, rack.defOf);
  applyPatch(next, newIds ?? []);
  restoreSamples();
}

// editing composites: the inside of a composite in a view of its own, over
// the patch. The patch keeps playing; what changes inside is brought to the
// patch as it happens (syncInside), so every instance of the composite plays
// the new inside. The view is a second rack (inner) that never talks to the
// audio engine itself: knob turns are passed on to the instances
// (forwardInner), anything else rebuilds them.

let editing = null; // the names of the open composites, outermost first
let shownPrefix = ''; // engine id prefix of the instance whose displays show
let loadingInner = false;
let syncTimer = 0;

// composites that can't be added or made now: the open ones and all that
// contain them, which would contain themselves
function openNow() {
  const out = new Set();
  for (const name of editing ?? []) for (const n of dependents(name, top.composites)) out.add(n);
  return out;
}

function openComposite(m) {
  if (!m.def.composite) return;
  closeContext();
  closeMenu();
  syncInside();
  editing = [...(editing ?? []), m.type];
  reloadInside(true);
}

// Back to a level: 0 is the patch.
function leaveTo(depth) {
  if (!editing) return;
  syncInside();
  closeContext();
  closeMenu();
  closePanelEdit();
  editing.length = Math.max(0, depth);
  if (editing.length) {
    reloadInside(true);
    return;
  }
  editing = null;
  loadingInner = true;
  try {
    inner.clear();
  } finally {
    loadingInner = false;
  }
  $('inner').hidden = true;
  rack = top;
  zoomShown();
}

// Show the open composite as it is in the patch now.
function reloadInside(fresh = false) {
  const name = editing?.at(-1);
  const spec = name && top.composites[name];
  if (!spec) {
    leaveTo(0);
    return;
  }
  const view = $('innerRack');
  const keep = fresh ? null : [view.scrollLeft, view.scrollTop];
  const selectedIds = fresh ? [] : [...inner.selection].map((m) => m.id);
  // shown first: the rack measures its jacks to draw the cables
  $('inner').hidden = false;
  loadingInner = true;
  try {
    inner.extraDefs = boundaryDefs(spec);
    inner.load(insidePatch(spec, top.composites, top.defOf));
    for (const id of selectedIds) {
      const m = inner.modules.get(id);
      if (m) inner.select(m, true);
    }
  } finally {
    loadingInner = false;
  }
  shownPrefix = instancePrefixes(name, [...top.modules.values()], top.composites)[0] ?? '';
  rack = inner;
  // the edit view opens at the patch's zoom
  if (fresh) inner.setZoom(top.zoom);
  if (keep) [view.scrollLeft, view.scrollTop] = keep;
  else view.scrollTo(0, 0);
  crumbs();
  zoomShown();
}

function crumbs() {
  const nav = $('crumbs');
  nav.replaceChildren();
  const level = (label, depth) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => leaveTo(depth));
    return b;
  };
  nav.append(level($('patchCurrent').textContent.replace(/ \*$/, '') || 'patch', 0));
  editing.forEach((name, i) => {
    nav.append('›');
    if (i === editing.length - 1) {
      const b = document.createElement('b');
      b.textContent = name;
      nav.append(b);
    } else {
      nav.append(level(name, i + 1));
    }
  });
}

// the zoom buttons show the zoom of the rack in view
function zoomShown() {
  $('zoomLevel').textContent = `${Math.round(rack.zoom * 100)}%`;
  $('zoomOut').disabled = rack.zoom <= ZOOM_MIN;
  $('zoomIn').disabled = rack.zoom >= ZOOM_MAX;
}

function scheduleSync() {
  if (loadingInner || !editing) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncInside, 0);
}

// Bring the patch to what the edit view shows.
function syncInside() {
  clearTimeout(syncTimer);
  if (!editing || loadingInner) return;
  if (inner.dragging) {
    // a cable picked up is not gone yet
    syncTimer = setTimeout(syncInside, 50);
    return;
  }
  const name = editing.at(-1);
  const old = top.composites[name];
  if (!old) return;
  const spec = specFromInside(inner.toJSON(), old);
  // composites made inside (make composite, paste) come along
  const composites = { ...top.composites, ...inner.composites, [name]: spec };
  if (JSON.stringify(composites) === JSON.stringify(top.composites)) return;
  const others = Object.keys(composites).some((n) => n !== name && JSON.stringify(composites[n]) !== JSON.stringify(top.composites[n]));
  const jacks = (s) => JSON.stringify([s.inputs.map((j) => j.name), s.outputs.map((j) => j.name)]);
  if (sameBuild(old, spec) && !others) {
    // only knob settings or places changed: the instances keep playing,
    // the knobs were already passed on to them
    top.setComposites(composites);
    for (const m of top.modules.values()) if (m.def.composite) m.def = top.defOf(m.type);
    top.onChange();
  } else {
    top.apply({ ...top.toJSON(), composites });
    shownPrefix = instancePrefixes(name, [...top.modules.values()], top.composites)[0] ?? '';
  }
  inner.setComposites(top.composites);
  // the jack panels change: show them anew
  if (jacks(old) !== jacks(spec)) reloadInside();
}

// What the edit view would send to the engine: knob turns go to the same
// module in every instance, unless the knob is on the composite's panel
// (then each instance has its own setting). The rest is done by syncInside.
function forwardInner(msg) {
  if (msg.op !== 'param' || !editing || loadingInner) return;
  const name = editing.at(-1);
  const spec = top.composites[name];
  if (!spec) return;
  if (typeof msg.id === 'number') {
    const m = inner.modules.get(msg.id);
    if (!m || m.def.boundary) return;
    if (spec.params?.some((p) => p.module === msg.id && p.param === m.keys[msg.i])) return;
  }
  for (const prefix of instancePrefixes(name, [...top.modules.values()], top.composites)) {
    audio.send({ op: 'param', id: `${prefix}/${msg.id}`, i: msg.i, v: msg.v });
  }
}

$('innerDone').addEventListener('click', () => leaveTo(editing ? editing.length - 1 : 0));

// The panel of the open composite: names of its jacks, which knobs it shows
// and their names, its description.
function openPanelEdit() {
  if (!editing) return;
  syncInside();
  const name = editing.at(-1);
  const spec = top.composites[name];
  $('panelTitle').textContent = `${name}: panel`;
  $('panelDoc').value = spec.doc ?? '';
  const field = (value, data, enabled = true) => {
    const input = document.createElement('input');
    input.value = value;
    input.maxLength = 24;
    input.spellcheck = false;
    input.disabled = !enabled;
    Object.assign(input.dataset, data);
    return input;
  };
  const group = (title, rows) => {
    const set = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = title;
    set.append(legend, ...rows.flat());
    return set;
  };
  const jackRows = (list, kind) => list.map((j) => {
    const label = document.createElement('label');
    label.textContent = j.name;
    return [label, field(j.name, { kind, old: j.name })];
  });
  const sets = [];
  if (spec.inputs.length) sets.push(group('inputs', jackRows(spec.inputs, 'inputs')));
  if (spec.outputs.length) sets.push(group('outputs', jackRows(spec.outputs, 'outputs')));
  for (const m of inner.modules.values()) {
    if (m.def.boundary) continue;
    const keys = m.keys.filter((k) => k !== 'bypass');
    if (!keys.length) continue;
    sets.push(group(`${m.type} knobs`, keys.map((k) => {
      const p = spec.params.find((q) => q.module === m.id && q.param === k);
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!p;
      const name = field(p?.name ?? k, { kind: 'params', module: m.id, param: k, old: p?.name ?? '' }, !!p);
      box.addEventListener('change', () => {
        name.disabled = !box.checked;
        if (box.checked) name.focus();
      });
      label.append(box, k);
      return [label, name];
    })));
  }
  if (!sets.length) {
    const p = document.createElement('p');
    p.textContent = 'nothing inside yet';
    sets.push(p);
  }
  $('panelFields').replaceChildren(...sets);
  $('panelNote').textContent = '';
  $('panelEdit').hidden = false;
  $('panelDoc').focus();
}

function closePanelEdit() {
  $('panelEdit').hidden = true;
}

function applyPanelEdit() {
  const name = editing?.at(-1);
  const spec = name && top.composites[name];
  if (!spec) return closePanelEdit();
  const fields = [...$('panelFields').querySelectorAll('input:not([type])')];
  const renames = { inputs: {}, outputs: {}, params: {} };
  const names = { inputs: [], outputs: [], params: [] };
  const params = [];
  for (const f of fields) {
    if (f.disabled) continue;
    const kind = f.dataset.kind;
    const value = f.value.trim();
    names[kind].push(value);
    if (kind === 'params') {
      if (f.dataset.old && f.dataset.old !== value) renames.params[f.dataset.old] = value;
      params.push({ name: value, module: Number(f.dataset.module), param: f.dataset.param });
    } else if (f.dataset.old !== value) {
      renames[kind][f.dataset.old] = value;
    }
  }
  for (const [kind, list] of Object.entries(names)) {
    const label = kind === 'params' ? 'knobs' : kind;
    if (list.some((n) => !n || n === '+')) return void ($('panelNote').textContent = `${label} need a name`);
    if (new Set(list).size !== list.length) return void ($('panelNote').textContent = `two ${label} have the same name`);
  }
  closePanelEdit();
  const next = renamePanel({ ...top.toJSON(), composites: top.composites }, name, renames);
  next.composites[name] = { ...next.composites[name], params, doc: $('panelDoc').value.trim() };
  top.apply(next);
  reloadInside();
}

$('innerPanel').addEventListener('click', openPanelEdit);
$('panelCancel').addEventListener('click', closePanelEdit);
$('panelOk').addEventListener('click', guarded(applyPanelEdit));
$('panelEdit').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') closePanelEdit();
  if (e.key === 'Enter') applyPanelEdit();
});

// right-click menu

const ctx = $('ctx');

function openContext(x, y, title, items) {
  closeMenu();
  $('ctxTitle').textContent = title;
  $('ctxItems').replaceChildren(...items.map((item) => {
    if (item instanceof Node) return item;
    const [label, run] = item;
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', guarded(async () => {
      closeContext();
      await run();
    }));
    return b;
  }));
  ctx.hidden = false;
  ctx.style.left = `${Math.max(4, Math.min(x, innerWidth - ctx.offsetWidth - 4))}px`;
  ctx.style.top = `${Math.max(4, Math.min(y, innerHeight - ctx.offsetHeight - 4))}px`;
  $('ctxItems').firstElementChild?.focus({ focusVisible: false });
}

// Colours to give modules: muted enough that a tinted panel stays calm in
// both themes. The last swatch picks any colour.
const SWATCHES = ['#d0453a', '#d98b2b', '#c9b13c', '#5d9e4a', '#3a9e94', '#3f78c4', '#7e5cc4', '#c25a9a'];

function swatches(mods) {
  const row = document.createElement('div');
  row.className = 'swatches';
  row.setAttribute('aria-label', 'colour');
  const current = mods.every((m) => m.color === mods[0].color) ? mods[0].color : undefined;
  const colour = (c) => {
    for (const m of mods) rack.setColour(m, c);
  };
  const swatch = (c, title) => {
    const b = document.createElement('button');
    b.title = title;
    b.setAttribute('aria-label', title);
    if (c) b.style.setProperty('--swatch', c);
    else b.classList.add('none');
    if (current === (c ?? null)) b.classList.add('on');
    b.addEventListener('click', () => {
      closeContext();
      colour(c);
    });
    return b;
  };
  row.append(swatch(null, 'no colour'), ...SWATCHES.map((c) => swatch(c, c)));
  // any colour; changes show while choosing
  const label = document.createElement('label');
  label.className = 'custom';
  label.title = 'any colour';
  const input = document.createElement('input');
  input.type = 'color';
  input.setAttribute('aria-label', 'any colour');
  const own = current && !SWATCHES.includes(current) ? current : null;
  input.value = own ?? current ?? '#808080';
  if (own) {
    label.classList.add('coloured', 'on');
    label.style.setProperty('--swatch', own);
  }
  input.addEventListener('input', () => colour(input.value));
  input.addEventListener('change', () => {
    colour(input.value);
    closeContext();
  });
  label.append(input);
  row.append(label);
  return row;
}

function closeContext() {
  ctx.hidden = true;
}

ctx.addEventListener('keydown', (e) => {
  const list = [...$('ctxItems').querySelectorAll('button, input')];
  const i = list.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') list[(i + 1) % list.length].focus();
  else if (e.key === 'ArrowUp') list[(i - 1 + list.length) % list.length].focus();
  else return;
  e.preventDefault();
});
ctx.addEventListener('contextmenu', (e) => e.preventDefault());

// patches
//
// The rack's patch is not kept in the url, only the name of a stored one:
// <app>/patch/<name> loads that patch from the service. nginx serves the page
// there with <base href="../">, so relative urls keep working.

const appRoot = new URL('.', document.baseURI);

function currentPatch() {
  return { ...top.toJSON(), midi: { in: midi.inName, out: midi.outName } };
}

// Loading is one undoable step, so an accidental "new" can be taken back.
function loadPatch(patch) {
  leaveTo(0);
  undo.commit();
  undo.quiet = true;
  try {
    top.load(patch);
  } finally {
    undo.quiet = false;
  }
  undo.commit();
  // a patch without midi settings (new, default, older files) keeps the ports
  if (patch.midi) midi.setPorts(patch.midi.in, patch.midi.out);
  if (usesInput()) audio.openInput().catch(showError);
  restoreSamples();
  syncCamera();
}

// unsaved changes
//
// `saved` is the patch as it was loaded or stored. While the rack differs, the
// name in the header gets a star, leaving the page asks first, and the rack is
// kept in this browser (autosave) and comes back on the next visit.

const canon = (patch) => JSON.stringify({
  modules: [...patch.modules].sort((a, b) => a.id - b.id),
  cables: patch.cables.map((c) => JSON.stringify(c)).sort(),
  midiMap: patch.midiMap,
  keyMap: patch.keyMap ?? [],
  composites: patch.composites ?? {},
});
let saved = null;
// the name of the patch whose changes are in the autosave, undefined for none
let autosaved;
try {
  autosaved = JSON.parse(localStorage.getItem('aparat.autosave'))?.name;
} catch {}
const dirty = () => saved !== null && canon(top.toJSON()) !== saved;

function markSaved() {
  undo.commit();
  saved = canon(top.toJSON());
  patchChanged();
}

// called after every step of the undo history
function patchChanged() {
  const changed = dirty();
  const name = patchFromPath();
  // the header shows the patch's name, also in the browser tab
  $('patchCurrent').textContent = `${name ?? 'untitled'}${changed ? ' *' : ''}`;
  $('patchCurrent').title = changed ? 'changed since it was loaded or stored' : 'loaded patch';
  if (editing) crumbs();
  document.title = `${name ?? 'untitled'}${changed ? ' *' : ''} · aparat`;
  try {
    if (changed) {
      localStorage.setItem('aparat.autosave', JSON.stringify({ name, patch: currentPatch() }));
      autosaved = name;
    } else if (autosaved === name) {
      // only this patch's: unsaved changes to another patch stay
      localStorage.removeItem('aparat.autosave');
      autosaved = undefined;
    }
  } catch {}
}

window.addEventListener('beforeunload', (e) => {
  undo.commit();
  if (dirty()) e.preventDefault();
});

// audio files of samplers
//
// A patch only names its files. They come back from this browser's storage
// if they were loaded here before.

async function restoreSamples() {
  for (const name of top.fileNames()) {
    if (!samples.get(name) && (await samples.restore(name))) top.fileLoaded(name);
  }
}

const loadSample = guarded(async (m, file) => {
  const name = await samples.add(file);
  top.fileLoaded(name); // other samplers playing a file of this name
  rack.setFile(m, name);
});

let sampleFor = null;
function chooseSample(m) {
  sampleFor = m;
  $('sampleFile').click();
}
$('sampleFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file && sampleFor) loadSample(sampleFor, file);
});
// Dropped files: a patch file (.json) anywhere in the window loads it, an
// audio file on empty rack space becomes a sampler there. Other drops are
// ignored rather than opened by the browser, which would leave the page.
const isPatchFile = (file) => /\.json$/i.test(file.name) || file.type === 'application/json';
//
// While files are dragged over the window, #dropzone says what a drop does.
// The browser tells the file's type during the drag, not its name.
const dropzone = $('dropzone');
let dragDepth = 0; // dragenter and dragleave fire for every element crossed
function dropHint(e) {
  const type = e.dataTransfer.items[0]?.type ?? '';
  if (type === 'application/json') return 'drop to load the patch';
  if (type.startsWith('audio/')) return 'drop on empty rack space for a sampler';
  return 'drop a patch file to load it, an audio file on empty rack space for a sampler';
}
const endDrag = () => {
  dragDepth = 0;
  dropzone.hidden = true;
};
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer.types.includes('Files')) return;
  if (dragDepth++ === 0) {
    dropzone.firstChild.textContent = dropHint(e);
    dropzone.hidden = false;
  }
});
window.addEventListener('dragleave', (e) => {
  if (e.dataTransfer.types.includes('Files') && --dragDepth <= 0) endDrag();
});
window.addEventListener('dragend', endDrag);
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer.types.includes('Files')) e.preventDefault();
});
window.addEventListener('drop', guarded(async (e) => {
  endDrag();
  const file = e.dataTransfer.files[0];
  if (!file) return;
  e.preventDefault();
  if (isPatchFile(file)) return importPatch(file);
  const cell = rack.cellAt(e.clientX, e.clientY);
  if (e.target === $('content') && cell) loadSample(rack.insert('sampler', cell), file);
}));

function usesInput() {
  return [...top.modules.values()].some((m) => m.type === 'input');
}

function patchFromPath() {
  if (!location.pathname.startsWith(appRoot.pathname)) return null;
  const match = /^patch\/([^/]+)$/.exec(location.pathname.slice(appRoot.pathname.length));
  try {
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

// The patch the rack shows, or null for none: as a link that can be shared
// (or the plain app url), in the header and the menu, and in the name field,
// so storing (also ctrl+s) never writes over a patch the rack no longer shows.
function showPatchInUrl(name) {
  const url = name ? new URL(`patch/${encodeURIComponent(name)}`, appRoot) : appRoot;
  if (url.href !== location.href) history.replaceState(null, '', url);
  $('patchName').value = name ?? '';
  patchChanged();
  markCurrentPatch();
  updatePatchButtons();
}

// engine messages

let cpu = 0;
const clipLamps = [];
const clipUntil = [];

function onEngineMessage(m) {
  switch (m.type) {
    case 'frame':
      onFrame(m);
      break;
    case 'midi':
      midi.send(m.data);
      break;
    case 'outbox':
      portals.fromEngine(m.list);
      break;
    case 'rec':
      recorder.onBlock(m);
      break;
    case 'error':
      showError(m.message);
      break;
  }
}

function onFrame(m) {
  cables.setPeaks(m.peaks);
  top.stepLights(m.lights);
  // the edit view lights the jacks of the composite's first instance
  if (editing) {
    const shown = [];
    for (const l of m.lights) {
      const rest = typeof l.id === 'string' && l.id.startsWith(`${shownPrefix}/`) ? l.id.slice(shownPrefix.length + 1) : '';
      // a composite inside it reads its own ids, 'n/m'
      if (rest) shown.push({ id: /^\d+$/.test(rest) ? Number(rest) : rest, v: l.v });
    }
    inner.stepLights(shown);
  }
  for (const d of m.displays) {
    top.drawDisplay(d.id, d.data);
    // the edit view shows the displays of the composite's first instance
    if (editing && typeof d.id === 'string' && d.id.startsWith(`${shownPrefix}/`)) {
      const rest = d.id.slice(shownPrefix.length + 1);
      if (/^\d+$/.test(rest)) inner.drawDisplay(Number(rest), d.data);
    }
  }
  cpu += (m.busy / m.span - cpu) * 0.05;
  $('cpu').textContent = `${Math.round(cpu * 100)}%`;
  const now = performance.now();
  clipLamps.forEach((lamp, c) => {
    if (m.clip[c]) clipUntil[c] = now + 300;
    lamp.classList.toggle('on', now < (clipUntil[c] ?? 0));
  });
}

function buildClipLamps() {
  const root = $('clip');
  root.replaceChildren();
  clipLamps.length = 0;
  for (let c = 0; c < audio.channels; c++) {
    const lamp = document.createElement('i');
    root.append(lamp);
    clipLamps.push(lamp);
  }
}

// midi in

function onMidiMessage(data) {
  audio.send({ op: 'midi', bytes: data });
  if ((data[0] & 0xf0) === 0xb0 && data[0] < 0xf0) top.handleCc((data[0] & 15) + 1, data[1], data[2]);
}

// portals: wireless cables to other tabs (modules/portal.js)
const portals = makePortals((m) => audio.running && audio.send(m));

// game controllers, sent while the engine runs (true: it was sent)
const gamepads = watchGamepads((m) => {
  if (!audio.running) return false;
  audio.send(m);
  return true;
});

// toolbar

async function startAudio() {
  recorder.stop();
  try {
    await audio.start($('device').value, { sampleRate: Number($('rate').value), latency: $('latency').value });
  } catch (err) {
    await stopAudio();
    throw err;
  }
  top.replay();
  gamepads.resend();
  camera.reset();
  syncCamera();
  portals.started();
  buildClipLamps();
  showAudioInfo();
  // outputLatency is often only known once sound is flowing
  setTimeout(showAudioInfo, 1000);
  $('start').textContent = 'stop';
  $('start').classList.add('on');
  if (usesInput()) await audio.openInput();
}

function showAudioInfo() {
  if (!audio.running) return;
  const ms = audio.latencyMs;
  $('channels').textContent = `${audio.channels} ch · ${audio.ctx.sampleRate} hz${ms ? ` · ${ms} ms` : ''}`;
}

async function stopAudio() {
  recorder.stop();
  await audio.stop();
  syncCamera();
  portals.stopped();
  cables.clearLevels();
  top.clearLive();
  inner.clearLive();
  $('start').textContent = 'start';
  $('start').classList.remove('on');
  $('channels').textContent = 'off';
  $('cpu').textContent = '';
  $('clip').replaceChildren();
  clipLamps.length = 0;
  cpu = 0;
}

async function showDevices() {
  const outputs = await listOutputs();
  const select = $('device');
  const previous = select.value;
  select.replaceChildren(new Option('system default', ''));
  outputs.forEach((d) => select.add(new Option(d.label || d.deviceId, d.deviceId)));
  select.value = outputs.some((d) => d.deviceId === previous) ? previous : '';
}

// add-module menu, shift+a opens it at the pointer

const menu = $('menu');
const search = $('search');
let menuCell = null;
let pointerAt = { x: innerWidth / 2, y: innerHeight / 2 };

async function addModule(name) {
  const cell = menuCell;
  closeMenu();
  const m = cell ? rack.insert(name, cell) : rack.add(name);
  m.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (name === 'input') await audio.openInput();
}

// The description of the module in focus (or under the pointer, or the first
// match of the search) replaces the hints below the list.
// It takes the hints' height, so the menu does not jump.
function showDoc(def) {
  const doc = $('doc');
  const hints = menu.querySelector('.hints');
  if (def && !hints.hidden) doc.style.height = `${hints.offsetHeight}px`;
  doc.textContent = def?.doc ?? '';
  doc.hidden = !def;
  hints.hidden = !!def;
}

function libraryButton(def) {
  const button = document.createElement('button');
  button.textContent = def.name;
  button.addEventListener('click', guarded(() => addModule(def.name)));
  button.addEventListener('focus', () => showDoc(def));
  button.addEventListener('pointerenter', () => showDoc(def));
  button.addEventListener('pointerleave', () => showDoc(focusedDef()));
  button.def = def;
  return button;
}
for (const def of [...defs].sort((a, b) => a.name.localeCompare(b.name))) $('library').append(libraryButton(def));

// the patch's composites come first, marked, and change with the patch
function listComposites() {
  for (const b of $('library').querySelectorAll('.composite')) b.remove();
  const banned = openNow();
  const names = Object.keys(rack.composites).filter((n) => !banned.has(n)).sort((a, b) => a.localeCompare(b));
  $('library').prepend(...names.map((name) => {
    const b = libraryButton(rack.defOf(name));
    b.classList.add('composite');
    return b;
  }));
}

// the def of the focused or highlighted button, if any
function focusedDef() {
  const lib = $('library');
  if (lib.contains(document.activeElement)) return document.activeElement.def;
  return lib.querySelector('button.first')?.def ?? null;
}

function filterMenu() {
  const q = search.value.trim().toLowerCase();
  let first = null;
  for (const b of $('library').children) {
    b.hidden = !b.textContent.includes(q);
    b.classList.remove('first');
    if (!b.hidden && !first) first = b;
  }
  if (q) first?.classList.add('first');
  showDoc(focusedDef());
  return first;
}

function openMenu(x, y, cell) {
  menuCell = cell;
  listComposites();
  search.value = '';
  filterMenu();
  menu.hidden = false;
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - w - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - h - 4))}px`;
  search.focus();
}

function closeMenu() {
  menu.hidden = true;
  menuCell = null;
}

search.addEventListener('input', filterMenu);
search.addEventListener('focus', () => showDoc(focusedDef()));
search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') filterMenu()?.click();
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    [...$('library').children].find((b) => !b.hidden)?.focus();
  }
});
$('library').addEventListener('keydown', (e) => {
  const list = [...$('library').children].filter((b) => !b.hidden);
  const i = list.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') list[i + 1]?.focus();
  if (e.key === 'ArrowUp') (list[i - 1] ?? search).focus();
  if (e.key.startsWith('Arrow')) e.preventDefault();
});
$('add').addEventListener('click', () => {
  if (!menu.hidden) return closeMenu();
  const r = $('add').getBoundingClientRect();
  openMenu(r.left, r.bottom + 4, null);
});
window.addEventListener('pointermove', (e) => {
  pointerAt = { x: e.clientX, y: e.clientY };
});
// capture phase: rack panning stops the event before it would bubble here
window.addEventListener('pointerdown', (e) => {
  if (!menu.hidden && !menu.contains(e.target) && e.target !== $('add')) closeMenu();
  if (!ctx.hidden && !ctx.contains(e.target)) closeContext();
}, true);
// right-click on empty rack space: the add-module menu at the pointer
// right-click on a cable, also where it crosses a module: the cable's menu
for (const [scroller, content] of [[$('rack'), $('content')], [$('innerRack'), $('innerContent')]]) {
  scroller.addEventListener('contextmenu', (e) => {
    const cable = rack.cableAt(e);
    if (!cable) return;
    e.preventDefault();
    e.stopPropagation();
    closeMenu();
    rack.selectCable(cable);
    openContext(e.clientX, e.clientY, rack.cableName(cable), [['remove', () => rack.disconnect(cable)]]);
  }, true);
  content.addEventListener('contextmenu', (e) => {
    if (e.target !== content) return;
    e.preventDefault();
    closeContext();
    openMenu(e.clientX, e.clientY, rack.cellAt(e.clientX, e.clientY));
  });
}

$('start').addEventListener('click', guarded(() => (audio.running ? stopAudio() : startAudio())));
$('devices').addEventListener('click', guarded(showDevices));
$('device').addEventListener('change', guarded(async () => {
  if (audio.running) await startAudio();
}));
// sample rate and latency are kept in this browser; a change restarts audio
for (const [id, key] of [['rate', 'aparat.rate'], ['latency', 'aparat.latency']]) {
  const select = $(id);
  try {
    const stored = localStorage.getItem(key);
    if ([...select.options].some((o) => o.value === stored)) select.value = stored;
  } catch {
    // the default then
  }
  select.addEventListener('change', guarded(async () => {
    try {
      localStorage.setItem(key, select.value);
    } catch {
      // still used for now
    }
    if (audio.running) await startAudio();
  }));
}
$('midi').addEventListener('click', guarded(async () => {
  await midi.enable();
  $('midi').hidden = true;
  $('midiPorts').hidden = false;
}));
// the computer keyboard plays notes, unless switched off in the midi menu
let keysOn = true;
try {
  keysOn = localStorage.getItem('aparat.keys') !== 'off';
} catch {}
const keys = makeKeys({ send: onMidiMessage, enabled: () => keysOn });
function showKeys() {
  $('keys').textContent = `computer keyboard: ${keysOn ? 'on' : 'off'}`;
}
showKeys();
$('keys').addEventListener('click', () => {
  keysOn = !keysOn;
  keys.release();
  showKeys();
  try {
    localStorage.setItem('aparat.keys', keysOn ? 'on' : 'off');
  } catch {}
});

$('new').addEventListener('click', () => {
  loadPatch(newPatch);
  showPatchInUrl(null);
  markSaved();
});
$('share').addEventListener('click', guarded(async () => {
  const url = appRoot.href + (await patchToHash(currentPatch()));
  const files = top.fileNames().length ? ' (audio files are not part of it)' : '';
  try {
    await navigator.clipboard.writeText(url);
    showInfo(`link to this patch copied${files}`);
  } catch {
    // no clipboard access: the address bar has it
    history.replaceState(null, '', url);
    showInfo(`the address bar now holds a link to this patch${files}`);
  }
}));
$('save').addEventListener('click', () => {
  download(new Blob([JSON.stringify(currentPatch(), null, 2)], { type: 'application/json' }), `aparat-${stamp()}.json`);
});
$('load').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', guarded(async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) await importPatch(file);
}));

// a patch file from the menu or dropped on the window
async function importPatch(file) {
  let patch;
  try {
    patch = JSON.parse(await file.text());
  } catch {
    throw new Error(`${file.name} is not a patch file`);
  }
  if (!Array.isArray(patch?.modules) || !Array.isArray(patch?.cables)) throw new Error(`${file.name} is not a patch file`);
  loadPatch(patch);
  showPatchInUrl(null);
  markSaved();
}
// help: help.html in its own tab, the same one each time, at a section or a
// module (help.js gives module entries the ids m-<name>)
function openHelp(id) {
  window.open(`help.html#${id}`, 'aparat-help')?.focus();
}
for (const b of document.querySelectorAll('[data-help]')) b.addEventListener('click', () => openHelp(b.dataset.help));

// settings: light or dark, or as the system says
$('theme').value = getTheme();
$('theme').addEventListener('change', (e) => setTheme(e.target.value));
onThemeChange(() => {
  top.redrawDisplays();
  inner.redrawDisplays();
});
$('record').addEventListener('click', guarded(() => recorder.toggle()));

// patches on the server, only shown when the service is there

// Factory patches come with aparat. Storing over one keeps your version, and
// deleting that ("revert") brings the factory patch back.
let patchList = [];
const patchInfo = (name) => patchList.find((p) => p.name === name);

function deleteLabel() {
  return patchInfo($('patchName').value.trim())?.factory ? 'revert' : 'delete';
}

function updatePatchButtons() {
  const name = $('patchName').value.trim();
  const info = patchInfo(name);
  $('patchLoad').disabled = !info;
  $('patchDelete').disabled = !info || (info.factory && !info.stored);
  $('patchDelete').title = info?.factory
    ? info.stored ? 'delete your version and go back to the factory patch' : 'factory patches cannot be deleted'
    : '';
  $('patchStore').disabled = !name;
  $('patchStore').textContent = info ? 'overwrite' : 'store';
  disarmDelete();
}

async function refreshPatches() {
  patchList = await patches.list();
  $('patchList').replaceChildren(...patchList.map((p) => new Option(p.factory ? `${p.name} (factory)` : p.name, p.name)));
  // the patches menu lists them all, a click loads one
  $('patchItems').replaceChildren(...patchList.map((p) => {
    const b = document.createElement('button');
    b.setAttribute('role', 'menuitem');
    b.dataset.name = p.name;
    b.textContent = p.name;
    if (p.factory) {
      const tag = document.createElement('kbd');
      tag.textContent = p.stored ? 'factory, changed' : 'factory';
      b.append(tag);
    }
    b.addEventListener('click', () => {
      $('patchName').value = p.name;
      updatePatchButtons();
      loadNamedPatch();
    });
    return b;
  }));
  if (!patchList.length) $('patchItems').textContent = 'no patches stored yet';
  markCurrentPatch();
  updatePatchButtons();
}

function markCurrentPatch() {
  const current = patchFromPath();
  for (const b of $('patchItems').querySelectorAll('button')) b.classList.toggle('current', b.dataset.name === current);
}

function flash(button, text) {
  button.textContent = text;
  setTimeout(() => {
    if (button.textContent === text) updatePatchButtons();
  }, 1200);
}

let deleteTimer = 0;
function disarmDelete() {
  clearTimeout(deleteTimer);
  $('patchDelete').classList.remove('confirm');
  $('patchDelete').textContent = deleteLabel();
}

const loadNamedPatch = guarded(async () => {
  const name = $('patchName').value.trim();
  loadPatch(await patches.load(name));
  showPatchInUrl(name);
  markSaved();
  flash($('patchLoad'), 'loaded');
});

$('patchName').addEventListener('input', updatePatchButtons);
$('patchName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !$('patchLoad').disabled) loadNamedPatch();
});
$('patchLoad').addEventListener('click', loadNamedPatch);
$('patchStore').addEventListener('click', guarded(async () => {
  const name = $('patchName').value.trim();
  await patches.store(name, currentPatch());
  showPatchInUrl(name);
  markSaved();
  await refreshPatches();
  flash($('patchStore'), 'stored');
}));
$('patchDelete').addEventListener('click', guarded(async () => {
  const button = $('patchDelete');
  if (!button.classList.contains('confirm')) {
    button.classList.add('confirm');
    button.textContent = 'sure?';
    deleteTimer = setTimeout(disarmDelete, 3000);
    return;
  }
  disarmDelete();
  const name = $('patchName').value.trim();
  const factory = patchInfo(name)?.factory;
  await patches.remove(name);
  await refreshPatches();
  if (factory) {
    // reverted: show the factory version
    loadPatch(await patches.load(name));
    showPatchInUrl(name);
    markSaved();
    flash(button, 'reverted');
    return;
  }
  if (patchFromPath() === name) showPatchInUrl(null);
  flash(button, 'deleted');
}));

patches.available().then(async (ok) => {
  if (!ok) return;
  $('patches').hidden = false;
  await refreshPatches().catch(showError);
});

// zoom, remembered per browser, not part of the patch

const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];
const zoomStep = (dir) =>
  dir > 0
    ? ZOOM_LEVELS.find((l) => l > rack.zoom + 0.001) ?? ZOOM_MAX
    : ZOOM_LEVELS.findLast((l) => l < rack.zoom - 0.001) ?? ZOOM_MIN;

function zoomTo(z, clientX, clientY) {
  rack.setZoom(z, clientX, clientY);
  $('zoomLevel').textContent = `${Math.round(rack.zoom * 100)}%`;
  $('zoomOut').disabled = rack.zoom <= ZOOM_MIN;
  $('zoomIn').disabled = rack.zoom >= ZOOM_MAX;
  try {
    localStorage.setItem('aparat.zoom', String(rack.zoom));
  } catch {}
}

$('zoomIn').addEventListener('click', () => zoomTo(zoomStep(1)));
$('zoomOut').addEventListener('click', () => zoomTo(zoomStep(-1)));
$('zoomReset').addEventListener('click', () => zoomTo(1));
// ctrl+wheel, which is also what a trackpad pinch sends
$('stage').addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  zoomTo(rack.zoom * Math.exp(-delta * 0.002), e.clientX, e.clientY);
}, { passive: false });

const typing = (el) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && bar.open) {
    bar.hide();
    return;
  }
  if (e.key === 'Escape' && !ctx.hidden) {
    closeContext();
    return;
  }
  if (e.key === 'Escape' && !menu.hidden) {
    closeMenu();
    return;
  }
  if (typing(e.target)) return;
  // space scrolls a page down; the rack should stay put. Buttons and the
  // push buttons on panels still take it.
  if (e.key === ' ' && !e.target.closest('button, [role="switch"]')) e.preventDefault();
  // edits during a drag would fight with the layout the drag works on
  if (rack.dragging && e.key !== 'Escape') return;
  if (e.key === 'Escape' && rack.cancelLearn()) return;
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && playKey(e)) {
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape' && editing && !rack.selection.size && !rack.selectedCable) {
    leaveTo(editing.length - 1);
    return;
  }
  if (e.key === 'Escape') {
    rack.select(null);
    rack.cables.selected = null;
    return;
  }
  if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    openHelp('start');
    return;
  }
  if (keys.keydown(e)) {
    e.preventDefault();
    return;
  }
  const command = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
  if (command && e.code === 'KeyD') {
    e.preventDefault();
    if (rack.selection.size) duplicateSelection();
    return;
  }
  if (command && e.code === 'KeyA') {
    e.preventDefault();
    rack.selectAll();
    return;
  }
  if (command && e.code === 'KeyC') {
    copySelection();
    return;
  }
  if (command && e.code === 'KeyV') {
    pasteClipboard();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyS') {
    // store the patch when it has a name, otherwise export a file
    e.preventDefault();
    if (!$('patches').hidden && !$('patchStore').disabled) $('patchStore').click();
    else $('save').click();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY')) {
    e.preventDefault();
    undo.go(e.code === 'KeyY' || e.shiftKey ? 1 : -1);
    return;
  }
  if (e.code === 'KeyA' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (!menu.hidden) closeMenu();
    else openMenu(pointerAt.x, pointerAt.y, rack.cellAt(pointerAt.x, pointerAt.y));
    return;
  }
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    const at = rack.cellAt(pointerAt.x, pointerAt.y) ? [pointerAt.x, pointerAt.y] : [];
    if (e.key === '+' || e.key === '=') return zoomTo(zoomStep(1), ...at);
    if (e.key === '-') return zoomTo(zoomStep(-1), ...at);
    if (e.key === '0') return zoomTo(1, ...at);
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && menu.hidden) {
    // the cable under the pointer goes first, then the selection
    const c = rack.hoverCable;
    if (c && rack.cables.list.includes(c)) {
      rack.disconnect(c);
      rack.hoverCable = null;
      rack.cables.setHighlight(null);
    } else {
      removeSelection();
    }
  }
});

// Key learn and linked keys (see rack.keyDown). Keys with a job of their own
// can't be learned; the rest, also the playing keyboard's, can, and a linked
// key then plays its button instead of a note. Links live in the patch, so
// they are learned outside the edit view.
const TAKEN = new Set(['Escape', 'Delete', 'Backspace', 'Tab', 'Equal', 'Minus', 'Digit0', 'Slash', 'NumpadAdd', 'NumpadSubtract']);

function playKey(e) {
  if (rack !== top && rack.learning) return false;
  if (top.learning && TAKEN.has(e.code)) {
    showInfo(`${keyName(e.code)} has a job of its own, pick another key`);
    return true;
  }
  const done = top.keyDown(e);
  if (done === 'knob') {
    top.cancelLearn();
    showInfo('keys work on buttons and switches; knobs learn midi controllers');
    return true;
  }
  return !!done;
}

window.addEventListener('keyup', (e) => top.keyUp(e.code));
window.addEventListener('blur', () => top.releaseKeys());

// touch: a long press is a right-click (browsers without a context menu on
// touch, like Safari on iOS, never send one)
{
  const HOLD_MS = 550;
  let timer = 0;
  let fired = 0;
  const cancel = () => clearTimeout(timer);
  $('stage').addEventListener('pointerdown', (e) => {
    cancel();
    if (e.pointerType !== 'touch') return;
    const { target, clientX, clientY } = e;
    const moved = (ev) => {
      if (Math.hypot(ev.clientX - clientX, ev.clientY - clientY) > 8) cancel();
    };
    window.addEventListener('pointermove', moved);
    const done = () => {
      cancel();
      window.removeEventListener('pointermove', moved);
      window.removeEventListener('pointerup', done);
      window.removeEventListener('pointercancel', done);
    };
    window.addEventListener('pointerup', done);
    window.addEventListener('pointercancel', done);
    timer = setTimeout(() => {
      fired = Date.now();
      target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY }));
    }, HOLD_MS);
  }, true);
  // the browser's own long-press menu event: use it instead of ours, or drop
  // it if ours was first
  window.addEventListener('contextmenu', (e) => {
    if (!e.isTrusted) return;
    cancel();
    if (Date.now() - fired < 1000) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}

// What the rack starts with: a patch packed into the link, else the patch
// named in the url, else the factory patch "default". Unsaved changes from
// the last visit come back on top of the patch they were made to. Without the
// patch service (or if loading fails) the rack starts with a new patch.
async function loadStored(name) {
  try {
    loadPatch(await patches.load(name));
    showPatchInUrl(name);
  } catch (err) {
    showError(`could not load patch "${name}": ${err.message.replace(/^patch: /, '')}`);
    loadPatch(newPatch);
    showPatchInUrl(null);
  }
}

let unsaved = null;
try {
  unsaved = JSON.parse(localStorage.getItem('aparat.autosave'));
} catch {}
let shared = null;
try {
  shared = await patchFromHash(location.hash);
} catch {
  showError('the patch in this link is damaged');
}
const named = patchFromPath();
if (shared) {
  loadPatch(shared);
  showPatchInUrl(null);
  markSaved();
} else if (unsaved?.patch && (named === null || named === unsaved.name)) {
  if (unsaved.name) await loadStored(unsaved.name);
  else showPatchInUrl(null);
  markSaved();
  undo.reset();
  loadPatch(unsaved.patch);
  showInfo('unsaved changes from your last visit are back (undo returns to the patch as stored)');
} else {
  await loadStored(named ?? 'default');
  markSaved();
}
let savedZoom = 1;
try {
  savedZoom = Number(localStorage.getItem('aparat.zoom')) || 1;
} catch {}
zoomTo(savedZoom);
if (!dirty()) undo.reset();
else patchChanged();
window.aparat = { get rack() { return rack; }, top, inner, audio, midi, undo, camera };
