// Gameplay tests in a real (headless) browser: fixed-step physics and fail-forward. Needs Playwright
// (npm i -D playwright && npx playwright install chromium); skipped with a note when it is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGame, injectDriver, freshRun, findPlaywright } from './helpers/browser.mjs';

const skip = findPlaywright() ? false : 'Playwright not installed (npm i -D playwright && npx playwright install chromium)';
let game = null;
let page = null;

test.before(async () => {
  if (skip) return;
  game = await startGame();
  page = await game.open({ width: 640, height: 360 });
});
test.after(async () => {
  if (game) await game.close();
});

test('fixed step: the same scripted input gives the same landing at 30, 60 and 144 Hz', { skip, timeout: 300000 }, async () => {
  const run = (hz) =>
    page.evaluate(async (hz) => {
      const N = window.__nsc;
      // the page's own frame loop is held: only this script advances the game (no real-time frames
      // slipping in between the run's start and its inputs)
      N.app.warming = true;
      Object.assign(N.save.data.flags, { coach: 4, played: true, hud: 3, rookie: 5 });
      N.app.setMouseMode(false);
      N.app.setTouchMode(false, true);
      if (N.app.session) N.app.session.phase = 'over';
      N.app.weather.wind.x = N.app.weather.wind.z = 0; // (gusts are random: still air for the test)
      await N.app.startEndless(true, true, 4242);
      const s = N.app.session;
      const inp = N.input;
      const dt = 1 / hz;
      const frame = () => N.sim(dt, dt);
      // every phase lasts a whole number of frames at 30, 60 and 144 Hz alike (multiples of 1/6 s),
      // so each rate feeds the fixed 1/60 s physics exactly the same input on exactly the same steps
      const hold = (sec) => {
        const n = Math.round(sec * hz);
        for (let i = 0; i < n; i++) frame();
      };
      const box = s.rig.carry;
      const ship = s.ship;
      // (wind gusts are random and frame-driven weather: the test isolates the crane's own physics)
      s.windScale = 0;
      let cell = null;
      for (let r = ship.rows - 1; r >= 0 && !cell; r--) for (let b = ship.bays - 1; b >= 0 && !cell; b--) if (s._zoneOk(box, r, b) && !s._ruleProblem(box, r, b) && ship.height(r, b) === 0) cell = { r, b };
      const w = ship.localToWorld(ship.cellLocal(cell.r, cell.b, 0));
      inp.keys.add('KeyE');
      hold(1);
      inp.keys.delete('KeyE');
      s.setTarget(w.x, w.z, false);
      hold(5);
      inp.keys.add('KeyQ');
      hold(4); // (lowering past the deck just stops paying out: the box sits down)
      inp.keys.delete('KeyQ');
      hold(1);
      const spr = s.rig.sprPos.toArray();
      const seated = !!(s.seat && s.seat.seated);
      inp.fire('lock');
      frame();
      const at = { state: box.state, cell: box.cell ? [box.cell.r, box.cell.b, box.cell.t] : null, grade: box.grade, seated };
      hold(3);
      const later = { state: box.state, cell: box.cell ? [box.cell.r, box.cell.b, box.cell.t] : null, grade: box.grade, seated };
      N.app.warming = false;
      return { spr, at, later };
    }, hz);
  const r30 = await run(30);
  const r60 = await run(60);
  const r144 = await run(144);
  assert.ok(r60.at.seated, 'the script seats the box before releasing it');
  for (const [hz, r] of [
    [30, r30],
    [144, r144],
  ]) {
    assert.equal(r.at.state, 'locked', `${hz} Hz: the box locks`);
    assert.deepEqual(r.at.cell, r60.at.cell, `${hz} Hz: same cell as 60 Hz`);
    assert.equal(r.at.grade, r60.at.grade, `${hz} Hz: same grade as 60 Hz`);
    const d = Math.hypot(r.spr[0] - r60.spr[0], r.spr[1] - r60.spr[1], r.spr[2] - r60.spr[2]);
    assert.ok(d < 0.001, `${hz} Hz: spreader within 1 mm of 60 Hz at release (${(d * 1000).toFixed(3)} mm)`);
  }
  for (const r of [r30, r60, r144]) assert.deepEqual(r.later, r.at, 'the result does not change after the release');
});

test('fail forward: a wrong bay pays a little (never zero), shows the way, and can be fixed at once', { skip, timeout: 300000 }, async () => {
  await freshRun(page, 777);
  await page.waitForFunction(() => window.__nsc.app.mode === 'play', null, { timeout: 60000 });
  await injectDriver(page);
  const r = await page.evaluate(() => {
    const N = window.__nsc;
    const s = Q.s();
    const ship = s.ship;
    const box = s.rig.carry;
    let wrong = null;
    for (let r = 0; r < ship.rows && !wrong; r++) for (let b = 0; b < ship.bays && !wrong; b++) if (!s._zoneOk(box, r, b) && ship.height(r, b) === 0) wrong = [r, b];
    if (!wrong) return { skip: true };
    const money0 = N.save.data.money;
    const ship0 = s.shipIndex;
    Q.hoistTo(6);
    const c = Q.cellWorld(wrong[0], wrong[1]);
    Q.goto(c[0], c[2], 0.1);
    Q.lowerUntil((s) => s.seat && s.seat.seated);
    N.sim(0.4);
    Q.press('Space');
    N.sim(1.5);
    const out = { misplaced: !!box.misplaced, counted: !!box.counted, paid: N.save.data.money - money0, hint: !!(N.app.coach.fix && N.app.coach.fix.cargo === box), pulse: s.guides.alert > 0, phase: s.phase, sameShip: s.shipIndex === ship0 };
    // retry straight away: lift it back out and set it where it belongs
    const p = box.mesh.getWorldPosition(new N.THREE.Vector3());
    Q.hoistTo(6);
    Q.goto(p.x, p.z, 0.08);
    Q.lowerUntil((s) => s.grab && s.grab.ready);
    Q.press('Space');
    N.sim(0.3);
    let right = null;
    for (let r = 0; r < ship.rows && !right; r++) for (let b = 0; b < ship.bays && !right; b++) if (s._zoneOk(box, r, b) && !s._ruleProblem(box, r, b)) right = [r, b];
    Q.hoistTo(7);
    const c2 = Q.cellWorld(right[0], right[1]);
    Q.goto(c2[0], c2[2], 0.1);
    Q.lowerUntil((s) => s.seat && s.seat.seated);
    N.sim(0.4);
    Q.press('Space');
    N.sim(1);
    out.fixed = !!box.counted && !box.misplaced;
    return out;
  });
  if (r.skip) return;
  assert.ok(r.misplaced && !r.counted, 'the wrong bay is flagged');
  assert.ok(r.paid > 0, `partial pay, not a silent zero (+$${r.paid})`);
  assert.ok(r.hint && r.pulse, 'an arrow shows the way and the right cells pulse');
  assert.ok(r.phase === 'play' && r.sameShip, 'no reset: same ship, still playing');
  assert.ok(r.fixed, 'moved to the right bay it counts');
});

test('fail forward: a box lost overboard is replaced on a later truck', { skip, timeout: 300000 }, async () => {
  await freshRun(page, 31);
  await page.waitForFunction(() => window.__nsc.app.mode === 'play', null, { timeout: 60000 });
  await injectDriver(page);
  const r = await page.evaluate(() => {
    const N = window.__nsc;
    const s = Q.s();
    const box = s.rig.carry;
    const len0 = s.manifest.length;
    Q.hoistTo(5);
    Q.goto(s.ship.origin.x + s.ship.halfBeam + 3.5, 0, 0.3);
    Q.press('Space');
    N.sim(8);
    return { lost: !!box.lost, grew: s.manifest.length - len0, phase: s.phase };
  });
  assert.ok(r.lost, 'the box went into the water');
  assert.equal(r.grew, 1, 'a replacement joins the manifest');
  assert.ok(r.phase === 'play' || r.phase === 'swap', 'the shift carries on');
});

test('mobile: the pre-hooked crate is not penalised while waiting for the first input', { skip, timeout: 300000 }, async () => {
  const m = await game.open({ mobile: true });
  const r = await m.evaluate(async () => {
    await new Promise((ok) => setTimeout(ok, 2500));
    const s = window.__nsc.app.session;
    const d = document.querySelector('.dropbtn').getBoundingClientRect();
    return { rough: s.stats.rough, score: s.score, carry: !!s.rig.carry, toasts: document.getElementById('toasts').textContent, bursts: document.getElementById('bursts').textContent, drop: { bottom: d.bottom, cx: d.left + d.width / 2, W: innerWidth, H: innerHeight } };
  });
  assert.ok(r.drop.bottom > r.drop.H - 140 && Math.abs(r.drop.cx - r.drop.W / 2) < 4, 'the DROP button sits at the bottom centre: ' + JSON.stringify(r.drop));
  assert.equal(r.rough, 0, 'no rough-handling penalty');
  assert.ok(r.score >= 0, 'no points taken');
  assert.ok(!/rough|BONG|CLANG|WHAM|KLONK|CRUNCH/i.test(r.toasts + r.bursts), 'no penalty toast or clang burst: ' + r.toasts + ' / ' + r.bursts);
  assert.ok(r.carry, 'the crate is still waiting on the hook');
  assert.deepEqual(m.errors, []);
});

test('no page errors during the gameplay tests', { skip }, () => {
  assert.deepEqual(page.errors, []);
});
