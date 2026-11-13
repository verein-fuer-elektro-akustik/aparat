// Web MIDI only exists on the main thread, so all MIDI passes through here.
// Ports are remembered by name, ids are not stable across replugging.

export class Midi {
  constructor({ inSelect, outSelect, onMessage }) {
    this.inSelect = inSelect;
    this.outSelect = outSelect;
    this.onMessage = onMessage;
    this.access = null;
    this.inName = '';
    this.outName = '';
    inSelect.addEventListener('change', () => {
      this.inName = inSelect.value;
    });
    outSelect.addEventListener('change', () => {
      this.outName = outSelect.value;
    });
  }

  async enable() {
    if (!navigator.requestMIDIAccess) throw new Error('this browser has no web midi');
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = () => this.refresh();
    this.refresh();
  }

  setPorts(inName, outName) {
    this.inName = inName ?? '';
    this.outName = outName ?? '';
    if (this.access) this.refresh();
  }

  refresh() {
    const inputs = [...this.access.inputs.values()];
    const outputs = [...this.access.outputs.values()];
    this.fill(this.inSelect, 'all inputs', inputs, this.inName);
    this.fill(this.outSelect, 'no midi out', outputs, this.outName);
    for (const port of inputs) {
      port.onmidimessage = (e) => {
        if (!this.inName || this.inName === port.name) this.onMessage([...e.data]);
      };
    }
  }

  fill(select, emptyLabel, ports, wanted) {
    select.replaceChildren(new Option(emptyLabel, ''));
    for (const p of ports) select.add(new Option(p.name, p.name));
    if (wanted && !ports.some((p) => p.name === wanted)) {
      select.add(new Option(`${wanted} (missing)`, wanted));
    }
    select.value = wanted;
  }

  send(data) {
    if (!this.access || !this.outName) return;
    const port = [...this.access.outputs.values()].find((p) => p.name === this.outName);
    if (!port) return;
    for (let i = 0; i < data.length; i += 3) {
      if (data[i] >= 0xf8) port.send([data[i]]);
      else port.send([data[i], data[i + 1], data[i + 2]]);
    }
  }
}
