// Crane feel (headless Chromium): lowering is smooth (no stop-start stutter) but the load still swings;
// COUNTERED only pays for the player's own counter-steering, never for one-finger auto-steer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGame, injectDriver, freshRun, findPlaywright } from './helpers/browser.mjs';

const skip = findPlaywright() ? false : 'Playwright not installed (npm i -D playwright && npx playwright install chromium)';
let game = null;
let page = null;

test.before(async () => {
  if (skip) return;
  game = await startGame();
  page = await game.open({ width: 800, height: 450 });
});
test.after(async () => {
  if (game) await game.close();
});

test('lowering: the load follows the winch smoothly (no stutter), and still swings when the trolley stops', { skip, timeout: 300000 }, async () => {
  await freshRun(page, 5);
  await injectDriver(page);
  const r = await page.evaluate(() => {
    const N = window.__nsc;
    const s = Q.s();
    N.app.warming = true;
    s.windScale = 0;
    s.calm = false;
    Q.hoistTo(5);
    N.sim(2);
    const ys = [];
    N.input.keys.add('KeyQ');
    for (let i = 0; i < 150; i++) {
      N.sim(1 / 60);
      ys.push(s.rig.carry.mesh.getWorldPosition(new N.THREE.Vector3()).y);
    }
    N.input.keys.clear();
    // how much the descent speed wobbles around its own short average (m/s)
    const v = ys.slice(1).map((y, i) => (y - ys[i]) * 60);
    let e = 0;
    let n = 0;
    for (let i = 30; i < v.length - 4; i++) {
      const m = v.slice(i - 4, i + 5).reduce((x, y) => x + y, 0) / 9;
      e += (v[i] - m) ** 2;
      n++;
    }
    const mean = v.slice(30).reduce((x, y) => x + y, 0) / (v.length - 30);
    // sway: run and stop dead
    Q.hoistTo(6);
    N.input.keys.add('KeyD');
    N.sim(1.2);
    N.input.keys.clear();
    let lo = 1e9;
    let hi = -1e9;
    for (let i = 0; i < 90; i++) {
      N.sim(1 / 60);
      const d = s.rig.sprPos.x - s.rig.x;
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
    return { wobble: Math.sqrt(e / n), mean, sway: (hi - lo) / 2 };
  });
  assert.ok(r.wobble < 0.2, `descent speed wobble ${r.wobble.toFixed(3)} m/s (it was ~0.7 with the stop-start fall)`);
  assert.ok(r.mean < -4 && r.mean > -6.5, `still a brisk descent (${r.mean.toFixed(2)} m/s)`);
  assert.ok(r.sway > 1, `the load still swings (${r.sway.toFixed(2)} m)`);
});

test('COUNTERED: one-finger auto-steer under a swinging load pays nothing; only the player’s own steering counts', { skip, timeout: 300000 }, async () => {
  await freshRun(page, 5);
  await injectDriver(page);
  const r = await page.evaluate(() => {
    const N = window.__nsc;
    const s = Q.s();
    N.app.warming = true;
    s.windScale = 0;
    s.calm = false;
    let countered = 0;
    s.on('countered', () => countered++);
    Q.hoistTo(6);
    // by hand first: run, stop dead, then steer towards the load while it is well out and let go
    N.input.keys.add('KeyD');
    N.sim(1.2);
    N.input.keys.clear();
    for (let i = 0; i < 180 && !countered; i++) {
      const ox = s.rig.sprPos.x - s.rig.x;
      N.input.keys.clear();
      if (Math.abs(ox) > 0.35 && i < 90) N.input.keys.add(ox > 0 ? 'KeyD' : 'KeyA');
      N.sim(1 / 30);
    }
    N.input.keys.clear();
    const manual = countered;
    N.sim(8);
    // then three big swings (alternating sides), each chased by the one-finger automation
    for (let k = 0; k < 3; k++) {
      const key = k % 2 ? 'KeyD' : 'KeyA';
      N.input.keys.add(key);
      N.sim(1.2);
      N.input.keys.clear();
      for (let i = 0; i < 240; i++) {
        s.setTarget(s.rig.sprPos.x, s.rig.sprPos.z, true);
        N.sim(1 / 30);
      }
      s.setTarget(null);
      N.sim(8);
    }
    const auto = countered - manual;
    return { auto, manual };
  });
  assert.equal(r.auto, 0, 'auto-steer never counts as countering');
  assert.equal(r.manual, 1, 'the player’s own counter-steer still does');
  assert.deepEqual(page.errors, []);
});
