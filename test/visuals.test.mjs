// What the crane shows (headless Chromium): the spreader is the box's size, its flaps and lamps match
// its state, the falls end on it, the footprint guide is exactly the box, the seabirds fly, glide and
// perch like birds, and the arrow keys get a quick start and stop.
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

test('arrow keys: a tap moves the trolley a useful step and it stops promptly', { skip, timeout: 300000 }, async () => {
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
    return { tap: run(0.2), hold: run(1) };
  });
  assert.ok(r.tap.during > 0.45, `a 0.2 s tap moves it ${r.tap.during.toFixed(2)} m`);
  assert.ok(r.hold.brake < 2.5, `it stops within ${r.hold.brake.toFixed(2)} m of letting go`);
  assert.deepEqual(page.errors, []);
});

test('seabirds: a real body, head and two-part wings that beat and fold; smooth gliding paths; they land and perch', { skip, timeout: 300000 }, async () => {
  await freshRun(page, 5);
  const r = await page.evaluate(() => {
    const N = window.__nsc;
    const T = N.THREE;
    const B = N.app.birds;
    N.app.warming = true;
    N.app.weather.cur.storm = 0;
    N.app.weather.cur.snow = 0;
    const box = (g) => {
      g.computeBoundingBox();
      const s = g.boundingBox.getSize(new T.Vector3());
      return [s.x, s.y, s.z];
    };
    const geo = { body: B.body.geometry.attributes.position.count, bodySize: box(B.body.geometry), wing: box(B.inL.geometry), tip: box(B.outL.geometry) };
    // wing beats: each bird's right inner wing relative to its body, sampled over 6 s
    const q = new T.Quaternion();
    const p = new T.Vector3();
    const sc = new T.Vector3();
    const mb = new T.Matrix4();
    const mw = new T.Matrix4();
    const wingAngle = (k) => {
      B.body.getMatrixAt(k, mb);
      B.inR.getMatrixAt(k, mw);
      const rel = mb.invert().multiply(mw);
      const x = new T.Vector3(1, 0, 0).transformDirection(rel);
      return Math.atan2(x.y, Math.hypot(x.x, x.z));
    };
    const lo = B.birds.map(() => 9);
    const hi = B.birds.map(() => -9);
    let maxStep = 0;
    let maxTurn = 0;
    let prev = null;
    let prevDir = null;
    const b0 = B.birds[0];
    for (let i = 0; i < 360; i++) {
      N.sim(1 / 60);
      B.birds.forEach((b, k) => {
        if (b.mode === 'perched') return;
        const a = wingAngle(k);
        lo[k] = Math.min(lo[k], a);
        hi[k] = Math.max(hi[k], a);
      });
      if (b0.mode !== 'perched') {
        if (prev) {
          const d = b0.pos.clone().sub(prev);
          maxStep = Math.max(maxStep, d.length());
          if (prevDir && d.length() > 1e-3 && prevDir.length() > 1e-3) maxTurn = Math.max(maxTurn, d.clone().normalize().angleTo(prevDir.clone().normalize()));
          prevDir = d;
        }
        prev = b0.pos.clone();
      } else prev = prevDir = null;
    }
    const swing = Math.max(...hi.map((h, k) => h - lo[k]));
    // they land on the lamps and bollards (wings folded) within a couple of minutes
    let perched = null;
    for (let i = 0; i < 240 && !perched; i++) {
      N.sim(0.5);
      const pb = B.birds.find((b) => b.mode === 'perched');
      if (pb) {
        const k = B.birds.indexOf(pb);
        B.body.getMatrixAt(k, mb);
        B.inR.getMatrixAt(k, mw);
        mb.invert().multiply(mw).decompose(p, q, sc);
        perched = { onPerch: B.perches.some((pp) => pp.pos.distanceTo(pb.pos) < 0.05), folded: sc.x < 0.8, t: i * 0.5 };
      }
    }
    return { n: B.birds.length, visible: B.body.visible, geo, swing, maxStep, maxTurn, perched };
  });
  assert.ok(r.n >= 4 && r.visible, 'a few birds about: ' + r.n);
  assert.ok(r.geo.body > 40, 'a shaped body (not a plank): ' + r.geo.body + ' vertices');
  assert.ok(r.geo.bodySize[1] > 0.15 && r.geo.bodySize[2] > 0.6, 'body has depth and length: ' + r.geo.bodySize.map((v) => v.toFixed(2)));
  assert.ok(r.geo.wing[0] > 0.35 && r.geo.tip[0] > 0.25, 'inner wing and wing tip are separate panels');
  assert.ok(r.swing > 0.4, `the wings beat (swing ${r.swing.toFixed(2)} rad)`);
  assert.ok(r.maxStep < 0.6, `smooth flight, no jumps (max ${r.maxStep.toFixed(2)} m per frame)`);
  assert.ok(r.maxTurn < 0.35, `no sudden turns (max ${r.maxTurn.toFixed(2)} rad per frame)`);
  assert.ok(r.perched && r.perched.onPerch && r.perched.folded, 'a bird lands and perches, wings folded: ' + JSON.stringify(r.perched));
  assert.deepEqual(page.errors, []);
});
