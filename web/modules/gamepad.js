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

// the pads switched on, as a bit mask (1 to 4 are the first four params)
const maskOf = (p) => (p[0] ? 1 : 0) | (p[1] ? 2 : 0) | (p[2] ? 4 : 0) | (p[3] ? 8 : 0);
const on = (mask) => [1, 2, 3, 4].filter((n) => mask & (1 << (n - 1)));
const clip = (v) => Math.max(-5, Math.min(5, v));

// The voltages and the panel's text from the pads switched on: sticks add up,
// triggers take the highest, a button is down if it is down on any of them.
function take(s, p) {
  s.mask = maskOf(p);
  const chosen = on(s.mask);
  const pads = chosen.map((n) => [n, s.pads?.[n - 1] ?? null]).filter(([, pad]) => pad);
  s.target.fill(0);
  s.fresh = true;
  if (!chosen.length) {
    s.text = ['no pad on', 'switch on 1 to 4', '', ''];
    return;
  }
  if (!pads.length) {
    s.text = [`pad ${chosen.join(' ')}`, 'none: press a button', 'on the controller', ''];
    return;
  }
  const sticks = [0, 0, 0, 0];
  const held = new Set();
  for (const [, pad] of pads) {
    const axis = (k) => pad.axes[k] ?? 0;
    const button = (k) => pad.buttons[k] ?? 0;
    sticks[0] += dead(axis(0));
    sticks[1] -= dead(axis(1));
    sticks[2] += dead(axis(2));
    sticks[3] -= dead(axis(3));
    TRIGGERS.forEach((b, k) => (s.target[STICKS + k] = Math.max(s.target[STICKS + k], button(b) * 10)));
    BUTTONS.forEach((b, k) => {
      if (button(b) > 0.5) s.target[STICKS + 2 + k] = 10;
    });
    pad.buttons.forEach((v, k) => v > 0.5 && held.add(NAMES[k] ?? `${k}`));
  }
  sticks.forEach((v, k) => (s.target[k] = clip(v * 5)));
  const f = (v) => `${v < 0 ? '' : '+'}${(v / 5).toFixed(2)}`;
  s.text = [
    pads.length === 1 ? `${pads[0][0]} ${short(pads[0][1].name)}` : `pads ${pads.map(([n]) => n).join(' ')}`,
    `l ${f(s.target[0])} ${f(s.target[1])}`,
    `r ${f(s.target[2])} ${f(s.target[3])}`,
    [...held].join(' '),
  ];
}

export default {
  name: 'gamepad',
  doc: 'A game controller (press one of its buttons first, browsers only show controllers after that). Sticks are ±5 V, up and right positive; triggers 0 to 10 V; buttons and the d-pad are gates. The buttons 1 to 4 switch controllers on; with several on, their sticks add up and their buttons work together.',
  cols: 4,
  inputs: {},
  outputs: OUTPUTS,
  kinds: { out: { a: 'gate', b: 'gate', x: 'gate', y: 'gate', lb: 'gate', rb: 'gate', up: 'gate', down: 'gate', left: 'gate', right: 'gate' } },
  lights: OUTPUTS,
  params: Object.fromEntries([1, 2, 3, 4].map((n) => [String(n), { min: 0, max: 1, default: n === 1 ? 1 : 0, step: 1, format: (v) => (v ? `pad ${n} on` : `pad ${n} off`) }])),
  displayHeight: 64,
  create: (sr) => ({
    pads: null,
    mask: -1,
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
    if (maskOf(p) !== s.mask) take(s, p);
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
  shape: (p, live) => live ?? [on(maskOf(p)).length ? `pad ${on(maskOf(p)).join(' ')}` : 'no pad on', 'audio is off', '', ''],
  displayText: (lines) => lines,
};
