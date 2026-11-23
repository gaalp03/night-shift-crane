// Save safety, in plain Node: corrupt main copy -> backup restore, old-build save migration,
// blocked storage, checkpoints. (No browser needed: localStorage is faked.)
import test from 'node:test';
import assert from 'node:assert/strict';

const KEY = 'night-shift-crane.save.v1';

/** A tiny localStorage; `blocked` makes every access throw, like a sandboxed iframe or private mode. */
function fakeStorage(init = {}, { blocked = false } = {}) {
  const m = new Map(Object.entries(init));
  const deny = () => {
    throw new Error('SecurityError: storage is disabled');
  };
  return {
    map: m,
    getItem: (k) => (blocked ? deny() : m.has(k) ? m.get(k) : null),
    setItem: (k, v) => (blocked ? deny() : m.set(k, String(v))),
    removeItem: (k) => (blocked ? deny() : m.delete(k)),
  };
}

function withWindow(storage, blocked = false) {
  globalThis.window = {};
  Object.defineProperty(globalThis.window, 'localStorage', {
    configurable: true,
    get() {
      if (blocked) throw new Error('SecurityError: access denied');
      return storage;
    },
  });
}

const { Save, SAVE_VERSION } = await import('../src/core/save.js');

test('a corrupt main copy is recovered from the last checkpoint, and repaired', () => {
  const ls = fakeStorage({
    [KEY]: '{"money": 12, "upgr', // a truncated write
    [KEY + '.bak']: JSON.stringify({ v: 2, money: 4321, upgrades: { sway: 2 }, flags: { played: true } }),
  });
  withWindow(ls);
  const s = new Save();
  const d = s.load();
  assert.equal(s.loadedFrom, 'backup');
  assert.equal(d.money, 4321);
  assert.equal(d.upgrades.sway, 2);
  // the main copy was rewritten from the recovered data
  assert.equal(JSON.parse(ls.map.get(KEY)).money, 4321);
});

test('an unreadable main copy and no backup start fresh instead of crashing', () => {
  withWindow(fakeStorage({ [KEY]: 'not json at all' }));
  const s = new Save();
  const d = s.load();
  assert.equal(s.loadedFrom, 'none');
  assert.equal(d.money, 0);
  assert.equal(d.v, SAVE_VERSION);
});

test('an old build\'s save is migrated and sanitised', () => {
  const old = {
    money: '750',
    upgrades: { sway: '2', trolley: 99, junk: 'x' },
    stats: { placed: 'NaN' },
    settings: { quality: 'ultra', music: 7 },
    story: { boxes: { s04: 'ship' } },
    rigSetup: 'turbo',
    flags: { played: true },
    login: null,
    endless: [],
  };
  withWindow(fakeStorage({ [KEY]: JSON.stringify(old) }));
  const d = new Save().load();
  assert.equal(d.v, SAVE_VERSION);
  assert.equal(d.money, 750);
  assert.equal(d.upgrades.sway, 2);
  assert.ok(d.upgrades.trolley <= 8, 'upgrade levels are clamped');
  assert.equal(d.stats.placed, 0);
  assert.equal(d.settings.quality, 'auto');
  assert.equal(d.settings.music, 1);
  assert.equal(d.story.boxes.s03, 'ship', 'the 1.3 story move is applied');
  assert.equal(d.rigSetup, '');
  assert.equal(typeof d.login, 'object');
  assert.equal(typeof d.endless.best, 'number');
  assert.equal(d.flags.played, true, 'real progress survives');
});

test('blocked storage: the game keeps playing in memory, nothing throws', () => {
  withWindow(null, true);
  const s = new Save();
  const d = s.load();
  assert.equal(s.ok, false);
  d.money = 99;
  assert.doesNotThrow(() => s.checkpoint());
  assert.doesNotThrow(() => s.flush());
  assert.equal(s.data.money, 99);
});

test('a checkpoint writes the main copy and the backup together', () => {
  const ls = fakeStorage();
  withWindow(ls);
  const s = new Save();
  s.load();
  s.data.money = 1234;
  s.checkpoint();
  assert.equal(JSON.parse(ls.map.get(KEY)).money, 1234);
  assert.equal(JSON.parse(ls.map.get(KEY + '.bak')).money, 1234);
  assert.equal(JSON.parse(ls.map.get(KEY)).v, SAVE_VERSION);
});

test('a newer cloud copy (CrazyGames data module) wins and later writes are mirrored', () => {
  withWindow(fakeStorage({ [KEY]: JSON.stringify({ v: 2, t: 1, money: 5 }) }));
  const s = new Save();
  s.load();
  const cloud = fakeStorage({ [KEY]: JSON.stringify({ v: 2, t: Date.now() + 1e6, money: 9999 }) });
  assert.equal(s.attachCloud(cloud), true);
  assert.equal(s.data.money, 9999);
  s.data.money = 10;
  s.checkpoint();
  assert.equal(JSON.parse(cloud.map.get(KEY)).money, 10);
});

test('the touch control choice persists, and unknown values fall back to "not chosen"', () => {
  const ls = fakeStorage();
  withWindow(ls);
  const a = new Save();
  a.load();
  assert.equal(a.data.settings.controls, '', 'a new player has not chosen yet');
  a.data.settings.controls = 'onefinger';
  a.checkpoint();
  const b = new Save();
  b.load();
  assert.equal(b.data.settings.controls, 'onefinger', 'remembered on the next visit');
  ls.map.set(KEY, JSON.stringify({ v: 2, settings: { controls: 'joystick' } }));
  const c = new Save();
  c.load();
  assert.equal(c.data.settings.controls, '', 'junk is not trusted');
});
