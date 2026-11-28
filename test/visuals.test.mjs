// What the crane shows (headless Chromium): the spreader is the box's size, its flaps and lamps match
// its state, the falls end on it, the footprint guide is exactly the box, no birds, and the arrow keys
// get a quick start and stop.
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

test('spreader: flush with a twenty-foot box, flaps down and lamps green only while it holds one, the falls end on its sheaves', { skip, timeout: 300000 }, async () => {
  await freshRun(page, 21);
  await injectDriver(page);
  const r = await page.evaluate(() => {
    const N = window.__nsc;
    const T = N.THREE;
    const s = Q.s();
    const cr = N.app.crane;
    N.app.warming = true;
    Q.hoistTo(6);
    N.sim(1.5);
    const box = new T.Box3().setFromObject(s.rig.carry.mesh);
    const frame = new T.Box3().setFromObject(cr.spreaderMesh);
    const flapsBox = new T.Box3();
    for (const f of cr.flaps) flapsBox.expandByObject(f.g);
    const held = { fold: cr.fold, led: cr.ledState, hint: s.hud().hint, ledMax: Math.max(...cr.leds.map((l) => Math.max(l.material.color.r, l.material.color.g, l.material.color.b))) };
    // the falls end on the spreader's sheaves
    let gap = 0;
    cr.spreader.updateMatrixWorld(true);
    const pts = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) pts.push(new T.Vector3(sx * 0.95, 0.21 + 0.5, sz * 2.5).applyMatrix4(cr.spreader.matrixWorld));
    for (let k = 0; k < 4; k++) {
      const seg = cr.ropeSegs[k * 2 + 1];
      const end = new T.Vector3(0, 1, 0).applyQuaternion(seg.quaternion).multiplyScalar(seg.scale.y).add(seg.position);
      gap = Math.max(gap, Math.min(...pts.map((p) => p.distanceTo(end))));
    }
    // set it down and lift clear: free
    Q.lowerUntil((s) => s.seat && s.seat.seated);
    Q.press('Space');
    N.sim(0.5);
    Q.hoistTo(6);
    N.sim(1);
    const free = { fold: cr.fold, led: cr.ledState, hint: s.hud().hint, carry: !!s.rig.carry };
    return {
      len: [frame.max.z - frame.min.z, box.max.z - box.min.z],
      wid: [frame.max.x - frame.min.x, box.max.x - box.min.x],
      flapsOut: [flapsBox.max.z - flapsBox.min.z, flapsBox.max.x - flapsBox.min.x],
      held,
      free,
      gap,
      rope: { r: cr.ropeSegs[0].geometry.parameters.radiusTop, c: cr.ropeBase.getHex() },
    };
  });
  assert.ok(Math.abs(r.len[0] - r.len[1]) < 0.06, `frame length ${r.len[0].toFixed(2)} m vs box ${r.len[1].toFixed(2)} m`);
  assert.ok(Math.abs(r.wid[0] - r.wid[1]) < 0.06, `frame width ${r.wid[0].toFixed(2)} m vs box ${r.wid[1].toFixed(2)} m`);
  assert.ok(r.flapsOut[0] < r.len[1] + 0.25 && r.flapsOut[1] < r.wid[1] + 0.25, 'the flaps hug the corners (no wide overhang): ' + JSON.stringify(r.flapsOut));
  assert.ok(r.held.fold < 0.05 && r.held.led === 'locked' && r.held.hint !== 'SPREADER EMPTY', 'holding: flaps down, green: ' + JSON.stringify(r.held));
  assert.ok(r.held.ledMax <= 1.2, 'the lamps do not bloom: ' + r.held.ledMax);
  assert.ok(!r.free.carry && r.free.hint === 'SPREADER EMPTY' && r.free.fold > 0.95 && r.free.led === 'idle', 'free: flaps drawn up, not green — matching SPREADER EMPTY: ' + JSON.stringify(r.free));
  assert.ok(r.gap < 0.05, `the falls end on the sheaves (gap ${r.gap.toFixed(3)} m)`);
  assert.ok(r.rope.r >= 0.07 && r.rope.c > 0x707070, 'readable falls: ' + JSON.stringify(r.rope));
  assert.deepEqual(page.errors, []);
});

test('footprint guide: exactly the box’s size under it, one plumb line (no second box drawn)', { skip, timeout: 300000 }, async () => {
  await freshRun(page, 21);
  await injectDriver(page);
  const r = await page.evaluate(() => {
    const N = window.__nsc;
    const s = Q.s();
    N.app.warming = true;
    Q.hoistTo(5);
    N.sim(1);
    const gd = s.guides;
    const xs = gd.corners.map((c) => Math.abs(c.position.x));
    const zs = gd.corners.map((c) => Math.abs(c.position.z));
    return { visible: gd.reticle.visible, xs, zs, beams: gd.beams.filter((b) => b.visible).length };
  });
  assert.ok(r.visible, 'the guide is up');
  for (const x of r.xs) assert.ok(Math.abs(x - 1.2) < 0.02, 'corner x at the box edge: ' + x);
  for (const z of r.zs) assert.ok(Math.abs(z - 3.0) < 0.05, 'corner z at the box end: ' + z);
  assert.equal(r.beams, 1, 'one plumb line');
});

test('no birds; arrow keys: a tap moves the trolley a useful step and it stops promptly', { skip, timeout: 300000 }, async () => {
  await freshRun(page, 5);
  await injectDriver(page);
  const r = await page.evaluate(() => {
    const N = window.__nsc;
    const s = Q.s();
    N.app.warming = true;
    Q.hoistTo(6);
    const run = (sec) => {
      Q.goto(-2, 0, 0.1);
      N.sim(1);
      const x0 = s.rig.x;
      N.input.keys.add('ArrowRight');
      N.sim(sec);
      N.input.keys.clear();
      const x1 = s.rig.x;
      N.sim(2);
      return { during: s.rig.x - x0, brake: s.rig.x - x1 };
    };
    return { gulls: N.app.gulls === undefined, tap: run(0.2), hold: run(1) };
  });
  assert.ok(r.gulls, 'the birds are gone');
  assert.ok(r.tap.during > 0.45, `a 0.2 s tap moves it ${r.tap.during.toFixed(2)} m`);
  assert.ok(r.hold.brake < 2.5, `it stops within ${r.hold.brake.toFixed(2)} m of letting go`);
  assert.deepEqual(page.errors, []);
});
