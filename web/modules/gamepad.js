// A game controller. The page reads the Gamepad API (it only exists there)
// and sends the state of all controllers as onGamepad(s, pads, p) whenever
// something moves; each pad is null or {name, axes, buttons}, in the browser's
// standard mapping. Sticks are ±5 V (up and right positive), triggers 0 to
// 10 V, buttons 10 V gates.

import { pole } from './lib/dsp.js';

const DEAD = 0.08; // sticks rarely rest exactly at 0
const OUTPUTS = ['lx', 'ly', 'rx', 'ry', 'lt', 'rt', 'a', 'b', 'x', 'y', 'lb', 'rb', 'up', 'down', 'left', 'right'];
const STICKS = 4;
const TRIGGERS = [6, 7]; // standard button numbers of lt and rt
const BUTTONS = [0, 1, 2, 3, 4, 5, 12, 13, 14, 15]; // a b x y lb rb and the d-pad
const NAMES = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'back', 'start', 'ls', 'rs', 'up', 'down', 'left', 'right', 'home'];

const dead = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

// the name without what Chrome and Firefox add (ids, mapping, vendor numbers)
function short(id) {
  const name = id.replace(/\s*\(.*$/, '').replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '') || 'gamepad';
  return name.length > 22 ? `${name.slice(0, 21)}…` : name;
}

function take(s, p) {
  s.index = p[0];
  const pad = s.pads?.[p[0] - 1] ?? null;
  s.target.fill(0);
  s.text = [`pad ${p[0]}`, 'none: press a button', 'on the controller', ''];
  s.fresh = true;
  if (!pad) return;
  const axis = (k) => pad.axes[k] ?? 0;
  const button = (k) => pad.buttons[k] ?? 0;
  s.target[0] = dead(axis(0)) * 5;
  s.target[1] = -dead(axis(1)) * 5;
  s.target[2] = dead(axis(2)) * 5;
  s.target[3] = -dead(axis(3)) * 5;
  TRIGGERS.forEach((b, k) => (s.target[STICKS + k] = button(b) * 10));
  BUTTONS.forEach((b, k) => (s.target[STICKS + 2 + k] = button(b) > 0.5 ? 10 : 0));
  const f = (v) => `${v < 0 ? '' : '+'}${v.toFixed(2)}`;
  const held = pad.buttons.map((v, k) => (v > 0.5 ? NAMES[k] ?? `${k}` : '')).filter(Boolean);
  s.text = [
    `${p[0]} ${short(pad.name)}`,
    `l ${f(dead(axis(0)))} ${f(-dead(axis(1)))}`,
    `r ${f(dead(axis(2)))} ${f(-dead(axis(3)))}`,
    held.join(' '),
  ];
}

export default {
  name: 'gamepad',
  doc: 'A game controller (press one of its buttons first, browsers only show controllers after that). Sticks are ±5 V, up and right positive; triggers 0 to 10 V; buttons and the d-pad are gates. pad picks the controller when several are plugged in.',
  cols: 4,
  inputs: {},
  outputs: OUTPUTS,
  lights: OUTPUTS,
  params: { pad: { min: 1, max: 4, default: 1, step: 1, format: (v) => `pad ${v}` } },
  displayHeight: 64,
  create: (sr) => ({
    pads: null,
    index: 0,
    target: new Float64Array(OUTPUTS.length),
    v: new Float64Array(OUTPUTS.length),
    coef: pole(0.005, sr),
    text: null,
    fresh: false,
  }),
  onGamepad(s, pads, p) {
    s.pads = pads;
    take(s, p);
  },
  process(s, i, o, p) {
    if (p[0] !== s.index) take(s, p);
    const { v, target, coef } = s;
    // the analog ones are smoothed, they arrive at the page's frame rate
    for (let k = 0; k < STICKS + 2; k++) {
      let x = v[k] + (target[k] - v[k]) * coef;
      if (x < 1e-20 && x > -1e-20) x = 0;
      v[k] = x;
      o[k] = x;
    }
    for (let k = STICKS + 2; k < OUTPUTS.length; k++) o[k] = target[k];
  },
  display(s) {
    if (!s.fresh) return null;
    s.fresh = false;
    return s.text;
  },
  shape: (p, live) => live ?? [`pad ${p[0]}`, 'audio is off', '', ''],
  displayText: (lines) => lines,
};
