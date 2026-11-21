// The page's half of the portal module (modules/portal.js). Tabs of this
// browser on this site talk over one BroadcastChannel. Each portal, here or
// in another tab, is a sender with its channel and its inputs' values; the
// engine gets the whole list whenever one of them sends, and each portal
// picks its channel's out of it. A sender that has been quiet for a second
// is gone (its tab closed, or crashed).

const TIMEOUT = 1000;

export function makePortals(send) {
  const tab = Math.random().toString(36).slice(2);
  const senders = new Map(); // key -> {key, tab, id, ch, last, peak, t}
  const bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel('aparat-portal') : null;

  function pass(fresh) {
    const list = [...senders.values()].map(({ t, ...m }) => m);
    send({ op: 'portal', senders: list, fresh });
  }

  // from this tab's engine: [{id, ch, last, peak} or {id, gone}]
  function fromEngine(list) {
    const fresh = [];
    for (const m of list) {
      const key = `${tab}:${m.id}`;
      if (m.gone) senders.delete(key);
      else senders.set(key, { key, tab: null, id: m.id, ch: m.ch, last: m.last, peak: m.peak, t: performance.now() });
      fresh.push(key);
      bc?.postMessage({ ...m, tab });
    }
    pass(fresh);
  }

  if (bc) {
    bc.onmessage = (e) => {
      const m = e.data;
      if (!m || m.tab === tab) return;
      if (m.bye) {
        for (const [key, s] of senders) if (s.tab === m.tab) senders.delete(key);
        pass([]);
        return;
      }
      const key = `${m.tab}:${m.id}`;
      if (m.gone) senders.delete(key);
      else senders.set(key, { key, tab: m.tab, id: m.id, ch: m.ch, last: m.last, peak: m.peak, t: performance.now() });
      pass([key]);
    };
    addEventListener('pagehide', () => bc.postMessage({ tab, bye: true }));
  }

  setInterval(() => {
    const now = performance.now();
    let dropped = false;
    for (const [key, s] of senders) {
      if (now - s.t > TIMEOUT) {
        senders.delete(key);
        dropped = true;
      }
    }
    if (dropped) pass([]);
  }, TIMEOUT / 4);

  return {
    fromEngine,
    // the engine stopped: this tab's portals are gone for everyone
    stopped() {
      for (const [key, s] of senders) if (s.tab === null) senders.delete(key);
      bc?.postMessage({ tab, bye: true });
    },
    // a fresh engine: tell it who is there
    started: () => pass([]),
  };
}
