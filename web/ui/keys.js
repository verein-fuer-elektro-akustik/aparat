// The computer keyboard as a midi keyboard: the two rows from A and W play an
// octave and a bit from C, Z and X move it an octave down and up. Sends note
// on and off on channel 1 like a midi device would.

const KEYS = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon'];
const VELOCITY = 100;

export function makeKeys({ send, enabled }) {
  let octave = 0;
  const down = new Map(); // key code -> the note it started

  function release() {
    for (const note of down.values()) send([0x80, note, 0]);
    down.clear();
  }

  // true if the key was used
  function keydown(e) {
    if (!enabled() || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      if (!e.repeat) octave = Math.max(-4, Math.min(4, octave + (e.code === 'KeyX' ? 1 : -1)));
      return true;
    }
    const i = KEYS.indexOf(e.code);
    if (i < 0) return false;
    if (!e.repeat && !down.has(e.code)) {
      const note = 60 + octave * 12 + i;
      down.set(e.code, note);
      send([0x90, note, VELOCITY]);
    }
    return true;
  }

  window.addEventListener('keyup', (e) => {
    const note = down.get(e.code);
    if (note === undefined) return;
    down.delete(e.code);
    send([0x80, note, 0]);
  });
  window.addEventListener('blur', release);

  return { keydown, release };
}
