// The module reference of the help page, made from the module definitions,
// so it is never out of date: each module's doc, its jacks and its knobs.

import { groups } from '../modules/index.js';
import { formatValue } from './knob.js';

// an element with properties and children (null children are left out)
function build(tag, props, children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

// the id of a module's entry, as the app links to it
const anchor = (name) => `m-${name.replace(/\s+/g, '-')}`;

const isToggle = (p) => p.min === 0 && p.max === 1 && p.step === 1;

function knob(name, p) {
  let range;
  if (p.momentary) range = isToggle(p) ? 'push button' : 'played, not kept in the patch';
  else if (isToggle(p)) range = `on/off, ${p.default ? 'on' : 'off'} at first`;
  else range = `${formatValue(p, p.min)} to ${formatValue(p, p.max)}, ${formatValue(p, p.default)} at first`;
  return build('li', {}, [build('b', { textContent: name }, []), ` ${range}`]);
}

function row(label, items) {
  if (!items.length) return null;
  return build('div', { className: 'row' }, [build('span', { className: 'label', textContent: label }, []), build('ul', {}, items)]);
}

function entry(def) {
  const kind = (dir, name) => ({ gate: ' gate', pitch: ' 1 V/oct' })[def.kinds?.[dir]?.[name]] ?? '';
  const inputs = Object.entries(def.inputs).map(([name, v]) =>
    build('li', {}, [build('b', { textContent: name }, []), kind('in', name), v ? ` (${v} V)` : '']));
  const outputs = def.outputs.map((name) => build('li', {}, [build('b', { textContent: name }, []), kind('out', name)]));
  const knobs = Object.entries(def.params).map(([name, p]) => knob(name, p));
  return build('article', { id: anchor(def.name) }, [
    build('h3', { textContent: def.name }, []),
    build('p', { textContent: def.doc }, []),
    row('in', inputs),
    row('out', outputs),
    row('knobs', knobs),
  ]);
}

const reference = document.getElementById('reference');
const toc = document.getElementById('toc-modules');
for (const [title, defs] of groups) {
  reference.append(build('h3', { className: 'group', textContent: title }, []), ...defs.map(entry));
  toc.append(build('li', {}, [build('a', { href: `#${anchor(defs[0].name)}`, textContent: title }, [])]));
}

// the page was opened at a module (#m-vco): the entries exist only now
if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
