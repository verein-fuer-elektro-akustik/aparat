const $ = (id) => document.getElementById(id);

const report = {
  page: {
    userAgent: navigator.userAgent,
    secureContext: window.isSecureContext,
    cores: navigator.hardwareConcurrency,
  },
};

function renderReport() {
  $('report').textContent = JSON.stringify(report, null, 2);
}
renderReport();

function showError(err) {
  $('error').textContent = String(err?.message ?? err);
}
window.addEventListener('error', (e) => showError(e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason));

const guarded = (fn) => async (...args) => {
  $('error').textContent = '';
  try {
    await fn(...args);
  } catch (err) {
    showError(err);
  }
};

// audio

let ctx = null;
let node = null;
let channelCount = 0;
let walking = false;
const toneButtons = [];
let onBenchResult = null;
let onPong = null;
let peakMessages = 0;

async function listDevices() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((t) => t.stop());
  const devices = await navigator.mediaDevices.enumerateDevices();
  const outputs = devices.filter((d) => d.kind === 'audiooutput');
  const sink = $('sink');
  sink.replaceChildren(new Option('system default', ''));
  for (const d of outputs) {
    if (d.deviceId !== 'default') sink.add(new Option(d.label || d.deviceId, d.deviceId));
  }
  report.outputDevices = outputs.map((d) => d.label);
  renderReport();
}

function timeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

function dbToGain(db) {
  return Math.pow(10, db / 20);
}

function sendLevel() {
  const db = Number($('level').value);
  $('levelText').textContent = `${db} db`;
  node?.port.postMessage({ type: 'gain', value: dbToGain(db) });
}

function allOff() {
  walking = false;
  $('walk').classList.remove('on');
  node?.port.postMessage({ type: 'allOff' });
  toneButtons.forEach((b) => b.classList.remove('on'));
}

async function startAudio() {
  allOff();
  if (ctx) await ctx.close();
  const sinkId = $('sink').value;
  ctx = new AudioContext(sinkId ? { latencyHint: 'interactive', sinkId } : { latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule('processor.js');
  await timeout(ctx.resume(), 5000, 'audio context did not start within 5 seconds');

  const dest = ctx.destination;
  const max = dest.maxChannelCount;
  channelCount = Math.min(Math.max(max, 1), 32);
  let channelError = null;
  try {
    dest.channelCount = channelCount;
    dest.channelCountMode = 'explicit';
    dest.channelInterpretation = 'discrete';
  } catch (err) {
    channelError = String(err.message ?? err);
  }

  node = new AudioWorkletNode(ctx, 'test', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [channelCount],
  });
  node.channelInterpretation = 'discrete';
  node.connect(dest);
  node.port.onmessage = (e) => onWorkletMessage(e.data);
  sendLevel();

  report.audio = {
    device: $('sink').selectedOptions[0].textContent,
    state: ctx.state,
    sampleRate: ctx.sampleRate,
    baseLatencyMs: round(ctx.baseLatency * 1000),
    outputLatencyMs: round(ctx.outputLatency * 1000),
    maxChannelCount: max,
    destinationChannelCount: dest.channelCount,
    channelError,
  };
  $('audioInfo').textContent = JSON.stringify(report.audio, null, 2);
  renderReport();
  buildChannels();
  $('walk').disabled = false;
  $('allOff').disabled = false;
  $('bench').disabled = false;
  $('ping').disabled = false;
}

function onWorkletMessage(m) {
  switch (m.type) {
    case 'started':
      report.audio.workletChannels = m.channels;
      report.audio.blockFrames = m.frames;
      $('audioInfo').textContent = JSON.stringify(report.audio, null, 2);
      renderReport();
      break;
    case 'pong':
      onPong?.(m.t);
      break;
    case 'peaks':
      peakMessages++;
      break;
    case 'benchResult':
      onBenchResult?.(m);
      break;
  }
}

function round(v, digits = 2) {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

function buildChannels() {
  const root = $('channels');
  root.replaceChildren();
  toneButtons.length = 0;
  report.channelsHeard = [];
  for (let ch = 0; ch < channelCount; ch++) {
    const cell = document.createElement('div');
    const btn = document.createElement('button');
    const hz = Math.round(110 * Math.pow(2, ch / 6));
    btn.textContent = `ch ${ch + 1} · ${hz} hz`;
    btn.addEventListener('click', () => {
      const on = !btn.classList.contains('on');
      btn.classList.toggle('on', on);
      node.port.postMessage({ type: 'tone', ch, on });
    });
    const label = document.createElement('label');
    const heard = document.createElement('input');
    heard.type = 'checkbox';
    heard.addEventListener('change', () => {
      if (heard.checked) report.channelsHeard.push(ch + 1);
      else report.channelsHeard = report.channelsHeard.filter((c) => c !== ch + 1);
      report.channelsHeard.sort((a, b) => a - b);
      renderReport();
    });
    label.append(heard, 'heard');
    cell.append(btn, label);
    root.append(cell);
    toneButtons.push(btn);
  }
  renderReport();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function walk() {
  if (walking) {
    allOff();
    return;
  }
  allOff();
  walking = true;
  $('walk').classList.add('on');
  for (let ch = 0; ch < channelCount && walking; ch++) {
    toneButtons[ch].classList.add('on');
    node.port.postMessage({ type: 'tone', ch, on: true });
    await wait(800);
    node.port.postMessage({ type: 'tone', ch, on: false });
    toneButtons[ch].classList.remove('on');
    await wait(200);
  }
  walking = false;
  $('walk').classList.remove('on');
}

// midi

let midi = null;
let clockTicks = 0;
let ccValue = 0;
const midiLines = [];

const STATUS = {
  0x80: 'note off',
  0x90: 'note on',
  0xa0: 'aftertouch',
  0xb0: 'cc',
  0xc0: 'program',
  0xd0: 'channel pressure',
  0xe0: 'pitch bend',
};
const SYSTEM = { 0xfa: 'start', 0xfb: 'continue', 0xfc: 'stop' };

function logMidi(line) {
  midiLines.unshift(line);
  midiLines.length = Math.min(midiLines.length, 20);
  $('midiLog').textContent = midiLines.join('\n');
}

function onMidiMessage(input, e) {
  const [status, a, b] = e.data;
  if (status === 0xf8) {
    clockTicks++;
    report.midi.clockTicksIn = clockTicks;
    if (clockTicks % 24 === 0) renderReport();
    return;
  }
  if (status === 0xfe) return;
  const name = status >= 0xf0 ? SYSTEM[status] ?? `system ${status.toString(16)}` : STATUS[status & 0xf0];
  const channel = status < 0xf0 ? ` ch${(status & 15) + 1}` : '';
  logMidi(`${e.timeStamp.toFixed(1).padStart(10)}  ${input.name}: ${name}${channel} ${a ?? ''} ${b ?? ''}`);
  report.midi.messagesIn = (report.midi.messagesIn ?? 0) + 1;
  renderReport();
}

function refreshMidi() {
  const inputs = [...midi.inputs.values()];
  const outputs = [...midi.outputs.values()];
  for (const input of inputs) {
    input.onmidimessage = (e) => onMidiMessage(input, e);
  }
  const select = $('midiOut');
  const previous = select.value;
  select.replaceChildren(new Option('no output', ''));
  outputs.forEach((o) => select.add(new Option(o.name, o.id)));
  if (outputs.some((o) => o.id === previous)) select.value = previous;
  else if (outputs.length) select.value = outputs[0].id;
  const inNames = inputs.map((p) => p.name);
  const outNames = outputs.map((p) => p.name);
  report.midi = { ...report.midi, inputs: inNames, outputs: outNames };
  $('midiInfo').textContent = `inputs: ${inNames.join(', ') || 'none'}\noutputs: ${outNames.join(', ') || 'none'}`;
  $('sendNote').disabled = !outputs.length;
  $('sendCc').disabled = !outputs.length;
  renderReport();
}

async function enableMidi() {
  if (!navigator.requestMIDIAccess) throw new Error('this browser has no web midi');
  midi = await navigator.requestMIDIAccess({ sysex: false });
  midi.onstatechange = refreshMidi;
  refreshMidi();
}

function midiOutput() {
  return midi.outputs.get($('midiOut').value);
}

function markSent(what) {
  report.midi.sent = [...(report.midi.sent ?? []), what];
  logMidi(`sent ${what} to ${midiOutput().name}`);
  renderReport();
}

function sendNote() {
  const out = midiOutput();
  out.send([0x90, 60, 100]);
  out.send([0x80, 60, 0], performance.now() + 250);
  markSent('note 60');
}

function sendCc() {
  ccValue = ccValue ? 0 : 127;
  midiOutput().send([0xb0, 1, ccValue]);
  markSent(`cc 1 = ${ccValue}`);
}

async function runPing() {
  $('ping').disabled = true;
  const times = [];
  onPong = (t) => times.push(performance.now() - t);
  for (let i = 0; i < 200; i++) {
    node.port.postMessage({ type: 'ping', t: performance.now() });
    await wait(10);
  }
  await wait(100);
  onPong = null;
  times.sort((a, b) => a - b);
  report.messageRoundTripMs = {
    count: times.length,
    min: round(times[0]),
    median: round(times[times.length >> 1]),
    p99: round(times[Math.floor(times.length * 0.99)]),
    max: round(times[times.length - 1]),
  };
  logMidi(`round trip ms: ${JSON.stringify(report.messageRoundTripMs)}`);
  renderReport();
  $('ping').disabled = false;
}

// budget

const RAMP = [10, 20, 40, 80, 120, 160, 240, 320, 480, 640, 960, 1280];
const HEADROOM = 0.5;

function benchStep(modules) {
  return new Promise((resolve) => {
    onBenchResult = resolve;
    node.port.postMessage({ type: 'bench', modules });
  });
}

function modulesAtLoad(rows, target) {
  let below = null;
  for (const row of rows) {
    if (row.load <= target) {
      below = row;
    } else if (below) {
      const t = (target - below.load) / (row.load - below.load);
      return Math.floor(below.modules + t * (row.modules - below.modules));
    } else {
      return null;
    }
  }
  return below ? `more than ${below.modules}` : null;
}

async function runBench() {
  allOff();
  $('bench').disabled = true;
  $('benchRows').replaceChildren();
  const rows = [];
  let clock = '';
  for (const modules of RAMP) {
    $('benchStatus').textContent = `${modules} modules...`;
    peakMessages = 0;
    const r = await benchStep(modules);
    await wait(50);
    clock = r.clock;
    const row = {
      modules: r.modules,
      cables: r.cables,
      avgMs: round(r.avgMs, 3),
      load: round(r.avgMs / r.budgetMs, 3),
      maxMs: round(r.maxMs, 2),
      over: r.over,
      blocks: r.blocks,
      peakPostAvgMs: round(r.postAvgMs, 3),
      plainAvgMs: round(r.plainAvgMs, 3),
      peakMessages,
    };
    rows.push(row);
    const tr = document.createElement('tr');
    const cells = [
      row.modules, row.cables, row.avgMs, `${Math.round(row.load * 100)}%`, row.maxMs,
      `${row.over}/${row.blocks}`, row.peakPostAvgMs, row.plainAvgMs, row.peakMessages,
    ];
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.append(td);
    }
    $('benchRows').append(tr);
    report.budget = { rows, clock };
    renderReport();
    if (row.load >= 1) break;
  }
  const atHeadroom = modulesAtLoad(rows, HEADROOM);
  const atLimit = modulesAtLoad(rows, 1);
  report.budget = { clock, modulesAt50PercentLoad: atHeadroom, modulesAt100PercentLoad: atLimit, rows };
  $('benchStatus').textContent = `about ${atHeadroom} modules at 50% load, ${atLimit} at 100%`;
  renderReport();
  $('bench').disabled = false;
}

// wiring

$('list').addEventListener('click', guarded(listDevices));
$('start').addEventListener('click', guarded(startAudio));
$('level').addEventListener('input', sendLevel);
$('walk').addEventListener('click', guarded(walk));
$('allOff').addEventListener('click', allOff);
$('midiEnable').addEventListener('click', guarded(enableMidi));
$('sendNote').addEventListener('click', guarded(sendNote));
$('sendCc').addEventListener('click', guarded(sendCc));
$('ping').addEventListener('click', guarded(runPing));
$('bench').addEventListener('click', guarded(runBench));
$('copy').addEventListener('click', guarded(() => navigator.clipboard.writeText($('report').textContent)));
