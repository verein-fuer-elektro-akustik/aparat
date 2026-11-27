// Clicking the rack takes the focus out of a note.

export default async ({ ev, go, ok, mouse, sleep }) => {
  await go('/aparat/'); await sleep(800);
  await ev(`(() => { const m = aparat.rack.add('note', { x: 0, row: 3 }); aparat.rack.setPan(0, -3 * 384 + 20); m.textArea.focus(); return 0; })()`);
  await sleep(50);
  console.log('focused', await ev('document.activeElement.tagName'));
  // a click on empty space
  const r = await ev(`JSON.stringify(aparat.rack.scroller.getBoundingClientRect())`).then(JSON.parse);
  await mouse('mousePressed', r.right - 20, r.bottom - 20); await mouse('mouseReleased', r.right - 20, r.bottom - 20); await sleep(100);
  ok(await ev('document.activeElement.tagName') !== 'TEXTAREA', `click on empty space leaves the note (${await ev('document.activeElement.tagName')})`);
  // on a panel
  await ev(`[...aparat.rack.modules.values()].find(m => m.type === 'note').textArea.focus(), 0`);
  const p = await ev(`(() => { const m = [...aparat.rack.modules.values()].find(m => m.type === 'output'); aparat.rack.setPan(0,0); const r = m.el.getBoundingClientRect(); return JSON.stringify([r.left + r.width / 2, r.top + r.height * 0.45]); })()`).then(JSON.parse);
  await mouse('mousePressed', ...p); await mouse('mouseReleased', ...p); await sleep(100);
  ok(await ev('document.activeElement.tagName') !== 'TEXTAREA', `click on a panel leaves the note (${await ev('document.activeElement.tagName')})`);
};
