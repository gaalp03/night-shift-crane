// The hot box (headless Chromium): set down in the right bay it pays a bonus with no extra input; the
// daily challenge's score includes it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGame, injectDriver, freshRun, findPlaywright } from './helpers/browser.mjs';

const skip = findPlaywright() ? false : 'Playwright not installed (npm i -D playwright && npx playwright install chromium)';
let game = null;
let page = null;

test.before(async () => {
  if (skip) return;
  game = await startGame();
  page = await game.open({ width: 1280, height: 720 });
});
test.after(async () => {
  if (game) await game.close();
});

test('hot box: the flashing box set down in its bay pays HOT BOX (+score, +money) — just by placing it', { skip, timeout: 300000 }, async () => {
  await freshRun(page, 21);
  await injectDriver(page);
  const r = await page.evaluate(() => {
    const N = window.__nsc;
    const s = Q.s();
    N.app.warming = true;
    const ev = [];
    s.on('hotBox', (e) => ev.push(e.pts));
    const hotIdx = s.manifest.findIndex((m) => m.hot);
    // place boxes until the hot one is down (snap assist on ship 1: lower over the slot)
    Q.press('Space');
    N.sim(1.5);
    let beacon = false;
    for (let k = 0; k < 4 && !ev.length; k++) {
      let g = 0;
      while (!(s.lanes[0].truck && s.lanes[0].truck.parked && s.lanes[0].truck.cargo) && g++ < 300) N.sim(0.1);
      const c = s.lanes[0].truck.cargo;
      if (c.hot) beacon = !!c.hotMat;
      const p = c.mesh.getWorldPosition(new N.THREE.Vector3());
      Q.hoistTo(7);
      Q.goto(p.x, p.z, 0.08);
      Q.lowerUntil((s) => s.grab && s.grab.ready);
      Q.press('Space');
      N.sim(0.3);
      Q.hoistTo(5);
      N.sim(0.5);
      const slot = s.guideSlot.clone();
      Q.goto(slot.x, slot.z, 0.12);
      for (let t = 0; t < 12 && s.rig.carry; t += 1 / 30) {
        N.input.keys.clear();
        N.input.keys.add('KeyQ');
        N.sim(1 / 30);
      }
      N.input.keys.clear();
      if (s.rig.carry) {
        Q.press('Space');
        N.sim(0.5);
      }
      N.sim(0.5);
    }
    return { hotIdx, ev, beacon, hot: s.stats.hot || 0, burst: document.getElementById('bursts').textContent };
  });
  assert.ok(r.hotIdx > 0, 'ship 1 has a hot box');
  assert.ok(r.beacon, 'it carries the beacon');
  assert.equal(r.ev.length, 1, 'HOT BOX paid once: ' + JSON.stringify(r));
  assert.ok(r.ev[0] >= 250, `+${r.ev[0]}`);
  assert.equal(r.hot, 1);
  assert.match(r.burst, /HOT BOX/);
  assert.deepEqual(page.errors, []);
});

test('daily challenge: the hot box’s bonus is part of the scored result', { skip, timeout: 300000 }, async () => {
  const r = await page.evaluate(async () => {
    const N = window.__nsc;
    const app = N.app;
    if (app.session) app.session.phase = 'over';
    await app.startDaily();
    const s = app.session;
    app.warming = true;
    const spec = s.level.manifest.find((m) => m.hot);
    const plain = s.level.manifest.find((m) => !m.hot && !m.check && !m.black);
    // the same placement, once with an ordinary box and once with the hot one
    const award = (sp) => {
      const c = s._newCargo(sp);
      const before = s.score;
      s.combo = 0;
      s._award(c, 'great', { pos: new N.THREE.Vector3() });
      return s.score - before;
    };
    return { daily: !!s.level.daily, hasHot: !!spec, plain: award(plain), hot: award(spec) };
  });
  assert.ok(r.daily && r.hasHot, 'today’s ship has its hot box');
  assert.ok(r.hot - r.plain >= 250, `the hot box adds its bonus to the daily score (${r.plain} vs ${r.hot})`);
  assert.deepEqual(page.errors, []);
});
