// Portals carry values between modules and between tabs.

export default async ({ ev, go, ok, send, shot, sleep, site, debugPort: PORT }) => {
  await go('/aparat/'); await sleep(800);
  // a second tab with its own connection
  const { result } = await send('Target.createTarget', { url: site + '/aparat/' });
  await sleep(2000);
  const t2 = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.id === result.targetId);
  const ws = new WebSocket(t2.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let n = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send2 = (method, params = {}) => new Promise((r) => { const i = ++n; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev2 = async (expression) => { const r = (await send2('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })).result; if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? '')); return r.result?.value; };
  // tab 1: button -> portal; tab 2: a portal on the same channel
  await ev(`(() => { const r = aparat.top; r.clear(); const b = r.add('button', { x: 0, row: 0 }); const p = r.add('portal', { x: 2, row: 0 });
    r.connect({ m: b, i: 0 }, { m: p, i: 0 }); return 0; })()`);
  await ev2(`(() => { const r = aparat.top; r.clear(); r.add('portal', { x: 0, row: 0 }); return 0; })()`);
  await ev(`document.getElementById('start').click(); 0`);
  await ev2(`document.getElementById('start').click(); 0`);
  await sleep(2000);
  const shown = (e) => e(`(() => { const m = [...aparat.top.modules.values()].find(m => m.type === 'portal'); return JSON.stringify(m.live); })()`);
  console.log('tab1 portal', await shown(ev), 'tab2 portal', await shown(ev2));
  ok((await shown(ev)) === '[1]' && (await shown(ev2)) === '[1]', 'each tab sees one linked portal');
  const lit2 = () => ev2(`(() => { const m = [...aparat.top.modules.values()].find(m => m.type === 'portal'); return m.jacks.out[0].el.style.getPropertyValue('--lit') || '0'; })()`);
  ok((await lit2()) === '0', 'tab 2 output dark before the press');
  await ev(`(() => { const m = [...aparat.top.modules.values()].find(m => m.type === 'button'); m.knobs[0].setNorm(1); return 0; })()`);
  await sleep(400);
  const on = await lit2();
  await ev(`(() => { const m = [...aparat.top.modules.values()].find(m => m.type === 'button'); m.knobs[0].setNorm(0); return 0; })()`);
  await sleep(600);
  const off = await lit2();
  ok(on === '1.00' && off === '0', `button in tab 1 lights portal output in tab 2 (${on} then ${off})`);
  // closing tab 2: tab 1 is alone again
  await send('Target.closeTarget', { targetId: result.targetId });
  await sleep(1800);
  ok((await shown(ev)) === '[0]', `tab 1 alone after tab 2 closed: ${await shown(ev)}`);
  await shot('portal');
};
