// The first minute and the mobile budget: the opening shot, the guaranteed first PERFECT, the quick
// first truck, the touch anti-sway, and the automatic quality stepping down on a struggling phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGame, injectDriver, findPlaywright } from './helpers/browser.mjs';

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

test('first load, desktop: the opening close-up pulls back while play is live; one press = a big PERFECT; the first truck is in within seconds', { skip, timeout: 300000 }, async () => {
  await withPage({ width: 1280, height: 720 }, async (page) => {
    const r = await page.evaluate(() => {
      const N = window.__nsc;
      const app = N.app;
      app.warming = true; // (game time from here on: lockstep)
      const s = app.session;
      const cam = () => app.camera.position.distanceTo(s.rig.sprPos);
      const out = { introOn: app.cams.introOn, near: cam() };
      let t = 0;
      const ev = [];
      s.on('burst', (e) => ev.push({ t, text: e.text, big: !!e.big }));
      s.on('firstPerfect', () => ev.push({ t, first: true }));
      N.sim(0.3);
      t = 0.3;
      out.midIntro = app.cams.introOn;
      // the player does not wait for the camera: the first press already counts
      N.input.pressed.add('Space');
      N.sim(1 / 60);
      let parked = null;
      while (t < 8) {
        N.sim(0.1);
        t += 0.1;
        const tr = s.lanes[0].truck;
        if (parked == null && tr && tr.parked && tr.cargo) parked = t;
      }
      out.far = cam();
      out.introAfter = app.cams.introOn;
      out.mode = app.cams.mode;
      out.exposure = N.gfx.renderer.toneMappingExposure === N.gfx.exposure;
      out.workLight = app.crane.workLight.intensity > 1;
      out.ev = ev;
      out.perfect = s.stats.perfect;
      out.parked = parked;
      out.phase = s.phase;
      out.banner = document.body.textContent.includes('First box');
      return out;
    });
    assert.ok(r.introOn, 'the opening move is running on the first frames');
    assert.ok(r.near < 20, `it starts close to the hook (${r.near.toFixed(1)} m)`);
    assert.ok(r.midIntro, 'still moving at 0.3 s');
    assert.ok(!r.introAfter && r.mode === 'chase' && r.far > 28, `it ends in the chase view (${r.far.toFixed(1)} m)`);
    assert.ok(r.exposure && r.workLight, 'lights fully up afterwards');
    assert.equal(r.perfect, 1, 'the first box is a PERFECT');
    const big = r.ev.find((e) => e.text === 'PERFECT!' && e.big);
    assert.ok(big && big.t < 1, 'a big PERFECT burst within a second of play: ' + JSON.stringify(r.ev));
    assert.ok(
      r.ev.some((e) => e.first),
      'the first-box moment fires'
    );
    assert.ok(r.parked != null && r.parked < 6, `the first truck parks within 6 s (${r.parked})`);
    assert.equal(r.phase, 'play');
    assert.deepEqual(page.errors, []);
  });
});

test('first load, phone: no choice screen, and the first box is a PERFECT', { skip, timeout: 300000 }, async () => {
  await withPage({ device: 'Pixel 5', until: 'frame' }, async (page) => {
    await page.waitForFunction(() => window.__nsc.app.mode === 'play', null, { timeout: 30000 });
    const r = await page.evaluate(() => {
      const N = window.__nsc;
      N.app.warming = true;
      N.sim(1);
      N.input.pressed.add('Space');
      N.sim(1.5);
      return { perfect: N.app.session.stats.perfect, rough: N.app.session.stats.rough, lens: N.app.camera.view && N.app.camera.view.enabled ? N.app.camera.view.offsetY : 0 };
    });
    assert.equal(r.perfect, 1);
    assert.equal(r.rough, 0);
    assert.ok(r.lens > 0.05, 'portrait phone: the picture is lifted above the thumbs (lens shift ' + r.lens + ')');
    assert.deepEqual(page.errors, []);
  });
});

test('touch: the anti-sway settles a swinging load clearly faster', { skip, timeout: 300000 }, async () => {
  await withPage({ device: 'Pixel 5 landscape', until: 'frame' }, async (page) => {
    await page.waitForFunction(() => window.__nsc.app.mode === 'play', null, { timeout: 30000 });
    await injectDriver(page);
    const r = await page.evaluate(() => {
      const N = window.__nsc;
      const s = Q.s();
      N.app.warming = true;
      s.windScale = 0; // (gusts are random: still air, the crane's own swing only)
      Q.hoistTo(5);
      const x0 = s.rig.x;
      const z0 = s.rig.z;
      // full stick for a second, let go, and measure how far the load still swings behind the trolley
      const run = (steady) => {
        N.save.data.settings.touchSteady = steady;
        Q.goto(x0 - 3, z0, 0.1);
        N.sim(3);
        N.input.keys.add('KeyD');
        N.sim(1.1);
        Q.clear();
        N.sim(0.6);
        // swing left after letting go: peak to peak of the load behind the trolley, over 1.5 s
        let lo = 1e9;
        let hi = -1e9;
        for (let i = 0; i < 90; i++) {
          N.sim(1 / 60);
          const d = s.rig.sprPos.x - s.rig.x;
          lo = Math.min(lo, d);
          hi = Math.max(hi, d);
        }
        return { amp: (hi - lo) / 2, assist: s.touchAssist };
      };
      const on = run(true);
      const off = run(false);
      N.save.data.settings.touchSteady = true;
      return { on, off };
    });
    assert.ok(r.on.assist && !r.off.assist, 'the assist follows the setting on a touch device');
    assert.ok(r.off.amp > r.on.amp * 1.3, `residual swing with the assist ${r.on.amp.toFixed(3)} m vs without ${r.off.amp.toFixed(3)} m`);
    assert.deepEqual(page.errors, []);
  });
});

test('automatic quality: a phone that cannot hold the frame rate drops resolution, shadows and effects fast; the FPS counter shows it', { skip, timeout: 300000 }, async () => {
  await withPage({ device: 'Pixel 5', until: 'frame' }, async (page) => {
    await page.waitForFunction(() => window.__nsc.app.mode === 'play', null, { timeout: 30000 });
    const r = await page.evaluate(() => {
      const N = window.__nsc;
      const g = N.gfx;
      // a capable-looking phone on the automatic setting: starts at medium with shadows
      g.lowEnd = false;
      g.applyQuality('auto', 0);
      const start = g.stats();
      // 20 fps frames, fed straight to the meter (two judging windows' worth, then plenty more)
      let windows = 0;
      let afterTwo = null;
      for (let i = 0; i < 2000 && g._adaptLevel < 6; i++) {
        const lvl = g._adaptLevel;
        g._adapt(0.05);
        if (g._adaptLevel !== lvl && ++windows === 2) afterTwo = g._adaptLevel;
      }
      const end = g.stats();
      N.save.data.settings.showFps = true;
      N.app.applySettings();
      return { start, end, afterTwo, fx: N.app.fx.budget, saved: N.save.data.settings.autoLevel, dpr: devicePixelRatio };
    });
    assert.ok(r.start.shadows && r.start.pixelRatio >= 1.35, 'starts sharp with shadows: ' + JSON.stringify(r.start));
    assert.ok(r.afterTwo >= 4, `two slow windows are enough for four steps (${r.afterTwo})`);
    assert.equal(r.end.level, 6);
    assert.ok(r.end.pixelRatio < 1.1, 'resolution goes below the old 1.35 floor: ' + JSON.stringify(r.end));
    assert.equal(r.end.shadows, false, 'shadows off');
    assert.ok(r.end.particles < 1 && r.end.rain < 1, 'fewer particles and rain drops');
    assert.equal(r.fx, r.end.particles, 'the particle system follows');
    assert.equal(r.saved, 6, 'remembered for the next visit');
    await page.waitForFunction(() => /FPS/.test((document.getElementById('fpsmeter') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    const meter = await page.evaluate(() => (document.getElementById('fpsmeter') || {}).textContent || '');
    assert.match(meter, /\d+ FPS · MEDIUM L6 · 0\.\d+x · no shadows/, 'the counter: ' + meter);
    assert.deepEqual(page.errors, []);
  });
});
