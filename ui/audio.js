const MAX_CHANNELS = 32;
const START_TIMEOUT = 5000;

export class AudioEngine {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.ctx = null;
    this.node = null;
    this.channels = 0;
    this.mic = null;
  }

  get running() {
    return !!this.node;
  }

  send(message) {
    this.node?.port.postMessage(message);
  }

  async stop() {
    this.closeInput();
    this.node = null;
    this.channels = 0;
    if (this.ctx) await this.ctx.close();
    this.ctx = null;
  }

  async start(sinkId) {
    await this.stop();
    const options = { latencyHint: 'interactive' };
    if (sinkId) options.sinkId = sinkId;
    const ctx = new AudioContext(options);
    await ctx.audioWorklet.addModule('engine/processor.js');
    await Promise.race([
      ctx.resume(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('audio did not start')), START_TIMEOUT)),
    ]);

    const dest = ctx.destination;
    const channels = Math.min(Math.max(dest.maxChannelCount, 1), MAX_CHANNELS);
    dest.channelCount = channels;
    dest.channelCountMode = 'explicit';
    dest.channelInterpretation = 'discrete';

    const node = new AudioWorkletNode(ctx, 'aparat', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [channels],
      channelCount: 8,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
    });
    node.port.onmessage = (e) => this.onMessage(e.data);
    node.connect(dest);

    this.ctx = ctx;
    this.node = node;
    this.channels = channels;
  }

  closeInput() {
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
  }

  async openInput() {
    if (!this.ctx || this.mic) return;
    this.mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.ctx.createMediaStreamSource(this.mic).connect(this.node);
  }
}

export async function listOutputs() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((t) => t.stop());
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default');
}
