// Records what the engine plays into a wav file. The audio is kept in memory
// until the recording stops, so it stops by itself at MAX_BYTES.

import { download, showInfo, stamp } from './toast.js';
import { encodeWav } from './wav.js';

const MAX_BYTES = 1024 ** 3; // 32-bit float: 47 minutes of stereo at 48 khz

export function makeRecorder({ audio, button }) {
  let rec = null;

  const time = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  function stop() {
    if (!rec) return;
    audio.send({ op: 'record', on: false });
    const { blocks, channels, rate } = rec;
    rec = null;
    button.classList.remove('on');
    button.textContent = 'record';
    if (blocks.length) download(encodeWav(blocks, channels, rate), `aparat-${stamp()}.wav`);
  }

  return {
    stop,
    toggle() {
      if (rec) return stop();
      if (!audio.running) throw new Error('start audio first');
      rec = { blocks: [], channels: audio.channels, rate: audio.ctx.sampleRate, samples: 0, shown: -1 };
      audio.send({ op: 'record', on: true });
      button.classList.add('on');
      button.textContent = 'stop 0:00';
    },
    // a block of interleaved samples from the engine
    onBlock(m) {
      if (!rec) return;
      rec.channels = m.channels;
      rec.blocks.push(m.data);
      rec.samples += m.data.length;
      const seconds = Math.floor(rec.samples / m.channels / rec.rate);
      if (seconds !== rec.shown) {
        rec.shown = seconds;
        button.textContent = `stop ${time(seconds)}`;
      }
      if (rec.samples * 4 >= MAX_BYTES) {
        showInfo(`recording stopped at ${time(seconds)}: it reached 1 GB`);
        stop();
      }
    },
  };
}
