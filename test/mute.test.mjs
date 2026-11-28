// CrazyGames mute support (headless Chromium, a stand-in SDK): the platform's muteAudio setting is
// respected at start and when it changes, and the game has its own mute toggle (button + M key).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGame, findPlaywright } from './helpers/browser.mjs';

const skip = findPlaywright() ? false : 'Playwright not installed (npm i -D playwright && npx playwright install chromium)';
let game = null;

test.before(async () => {
  if (!skip) game = await startGame();
});
test.after(async () => {
  if (game) await game.close();
});

/** A minimal CrazyGames SDK v3 stand-in: settings.muteAudio + a settings change listener. */
const STUB = `
window.__cg = { listeners: [], calls: [] };
window.CrazyGames = { SDK: {
  environment: 'local',
  init: () => Promise.resolve(),
  game: {
    settings: { muteAudio: true, disableChat: false },
    addSettingsChangeListener: (fn) => window.__cg.listeners.push(fn),
    removeSettingsChangeListener: () => {},
    gameplayStart: () => window.__cg.calls.push('gameplayStart'),
    gameplayStop: () => window.__cg.calls.push('gameplayStop'),
    loadingStart: () => window.__cg.calls.push('loadingStart'),
    loadingStop: () => window.__cg.calls.push('loadingStop'),
    happytime: () => {},
  },
  ad: { requestAd: (t, cb) => cb && cb.adError && cb.adError('no ads in tests'), hasAdblock: () => Promise.resolve(false) },
  user: { getUser: () => Promise.resolve(null), systemInfo: { device: { type: 'desktop' } }, isUserAccountAvailable: false },
  data: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} },
} };
`;

test('CrazyGames muteAudio: muted from the start when the platform says so, follows its change listener; the in-game toggle (button and M) works on top', { skip, timeout: 300000 }, async () => {
  const page = await game.open({ width: 1280, height: 720, sdk: STUB });
  try {
    // the SDK answers within a moment; the setting is applied once it does
    await page.waitForFunction(() => window.__cg && window.__cg.listeners.length > 0, null, { timeout: 15000 });
    const st = () =>
      page.evaluate(() => {
        const a = window.__nsc.audio;
        return { muted: a.muted, reasons: [...a.muteReasons], gain: a.master ? a.master.gain.value : null, user: !!window.__nsc.save.data.settings.muted };
      });
    await page.waitForTimeout(300);
    const start = await st();
    assert.ok(start.muted && start.reasons.includes('platform'), 'muted by the platform at start: ' + JSON.stringify(start));
    // the platform unmutes
    await page.evaluate(() => window.__cg.listeners.forEach((fn) => fn({ muteAudio: false, disableChat: false })));
    await page.waitForTimeout(200);
    const un = await st();
    assert.ok(!un.reasons.includes('platform'), 'the change listener unmutes: ' + JSON.stringify(un));
    assert.ok(!un.muted, 'sound on again');
    // the player's own toggle: the HUD button, then the M key
    await page.evaluate(() => document.querySelector('.hud-btns .mutebtn').click());
    const u1 = await st();
    assert.ok(u1.muted && u1.user && u1.reasons.includes('user'), 'the in-game mute button mutes (and is remembered): ' + JSON.stringify(u1));
    await page.keyboard.press('KeyM');
    const u2 = await st();
    assert.ok(!u2.muted && !u2.user, 'M unmutes: ' + JSON.stringify(u2));
    // the platform mutes again mid-game: the player's unmute does not override it
    await page.evaluate(() => window.__cg.listeners.forEach((fn) => fn({ muteAudio: true })));
    await page.waitForTimeout(200);
    const again = await st();
    assert.ok(again.muted && again.reasons.includes('platform'), 'the platform mute holds');
    assert.ok(await page.evaluate(() => window.__cg.calls.includes('gameplayStart')), 'gameplayStart reached the platform');
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

test('mute is total: the master lands on exactly 0 and the audio graph is suspended (no sea residue), sound comes back on unmute; the sea dips under a lock, a drop and a horn', { skip, timeout: 300000 }, async () => {
  const page = await game.open({ width: 1280, height: 720 });
  try {
    // a real gesture unlocks the audio
    await page.mouse.click(640, 360);
    await page.waitForFunction(() => window.__nsc.audio.ctx && window.__nsc.audio.ctx.state === 'running', null, { timeout: 10000 });
    await page.waitForTimeout(300);
    const st = () =>
      page.evaluate(() => {
        const a = window.__nsc.audio;
        return { state: a.ctx.state, gain: a.master.gain.value, amb: a.buses.amb.gain.value, ducks: a.ducks || 0 };
      });
    // the duck: the lock clunk pulls the ambience bus down, then it comes back
    const d = await page.evaluate(async () => {
      const a = window.__nsc.audio;
      a.play('lock');
      await new Promise((r) => setTimeout(r, 160));
      const dip = a.buses.amb.gain.value;
      a.play('horn_ship');
      await new Promise((r) => setTimeout(r, 160));
      const dip2 = a.buses.amb.gain.value;
      await new Promise((r) => setTimeout(r, 2600));
      return { dip, dip2, back: a.buses.amb.gain.value, ducks: a.ducks };
    });
    assert.ok(d.dip < 0.65 && d.dip2 < 0.65, 'the sea ducks under the lock and the horn: ' + JSON.stringify(d));
    assert.ok(d.back > 0.95, 'and comes back: ' + d.back);
    // in-game mute
    await page.keyboard.press('KeyM');
    await page.waitForTimeout(250);
    const m = await st();
    assert.equal(m.gain, 0, 'master at exactly 0: ' + JSON.stringify(m));
    assert.equal(m.state, 'suspended', 'the graph is suspended: nothing reaches the speakers');
    // a tap while muted does not wake it
    await page.mouse.click(640, 360);
    await page.waitForTimeout(250);
    assert.equal((await st()).state, 'suspended', 'a tap does not wake a muted game');
    await page.keyboard.press('KeyM');
    await page.waitForFunction(() => window.__nsc.audio.ctx.state === 'running', null, { timeout: 5000 });
    await page.waitForTimeout(150);
    const u = await st();
    assert.ok(u.gain > 0.95, 'sound back: ' + JSON.stringify(u));
    // the platform's mute (CrazyGames muteAudio) takes the same path
    await page.evaluate(() => window.__nsc.audio.setMuted(true, 'platform'));
    await page.waitForTimeout(250);
    const p = await st();
    assert.ok(p.gain === 0 && p.state === 'suspended', 'platform mute is total too: ' + JSON.stringify(p));
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});
