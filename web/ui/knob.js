const DRAG_RANGE = 180;
const SWEEP = 270;
const FADER_CAP = 10; // px, the height of a fader's cap (style.css)

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
const isToggle = (def) => def.min === 0 && def.max === 1 && def.step === 1;

export function makeKnob({ name, def, value, onChange, onLearn }) {
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
  el.append(dial, label);

  let current = value;
  let norm = toNorm(def, value);
  let showing = false;

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

  function show(on) {
    showing = on;
    el.classList.toggle('active', on);
    if (!toggle) label.textContent = on ? formatValue(def, current) : name;
  }

  function setNorm(n) {
    norm = clamp01(n);
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
    el.setPointerCapture(e.pointerId);
    dragging = true;
    let lastY = e.clientY;
    // a fader's cap follows the pointer along its track (on screen, so zoomed)
    let range = DRAG_RANGE;
    if (def.fader) {
      const shown = dial.getBoundingClientRect().height;
      range = Math.max(1, shown - FADER_CAP * (shown / dial.offsetHeight || 1));
    }
    const move = (ev) => {
      const scale = ev.shiftKey ? 0.1 : 1;
      setNorm(norm + ((lastY - ev.clientY) / range) * scale);
      lastY = ev.clientY;
    };
    const up = () => {
      dragging = false;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
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

  el.addEventListener('dblclick', () => {
    if (!toggle) setNorm(toNorm(def, def.default));
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

  // right-click on a knob is midi learn, not the module menu
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onLearn();
  });

  render();
  return {
    el,
    setValue,
    setNorm,
    // from a midi controller: an inverted button is lit at the top
    setControl: (n) => setNorm(def.inverted ? 1 - n : n),
    reset: () => setNorm(toNorm(def, def.default)),
  };
}
