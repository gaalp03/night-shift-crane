// localStorage-backed save data with defensive parsing and versioning.
const KEY = 'night-shift-crane.save.v1';

const defaults = () => ({
  v: 1,
  money: 0,
  upgrades: {},
  shifts: {}, // id -> { stars, best }
  endless: { best: 0, bestShips: 0, runs: 0 },
  settings: { music: 0.7, sfx: 0.9, quality: 'auto', shake: true, cabDefault: false, hints: true },
  flags: { introSeen: false, tutorialDone: false, endlessSeen: false },
  paint: 'yellow',
  stats: { placed: 0, lost: 0, perfects: 0, earned: 0, playSeconds: 0 },
});

function merge(base, extra) {
  if (!extra || typeof extra !== 'object') return base;
  for (const k of Object.keys(extra)) {
    const v = extra[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') merge(base[k], v);
    else base[k] = v;
  }
  return base;
}

class Save {
  constructor() {
    this.data = defaults();
    this._timer = 0;
    this.ok = true;
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) merge(this.data, JSON.parse(raw));
    } catch (e) {
      this.ok = false;
    }
    return this.data;
  }

  /** Debounced write so rapid changes (sliders) do not hammer storage. */
  commit(immediate = false) {
    clearTimeout(this._timer);
    const write = () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.data));
      } catch (e) {
        this.ok = false;
      }
    };
    if (immediate) write();
    else this._timer = setTimeout(write, 250);
  }

  reset() {
    this.data = defaults();
    this.commit(true);
  }

  totalStars() {
    let n = 0;
    for (const k in this.data.shifts) n += this.data.shifts[k].stars || 0;
    return n;
  }

  shift(id) {
    return this.data.shifts[id] || { stars: 0, best: 0 };
  }

  recordShift(id, stars, score) {
    const cur = this.data.shifts[id] || { stars: 0, best: 0 };
    const gainedStars = Math.max(0, stars - cur.stars);
    const newBest = score > cur.best;
    this.data.shifts[id] = { stars: Math.max(cur.stars, stars), best: Math.max(cur.best, score) };
    this.commit(true);
    return { gainedStars, newBest };
  }
}

export const save = new Save();
