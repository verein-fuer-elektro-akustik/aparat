import { defs } from '../modules/index.js';
import { AudioEngine, listOutputs } from './audio.js';
import { CableLayer } from './cables.js';
import { defaultPatch } from './default-patch.js';
import { Midi } from './midi.js';
import { Rack } from './rack.js';
import { encodeWav } from './wav.js';

const $ = (id) => document.getElementById(id);

function showError(err) {
  $('error').textContent = err ? String(err.message ?? err) : '';
}
window.addEventListener('error', (e) => showError(e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason));

const guarded = (fn) => async (...args) => {
  showError(null);
  try {
    await fn(...args);
  } catch (err) {
    showError(err);
  }
};

const audio = new AudioEngine(onEngineMessage);
const cables = new CableLayer($('cables'), $('rack'));
let saveTimer = 0;
let restoring = false;

const midi = new Midi({
  inSelect: $('midiIn'),
  outSelect: $('midiOut'),
  onMessage: onMidiMessage,
  onChange: scheduleSave,
});

const rack = new Rack({
  scroller: $('rack'),
  content: $('content'),
  cables,
  send: (m) => audio.send(m),
  onChange: scheduleSave,
});

// patch persistence

function currentPatch() {
  return { ...rack.toJSON(), midi: { in: midi.inName, out: midi.outName } };
}

function scheduleSave() {
  if (restoring) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    history.replaceState(null, '', `#${encodeURIComponent(JSON.stringify(currentPatch()))}`);
  }, 300);
}

function loadPatch(patch) {
  restoring = true;
  rack.load(patch);
  midi.setPorts(patch.midi?.in, patch.midi?.out);
  restoring = false;
  if (usesInput()) audio.openInput().catch(showError);
  scheduleSave();
}

function usesInput() {
  return [...rack.modules.values()].some((m) => m.type === 'input');
}

function patchFromHash() {
  const hash = location.hash.slice(1);
  if (!hash) return null;
  try {
    return JSON.parse(decodeURIComponent(hash));
  } catch {
    showError('could not read the patch in this url, loaded the default instead');
    return null;
  }
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
  await audio.start($('device').value);
  rack.replay();
  buildClipLamps();
  $('channels').textContent = `${audio.channels} ch · ${audio.ctx.sampleRate} hz`;
  $('start').textContent = 'restart audio';
  $('start').classList.add('on');
  if (usesInput()) await audio.openInput();
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
  $('record').textContent = 'stop';
}

for (const def of defs) {
  const button = document.createElement('button');
  button.textContent = def.name;
  button.addEventListener('click', guarded(async () => {
    const m = rack.add(def.name);
    m.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (def.name === 'input') await audio.openInput();
  }));
  $('library').append(button);
}

$('start').addEventListener('click', guarded(startAudio));
$('devices').addEventListener('click', guarded(showDevices));
$('device').addEventListener('change', guarded(async () => {
  if (audio.running) await startAudio();
}));
$('midi').addEventListener('click', guarded(async () => {
  await midi.enable();
  $('midi').hidden = true;
}));
$('new').addEventListener('click', () => loadPatch({ modules: [], cables: [] }));
$('save').addEventListener('click', () => {
  download(new Blob([JSON.stringify(currentPatch(), null, 2)], { type: 'application/json' }), `aparat-${stamp()}.json`);
});
$('load').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', guarded(async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) loadPatch(JSON.parse(await file.text()));
}));
$('record').addEventListener('click', guarded(toggleRecording));

window.addEventListener('keydown', (e) => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && rack.selected && e.target.tagName !== 'INPUT') {
    rack.remove(rack.selected);
  }
});

loadPatch(patchFromHash() ?? defaultPatch);
window.aparat = { rack, audio, midi };
