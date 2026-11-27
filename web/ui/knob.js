const DRAG_RANGE = 180;
const SWEEP = 270;
const FADER_CAP = 10; // px, the height of a fader's cap (style.css)
const SVG = 'http://www.w3.org/2000/svg';

const clamp01 = (n) => Math.min(1, Math.max(0, n));

function toNorm(def, v) {
  if (def.curve === 'exp') return clamp01(Math.log(v / def.min) / Math.log(def.max / def.min));
  return clamp01((v - def.min) / (def.max - def.min));
}

function fromNorm(def, n) {
  let v = def.curve === 'exp' ? def.min * (def.max / def.min) ** n : def.min + n * (def.max - def.min);
  if (def.step) v = def.min + Math.round((v - def.min) / def.step) * def.step;
  return Math.min(def.max, Math.max(def.min, v));
}

export function formatValue(def, v) {
  return def.format ? def.format(v) : v.toFixed(2);
}

// A parameter that is only off (0) or on (1) is drawn as a button that flips
// on click. It keeps the knob interface, so random, reset and midi learn work.
// One with fader: true is a vertical fader, which works like a knob except
// that a drag moves its cap with the pointer. A toggle has its name (or
// def.label) written on it and is filled while on, so it shows no value.
//
// Knobs and faders can be limited to part of their travel, [lo, hi] from 0
// to 1 along it, so it works the same on exponential and stepped knobs.
// ctrl+drag (cmd on a Mac) on the knob moves a limit: on a knob the left half
// moves the lowest point and the right half the highest, on a fader above or
// below the middle of the range; ctrl+double-click takes that limit away.
// Marks on the ring or beside the track show the limits on hover. Turning, the wheel,
// keys, reset, random and midi all stay inside; a midi controller spreads its
// whole travel across the range. onRange gets [lo, hi], or null for none.
const isToggle = (def) => def.min === 0 && def.max === 1 && def.step === 1;

export function makeKnob({ name, def, value, range, onChange, onLearn, onRange, onMenu }) {
  const toggle = isToggle(def);
  const el = document.createElement('div');
  const text = toggle && (def.label ?? name);
  el.className = toggle ? 'knob toggle' : def.fader ? 'knob fader' : 'knob';
  el.tabIndex = 0;
  el.setAttribute('aria-label', name);
  if (toggle) {
    el.setAttribute('role', 'switch');
  } else {
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-valuemin', '0');
    el.setAttribute('aria-valuemax', '1');
  }
  const dial = document.createElement('div');
  dial.className = 'dial';
  const label = document.createElement('span');
  label.textContent = toggle ? text : name;
  // the dial with what is drawn around it: the arc of its range and the marks
  const face = document.createElement('div');
  face.className = 'face';
  face.append(dial);
  el.append(face, label);

  let current = value;
  let norm = toNorm(def, value);
  let showing = false;
  let [lo, hi] = range ?? [0, 1];
  const handles = toggle ? null : { lo: makeHandle('lo'), hi: makeHandle('hi') };
  // the range on the ring, as an svg arc so it stays smooth at any zoom: a
  // circle over the dial's border, measured in degrees (pathLength 360), whose
  // dash covers the range; it starts at 3 o'clock, the travel at 135 degrees
  const arc = handles && document.createElementNS(SVG, 'svg');
  const ring = handles && document.createElementNS(SVG, 'circle');
  if (arc) {
    arc.setAttribute('class', 'arc');
    arc.setAttribute('viewBox', '0 0 28 28');
    arc.setAttribute('aria-hidden', 'true');
    for (const [k, v] of Object.entries({ cx: 14, cy: 14, r: 13, pathLength: 360 })) ring.setAttribute(k, v);
    arc.append(ring);
  }
  if (handles) {
    face.append(arc, handles.lo, handles.hi);
  }

  function render() {
    if (toggle) {
      const lit = def.inverted ? current === 0 : current === 1;
      el.classList.toggle('on', lit);
      el.setAttribute('aria-checked', String(lit));
      return;
    }
    if (def.fader) dial.style.setProperty('--pos', norm.toFixed(4));
    else dial.style.transform = `rotate(${norm * SWEEP - SWEEP / 2}deg)`;
    el.setAttribute('aria-valuenow', norm.toFixed(3));
    el.setAttribute('aria-valuetext', formatValue(def, current));
    if (showing) label.textContent = formatValue(def, current);
  }

  function renderRange() {
    if (!handles) return;
    el.classList.toggle('limited', lo > 0 || hi < 1);
    el.style.setProperty('--lo', lo);
    el.style.setProperty('--hi', hi);
    ring.setAttribute('stroke-dasharray', `${((hi - lo) * SWEEP).toFixed(2)} 360`);
    ring.setAttribute('transform', `rotate(${(135 + lo * SWEEP).toFixed(2)} 14 14)`);
    handles.lo.style.setProperty('--at', lo);
    handles.hi.style.setProperty('--at', hi);
    el.setAttribute('aria-valuemin', String(lo));
    el.setAttribute('aria-valuemax', String(hi));
  }

  function show(on) {
    showing = on;
    el.classList.toggle('active', on);
    if (!toggle) label.textContent = on ? formatValue(def, current) : name;
  }

  function setNorm(n) {
    norm = Math.min(hi, Math.max(lo, n));
    const next = fromNorm(def, norm);
    if (next !== current) {
      current = next;
      onChange(current);
    }
    render();
  }

  function setValue(v) {
    current = v;
    norm = toNorm(def, v);
    render();
  }

  // how far the pointer moves for the whole travel: a fader's cap (and its
  // handles) follow the pointer along the track, on screen, so zoomed
  function dragRange() {
    if (!def.fader) return DRAG_RANGE;
    const shown = dial.getBoundingClientRect().height;
    return Math.max(1, shown - FADER_CAP * (shown / dial.offsetHeight || 1));
  }

  // pointer drags, shift for fine; calls step(delta) with the travel moved
  function drag(e, target, step, done) {
    target.setPointerCapture(e.pointerId);
    dragging = true;
    let lastY = e.clientY;
    const range = dragRange();
    const move = (ev) => {
      step(((lastY - ev.clientY) / range) * (ev.shiftKey ? 0.1 : 1));
      lastY = ev.clientY;
    };
    const up = () => {
      dragging = false;
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      done?.();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  function setLimit(which, n) {
    n = Math.round(clamp01(n) * 1e4) / 1e4;
    if (which === 'lo') lo = Math.min(hi, n);
    else hi = Math.max(lo, n);
    renderRange();
    label.textContent = formatValue(def, fromNorm(def, which === 'lo' ? lo : hi));
    onRange?.(lo > 0 || hi < 1 ? [lo, hi] : null);
    // the value moves along when a limit passes it
    if (norm < lo || norm > hi) setNorm(norm);
  }

  // a mark showing one end of the travel
  function makeHandle(which) {
    const h = document.createElement('div');
    h.className = `limit ${which}`;
    return h;
  }

  // which limit a ctrl+drag or ctrl+double-click at the pointer moves
  function limitAt(e) {
    const r = dial.getBoundingClientRect();
    if (!def.fader) return e.clientX < r.left + r.width / 2 ? 'lo' : 'hi';
    const cap = FADER_CAP * (r.height / dial.offsetHeight || 1);
    const middle = r.bottom - cap / 2 - ((lo + hi) / 2) * (r.height - cap);
    return e.clientY < middle ? 'hi' : 'lo';
  }

  const limiting = (e) => (e.ctrlKey || e.metaKey) && handles;

  let dragging = false;
  el.addEventListener('pointerenter', () => show(true));
  el.addEventListener('pointerleave', () => {
    if (!dragging) show(false);
  });
  el.addEventListener('focus', () => show(true));
  el.addEventListener('blur', () => show(false));

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.focus({ focusVisible: false });
    if (limiting(e)) {
      const which = limitAt(e);
      el.classList.add('limiting');
      label.textContent = formatValue(def, fromNorm(def, which === 'lo' ? lo : hi));
      drag(e, el, (d) => setLimit(which, (which === 'lo' ? lo : hi) + d), () => {
        el.classList.remove('limiting');
        show(el.matches(':hover') || document.activeElement === el);
      });
      return;
    }
    if (def.momentary) {
      // on while held, wherever the pointer goes
      el.setPointerCapture(e.pointerId);
      setNorm(1);
      const release = () => {
        setNorm(0);
        el.removeEventListener('pointerup', release);
        el.removeEventListener('pointercancel', release);
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      return;
    }
    if (toggle) {
      setNorm(current === 1 ? 0 : 1);
      return;
    }
    drag(e, el, (d) => setNorm(norm + d));
  });

  // The wheel turns the knob under the pointer: about 50 notches for the whole
  // range, ten times finer with shift; stepped knobs move one step per notch.
  // Trackpads send many small deltas, so they add up. ctrl+wheel is left to
  // the rack's zoom, and buttons ignore the wheel, so scrolling past one does
  // not flip it.
  let wheel = 0;
  el.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey || toggle) return;
    e.preventDefault();
    // shift+wheel scrolls sideways in some browsers, so take either axis
    const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    wheel -= d / 100; // a notch is about 100 pixels
    const notches = wheel > 0 ? Math.floor(wheel) : Math.ceil(wheel);
    if (def.step) {
      if (!notches) return;
      wheel -= notches;
      setNorm(norm + notches / ((def.max - def.min) / def.step));
    } else {
      setNorm(norm + wheel * (e.shiftKey ? 0.002 : 0.02));
      wheel = 0;
    }
    show(true);
  }, { passive: false });

  el.addEventListener('keyup', (e) => {
    if (def.momentary && (e.key === ' ' || e.key === 'Enter')) setNorm(0);
  });

  el.addEventListener('dblclick', (e) => {
    if (limiting(e)) setLimit(limitAt(e), limitAt(e) === 'lo' ? 0 : 1);
    else if (!toggle) setNorm(toNorm(def, def.default));
  });

  el.addEventListener('keydown', (e) => {
    if (toggle && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      e.stopPropagation();
      if (def.momentary) setNorm(1);
      else setNorm(current === 1 ? 0 : 1);
      return;
    }
    const stepSize = def.step ? 1 / ((def.max - def.min) / def.step) : e.shiftKey ? 0.002 : 0.02;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') setNorm(norm + stepSize);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') setNorm(norm - stepSize);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  // right-click opens the knob's menu (onMenu), shift+right-click learns at
  // once (onLearn)
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey || !onMenu) onLearn();
    else onMenu(e);
  });

  render();
  renderRange();
  return {
    el,
    setValue,
    setNorm,
    // from a midi controller, across the range; an inverted button is lit
    // at the top
    setControl: (n) => setNorm(lo + (def.inverted ? 1 - n : n) * (hi - lo)),
    reset: () => setNorm(toNorm(def, def.default)),
    randomize: () => setNorm(lo + Math.random() * (hi - lo)),
    limited: () => lo > 0 || hi < 1,
    // takes the limits away, as ctrl+double-click on both ends
    clearRange: () => {
      lo = 0;
      hi = 1;
      renderRange();
      onRange?.(null);
    },
    // from the patch (undo): the value is set on its own
    setRange: (r) => {
      [lo, hi] = r ?? [0, 1];
      renderRange();
    },
  };
}
