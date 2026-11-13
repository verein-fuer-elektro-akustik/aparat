// Audio files for the sampler, by file name. They are decoded to mono and
// kept in this browser (IndexedDB), so a patch finds its files again after a
// reload. They are not stored on the server or in patch files.

const MAX_SECONDS = 120;
const loaded = new Map(); // name -> { samples: Float32Array, sr }

function store(mode) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('aparat', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('samples');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => resolve(open.result.transaction('samples', mode).objectStore('samples'));
  });
}

const done = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export const samples = {
  get: (name) => loaded.get(name),

  // Decode a file the user chose and keep it. Returns its name.
  async add(file) {
    const ctx = new OfflineAudioContext(1, 1, 48000);
    let audio;
    try {
      audio = await ctx.decodeAudioData(await file.arrayBuffer());
    } catch {
      throw new Error(`${file.name} is not an audio file this browser can read`);
    }
    const n = Math.min(audio.length, MAX_SECONDS * audio.sampleRate);
    const data = new Float32Array(n);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const ch = audio.getChannelData(c);
      for (let i = 0; i < n; i++) data[i] += ch[i] / audio.numberOfChannels;
    }
    const sample = { samples: data, sr: audio.sampleRate };
    loaded.set(file.name, sample);
    // keeping it for the next visit is a bonus: private windows may refuse
    store('readwrite').then((s) => done(s.put(sample, file.name))).catch(() => {});
    return file.name;
  },

  // Bring a file from an earlier visit back. False if it is not there.
  async restore(name) {
    if (loaded.has(name)) return true;
    try {
      const sample = await done((await store('readonly')).get(name));
      if (!sample) return false;
      loaded.set(name, sample);
      return true;
    } catch {
      return false;
    }
  },
};
