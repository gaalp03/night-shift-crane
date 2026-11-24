// Controls on real device profiles (headless Chromium): the touch picker, Manual as the default,
// the choice persisting across visits, the desktop key intro, and every control button on screen.
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

/** Open a page for one test and always close it afterwards. */
async function withPage(opts, fn) {
  const page = await game.open(opts);
  try {
    await fn(page);
  } finally {
    await page
      .context()
      .close()
      .catch(() => {});
  }
}

/** Which controls are fully on screen. */
const onScreen = (page) =>
  page.evaluate(() => {
    const W = innerWidth;
    const H = innerHeight;
    const seen = (sel) =>
      [...document.querySelectorAll(sel)].some((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 4 && r.height > 4 && cs.display !== 'none' && cs.visibility !== 'hidden' && el.offsetParent !== null && r.left >= -1 && r.top >= -1 && r.right <= W + 1 && r.bottom <= H + 1;
      });
    return {
      mode: window.__nsc.app.mode,
      controls: window.__nsc.save.data.settings.controls,
      picker: !!document.getElementById('picker'),
      keys: !!document.getElementById('keysintro'),
      stick: seen('#touch .stick'),
      up: seen('#touch .tbtn.up'),
      down: seen('#touch .tbtn.dn'),
      lock: seen('#touch .tbtn.lock'),
      drop: seen('.dropbtn'),
      pause: seen('.hud-btns .btn:last-child'),
      mute: seen('.hud-btns .mutebtn'),
      upgrade: seen('.hud-tr .upgrade'),
    };
  });

test('iPad (reports as a Mac), landscape 1024x712: picker first; no tap for 5 s -> Manual; every button on screen', { skip, timeout: 300000 }, async () => {
  await withPage({ device: 'ipad', width: 1024, height: 712, until: 'frame' }, async (page) => {
    const boot = await onScreen(page);
    assert.equal(await page.evaluate(() => window.__nsc.app.touchMode), true, 'detected as touch');
    assert.ok(boot.picker && boot.mode === 'picker', 'the control picker comes first');
    assert.equal(boot.controls, '', 'nothing chosen yet');
    await page.waitForTimeout(5600);
    const v = await onScreen(page);
    assert.equal(v.mode, 'play');
    assert.equal(v.controls, 'manual', 'Manual after 5 s without input');
    assert.ok(v.stick && v.up && v.down && v.lock, 'stick + hoist / lower / grab-drop buttons on screen: ' + JSON.stringify(v));
    assert.ok(v.pause && v.mute, 'pause and mute on screen');
    // the choice is remembered: the next visit starts straight in Manual, no picker
    await page.reopen();
    await page.waitForTimeout(500);
    const again = await onScreen(page);
    assert.ok(!again.picker && again.mode === 'play' && again.controls === 'manual' && again.stick, 'remembered: ' + JSON.stringify(again));
    assert.deepEqual(page.errors, []);
  });
});

test('the picker: one tap on One-finger starts play with it; the switch in settings changes and persists it', { skip, timeout: 300000 }, async () => {
  await withPage({ device: 'ipad', width: 1024, height: 712, until: 'frame' }, async (page) => {
    await page.locator('.pickcard.onefinger').tap();
    await page.waitForTimeout(500);
    const v = await onScreen(page);
    assert.ok(v.mode === 'play' && v.controls === 'onefinger', 'one tap picks and plays: ' + JSON.stringify(v));
    assert.ok(v.drop && !v.stick, 'One-finger: the DROP button, no stick (landscape iPad too): ' + JSON.stringify(v));
    // settings: back to Manual
    await page.evaluate(() => window.__nsc.app.pause());
    await page.evaluate(() => [...document.querySelectorAll('#screens .btn')].find((b) => /Settings/.test(b.textContent)).click());
    await page.waitForTimeout(300);
    await page.evaluate(() => [...document.querySelectorAll('.controls-row .seg button')].find((b) => /Manual/.test(b.textContent)).click());
    assert.equal(await page.evaluate(() => window.__nsc.save.data.settings.controls), 'manual');
    await page.reopen();
    await page.waitForTimeout(500);
    const after = await onScreen(page);
    assert.ok(!after.picker && after.controls === 'manual' && after.stick && after.lock, 'the settings choice persists: ' + JSON.stringify(after));
    assert.deepEqual(page.errors, []);
  });
});

for (const [name, opts] of [
  ['iPad portrait 1024x1366', { device: 'ipad', width: 1024, height: 1366 }],
  ['phone portrait 390x844', { device: 'iPhone 13' }],
  ['phone landscape 844x390', { device: 'iPhone 13 landscape' }],
]) {
  test(`${name}: Manual controls all on screen`, { skip, timeout: 300000 }, async () => {
    await withPage({ ...opts, until: 'frame' }, async (page) => {
      await page.waitForTimeout(5600);
      const v = await onScreen(page);
      assert.ok(v.mode === 'play' && v.controls === 'manual', JSON.stringify(v));
      assert.ok(v.stick && v.up && v.down && v.lock && v.pause && v.mute, 'every control on screen: ' + JSON.stringify(v));
      assert.deepEqual(page.errors, []);
    });
  });
}

test('desktop 1366x768: straight into keyboard play, a non-blocking key intro, DROP on screen', { skip, timeout: 300000 }, async () => {
  await withPage({ width: 1366, height: 768 }, async (page) => {
    const v = await onScreen(page);
    assert.equal(await page.evaluate(() => window.__nsc.app.touchMode), false);
    assert.ok(v.mode === 'play' && !v.picker, 'no picker on desktop');
    await page.waitForFunction(() => document.getElementById('keysintro'), null, { timeout: 15000 }).catch(() => {});
    const k = await page.evaluate(() => {
      const el = document.getElementById('keysintro');
      return el ? { text: el.textContent, pe: getComputedStyle(el).pointerEvents } : null;
    });
    assert.ok(k && /MOVE/.test(k.text) && /HOIST/.test(k.text) && /LOWER/.test(k.text) && /DROP/.test(k.text), 'the key intro names move / hoist / lower / drop: ' + JSON.stringify(k));
    assert.ok(/W/.test(k.text) && /A/.test(k.text) && /S/.test(k.text) && /D/.test(k.text) && /←/.test(k.text), 'both arrows and WASD');
    assert.equal(k.pe, 'none', 'it never blocks a click');
    // play goes on underneath: SPACE drops the first box
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__nsc.app.session.stats.placed >= 1, null, { timeout: 60000 });
    const d = await onScreen(page);
    assert.ok(!d.stick, 'no touch controls on desktop');
    assert.deepEqual(page.errors, []);
  });
});

test('portrait phone: the Upgrade button is on screen when something is affordable', { skip, timeout: 300000 }, async () => {
  await withPage({ device: 'iPhone 13', until: 'frame' }, async (page) => {
    await page.waitForTimeout(5600);
    await page.evaluate(() => {
      const N = window.__nsc;
      N.save.data.flags.hud = 3;
      N.app.applyHudStage();
      N.save.data.money = 5000;
      N.app.upgradesChanged();
    });
    await page.waitForTimeout(300);
    const v = await onScreen(page);
    assert.ok(v.upgrade, 'Upgrade visible on a portrait phone: ' + JSON.stringify(v));
  });
});

/** A returning player (all HUD, money for an upgrade) at the end of a ship: the card is up. */
const cardUp = (mode, rig = 'steady') => [
  ([mode, rig]) => localStorage.setItem('night-shift-crane.save.v1', JSON.stringify({ v: 2, money: 5000, flags: { played: true, hud: 3, coach: 4, rookie: 5, keysIntro: true }, settings: { controls: mode }, rigSetup: rig })),
  [mode, rig],
];

const rects = (page) =>
  page.evaluate(() => {
    const R = (sel) => {
      const e = document.querySelector(sel);
      if (!e || e.offsetParent === null) return null;
      const r = e.getBoundingClientRect();
      return [r.left, r.top, r.right, r.bottom];
    };
    const o = { W: innerWidth, H: innerHeight, card: R('.shipcard'), upgrade: R('.hud-tr .upgrade'), tup: R('#touch .tbtn.up'), tlock: R('#touch .tbtn.lock'), stick: R('#touch .stick'), wind: R('.hud-bl') };
    const ov = (a, b) => !!(a && b && Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 4 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 4);
    o.issues = [];
    if (ov(o.card, o.upgrade)) o.issues.push('card covers Upgrade');
    for (const k of ['tup', 'tlock', 'stick']) if (ov(o.upgrade, o[k])) o.issues.push('Upgrade over ' + k);
    if (ov(o.wind, o.stick)) o.issues.push('wind dial under the stick');
    for (const k of ['card', 'upgrade', 'tup', 'tlock', 'stick', 'wind']) if (o[k] && (o[k][0] < -1 || o[k][1] < -1 || o[k][2] > o.W + 1 || o[k][3] > o.H + 1)) o.issues.push(k + ' cut off');
    return o;
  });

for (const [name, opts, mode, ships] of [
  ['portrait phone 390x844, One-finger', { device: 'iPhone 13', width: 390, height: 844 }, 'onefinger', 1],
  ['short landscape phone 750x342, Manual (crane-setup card)', { device: 'iPhone 13 landscape' }, 'manual', 2],
  ['landscape phone 844x390, Manual', { device: 'iPhone 13 landscape', width: 844, height: 390 }, 'manual', 1],
]) {
  test(`${name}: the ship card, Upgrade, buttons and wind dial never cover each other`, { skip, timeout: 300000 }, async () => {
    const o = { ...opts };
    // (explicit sizes override the device's own viewport)
    await withPage({ ...o, init: cardUp(mode, ships > 1 ? '' : 'steady') }, async (page) => {
      if (o.width) await page.setViewportSize({ width: o.width, height: o.height });
      await page.evaluate((ships) => {
        const N = window.__nsc;
        const s = N.app.session;
        N.app.warming = true;
        N.app.upgradesChanged();
        for (let k = 0; k < ships; k++) {
          N.sim(s.time + 0.3);
          if (k < ships - 1) {
            let g = 0;
            while (s.phase !== 'play' && g++ < 400) N.sim(0.1);
          }
        }
      }, ships);
      await page.waitForTimeout(400);
      const r = await rects(page);
      assert.ok(r.card, 'the ship card is up');
      assert.ok(r.upgrade, 'the Upgrade chip is on screen (a returning player with money)');
      assert.deepEqual(r.issues, [], JSON.stringify(r));
    });
  });
}
