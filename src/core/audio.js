// Web Audio engine: decoded sample playback only (no synthesis), buses, seamless loops,
// a lazy-decoding music player with crossfades, and iOS/Safari unlock handling.
import { clamp, clamp01, randPick, rand } from './util.js';

const AC = window.AudioContext || window.webkitAudioContext;

class Loop {
  /** Native looping source (for gapless WAV loops) whose gain/rate can be driven every frame. */
  constructor(engine, buffer, bus, opts = {}) {
    this.e = engine;
    this.buffer = buffer;
    this.bus = bus;
    this.vol = 0;
    this.rate = opts.rate || 1;
    this.gain = null;
    this.src = null;
    this.playing = false;
  }
  start() {
    const ctx = this.e.ctx;
    if (!ctx || !this.buffer || this.playing) return this;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.bus);
    this.src = ctx.createBufferSource();
    this.src.buffer = this.buffer;
    this.src.loop = true;
    this.src.playbackRate.value = this.rate;
    this.src.connect(this.gain);
    this.src.start(0, Math.random() * this.buffer.duration);
    this.playing = true;
    return this;
  }
  set(vol, rate, tc = 0.08) {
    if (!this.playing) {
      if (vol <= 0.001) return;
      this.start();
      if (!this.playing) return;
    }
    const t = this.e.ctx.currentTime;
    if (vol !== this.vol) {
      this.vol = vol;
      this.gain.gain.setTargetAtTime(vol, t, tc);
    }
    if (rate !== undefined && rate !== this.rate) {
      this.rate = rate;
      this.src.playbackRate.setTargetAtTime(rate, t, tc);
    }
  }
  stop(fade = 0.2) {
    if (!this.playing) return;
    const t = this.e.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(0, t, fade / 3);
    const src = this.src;
    const gain = this.gain;
    try {
      src.stop(t + fade + 0.05);
    } catch (e) {}
    setTimeout(() => {
      try {
        gain.disconnect();
      } catch (e) {}
    }, (fade + 0.2) * 1000);
    this.playing = false;
    this.vol = 0;
    this.src = this.gain = null;
  }
}

class XLoop {
  /** Crossfading loop for long compressed ambiences (hides MP3 padding at the loop point). */
  constructor(engine, buffer, bus, xfade = 1.2) {
    this.e = engine;
    this.buffer = buffer;
    this.bus = bus;
    this.xf = Math.min(xfade, buffer ? buffer.duration * 0.3 : 1);
    this.out = null;
    this.vol = 0;
    this.nextAt = 0;
    this.playing = false;
    this.nodes = [];
  }
  start() {
    const ctx = this.e.ctx;
    if (!ctx || !this.buffer || this.playing) return this;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(this.bus);
    this.playing = true;
    this.nextAt = ctx.currentTime + 0.02;
    this.e.xloops.add(this);
    this._schedule(Math.random() * (this.buffer.duration - this.xf * 2));
    return this;
  }
  _schedule(offset = 0) {
    const ctx = this.e.ctx;
    const t = Math.max(this.nextAt, ctx.currentTime + 0.01);
    const dur = this.buffer.duration - offset;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + this.xf);
    g.gain.setValueAtTime(1, t + dur - this.xf);
    g.gain.linearRampToValueAtTime(0, t + dur);
    g.connect(this.out);
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(g);
    src.start(t, offset);
    src.stop(t + dur + 0.05);
    const node = { src, g };
    this.nodes.push(node);
    src.onended = () => {
      try {
        g.disconnect();
      } catch (e) {}
      const i = this.nodes.indexOf(node);
      if (i >= 0) this.nodes.splice(i, 1);
    };
    this.nextAt = t + dur - this.xf;
  }
  tick() {
    if (!this.playing) return;
    if (this.e.ctx.currentTime > this.nextAt - 1.5) this._schedule(0);
  }
  set(vol, _rate, tc = 0.25) {
    if (!this.playing) {
      if (vol <= 0.001) return;
      this.start();
      if (!this.playing) return;
    }
    if (vol === this.vol) return;
    this.vol = vol;
    this.out.gain.setTargetAtTime(vol, this.e.ctx.currentTime, tc);
  }
  stop(fade = 0.6) {
    if (!this.playing) return;
    this.playing = false;
    this.e.xloops.delete(this);
    const t = this.e.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, fade / 3);
    const nodes = this.nodes.slice();
    const out = this.out;
    setTimeout(() => {
      for (const n of nodes) {
        try {
          n.src.stop();
        } catch (e) {}
      }
      try {
        out.disconnect();
      } catch (e) {}
    }, (fade + 0.3) * 1000);
    this.nodes = [];
    this.vol = 0;
  }
}

class Music {
  constructor(engine) {
    this.e = engine;
    this.tracks = {};
    this.cache = new Map(); // id -> AudioBuffer (at most two kept)
    this.loading = new Map();
    this.cur = null; // { id, src, gain, endAt }
    this.playlist = [];
    this.index = 0;
    this.wanted = null;
    this.fadeOut = 2.5;
    this.token = 0;
  }
  async _buffer(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    if (this.loading.has(id)) return this.loading.get(id);
    const def = this.tracks[id];
    if (!def || !this.e.ctx) return null;
    const p = (async () => {
      try {
        const res = await fetch(this.e.base + def.file);
        const arr = await res.arrayBuffer();
        const buf = await this.e.decode(arr);
        this.cache.set(id, buf);
        // keep memory bounded: only the current track and the newest decode stay cached
        for (const k of [...this.cache.keys()]) {
          if (this.cache.size <= 2) break;
          if (k !== id && (!this.cur || this.cur.id !== k)) this.cache.delete(k);
        }
        return buf;
      } catch (e) {
        return null;
      } finally {
        this.loading.delete(id);
      }
    })();
    this.loading.set(id, p);
    return p;
  }
  /** Start (or switch to) a playlist. Same playlist => no-op. */
  setPlaylist(ids, { shuffle = false, fade = 2.5 } = {}) {
    const key = ids.join('|');
    if (this.wanted === key) return;
    this.wanted = key;
    this.playlist = ids.slice();
    if (shuffle && this.playlist.length > 1) {
      for (let i = this.playlist.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
      }
    }
    this.index = 0;
    this._playIndex(fade);
  }
  async _playIndex(fade) {
    const token = ++this.token;
    if (!this.playlist.length) {
      this._fadeCurrent(fade);
      return;
    }
    const id = this.playlist[this.index % this.playlist.length];
    const buf = await this._buffer(id);
    if (token !== this.token) return;
    if (!buf) {
      // skip broken track but avoid a tight loop
      this.index++;
      if (this.playlist.length > 1) setTimeout(() => token === this.token && this._playIndex(fade), 4000);
      return;
    }
    const ctx = this.e.ctx;
    const t = ctx.currentTime + 0.05;
    this._fadeCurrent(fade);
    const def = this.tracks[id];
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(def.vol == null ? 1 : def.vol, t + Math.max(0.05, fade * 0.6));
    gain.connect(this.e.buses.music);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    src.start(t);
    this.cur = { id, src, gain, endAt: t + buf.duration, title: def.title, artist: def.artist };
    if (this.e.onTrack) this.e.onTrack(this.cur);
    // warm the next track's decode well before the crossfade
    const nextId = this.playlist[(this.index + 1) % this.playlist.length];
    if (nextId !== id) setTimeout(() => token === this.token && this._buffer(nextId), Math.max(1000, (buf.duration - 30) * 1000));
  }
  _fadeCurrent(fade) {
    const cur = this.cur;
    if (!cur) return;
    this.cur = null;
    const ctx = this.e.ctx;
    const t = ctx.currentTime;
    cur.gain.gain.cancelScheduledValues(t);
    cur.gain.gain.setTargetAtTime(0, t, Math.max(0.02, fade / 3));
    try {
      cur.src.stop(t + fade + 0.1);
    } catch (e) {}
    setTimeout(() => {
      try {
        cur.gain.disconnect();
      } catch (e) {}
    }, (fade + 0.4) * 1000);
  }
  tick() {
    const cur = this.cur;
    if (!cur || !this.e.ctx) return;
    if (this.e.ctx.currentTime > cur.endAt - 3.5) {
      this.index = (this.index + 1) % Math.max(1, this.playlist.length);
      this._playIndex(3.5);
    }
  }
  stop(fade = 1.5) {
    this.wanted = null;
    this.token++;
    this.playlist = [];
    this._fadeCurrent(fade);
  }
}

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.base = 'assets/audio/';
    this.defs = {};
    this.buffers = new Map();
    this.buses = {};
    this.xloops = new Set();
    this.unlocked = false;
    this.vol = { music: 0.7, sfx: 0.9 };
    this.muteReasons = new Set();
    this.listener = { x: 0, y: 0, z: 0, rx: 1, ry: 0, rz: 0 };
    this.lastPlayed = new Map();
    this.music = new Music(this);
    this.onTrack = null;
    this.muffle = 0;
  }

  init(manifest) {
    this.defs = manifest.sfx;
    this.music.tracks = manifest.music;
    if (!AC) return;
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      try {
        this.ctx = new AC();
      } catch (e2) {
        this.ctx = null;
        return;
      }
    }
    const ctx = this.ctx;
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch (e) {}
    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -9;
    this.limiter.knee.value = 8;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.18;
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    const mk = (dest) => {
      const g = ctx.createGain();
      g.connect(dest);
      return g;
    };
    // world sounds (sfx + ambience) pass through a low-pass that we close when paused / inside the cab
    this.worldFilter = ctx.createBiquadFilter();
    this.worldFilter.type = 'lowpass';
    this.worldFilter.frequency.value = 20000;
    this.worldFilter.Q.value = 0.4;
    this.worldFilter.connect(this.master);
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 20000;
    this.musicFilter.connect(this.master);

    this.buses.sfxMaster = mk(this.master); // volume slider for all non-music
    this.worldFilter.disconnect();
    this.worldFilter.connect(this.buses.sfxMaster);
    this.buses.sfx = mk(this.worldFilter);
    this.buses.amb = mk(this.worldFilter);
    this.buses.ui = mk(this.buses.sfxMaster);
    this.buses.music = mk(this.musicFilter);
    this._applyVolumes();

    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click']) {
      window.addEventListener(ev, unlock, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.setMuted(true, 'hidden');
      else this.setMuted(false, 'hidden');
    });
  }

  /** Must run inside a user gesture on iOS; harmless elsewhere. */
  unlock() {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== 'running' && !this.muteReasons.has('hidden') && !this.muteReasons.has('ad')) {
      const p = ctx.resume();
      if (p && p.catch) p.catch(() => {});
    }
    if (!this.unlocked) {
      try {
        const b = ctx.createBuffer(1, 1, 22050);
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(ctx.destination);
        s.start(0);
      } catch (e) {}
      this.unlocked = true;
    }
  }

  decode(arrayBuffer) {
    const ctx = this.ctx;
    return new Promise((resolve, reject) => {
      // callback form keeps old Safari happy
      const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
      if (p && p.catch) p.catch(reject);
    });
  }

  async load(onProgress) {
    if (!this.ctx) {
      if (onProgress) onProgress(1);
      return;
    }
    const files = new Set();
    for (const k in this.defs) for (const f of this.defs[k].files) files.add(f);
    const list = [...files];
    let done = 0;
    const loadOne = async (f) => {
      try {
        const res = await fetch(this.base + f);
        if (!res.ok) throw new Error(res.status);
        const arr = await res.arrayBuffer();
        const buf = await this.decode(arr);
        this.buffers.set(f, buf);
      } catch (e) {
        // missing sound: stay silent rather than break the game
      }
      done++;
      if (onProgress) onProgress(done / list.length);
    };
    // modest parallelism keeps mobile decoders responsive
    const queue = list.slice();
    const workers = [];
    for (let i = 0; i < 6; i++) {
      workers.push(
        (async () => {
          while (queue.length) await loadOne(queue.shift());
        })()
      );
    }
    await Promise.all(workers);
  }

  setListener(camera) {
    const e = camera.matrixWorld.elements;
    const l = this.listener;
    l.x = e[12];
    l.y = e[13];
    l.z = e[14];
    l.rx = e[0];
    l.ry = e[1];
    l.rz = e[2];
  }

  _pick(name) {
    const def = this.defs[name];
    if (!def) return null;
    let f = def.files[0];
    if (def.files.length > 1) {
      const last = this.lastPlayed.get(name);
      do {
        f = randPick(def.files);
      } while (f === last && def.files.length > 1);
      this.lastPlayed.set(name, f);
    }
    const buf = this.buffers.get(f);
    return buf ? { def, buf } : null;
  }

  /**
   * One-shot. opts: vol, rate, pan (-1..1), pos {x,y,z} (auto pan + distance), delay (s), bus.
   */
  play(name, opts = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    const p = this._pick(name);
    if (!p) return null;
    const { def, buf } = p;
    let vol = (def.vol == null ? 1 : def.vol) * (opts.vol == null ? 1 : opts.vol);
    let pan = opts.pan || 0;
    if (opts.pos) {
      const l = this.listener;
      const dx = opts.pos.x - l.x;
      const dy = opts.pos.y - l.y;
      const dz = opts.pos.z - l.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
      const ref = opts.ref || 34;
      vol *= clamp01(1.15 / (1 + (d / ref) * (d / ref)));
      pan = clamp((dx * l.rx + dy * l.ry + dz * l.rz) / d, -1, 1) * 0.7;
    }
    if (vol <= 0.003) return null;
    const rv = def.rateVar == null ? 0.05 : def.rateVar;
    const rate = (opts.rate || 1) * (def.rate || 1) * (1 + rand(-rv, rv));
    const t = ctx.currentTime + (opts.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = vol;
    let tail = g;
    if (pan && ctx.createStereoPanner) {
      const pn = ctx.createStereoPanner();
      pn.pan.value = pan;
      g.connect(pn);
      tail = pn;
    }
    tail.connect(this.buses[opts.bus || def.bus || 'sfx']);
    src.connect(g);
    src.start(t);
    src.onended = () => {
      try {
        tail.disconnect();
        if (tail !== g) g.disconnect();
      } catch (e) {}
    };
    return { src, gain: g };
  }

  /** Create a controllable loop. `x: true` in the manifest marks crossfade loops. */
  loop(name) {
    const def = this.defs[name];
    const dummy = { set() {}, stop() {}, start() {}, playing: false };
    if (!this.ctx || !def) return dummy;
    const buf = this.buffers.get(def.files[0]);
    if (!buf) return dummy;
    const bus = this.buses[def.bus || 'amb'];
    const base = def.vol == null ? 1 : def.vol;
    const inner = def.x ? new XLoop(this, buf, bus, def.x === true ? 1.2 : def.x) : new Loop(this, buf, bus);
    return {
      set: (v, r, tc) => inner.set(v * base, r, tc),
      stop: (f) => inner.stop(f),
      start: () => inner.start(),
      get playing() {
        return inner.playing;
      },
    };
  }

  /** Per-frame housekeeping. */
  update() {
    if (!this.ctx) return;
    for (const l of this.xloops) l.tick();
    this.music.tick();
  }

  /** 0 = open, 1 = heavily muffled (pause menu), used for a tactile "world goes quiet" effect. */
  setMuffle(amount, tc = 0.2) {
    if (!this.ctx || amount === this.muffle) return;
    this.muffle = amount;
    const t = this.ctx.currentTime;
    const f = 20000 * Math.pow(0.03, amount); // 20k -> 600 Hz
    this.worldFilter.frequency.setTargetAtTime(f, t, tc);
    this.musicFilter.frequency.setTargetAtTime(Math.max(f, 900), t, tc);
  }

  setVolume(kind, v) {
    this.vol[kind] = clamp01(v);
    this._applyVolumes();
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.buses.music.gain.setTargetAtTime(this.vol.music * 0.8, t, 0.05);
    this.buses.sfxMaster.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
  }

  /** Reasons stack: 'hidden', 'ad', 'platform'. Audio resumes when all are cleared. */
  setMuted(muted, reason = 'user') {
    if (!this.ctx) return;
    if (muted) this.muteReasons.add(reason);
    else this.muteReasons.delete(reason);
    const hard = this.muteReasons.has('hidden') || this.muteReasons.has('ad');
    const any = this.muteReasons.size > 0;
    this.master.gain.setTargetAtTime(any ? 0 : 1, this.ctx.currentTime, 0.03);
    if (hard) {
      if (this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
    } else if (this.ctx.state !== 'running' && this.unlocked) {
      this.ctx.resume().catch(() => {});
    }
  }
}

export const audio = new AudioEngine();
