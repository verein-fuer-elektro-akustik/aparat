// The drop zone shows while a file is dragged over the window.

export default async ({ ev, go, ok, shot, sleep }) => {
  await go('/aparat/'); await sleep(800);
  const fire = (type, sel, name, mime) => ev(`(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['{}'], ${JSON.stringify(name)}, { type: ${JSON.stringify(mime)} }));
    window.__dt = dt;
    ${sel}.dispatchEvent(new DragEvent(${JSON.stringify(type)}, { dataTransfer: dt, bubbles: true, cancelable: true }));
  })()`);
  const zone = () => ev(`(() => { const z=document.getElementById('dropzone'); return z.hidden ? null : z.textContent; })()`);
  ok(await zone() === null, 'hidden at first');
  await fire('dragenter', `document.getElementById('content')`, 'p.json', 'application/json');
  ok(await zone() === 'drop to load the patch', `json: ${await zone()}`);
  await shot('dropzone');
  // crossing into a child: enter child, leave parent; still shown
  await fire('dragenter', `document.querySelector('.module')`, 'p.json', 'application/json');
  await fire('dragleave', `document.getElementById('content')`, 'p.json', 'application/json');
  ok(await zone() !== null, 'still shown when moving onto a module');
  await fire('dragleave', `document.querySelector('.module')`, 'p.json', 'application/json');
  ok(await zone() === null, 'hidden after leaving the window');
  await fire('dragenter', `document.body`, 'a.wav', 'audio/wav');
  ok(/sampler/.test(await zone()), `audio: ${await zone()}`);
  await fire('drop', `document.querySelector('header')`, 'a.wav', 'audio/wav');
  ok(await zone() === null, 'hidden after a drop');
};
