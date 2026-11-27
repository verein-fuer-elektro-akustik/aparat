// The camera for the camera module (modules/camera.js). The page owns it:
// each video frame is shrunk to a few hundred pixels and read as brightness;
// the difference to the frame before is motion. Out come the numbers the
// module needs and a small picture for its panel. The camera only runs while
// something asks for it, so its light is off otherwise.

export const W = 48;
const H = 30;
const ZONES = 3;

export class Camera {
  constructor(onFrame) {
    this.onFrame = onFrame; // ({values, luma, diff})
    this.stream = null;
    this.video = null;
    this.starting = null;
    this.failed = false;
    this.prev = null;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  get on() {
    return !!this.stream;
  }

  // false when the camera can't be had (no camera, permission refused): it
  // is not asked again until reset()
  async start() {
    if (this.stream || this.failed) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('this browser has no camera access');
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false });
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        await video.play();
        this.stream = stream;
        this.video = video;
        this.prev = null;
        this.loop();
      } catch (err) {
        this.failed = true;
        throw new Error(`camera: ${err.message}`);
      } finally {
        this.starting = null;
      }
    })();
    return this.starting;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
    this.prev = null;
  }

  // ask again next time (after audio was restarted)
  reset() {
    this.failed = false;
  }

  loop() {
    const video = this.video;
    if (!video || this.video !== video) return;
    const next = () => {
      if (this.video !== video) return;
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => this.loop());
      else requestAnimationFrame(() => this.loop());
    };
    if (video.videoWidth) this.read(video);
    next();
  }

  read(video) {
    // the middle of the picture, in the shape of the panel's display
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.min(vw / W, vh / H);
    const sw = W * scale;
    const sh = H * scale;
    this.g.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, W, H);
    const px = this.g.getImageData(0, 0, W, H).data;
    const luma = new Uint8Array(W * H);
    const diff = new Uint8Array(W * H);
    const prev = this.prev;
    let bright = 0;
    let motion = 0;
    let mx = 0;
    let my = 0;
    const zones = new Float32Array(ZONES * ZONES);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = y * W + x;
        const l = (px[4 * k] * 0.299 + px[4 * k + 1] * 0.587 + px[4 * k + 2] * 0.114) | 0;
        luma[k] = l;
        bright += l;
        if (!prev) continue;
        let d = Math.abs(l - prev[k]);
        if (d < 8) d = 0; // camera noise
        diff[k] = d;
        motion += d;
        mx += d * x;
        my += d * y;
        zones[Math.floor((y * ZONES) / H) * ZONES + Math.floor((x * ZONES) / W)] += d;
      }
    }
    this.prev = luma;
    const n = W * H;
    const values = new Float32Array(4 + ZONES * ZONES);
    values[0] = bright / (255 * n);
    values[1] = motion / (255 * n);
    // where the motion is, 0 to 1 from the left and from the bottom; NaN
    // when nothing moves, so the module keeps the last place
    values[2] = motion > 0 ? mx / motion / (W - 1) : NaN;
    values[3] = motion > 0 ? 1 - my / motion / (H - 1) : NaN;
    for (let z = 0; z < zones.length; z++) values[4 + z] = (zones[z] * zones.length) / (255 * n);
    this.onFrame({ values, luma, diff });
  }
}
