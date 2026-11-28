// The snap assist on the first ship(s), the LOWER hint when the hook hovers, and the sway feedback
// (rope colour, STEADY) — headless Chromium.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGame, injectDriver, freshRun, findPlaywright } from './helpers/browser.mjs';

const skip = findPlaywright() ? false : 'Playwright not installed (npm i -D playwright && npx playwright install chromium)';
let game = null;

test.before(async () => {
  if (!skip) game = await startGame();
});
test.after(async () => {
  if (game) await game.close();
});

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

/** Drop the hanging first box, then fetch the next one from the truck and lift it. */
const fetchSecond = () => {
  const N = window.__nsc;
  const s = Q.s();
  N.app.warming = true;
  Q.press('Space');
  N.sim(1.5);
  let g = 0;
  while (!(s.lanes[0].truck && s.lanes[0].truck.parked && s.lanes[0].truck.cargo) && g++ < 200) N.sim(0.1);
  const p = s.lanes[0].truck.cargo.mesh.getWorldPosition(new N.THREE.Vector3());
  Q.hoistTo(7);
  Q.goto(p.x, p.z, 0.08);
  Q.lowerUntil((s) => s.grab && s.grab.ready);
  Q.press('Space');
  N.sim(0.3);
  Q.hoistTo(5);
  N.sim(0.5);
};

test(
  'snap assist: on the first ship a box lowered within ~1.6 m of its slot slides over, sits down and locks itself — PERFECT, with a clunk; full on ship 1, half on ship 2, off from ship 3',
  { skip, timeout: 300000 },
  async () => {
    await withPage({ width: 1280, height: 720 }, async (page) => {
      await freshRun(page, 21);
      await injectDriver(page);
      const r = await page.evaluate((fetch) => {
        const N = window.__nsc;
        const s = Q.s();
        new Function('return (' + fetch + ')')()();
        const ev = [];
        s.on('snapLock', () => ev.push('snap'));
        s.on('placed', (e) => ev.push(e.grade));
        const slot = s.guideSlot.clone();
        Q.goto(slot.x - 1.2, slot.z + 1.0, 0.15);
        // the player only holds LOWER
        let t = 0;
        while (t < 15 && s.rig.carry) {
          N.input.keys.clear();
          N.input.keys.add('KeyQ');
          N.sim(1 / 30);
          t += 1 / 30;
        }
        N.input.keys.clear();
        N.sim(0.6);
        const k = [];
        for (const i of [0, 1, 2]) {
          const keep = s.shipIndex;
          s.shipIndex = i;
          k.push(s.snapK());
          s.shipIndex = keep;
        }
        return { ev, secs: t, k, burst: document.getElementById('bursts').textContent };
      }, fetchSecond.toString());
      assert.deepEqual(r.ev.slice().sort(), ['perfect', 'snap'], 'snapped in and locked PERFECT: ' + JSON.stringify(r));
      assert.ok(r.secs < 9, `holding LOWER is enough (${r.secs.toFixed(1)} s)`);
      assert.match(r.burst, /PERFECT/);
      assert.deepEqual(r.k, [1, 0.5, 0], 'tapers off over ships 1-2');
      assert.deepEqual(page.errors, []);
    });
  }
);

test('snap assist: off on ship 3 — the same lowering just lands where it is', { skip, timeout: 300000 }, async () => {
  await withPage({ width: 1280, height: 720 }, async (page) => {
    await freshRun(page, 21);
    await injectDriver(page);
    const r = await page.evaluate((fetch) => {
      const N = window.__nsc;
      const s = Q.s();
      new Function('return (' + fetch + ')')()();
      s.shipIndex = 2; // (as if on the third ship)
      const ev = [];
      s.on('snapStart', () => ev.push('snap'));
      const slot = s.guideSlot.clone();
      Q.goto(slot.x - 1.2, slot.z + 1.0, 0.15);
      for (let t = 0; t < 4; t += 1 / 30) {
        N.input.keys.clear();
        N.input.keys.add('KeyQ');
        N.sim(1 / 30);
      }
      N.input.keys.clear();
      return { ev, k: s.snapK() };
    }, fetchSecond.toString());
    assert.equal(r.k, 0);
    assert.deepEqual(r.ev, [], 'no snap from ship 3');
    assert.deepEqual(page.errors, []);
  });
});

test('LOWER hint: hovering over the box on the truck for 4 s says LOWER with the arrow; at most once per 15 s; lowering clears it', { skip, timeout: 300000 }, async () => {
  await withPage({ width: 1280, height: 720 }, async (page) => {
    await freshRun(page, 21);
    await injectDriver(page);
    const r = await page.evaluate(() => {
      const N = window.__nsc;
      const s = Q.s();
      const coach = () => document.getElementById('coach').textContent;
      N.app.warming = true;
      Q.press('Space');
      N.sim(1.5);
      let g = 0;
      while (!(s.lanes[0].truck && s.lanes[0].truck.parked && s.lanes[0].truck.cargo) && g++ < 200) N.sim(0.1);
      const p = s.lanes[0].truck.cargo.mesh.getWorldPosition(new N.THREE.Vector3());
      Q.hoistTo(6);
      Q.goto(p.x, p.z, 0.08);
      const c = N.app.coach;
      const shown0 = c.lowerShown || 0;
      N.sim(2);
      const at3 = coach();
      N.sim(3);
      const at45 = coach();
      const arrow = !!document.querySelector('.garrow.on');
      N.sim(4);
      const gone = coach();
      N.sim(5); // (still hovering, but within 15 s of the last one)
      const again = (c.lowerShown || 0) - shown0;
      N.sim(6); // past 15 s: it may come back once
      const later = (c.lowerShown || 0) - shown0;
      // lowering clears it at once
      N.input.keys.add('KeyQ');
      N.sim(0.3);
      N.input.keys.clear();
      return { at3, at45, arrow, gone, again, later, afterLower: coach() };
    });
    assert.ok(!/LOWER/.test(r.at3), 'not at 2 s: ' + r.at3);
    assert.match(r.at45, /LOWER/, 'by 5 s');
    assert.ok(r.arrow, 'with the arrow on the target');
    assert.ok(!/LOWER/.test(r.gone), 'it goes after a few seconds');
    assert.equal(r.again, 1, 'not again within 15 s');
    assert.equal(r.later, 2, 'at most once more after 15 s');
    assert.ok(!/LOWER/.test(r.afterLower), 'lowering clears it');
    assert.deepEqual(page.errors, []);
  });
});

test('sway feedback: the falls go red while the load swings and flash green with STEADY when it is damped', { skip, timeout: 300000 }, async () => {
  await withPage({ width: 1280, height: 720 }, async (page) => {
    await freshRun(page, 5);
    await injectDriver(page);
    const r = await page.evaluate(() => {
      const N = window.__nsc;
      const s = Q.s();
      N.app.warming = true;
      s.windScale = 0;
      s.calm = false;
      const ev = [];
      s.on('steady', () => ev.push('steady'));
      Q.hoistTo(6);
      N.input.keys.add('KeyD');
      N.sim(1.2);
      N.input.keys.clear();
      // (the reddest the falls get during the swing: the load passes through the middle twice a period)
      let c1 = N.app.crane.ropeMat.color.clone();
      for (let i = 0; i < 30; i++) {
        N.sim(1 / 30);
        const c = N.app.crane.ropeMat.color;
        if (c.r - c.g > c1.r - c1.g) c1 = c.clone();
      }
      let c2 = null;
      for (let i = 0; i < 400 && !c2; i++) {
        N.sim(1 / 30);
        if (ev.length) {
          N.sim(0.1);
          c2 = N.app.crane.ropeMat.color.clone();
        }
      }
      return { swingRed: c1.r > c1.g * 1.25, ev, steadyGreen: !!c2 && c2.g > c2.r * 1.2, burst: document.getElementById('bursts').textContent };
    });
    assert.ok(r.swingRed, 'red while it swings');
    assert.ok(r.ev.includes('steady'), 'STEADY when it is damped');
    assert.ok(r.steadyGreen, 'the falls flash green');
    assert.match(r.burst, /STEADY/);
    assert.deepEqual(page.errors, []);
  });
});
