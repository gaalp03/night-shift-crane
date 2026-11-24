// localStorage-backed save data with defensive parsing and versioning.
const KEY = 'night-shift-crane.save.v1';
const BAK = KEY + '.bak';
export const SAVE_VERSION = 2;

const defaults = () => ({
  v: SAVE_VERSION,
  money: 0,
  upgrades: {},
  shifts: {}, // id -> { stars, best }
  endless: { best: 0, bestShips: 0, runs: 0 },
  // Tonight's Shift: today's record, and how many nights in a row it has been worked
  daily: { date: '', best: 0, stars: 0, order: '', streak: 0, bestStreak: 0, last: '', plays: 0 },
  // controls (touch devices): '' = not chosen yet, 'manual' (stick + buttons) or 'onefinger' (drag + tap)
  settings: { music: 0.7, sfx: 0.9, quality: 'auto', shake: true, cabDefault: false, hints: true, flashes: true, controls: '', showFps: false },
  flags: { introSeen: false, tutorialDone: false, endlessSeen: false, checkSeen: false },
  story: { boxes: {}, opened: {}, ending: null },
  login: { last: '', streak: 0, best: 0 }, // daily login streak (local calendar days)
  week: { key: '', best: 0, ships: 0 }, // this week's port record (Monday to Sunday, local)
  rigSetup: '', // 'steady' | 'fast' | '' (chosen after the second ship, switchable in the workshop)
  install: '', // first day played (YYYY-MM-DD), for return-day analytics // what became of each unlisted box (shift id -> outcome)
  paint: 'yellow',
  awards: {},
  stats: { placed: 0, lost: 0, perfects: 0, earned: 0, playSeconds: 0, busted: 0, smuggled: 0 },
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

/** Storage that may be missing or blocked (private mode, sandboxed iframes): null instead of a throw. */
function localStore() {
  try {
    const ls = window.localStorage;
    const k = '__nsc_probe';
    ls.setItem(k, '1');
    ls.removeItem(k);
    return ls;
  } catch (e) {
    return null;
  }
}

function parse(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const d = JSON.parse(raw);
    return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
  } catch (e) {
    return null;
  }
}

const num = (v, lo = 0, hi = 1e12, int = true) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  const c = Math.min(hi, Math.max(lo, n));
  return int ? Math.floor(c) : c;
};

/** Older builds' saves: rename what moved, then make every field the type this build expects. */
function migrate(d) {
  // 1.3: the first unlisted box moved from shift 4 to shift 3
  const b = d.story && d.story.boxes;
  if (b && b.s04 && !b.s03) {
    b.s03 = b.s04;
    delete b.s04;
  }
  d.v = SAVE_VERSION;
}

function sanitize(d) {
  const D = defaults();
  for (const k of Object.keys(D)) {
    const want = D[k];
    if (want && typeof want === 'object' && !Array.isArray(want) && (!d[k] || typeof d[k] !== 'object' || Array.isArray(d[k]))) d[k] = want;
  }
  d.money = num(d.money);
  const up = {};
  for (const k of Object.keys(d.upgrades)) up[k] = num(d.upgrades[k], 0, 8);
  d.upgrades = up;
  for (const k of Object.keys(d.stats)) d.stats[k] = num(d.stats[k]);
  d.endless.best = num(d.endless.best);
  d.endless.bestShips = num(d.endless.bestShips);
  d.endless.runs = num(d.endless.runs);
  d.login.streak = num(d.login.streak, 0, 9999);
  d.login.best = num(d.login.best, 0, 9999);
  d.week.best = num(d.week.best);
  const st = d.settings;
  st.music = num(st.music, 0, 1, false);
  st.sfx = num(st.sfx, 0, 1, false);
  if (!['auto', 'low', 'medium', 'high'].includes(st.quality)) st.quality = 'auto';
  if (!['', 'steady', 'fast'].includes(d.rigSetup)) d.rigSetup = '';
  if (!['', 'manual', 'onefinger'].includes(st.controls)) st.controls = '';
  if (typeof d.paint !== 'string') d.paint = 'yellow';
  return d;
}

export class Save {
  constructor() {
    this.data = defaults();
    this._timer = 0;
    this.ok = true;
    this.ls = null;
    this.loadedFrom = 'none'; // 'main' | 'backup' | 'cloud' | 'none'
  }

  /**
   * Main copy first; if it is unreadable, the last checkpoint (backup); else a fresh start.
   * Storage that cannot be used at all leaves the game in memory (and in the cloud copy, if any).
   */
  load() {
    this.ls = localStore();
    this.ok = !!this.ls;
    let src = null;
    if (this.ls) {
      try {
        src = parse(this.ls.getItem(KEY));
        if (src) this.loadedFrom = 'main';
        else {
          src = parse(this.ls.getItem(BAK));
          if (src) this.loadedFrom = 'backup';
        }
      } catch (e) {
        src = null;
      }
    }
    try {
      if (src) merge(this.data, src);
      migrate(this.data);
      sanitize(this.data);
    } catch (e) {
      this.data = defaults();
      this.loadedFrom = 'none';
    }
    // a damaged main copy is replaced by the recovered one at once
    if (this.loadedFrom === 'backup') this.commit(true);
    return this.data;
  }

  /**
   * Platform cloud save (CrazyGames data module): adopt it if it is further along than this
   * browser's copy, and mirror every later write to it.
   * @param store { getItem(key), setItem(key, value) }
   */
  attachCloud(store) {
    if (!store) return false;
    this.cloud = store;
    try {
      const remote = parse(store.getItem(KEY));
      if (remote && (remote.t || 0) > (this.data.t || 0)) {
        const fresh = defaults();
        merge(fresh, remote);
        migrate(fresh);
        sanitize(fresh);
        this.data = fresh;
        this.loadedFrom = 'cloud';
        return true;
      }
    } catch (e) {}
    return false;
  }

  _write(backup) {
    this.data.t = Date.now();
    this.data.v = SAVE_VERSION;
    const json = JSON.stringify(this.data);
    if (this.ls) {
      try {
        this.ls.setItem(KEY, json);
        if (backup) this.ls.setItem(BAK, json);
        this.ok = true;
      } catch (e) {
        this.ok = false; // (full or revoked storage: the game carries on in memory)
      }
    }
    try {
      if (this.cloud) this.cloud.setItem(KEY, json);
    } catch (e) {}
  }

  /** Debounced write so rapid changes (sliders) do not hammer storage. */
  commit(immediate = false) {
    clearTimeout(this._timer);
    if (immediate) this._write(false);
    else this._timer = setTimeout(() => this._write(false), 250);
  }

  /** Write now (tab hidden, page closing, rewards). */
  flush() {
    clearTimeout(this._timer);
    this._write(false);
  }

  /** A checkpoint (every ship, every purchase): written now, and kept as the fallback copy. */
  checkpoint() {
    clearTimeout(this._timer);
    this._write(true);
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
    this.data.shifts[id] = { ...cur, stars: Math.max(cur.stars, stars), best: Math.max(cur.best, score) };
    this.commit(true);
    return { gainedStars, newBest };
  }
}

export const save = new Save();
