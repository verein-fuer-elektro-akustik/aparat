// Dropping patch files on the window, the header, panels; other files on empty space.

export default async ({ ev, go, ok, sleep }) => {
  await go('/aparat/'); await sleep(800);
  const patch = JSON.stringify({ v: 2, modules: [{ id: 1, type: 'noise', x: 0, row: 0, params: {} }, { id: 2, type: 'output', x: 2, row: 0, params: {} }], cables: [{ from: [1, 'pink'], to: [2, '1'] }] });
  // drops a file on the element at (x, y), returns whether the browser default was prevented
  const drop = (sel, name, body, type = '') => ev(`(() => {
    const el = ${sel};
    const dt = new DataTransfer();
    dt.items.add(new File([${JSON.stringify(body)}], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} }));
    const r = el.getBoundingClientRect();
    const opt = { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + r.height - 5 };
    el.dispatchEvent(new DragEvent('dragover', opt));
    return !el.dispatchEvent(new DragEvent('drop', opt));
  })()`);
  const types = () => ev(`[...aparat.rack.modules.values()].map(m=>m.type).join(' ')`);
  ok(await drop(`document.querySelector('header')`, 'mine.json', patch) && (await sleep(300), await types()) === 'noise output', `drop on the header loads it: ${await types()}`);
  ok(await ev(`document.getElementById('patchCurrent').textContent`) !== 'default', 'no longer named default');
  await go('/aparat/'); await sleep(800);
  await drop(`[...aparat.rack.modules.values()].find(m=>m.type==='vco').el`, 'p.json', patch); await sleep(300);
  ok(await types() === 'noise output', 'drop on a module panel loads it');
  await go('/aparat/'); await sleep(800);
  await ev(`aparat.rack.add('sampler'); 0`); await sleep(200);
  await drop(`[...aparat.rack.modules.values()].find(m=>m.type==='sampler').el`, 'p.json', patch); await sleep(300);
  ok(await types() === 'noise output', 'drop on a sampler panel loads the patch, not a sample');
  await drop(`document.getElementById('rack')`, 'bad.json', '{nope'); await sleep(300);
  ok(await types() === 'noise output' && /not a patch file/.test(await ev(`document.getElementById('error').textContent`)), `bad json: ${await ev(`document.getElementById('error').textContent`)}`);
  await drop(`document.getElementById('rack')`, 'x.txt', 'hello', 'text/plain'); await sleep(300);
  ok(/\bsampler\b/.test(await types()), `an audio-or-other file on empty space still makes a sampler: ${await types()}`);
};
