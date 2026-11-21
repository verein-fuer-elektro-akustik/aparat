// Wireless cables between patches in other tabs of this browser, and within
// a patch. Every portal sends its inputs on its channel and outputs the sum
// of what the other portals on that channel send.
//
// The engine can't reach other tabs, so after each block outbox() hands the
// page what to send (see ui/portal.js), and the page passes back everything
// that is being sent as onPortal(s, {senders, fresh}, p, id): senders are
// [{key, tab, id, ch, last, peak}] (tab null for this tab), fresh the keys
// that just sent. last is an input's value at the end of the block, peak its
// loudest in the block, so a trigger shorter than a block still arrives (as
// a short pulse).

const N = 4;
const KEEPALIVE = 64; // blocks: a portal that sends nothing new still says it is there
const PULSE = 0.002; // seconds

export default {
  name: 'portal',
  doc: 'Wireless cables to the other portals on the same channel: in this patch, or in aparat in other tabs of this browser. Each input is sent, each output is the sum of what the other portals send. Changes arrive within a few ms, so it is for gates, clocks and control voltages, not for audio.',
  cols: 2,
  inputs: { 1: 0, 2: 0, 3: 0, 4: 0 },
  outputs: ['1', '2', '3', '4'],
  lights: ['1', '2', '3', '4'],
  params: { channel: { min: 1, max: 16, default: 1, step: 1, format: (v) => `ch ${v}` } },
  displayHeight: 22,
  create: (sr) => ({
    pulseLen: Math.round(PULSE * sr),
    last: new Float64Array(N),
    peak: new Float64Array(N),
    sent: null,
    blocks: 0,
    ch: 0,
    value: new Float64Array(N),
    pulse: new Int32Array(N),
    others: -1,
    shown: -1,
  }),
  process(s, i, o, p) {
    s.ch = p[0];
    for (let k = 0; k < N; k++) {
      const x = i[k];
      s.last[k] = x;
      const a = x < 0 ? -x : x;
      if (a > s.peak[k]) s.peak[k] = a;
      if (s.pulse[k] > 0) {
        s.pulse[k]--;
        o[k] = 10;
      } else {
        o[k] = s.value[k];
      }
    }
  },
  // after each block: what to send, or null when nothing changed
  outbox(s) {
    const msg = { ch: s.ch, last: Array.from(s.last), peak: Array.from(s.peak) };
    s.peak.fill(0);
    const same = s.sent && s.sent.ch === msg.ch && msg.last.every((v, k) => v === s.sent.last[k]) && msg.peak.every((v, k) => v === s.sent.peak[k]);
    if (same && ++s.blocks < KEEPALIVE) return null;
    s.blocks = 0;
    s.sent = msg;
    return msg;
  },
  onPortal(s, { senders, fresh }, p, id) {
    const sum = new Float64Array(N);
    let others = 0;
    for (const m of senders) {
      if (m.ch !== p[0] || (m.tab === null && m.id === id)) continue;
      others++;
      for (let k = 0; k < N; k++) {
        sum[k] += m.last[k];
        // a trigger that came and went inside the block
        if (m.peak[k] >= 1 && Math.abs(m.last[k]) < 1 && fresh.includes(m.key)) s.pulse[k] = s.pulseLen;
      }
    }
    s.value.set(sum);
    s.others = others;
  },
  display(s) {
    if (s.others === s.shown) return null;
    s.shown = s.others;
    return [s.others];
  },
  displayText: ([n]) => [n < 0 ? 'audio is off' : n === 0 ? 'alone' : `${n} linked`],
  shape: (p, live) => live ?? [-1],
};
