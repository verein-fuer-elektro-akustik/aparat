// Dropping an audio file makes a sampler that shows, plays and keeps the file.

export default async ({ ev, key, shot, go, ok, sleep, site }) => {
  const U = `${site}/aparat/`;
  await go(U);
  // a wav file made in the page (1 s of 220 hz), dropped on empty rack space
  await ev(`(async () => {
    const { encodeWav } = await import('/aparat/ui/wav.js');
    const data = Float32Array.from({ length: 44100 }, (_, i) => 0.8 * Math.sin(2 * Math.PI * 220 * i / 44100));
    const file = new File([encodeWav([data], 1, 44100)], 'tone.wav', { type: 'audio/wav' });
    const dt = new DataTransfer(); dt.items.add(file);
    aparat.rack.scroller.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 300, clientY: 600 }));
  })()`);
  await sleep(800);
  const sampler = `[...aparat.rack.modules.values()].find(m => m.type === 'sampler')`;
  ok(await ev(`${sampler}?.data?.name`) === 'tone.wav', 'dropping an audio file adds a sampler with it');
  ok(await ev(`${sampler}.fileButton.textContent`) === 'tone.wav', 'the panel shows the file name');
  // lfo triggers it, a meter listens
  await ev(`(() => { const r = aparat.rack; const s = ${sampler}; const l = r.add('lfo'); const m = r.add('meter');
    r.connect({ m: l, i: 3 }, { m: s, i: 0 }); r.connect({ m: s, i: 0 }, { m, i: 0 }); })()`);
  await ev(`document.getElementById('start').click()`); await sleep(2500);
  const level = `Math.max(...aparat.rack.cables.list.find(c => c.to.m.type === 'meter').hist)`;
  ok(await ev(level) > 0.5, `the sampler plays when triggered: ${(await ev(level)).toFixed(2)}`);
  await shot('sampler');
  await sleep(500);
  // reload: the unsaved patch comes back, and the file from the browser's storage
  await go(U, 2500);
  ok(await ev(`${sampler}?.fileButton.textContent`) === 'tone.wav', 'after a reload the file is back: ' + await ev(`${sampler}?.fileButton.textContent`));
  await ev(`document.getElementById('start').click()`); await sleep(2500);
  ok(await ev(level) > 0.5, 'and plays');
  // a file this browser does not have
  await ev(`(() => { const m = aparat.rack.add('sampler', { data: { name: 'gone.wav' } }); })()`); await sleep(300);
  ok(await ev(`[...aparat.rack.modules.values()].at(-1).fileButton.textContent`) === 'gone.wav (missing)', 'a missing file is marked');
};
