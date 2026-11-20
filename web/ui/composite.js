// Composites: modules made of modules. A composite is stored in the patch
// under `composites`, by name:
//
//   { doc, modules, cables,                     the inside, like a patch
//     inputs:  [{ name, to: [[id, input], ...] }],   a jack can feed several
//     outputs: [{ name, from: [id, output] }],
//     params:  [{ name, module: id, param }] }       knobs brought outside
//
// A module of a composite's type is one panel in the rack. For the engine it
// is expanded into its inner modules (flatten), with ids `<outer>/<inner>`,
// so the engine only ever sees built-in modules. Composites may contain
// composites.
//
// Everything here works on plain patch data and does not touch the DOM.

// The def of a type: a built-in module, or a composite's panel.
export function defFinder(registry, composites = {}) {
  const panels = new Map();
  const defOf = (type) => {
    if (registry[type]) return registry[type];
    const spec = composites[type];
    if (!spec) return null;
    if (!panels.has(type)) panels.set(type, panelDef(type, spec, defOf));
    return panels.get(type);
  };
  return defOf;
}

// A composite as a module def for the panel: its jacks and knobs, the knobs
// with the ranges of the inner knobs they stand for.
export function panelDef(name, spec, defOf) {
  const byId = new Map(spec.modules.map((m) => [m.id, m]));
  const params = {};
  for (const p of spec.params ?? []) {
    const inner = byId.get(p.module);
    const def = inner && defOf(inner.type)?.params[p.param];
    if (!def) continue;
    params[p.name] = { ...def, default: inner.params?.[p.param] ?? def.default };
  }
  const inputs = Object.fromEntries((spec.inputs ?? []).map((j) => [j.name, 0]));
  const outputs = (spec.outputs ?? []).map((j) => j.name);
  return {
    name,
    doc: spec.doc || `A composite of ${spec.modules.length} modules.`,
    cols: fit(Object.keys(params).length, Object.keys(inputs).length, outputs.length),
    inputs,
    outputs,
    params,
    composite: spec,
  };
}

// the narrowest panel (in cells) whose knob and jack rows fit its height
function fit(nParams, nIn, nOut) {
  for (let cols = 2; cols < 8; cols++) {
    const rows = Math.ceil(nParams / cols) + Math.ceil(nIn / cols) + Math.ceil(nOut / cols);
    if (rows <= 6) return cols;
  }
  return 8;
}

// The built-in modules and cables a composite module stands for.
//   prefix   the id of the composite module, inner ids become prefix/id
//   values   {knob name: value} of the composite module
// Returns engine-ready lists (params as arrays, jacks as indices) and, for
// the composite's own jacks and knobs, where they lead inside:
//   inputs[i] = [[id, input index], ...], outputs[i] = [id, output index]
//   or null, params[i] = [id, param index]
export function flatten(spec, prefix, values, defOf) {
  const out = { modules: [], cables: [], inputs: [], outputs: [], params: [] };
  // the knobs the composite brings outside, by inner module
  const set = new Map();
  for (const p of spec.params ?? []) {
    if (!(p.name in values)) continue;
    if (!set.has(p.module)) set.set(p.module, {});
    set.get(p.module)[p.param] = values[p.name];
  }
  // each inner module, built-in or itself flattened
  const inner = new Map();
  for (const m of spec.modules) {
    const def = defOf(m.type);
    if (!def) continue;
    const id = `${prefix}/${m.id}`;
    const params = { ...m.params, ...set.get(m.id) };
    if (def.composite) {
      const f = flatten(def.composite, id, params, defOf);
      out.modules.push(...f.modules);
      out.cables.push(...f.cables);
      inner.set(m.id, { def, flat: f });
    } else {
      const keys = Object.keys(def.params);
      out.modules.push({ id, type: m.type, params: keys.map((k) => params[k] ?? def.params[k].default), data: m.data ?? null });
      inner.set(m.id, { def, id, keys });
    }
  }
  // where an inner jack is in engine terms
  const source = (id, name) => {
    const m = inner.get(id);
    const i = m?.def.outputs.indexOf(name) ?? -1;
    if (i < 0) return null;
    return m.flat ? m.flat.outputs[i] : [m.id, i];
  };
  const targets = (id, name) => {
    const m = inner.get(id);
    const i = m ? Object.keys(m.def.inputs).indexOf(name) : -1;
    if (i < 0) return [];
    return m.flat ? m.flat.inputs[i] : [[m.id, i]];
  };
  for (const c of spec.cables) {
    const from = source(...c.from);
    if (!from) continue;
    for (const to of targets(...c.to)) out.cables.push({ from, to });
  }
  out.inputs = (spec.inputs ?? []).map((j) => j.to.flatMap(([id, name]) => targets(id, name)));
  out.outputs = (spec.outputs ?? []).map((j) => source(...j.from));
  const panel = Object.keys(panelDef('', spec, defOf).params);
  out.params = panel.map((name) => {
    const p = spec.params.find((q) => q.name === name);
    const m = inner.get(p.module);
    if (!m) return null;
    if (m.flat) {
      const k = Object.keys(m.def.params).indexOf(p.param);
      return k >= 0 ? m.flat.params[k] : null;
    }
    const k = m.keys.indexOf(p.param);
    return k >= 0 ? [m.id, k] : null;
  });
  return out;
}

// A name not yet in `taken`: name, name 2, name 3 ...
function unique(name, taken) {
  let n = name;
  for (let k = 2; taken.has(n); k++) n = `${name} ${k}`;
  taken.add(n);
  return n;
}

// Turns modules of a patch into one composite module.
//   ids       the modules to put inside
//   name      the composite's name (a new one, or one to replace)
//   exposed   [{ id, param }] inner knobs that become knobs of the composite
// Cables from outside become inputs (one per outside source, feeding all the
// inner jacks it fed), cables to outside become outputs (one per inner
// source). Returns the new patch; the composite takes the place of the
// leftmost, topmost module.
export function makeComposite(patch, ids, name, exposed, defOf) {
  const inside = new Set(ids);
  const mods = patch.modules.filter((m) => inside.has(m.id));
  const minX = Math.min(...mods.map((m) => m.x));
  const minRow = Math.min(...mods.map((m) => m.row));
  const typeOf = new Map(mods.map((m) => [m.id, m.type]));

  const inputs = [];
  const outputs = [];
  const outside = [];
  const bySource = new Map();
  const byInner = new Map();
  for (const c of patch.cables) {
    const a = inside.has(c.from[0]);
    const b = inside.has(c.to[0]);
    if (a === b) {
      if (!a) outside.push(c);
      continue;
    }
    if (b) {
      // from outside in: one input per outside source
      const key = JSON.stringify(c.from);
      if (!bySource.has(key)) {
        const jack = { name: c.to[1], to: [] };
        inputs.push(jack);
        bySource.set(key, { jack, from: c.from });
      }
      const entry = bySource.get(key);
      entry.jack.to.push(c.to);
    } else {
      // from inside out: one output per inner source
      const key = JSON.stringify(c.from);
      if (!byInner.has(key)) {
        const jack = { name: c.from[1], from: c.from };
        outputs.push(jack);
        byInner.set(key, { jack, to: [] });
      }
      byInner.get(key).to.push(c.to);
    }
  }
  // jacks are named after the inner jack; two of the same name get the
  // module's type in front, and a number if that is not enough
  const label = (list, inner) => {
    const count = new Map();
    for (const j of list) count.set(j.name, (count.get(j.name) ?? 0) + 1);
    const taken = new Set();
    for (const j of list) {
      const at = inner(j);
      j.name = unique(count.get(j.name) > 1 ? `${typeOf.get(at[0])} ${at[1]}` : j.name, taken);
    }
  };
  label(inputs, (j) => j.to[0]);
  label(outputs, (j) => j.from);

  const knobNames = new Set();
  const params = exposed
    .filter((e) => inside.has(e.id))
    .map((e) => ({ name: e.param, module: e.id, param: e.param }));
  const clash = new Map();
  for (const p of params) clash.set(p.name, (clash.get(p.name) ?? 0) + 1);
  for (const p of params) p.name = unique(clash.get(p.name) > 1 ? `${typeOf.get(p.module)} ${p.param}` : p.name, knobNames);

  const spec = {
    doc: '',
    modules: mods.map((m) => ({ ...m, x: m.x - minX, row: m.row - minRow })),
    cables: patch.cables.filter((c) => inside.has(c.from[0]) && inside.has(c.to[0])),
    inputs,
    outputs,
    params,
  };
  const id = Math.max(0, ...patch.modules.map((m) => m.id)) + 1;
  const values = Object.fromEntries(params.map((p) => [p.name, mods.find((m) => m.id === p.module).params?.[p.param]]));
  const cables = [
    ...outside,
    ...[...bySource.values()].map((e) => ({ from: e.from, to: [id, e.jack.name] })),
    ...[...byInner.values()].flatMap((e) => e.to.map((to) => ({ from: [id, e.jack.name], to }))),
  ];
  // midi links of brought-out knobs move to the composite, others go
  const midiMap = (patch.midiMap ?? []).flatMap((e) => {
    if (!inside.has(e.id)) return [e];
    const p = params.find((q) => q.module === e.id && q.param === e.param);
    return p ? [{ ...e, id, param: p.name }] : [];
  });
  const composites = { ...patch.composites, [name]: spec };
  return {
    ...patch,
    composites,
    modules: [...patch.modules.filter((m) => !inside.has(m.id)), { id, type: name, x: minX, row: minRow, params: values }],
    cables,
    midiMap,
  };
}

// The opposite: a composite module back into its inner modules, placed where
// it was, with the cables reconnected and its knob values applied.
export function ungroup(patch, id, defOf) {
  const outer = patch.modules.find((m) => m.id === id);
  const def = outer && defOf(outer.type);
  if (!def?.composite) return patch;
  const spec = def.composite;
  let next = Math.max(0, ...patch.modules.map((m) => m.id)) + 1;
  const newId = new Map(spec.modules.map((m) => [m.id, next++]));
  const set = new Map();
  for (const p of spec.params ?? []) {
    if (outer.params?.[p.name] === undefined) continue;
    if (!set.has(p.module)) set.set(p.module, {});
    set.get(p.module)[p.param] = outer.params[p.name];
  }
  const modules = spec.modules.map((m) => ({
    ...m,
    id: newId.get(m.id),
    x: outer.x + m.x,
    row: outer.row + m.row,
    params: { ...m.params, ...set.get(m.id) },
  }));
  const cables = [];
  for (const c of patch.cables) {
    if (c.to[0] === id) {
      const jack = spec.inputs.find((j) => j.name === c.to[1]);
      for (const [inner, name] of jack?.to ?? []) cables.push({ from: c.from, to: [newId.get(inner), name] });
    } else if (c.from[0] === id) {
      const jack = spec.outputs.find((j) => j.name === c.from[1]);
      if (jack) cables.push({ from: [newId.get(jack.from[0]), jack.from[1]], to: c.to });
    } else {
      cables.push(c);
    }
  }
  for (const c of spec.cables) cables.push({ from: [newId.get(c.from[0]), c.from[1]], to: [newId.get(c.to[0]), c.to[1]] });
  const midiMap = (patch.midiMap ?? []).flatMap((e) => {
    if (e.id !== id) return [e];
    const p = spec.params.find((q) => q.name === e.param);
    return p ? [{ ...e, id: newId.get(p.module), param: p.param }] : [];
  });
  return {
    ...patch,
    modules: [...patch.modules.filter((m) => m.id !== id), ...modules],
    cables,
    midiMap,
    newIds: [...newId.values()],
  };
}

// The composites a patch's modules use, also inside other composites.
export function usedComposites(modules, composites = {}) {
  const used = {};
  const visit = (type) => {
    if (used[type] || !composites[type]) return;
    used[type] = composites[type];
    for (const m of composites[type].modules) visit(m.type);
  };
  for (const m of modules) visit(m.type);
  return used;
}

// A whole patch with every composite expanded: only built-in modules, with
// string ids for inner ones. For tests and tools; the rack expands per module.
export function flattenPatch(patch, registry) {
  const defOf = defFinder(registry, patch.composites);
  const modules = [];
  const cables = [];
  const flat = new Map();
  for (const m of patch.modules) {
    const def = defOf(m.type);
    if (!def) continue;
    if (def.composite) {
      const values = { ...Object.fromEntries(Object.entries(def.params).map(([k, p]) => [k, p.default])), ...m.params };
      const f = flatten(def.composite, String(m.id), values, defOf);
      flat.set(m.id, { def, f });
      for (const x of f.modules) {
        const d = registry[x.type];
        modules.push({ id: x.id, type: x.type, params: Object.fromEntries(Object.keys(d.params).map((k, i) => [k, x.params[i]])), data: x.data });
      }
      for (const c of f.cables) {
        cables.push({ from: [c.from[0], registry[typeOf(modules, c.from[0])].outputs[c.from[1]]], to: [c.to[0], Object.keys(registry[typeOf(modules, c.to[0])].inputs)[c.to[1]]] });
      }
    } else {
      modules.push(m);
      flat.set(m.id, { def });
    }
  }
  for (const c of patch.cables) {
    const a = flat.get(c.from[0]);
    const b = flat.get(c.to[0]);
    if (!a || !b) continue;
    const froms = a.f ? [a.f.outputs[a.def.outputs.indexOf(c.from[1])]].filter(Boolean) : [[c.from[0], a.def.outputs.indexOf(c.from[1])]];
    const tos = b.f ? b.f.inputs[Object.keys(b.def.inputs).indexOf(c.to[1])] ?? [] : [[c.to[0], Object.keys(b.def.inputs).indexOf(c.to[1])]];
    for (const [fid, fi] of froms) {
      for (const [tid, ti] of tos) {
        cables.push({ from: [fid, registry[typeOf(modules, fid)].outputs[fi]], to: [tid, Object.keys(registry[typeOf(modules, tid)].inputs)[ti]] });
      }
    }
  }
  return { ...patch, composites: undefined, modules, cables };
}

const typeOf = (modules, id) => modules.find((m) => m.id === id).type;

// ---------------------------------------------------------------------------
// Editing a composite's inside (the edit view): the inside is shown as a
// patch of its modules plus two panels standing for its jacks, "in" (its
// inputs, as outputs to patch from) and "out" (its outputs, as inputs). Each
// has a spare jack "+": a cable from it (to it) makes a new jack, named after
// the jack at the other end. A jack whose cables are all gone goes away.

export const IN_TYPE = 'composite in';
export const OUT_TYPE = 'composite out';
export const ADD_JACK = '+';

export function boundaryDefs(spec) {
  const ins = (spec.inputs ?? []).map((j) => j.name);
  const outs = (spec.outputs ?? []).map((j) => j.name);
  const cols = (n) => Math.max(2, Math.ceil(n / 6));
  return {
    [IN_TYPE]: {
      name: 'in',
      doc: "The composite's inputs: what is patched into it outside comes out here.",
      cols: cols(ins.length + 1),
      inputs: {},
      outputs: [...ins, ADD_JACK],
      params: {},
      boundary: true,
    },
    [OUT_TYPE]: {
      name: 'out',
      doc: "The composite's outputs: what is patched in here comes out of it outside.",
      cols: cols(outs.length + 1),
      inputs: Object.fromEntries([...outs, ADD_JACK].map((n) => [n, 0])),
      outputs: [],
      params: {},
      boundary: true,
    },
  };
}

// The patch the edit view shows for a composite.
export function insidePatch(spec, composites, defOf) {
  const ids = spec.modules.map((m) => m.id);
  const IN = Math.max(0, ...ids) + 1;
  const OUT = IN + 1;
  const defs = boundaryDefs(spec);
  let modules = spec.modules.map((m) => ({ ...m }));
  let layout = spec.layout;
  if (!layout) {
    // first time: "in" on the left, "out" right of everything
    const shift = defs[IN_TYPE].cols;
    modules = modules.map((m) => ({ ...m, x: m.x + shift }));
    const right = Math.max(shift, ...modules.map((m) => m.x + (defOf?.(m.type)?.cols ?? 4)));
    layout = { in: [0, 0], out: [right + 1, 0] };
  }
  modules.push({ id: IN, type: IN_TYPE, x: layout.in[0], row: layout.in[1], params: {} });
  modules.push({ id: OUT, type: OUT_TYPE, x: layout.out[0], row: layout.out[1], params: {} });
  const cables = spec.cables.map((c) => ({ from: [...c.from], to: [...c.to] }));
  for (const j of spec.inputs ?? []) for (const to of j.to) cables.push({ from: [IN, j.name], to: [...to] });
  for (const j of spec.outputs ?? []) cables.push({ from: [...j.from], to: [OUT, j.name] });
  return { v: 2, modules, cables, midiMap: [], composites };
}

// The composite as the edit view now has it. `old` is the composite before:
// its doc and knob names are kept, knobs of modules that are gone are dropped.
export function specFromInside(patch, old) {
  const inMod = patch.modules.find((m) => m.type === IN_TYPE);
  const outMod = patch.modules.find((m) => m.type === OUT_TYPE);
  const IN = inMod?.id;
  const OUT = outMod?.id;
  const modules = patch.modules.filter((m) => m.id !== IN && m.id !== OUT);
  const ids = new Set(modules.map((m) => m.id));
  const typeOf = new Map(modules.map((m) => [m.id, m.type]));
  const cables = patch.cables.filter((c) => ids.has(c.from[0]) && ids.has(c.to[0]));

  // inputs: the old ones in their order, then new ones from "+"
  const inputs = (old.inputs ?? []).map((j) => ({ name: j.name, to: [] }));
  const taken = new Set(inputs.map((j) => j.name));
  for (const c of patch.cables) {
    if (c.from[0] !== IN || !ids.has(c.to[0])) continue;
    let jack = inputs.find((j) => j.name === c.from[1]);
    if (c.from[1] === ADD_JACK) {
      // one new jack per cable from "+"
      jack = { name: unique(c.to[1], taken), to: [] };
      inputs.push(jack);
    }
    jack?.to.push([...c.to]);
  }
  const outputs = [];
  const outTaken = new Set();
  const oldOut = (old.outputs ?? []).map((j) => j.name);
  for (const name of oldOut) outTaken.add(name);
  const feeds = new Map();
  for (const c of patch.cables) {
    if (c.to[0] !== OUT || !ids.has(c.from[0])) continue;
    if (c.to[1] === ADD_JACK) {
      outputs.push({ name: unique(c.from[1], outTaken), from: [...c.from] });
    } else if (!feeds.has(c.to[1])) {
      // an output has one source; a second cable into it is ignored
      feeds.set(c.to[1], [...c.from]);
    }
  }
  const kept = oldOut.filter((n) => feeds.has(n)).map((name) => ({ name, from: feeds.get(name) }));
  const params = (old.params ?? []).filter((p) => ids.has(p.module) && typeOf.get(p.module));
  const spec = {
    doc: old.doc ?? '',
    modules,
    cables,
    inputs: inputs.filter((j) => j.to.length),
    outputs: [...kept, ...outputs],
    params,
    layout: { in: [inMod?.x ?? 0, inMod?.row ?? 0], out: [outMod?.x ?? 0, outMod?.row ?? 0] },
  };
  return spec;
}

// Whether two composites differ only in knob settings of their modules
// (then playing instances can be kept and just sent the new values).
export function sameBuild(a, b) {
  const strip = (s) => JSON.stringify({ ...s, layout: undefined, modules: s.modules.map((m) => ({ ...m, params: undefined, x: undefined, row: undefined, color: undefined })) });
  return !!a && !!b && strip(a) === strip(b);
}

// The composites that use `name`, also through other composites, and itself.
export function dependents(name, composites) {
  const out = new Set([name]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [n, spec] of Object.entries(composites)) {
      if (!out.has(n) && spec.modules.some((m) => out.has(m.type))) {
        out.add(n);
        grew = true;
      }
    }
  }
  return out;
}

// The engine id prefixes of every playing instance of composite `name`: an
// instance in the patch is "<id>", one inside a composite C is "<C's
// prefix>/<id in C>".
export function instancePrefixes(name, modules, composites) {
  const memo = new Map();
  const of = (type, seen) => {
    if (memo.has(type)) return memo.get(type);
    if (seen.has(type)) return [];
    seen.add(type);
    const list = modules.filter((m) => m.type === type).map((m) => String(m.id));
    for (const [c, spec] of Object.entries(composites)) {
      for (const m of spec.modules) {
        if (m.type === type) for (const p of of(c, seen)) list.push(`${p}/${m.id}`);
      }
    }
    memo.set(type, list);
    return list;
  };
  return of(name, new Set());
}

// Renames a composite's jacks and knobs everywhere they are referred to: the
// patch's cables, knob values and midi links, and other composites that use
// it. renames = { inputs: {old: new}, outputs: {...}, params: {...} }
export function renamePanel(patch, name, renames) {
  const rin = renames.inputs ?? {};
  const rout = renames.outputs ?? {};
  const rpar = renames.params ?? {};
  const ri = (n) => rin[n] ?? n;
  const ro = (n) => rout[n] ?? n;
  const rp = (n) => rpar[n] ?? n;
  // modules, cables and knob links of one level (the patch or a composite)
  const level = (modules, cables) => {
    const ids = new Set(modules.filter((m) => m.type === name).map((m) => m.id));
    return {
      ids,
      modules: modules.map((m) => (ids.has(m.id) ? { ...m, params: Object.fromEntries(Object.entries(m.params ?? {}).map(([k, v]) => [rp(k), v])) } : m)),
      cables: cables.map((c) => ({
        from: ids.has(c.from[0]) ? [c.from[0], ro(c.from[1])] : c.from,
        to: ids.has(c.to[0]) ? [c.to[0], ri(c.to[1])] : c.to,
      })),
    };
  };
  const composites = {};
  for (const [n, spec] of Object.entries(patch.composites ?? {})) {
    let next = spec;
    if (n === name) {
      next = {
        ...spec,
        inputs: spec.inputs.map((j) => ({ ...j, name: ri(j.name) })),
        outputs: spec.outputs.map((j) => ({ ...j, name: ro(j.name) })),
        params: spec.params.map((p) => ({ ...p, name: rp(p.name) })),
      };
    }
    const l = level(next.modules, next.cables);
    composites[n] = {
      ...next,
      modules: l.modules,
      cables: l.cables,
      inputs: next.inputs?.map((j) => ({ ...j, to: j.to.map(([id, jn]) => [id, l.ids.has(id) ? ri(jn) : jn]) })),
      outputs: next.outputs?.map((j) => ({ ...j, from: l.ids.has(j.from[0]) ? [j.from[0], ro(j.from[1])] : j.from })),
      params: next.params?.map((p) => (l.ids.has(p.module) ? { ...p, param: rp(p.param) } : p)),
    };
  }
  const top = level(patch.modules, patch.cables);
  return {
    ...patch,
    composites,
    modules: top.modules,
    cables: top.cables,
    midiMap: (patch.midiMap ?? []).map((e) => (top.ids.has(e.id) ? { ...e, param: rp(e.param) } : e)),
  };
}
