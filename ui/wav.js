// 32-bit float WAV from a list of interleaved blocks.

export function encodeWav(blocks, channels, sampleRate) {
  const samples = blocks.reduce((n, b) => n + b.length, 0);
  const bytes = samples * 4;
  const view = new DataView(new ArrayBuffer(44 + bytes));
  const text = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 4, true);
  view.setUint16(32, channels * 4, true);
  view.setUint16(34, 32, true);
  text(36, 'data');
  view.setUint32(40, bytes, true);
  let at = 44;
  for (const block of blocks) {
    for (let i = 0; i < block.length; i++, at += 4) view.setFloat32(at, block[i], true);
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}
