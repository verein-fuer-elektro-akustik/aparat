// The Gamepad API only exists on the page and has no events for movement,
// so the controllers are read every frame while one is connected, and their
// state goes to the engine when something changed (see modules/gamepad.js).
// Browsers show a controller only after one of its buttons was pressed.

const MAX = 4;
const round = (v) => Math.round(v * 1000) / 1000;

export function watchGamepads(send) {
  if (!navigator.getGamepads) return { resend() {} };
  let last = '';
  let running = false;

  function read() {
    const pads = [];
    for (const p of [...navigator.getGamepads()].slice(0, MAX)) {
      pads.push(p && p.connected ? { name: p.id, axes: p.axes.map(round), buttons: p.buttons.map((b) => round(b.value)) } : null);
    }
    while (pads.length < MAX) pads.push(null);
    return pads;
  }

  function frame() {
    const pads = read();
    const key = JSON.stringify(pads);
    if (key !== last && send({ op: 'gamepad', pads })) last = key;
    if (pads.some(Boolean)) requestAnimationFrame(frame);
    else running = false;
  }

  function start() {
    if (running) return;
    running = true;
    requestAnimationFrame(frame);
  }

  addEventListener('gamepadconnected', start);
  addEventListener('gamepaddisconnected', () => {
    start(); // once more, so the engine hears it is gone
  });
  return {
    // a fresh engine has not heard of the controllers yet
    resend() {
      last = '';
      start();
    },
  };
}
