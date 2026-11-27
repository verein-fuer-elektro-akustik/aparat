// Displays drawn with audio off, a sampler's waveform, live data while running.

export default async ({ ev, go, ok, shot, send, sleep }) => {
  await go('/aparat/'); await sleep(800);
  // a patch: lfo clock -> env, hdar, sampler (with a generated wav)
  const patch = { v: 2, modules: [
    { id: 1, type: 'lfo', x: 0, row: 0, params: { rate: 1.5, pw: 0.5 } },
    { id: 2, type: 'env', x: 2, row: 0, params: { a: 0.05, d: 0.3, s: 0.4, r: 0.6 } },
    { id: 3, type: 'hdar', x: 4, row: 0, params: { delay: 0.1, attack: 0.2, hold: 0.1, release: 0.4 } },
    { id: 4, type: 'sampler', x: 6, row: 0, params: { start: 0.2, length: 0.5 } },
    { id: 5, type: 'output', x: 9, row: 0, params: { level: 0.3 } },
  ], cables: [
    { from: [1, 'squ'], to: [2, 'gate'] }, { from: [1, 'squ'], to: [3, 'trig'] }, { from: [1, 'squ'], to: [4, 'trig'] },
    { from: [4, 'out'], to: [5, '1'] },
  ] };
  await ev(`(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([${JSON.stringify(JSON.stringify(patch))}], 'shapes.json', { type: 'application/json' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  })(); 0`);
  await sleep(600);
  // a wav: a decaying 220 hz tone, 1 s
  await ev(`(async () => {
    const sr = 48000, n = sr, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const s = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); s(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 220 * i / sr) * Math.exp(-3 * i / n) * 30000), true);
    const m = [...aparat.rack.modules.values()].find(m => m.type === 'sampler');
    const dt = new DataTransfer(); dt.items.add(new File([buf], 'tone.wav', { type: 'audio/wav' }));
    m.el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  })()`);
  await sleep(1200);
  const painted = (type) => ev(`(() => { const m=[...aparat.rack.modules.values()].find(m=>m.type==='${type}'); const c=m.canvas; const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for (let i=3;i<d.length;i+=4) if (d[i]) n++; return n; })()`);
  for (const t of ['env', 'hdar', 'sampler']) ok(await painted(t) > 200, `${t} drawn with audio off: ${await painted(t)} px`);
  ok(await ev(`[...aparat.rack.modules.values()].find(m=>m.type==='sampler').peaks?.length`) === 1024, 'sampler has its waveform');
  await shot('shapes-off');
  await ev(`document.getElementById('start').click(); 0`); await sleep(500);
  const live = (type) => ev(`(() => { const m=[...aparat.rack.modules.values()].find(m=>m.type==='${type}'); return m.live ? [...m.live].map(v=>+v.toFixed(3)) : null; })()`);
  let seen = { env: 0, hdar: 0, sampler: 0 };
  for (let k = 0; k < 20; k++) { for (const t of Object.keys(seen)) { const l = await live(t); if (l && (t === 'sampler' ? l[0] >= 0 : l[0] > 0)) seen[t]++; } await sleep(50); }
  ok(seen.env > 3 && seen.hdar > 3 && seen.sampler > 3, `live data while running: ${JSON.stringify(seen)}`);
  await shot('shapes-on');
  // a knob turn redraws the shape with audio off
  await ev(`document.getElementById('start').click(); 0`); await sleep(400);
  ok(await live('env') === null, 'live data dropped on stop');
  const before = await painted('env');
  await ev(`(() => { const m=[...aparat.rack.modules.values()].find(m=>m.type==='env'); m.knobs[3].setNorm(0.1); })(); 0`); await sleep(200);
  ok(await painted('env') !== before, 'turning release redraws the curve');
};
