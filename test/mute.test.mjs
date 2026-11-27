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
