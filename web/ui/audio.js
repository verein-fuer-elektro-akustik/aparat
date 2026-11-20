const MAX_CHANNELS = 32;
const START_TIMEOUT = 5000;

// The latency setting is only a request, a name or a number of ms; each
// browser picks its own buffer size for it.
const LATENCY_HINTS = { low: 'interactive', balanced: 'balanced', safe: 'playback' };

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

  // sampleRate: a number, or 0 for the sound card's own rate (a different one
  // is converted by the browser); latency: low, balanced, safe or ms
  async start(sinkId, { sampleRate = 0, latency = 'low' } = {}) {
    await this.stop();
    const ms = Number(latency);
    const options = { latencyHint: ms > 0 ? ms / 1000 : LATENCY_HINTS[latency] ?? 'interactive' };
    if (sinkId) options.sinkId = sinkId;
    if (sampleRate) options.sampleRate = sampleRate;
    const ctx = new AudioContext(options);
    try {
      // relative to this file, not to the page, whose url changes with patches
      await ctx.audioWorklet.addModule(new URL('../engine/processor.js', import.meta.url));
      await Promise.race([
        ctx.resume(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('audio did not start')), START_TIMEOUT)),
      ]);
    } catch (err) {
      ctx.close().catch(() => {});
      throw err;
    }

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

  // the delay from the engine to the speakers in ms, as far as the browser
  // knows it (outputLatency is 0 where it is not reported)
  get latencyMs() {
    if (!this.ctx) return 0;
    return Math.round(((this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000);
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
