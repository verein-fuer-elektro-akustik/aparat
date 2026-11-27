// Cables follow the view while it is dragged, without lagging a frame.

export default async ({ ev, go, ok, mouse, sleep }) => {
  await go('/aparat/'); await sleep(800);
  // after all of a frame's callbacks: were the cables last drawn at the pan the panels show?
  await ev(`(() => { const c = aparat.top.cables; const draw = c.draw.bind(c); c.draw = (t) => { c.drawnAt = { ...c.pan }; draw(t); };
    window.lag = { frames: 0, behind: 0 };
    const ch = new MessageChannel(); ch.port1.onmessage = () => { const r = aparat.top; const x = Math.round(r.pan.x), y = Math.round(r.pan.y);
      lag.frames++; if (!c.drawnAt || c.drawnAt.x !== x || c.drawnAt.y !== y) lag.behind++; };
    const tick = () => { ch.port2.postMessage(0); requestAnimationFrame(tick); }; requestAnimationFrame(tick); return 0; })()`);
  const r = await ev(`JSON.stringify(aparat.rack.scroller.getBoundingClientRect())`).then(JSON.parse);
  const x = r.right - 300, y = r.bottom - 150;
  await ev('(lag.frames = lag.behind = 0, 0)');
  await mouse('mousePressed', x, y);
  for (let k = 1; k <= 12; k++) { await mouse('mouseMoved', x - 300 * k / 12, y - 60 * k / 12); await sleep(16); }
  await mouse('mouseReleased', x - 300, y - 60);
  await sleep(700);
  const lag = await ev('JSON.stringify(lag)').then(JSON.parse);
  console.log(lag);
  ok(lag.frames > 20 && lag.behind === 0, `cables never a frame behind while dragging and coasting (${lag.behind} of ${lag.frames})`);
};
