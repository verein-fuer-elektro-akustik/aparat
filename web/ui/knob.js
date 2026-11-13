const DRAG_RANGE = 180;
const SWEEP = 270;

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

function formatValue(def, v) {
  return def.format ? def.format(v) : v.toFixed(2);
}

// A parameter that is only off (0) or on (1) is drawn as a button that flips
// on click. It keeps the knob interface, so random, reset and midi learn work.
const isToggle = (def) => def.min === 0 && def.max === 1 && def.step === 1;

export function makeKnob({ name, def, value, onChange, onLearn }) {
  const toggle = isToggle(def);
  const el = document.createElement('div');
  el.className = toggle ? 'knob toggle' : 'knob';
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
  label.textContent = name;
  el.append(dial, label);

  let current = value;
  let norm = toNorm(def, value);
  let showing = false;

  function render() {
    if (toggle) {
      el.classList.toggle('on', current === 1);
      el.setAttribute('aria-checked', String(current === 1));
      if (showing) label.textContent = formatValue(def, current);
      return;
    }
    dial.style.transform = `rotate(${norm * SWEEP - SWEEP / 2}deg)`;
    el.setAttribute('aria-valuenow', norm.toFixed(3));
    el.setAttribute('aria-valuetext', formatValue(def, current));
    if (showing) label.textContent = formatValue(def, current);
  }

  function show(on) {
    showing = on;
    el.classList.toggle('active', on);
    label.textContent = on ? formatValue(def, current) : name;
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
    if (toggle) {
      setNorm(current === 1 ? 0 : 1);
      return;
    }
    el.setPointerCapture(e.pointerId);
    dragging = true;
    let lastY = e.clientY;
    const move = (ev) => {
      const scale = ev.shiftKey ? 0.1 : 1;
      setNorm(norm + ((lastY - ev.clientY) / DRAG_RANGE) * scale);
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

  el.addEventListener('dblclick', () => {
    if (!toggle) setNorm(toNorm(def, def.default));
  });

  el.addEventListener('keydown', (e) => {
    if (toggle && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      e.stopPropagation();
      setNorm(current === 1 ? 0 : 1);
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
    reset: () => setNorm(toNorm(def, def.default)),
  };
}
