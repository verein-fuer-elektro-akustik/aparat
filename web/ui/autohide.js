// While audio runs, the header fades away after a few seconds with the pointer
// away from it, and the rack takes its place. The racks are panned down by the
// header's height at the same moment, so nothing on screen moves. Moving the
// pointer (or a touch) to the top edge brings it back, and so do stopping and
// keyboard focus in the header. It stays while a menu is open, the pointer is
// on it, or recording runs (so the record button shows). The view menu
// switches it off.

import { kept } from './kept.js';

const IDLE = 3000; // ms without the pointer near the header
const EDGE = 24; // px from the top that bring it back

export function autohide({ header, racks, running, recording }) {
  let enabled = kept.get('autohide') !== 'off';
  let away = false;
  let timer = 0;
  let height = 0;
  let pressed = false; // not in the middle of a drag

  const busy = () =>
    !enabled ||
    !running() ||
    recording() ||
    pressed ||
    header.matches(':hover') ||
    header.contains(document.activeElement) ||
    !!header.querySelector('.menu.open');

  function schedule() {
    clearTimeout(timer);
    timer = away || !enabled || !running() ? 0 : setTimeout(hide, IDLE);
  }

  function hide() {
    timer = 0;
    if (away) return;
    if (busy()) return schedule();
    away = true;
    header.classList.add('away');
    const done = () => {
      if (!away || header.classList.contains('gone')) return;
      height = header.offsetHeight;
      header.classList.add('gone');
      for (const r of racks) r.setPan(r.pan.x, r.pan.y + height);
    };
    // the fade first, then the space; without motion at once
    if (getComputedStyle(header).transitionDuration.split(',').every((d) => parseFloat(d) === 0)) done();
    else setTimeout(done, 200);
  }

  function show() {
    if (!away) return schedule();
    away = false;
    if (header.classList.contains('gone')) {
      header.classList.remove('gone');
      for (const r of racks) r.setPan(r.pan.x, r.pan.y - height);
      void header.offsetHeight; // starts the fade from transparent
    }
    header.classList.remove('away');
    schedule();
  }

  const near = (y) => y < (away ? EDGE : header.getBoundingClientRect().bottom + EDGE);
  addEventListener('pointermove', (e) => (near(e.clientY) ? show() : timer || away || schedule()), { passive: true });
  addEventListener('pointerdown', (e) => {
    pressed = true;
    if (near(e.clientY)) show();
  }, { passive: true, capture: true });
  for (const type of ['pointerup', 'pointercancel']) addEventListener(type, () => (pressed = false), { passive: true, capture: true });
  header.addEventListener('focusin', show);

  return {
    // audio started or stopped
    update() {
      if (running() && enabled) schedule();
      else show();
    },
    get enabled() {
      return enabled;
    },
    set enabled(on) {
      enabled = on;
      kept.set('autohide', on ? 'on' : 'off');
      this.update();
    },
  };
}
