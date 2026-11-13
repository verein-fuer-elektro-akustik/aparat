import { defs } from '../modules/index.js';
import { AudioEngine, listOutputs } from './audio.js';
import { CableLayer } from './cables.js';
import { newPatch } from './new-patch.js';
import { menubar } from './menubar.js';
import { Midi } from './midi.js';
import { patches } from './patches.js';
import { Rack, ZOOM_MAX, ZOOM_MIN } from './rack.js';
import { encodeWav } from './wav.js';

const $ = (id) => document.getElementById(id);

// Warnings stack at the top right. Each closes on click or after a while; the
// same message again restarts its timer instead of stacking up.
const TOAST_MS = 8000;
const MAX_TOASTS = 4;

function showError(err) {
  if (!err) return;
  const text = String(err.message ?? err);
  const root = $('error');
  let toast = [...root.children].find((t) => t.textContent === text);
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = text;
    toast.title = 'click to close';
    toast.addEventListener('click', () => toast.remove());
    root.append(toast);
    while (root.children.length > MAX_TOASTS) root.firstElementChild.remove();
  }
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toast.remove(), TOAST_MS);
}
// keep warnings just below the toolbar, which wraps on narrow windows
new ResizeObserver(() => {
  $('error').style.top = `${document.querySelector('header').getBoundingClientRect().bottom + 8}px`;
}).observe(document.querySelector('header'));
window.addEventListener('error', (e) => showError(e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason));

const guarded = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    showError(err);
  }
};

const audio = new AudioEngine(onEngineMessage);
const cables = new CableLayer($('cables'), $('rack'));

const midi = new Midi({
  inSelect: $('midiIn'),
  outSelect: $('midiOut'),
  onMessage: onMidiMessage,
});

const rack = new Rack({
  scroller: $('rack'),
  sizer: $('sizer'),
  content: $('content'),
  cables,
  send: (m) => audio.send(m),
  onChange: () => undo.changed(),
  onContextMenu: (e, m) => openContext(e.clientX, e.clientY, m.type, [
    ['random', () => rack.randomize(m)],
    ['reset', () => rack.resetParams(m)],
    ['duplicate', () => rack.duplicate(m)],
    ['remove', () => rack.remove(m)],
  ]),
});

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
  snapshot: () => JSON.stringify(rack.toJSON()),
  reset() {
    clearTimeout(this.timer);
    this.stack = [this.snapshot()];
    this.at = 0;
    this.buttons();
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
      rack.apply(JSON.parse(this.stack[to]));
    } finally {
      this.quiet = false;
    }
    // module and cable order can differ after apply; keep what the rack now says
    this.stack[to] = this.snapshot();
    if (rack.selected && !rack.live(rack.selected)) rack.select(null);
    this.buttons();
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
    const m = rack.selected;
    for (const id of ['editDuplicate', 'editRandom', 'editReset']) $(id).disabled = !m;
    $('editRemove').disabled = !m && !rack.selectedCable;
  },
});
$('editAdd').addEventListener('click', () => {
  const r = $('add').getBoundingClientRect();
  openMenu(r.left, r.bottom + 4, null);
});
$('editDuplicate').addEventListener('click', () => rack.selected && rack.duplicate(rack.selected));
$('editRandom').addEventListener('click', () => rack.selected && rack.randomize(rack.selected));
$('editReset').addEventListener('click', () => rack.selected && rack.resetParams(rack.selected));
$('editRemove').addEventListener('click', () => removeSelection());

function removeSelection() {
  if (rack.selectedCable) rack.disconnect(rack.selectedCable);
  else if (rack.selected) rack.remove(rack.selected);
}

// right-click menu

const ctx = $('ctx');

function openContext(x, y, title, items) {
  closeMenu();
  $('ctxTitle').textContent = title;
  $('ctxItems').replaceChildren(...items.map(([label, run]) => {
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

function closeContext() {
  ctx.hidden = true;
}

ctx.addEventListener('keydown', (e) => {
  const list = [...$('ctxItems').children];
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
  return { ...rack.toJSON(), midi: { in: midi.inName, out: midi.outName } };
}

// Loading is one undoable step, so an accidental "new" can be taken back.
function loadPatch(patch) {
  undo.commit();
  undo.quiet = true;
  try {
    rack.load(patch);
  } finally {
    undo.quiet = false;
  }
  undo.commit();
  // a patch without midi settings (new, default, older files) keeps the ports
  if (patch.midi) midi.setPorts(patch.midi.in, patch.midi.out);
  if (usesInput()) audio.openInput().catch(showError);
}

function usesInput() {
  return [...rack.modules.values()].some((m) => m.type === 'input');
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
  $('patchCurrent').textContent = name ?? '';
  $('patchName').value = name ?? '';
  markCurrentPatch();
  updatePatchButtons();
}

// engine messages

let rec = null;
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
    case 'rec':
      if (rec) {
        rec.channels = m.channels;
        rec.blocks.push(m.data);
      }
      break;
    case 'error':
      showError(m.message);
      break;
  }
}

function onFrame(m) {
  cables.setPeaks(m.peaks);
  for (const d of m.displays) rack.drawDisplay(d.id, d.data);
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
  if ((data[0] & 0xf0) === 0xb0 && data[0] < 0xf0) rack.handleCc((data[0] & 15) + 1, data[1], data[2]);
}

// toolbar

async function startAudio() {
  stopRecording();
  try {
    await audio.start($('device').value);
  } catch (err) {
    await stopAudio();
    throw err;
  }
  rack.replay();
  buildClipLamps();
  $('channels').textContent = `${audio.channels} ch · ${audio.ctx.sampleRate} hz`;
  $('start').textContent = 'stop';
  $('start').classList.add('on');
  if (usesInput()) await audio.openInput();
}

async function stopAudio() {
  stopRecording();
  await audio.stop();
  cables.clearLevels();
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

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

function stopRecording() {
  if (!rec) return;
  audio.send({ op: 'record', on: false });
  const { blocks, channels } = rec;
  rec = null;
  $('record').classList.remove('on');
  $('record').textContent = 'record';
  if (blocks.length) download(encodeWav(blocks, channels, audio.ctx.sampleRate), `aparat-${stamp()}.wav`);
}

function toggleRecording() {
  if (rec) {
    stopRecording();
    return;
  }
  if (!audio.running) throw new Error('start audio first');
  rec = { blocks: [], channels: audio.channels };
  audio.send({ op: 'record', on: true });
  $('record').classList.add('on');
  $('record').textContent = 'stop rec';
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

for (const def of defs) {
  const button = document.createElement('button');
  button.textContent = def.name;
  button.addEventListener('click', guarded(() => addModule(def.name)));
  $('library').append(button);
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
  return first;
}

function openMenu(x, y, cell) {
  menuCell = cell;
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
$('rack').addEventListener('contextmenu', (e) => {
  const cable = rack.cableAt(e);
  if (!cable) return;
  e.preventDefault();
  e.stopPropagation();
  closeMenu();
  rack.selectCable(cable);
  openContext(e.clientX, e.clientY, rack.cableName(cable), [['remove', () => rack.disconnect(cable)]]);
}, true);
$('content').addEventListener('contextmenu', (e) => {
  if (e.target !== $('content')) return;
  e.preventDefault();
  closeContext();
  openMenu(e.clientX, e.clientY, rack.cellAt(e.clientX, e.clientY));
});

$('start').addEventListener('click', guarded(() => (audio.running ? stopAudio() : startAudio())));
$('devices').addEventListener('click', guarded(showDevices));
$('device').addEventListener('change', guarded(async () => {
  if (audio.running) await startAudio();
}));
$('midi').addEventListener('click', guarded(async () => {
  await midi.enable();
  $('midi').hidden = true;
  $('midiPorts').hidden = false;
}));
$('new').addEventListener('click', () => {
  loadPatch(newPatch);
  showPatchInUrl(null);
});
$('save').addEventListener('click', () => {
  download(new Blob([JSON.stringify(currentPatch(), null, 2)], { type: 'application/json' }), `aparat-${stamp()}.json`);
});
$('load').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', guarded(async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  loadPatch(JSON.parse(await file.text()));
  showPatchInUrl(null);
}));
$('record').addEventListener('click', guarded(toggleRecording));

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
$('rack').addEventListener('wheel', (e) => {
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
  // edits during a drag would fight with the layout the drag works on
  if (rack.dragging && e.key !== 'Escape') return;
  if (e.key === 'Escape') {
    rack.select(null);
    rack.cables.selected = null;
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyD') {
    e.preventDefault();
    if (rack.selected) rack.duplicate(rack.selected);
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
  if ((e.key === 'Delete' || e.key === 'Backspace') && menu.hidden) removeSelection();
});

// The patch from the url, or else the factory patch "default". Without the
// patch service (or if loading fails) the rack starts with a new patch.
const startPatch = patchFromPath() ?? 'default';
try {
  loadPatch(await patches.load(startPatch));
  showPatchInUrl(startPatch);
} catch (err) {
  showError(`could not load patch "${startPatch}": ${err.message.replace(/^patch: /, '')}`);
  loadPatch(newPatch);
  showPatchInUrl(null);
}
let savedZoom = 1;
try {
  savedZoom = Number(localStorage.getItem('aparat.zoom')) || 1;
} catch {}
zoomTo(savedZoom);
undo.reset();
window.aparat = { rack, audio, midi, undo };
