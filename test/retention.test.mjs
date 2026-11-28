// Conversion and return (headless Chromium): no choice screen on touch, the job and the DROP cue from
// the first frame, the ship card's one named goal + weekly record, the daily ladder on a return visit,
// and the storm ship (telegraphed, losable, double pay) while ordinary ships stay fail-free.
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

const firstFrame = (page) =>
  page.evaluate(() => {
    const N = window.__nsc;
    N.app.warming = true;
    const seen = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 4 && r.height > 4 && cs.display !== 'none' && cs.visibility !== 'hidden' && r.top >= 0 && r.bottom <= innerHeight;
    };
    const anim = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).animationName : '';
    };
    return {
      mode: N.app.mode,
      picker: !!document.getElementById('picker'),
      controls: N.save.data.settings.controls,
      playing: N.sdk.isPlaying,
      hud: document.body.classList.contains('hud-on'),
      job: (document.getElementById('jobline') || {}).textContent || '',
      jobSeen: seen('#jobline'),
      cue: document.body.classList.contains('firstcue'),
      stick: seen('#touch .stick'),
      lockAnim: anim('#touch .tbtn.lock'),
      drop: seen('.dropbtn'),
      dropAnim: anim('.dropbtn'),
      dropText: (document.querySelector('.dropbtn') || {}).textContent || '',
      placed: N.app.session.stats.placed,
    };
  });

test('phone, first launch: no choice screen; Manual, the HUD and the job line from the first frame; the DROP button pulses', { skip, timeout: 300000 }, async () => {
  await withPage({ device: 'iPhone 13', until: 'frame' }, async (page) => {
    const v = await firstFrame(page);
    assert.ok(v.mode === 'play' && !v.picker, 'playing at once: ' + JSON.stringify(v));
    assert.equal(v.controls, 'manual');
    assert.ok(v.playing && v.hud && v.stick, 'gameplay started (no gameplayStop), HUD and the pad on screen: ' + JSON.stringify(v));
    assert.match(v.job, /LOAD\s4\sBOXES\s·\sSHIP\s1/, 'the job before the first drop');
    assert.ok(v.jobSeen, 'the job line is on screen');
    assert.equal(v.placed, 0, 'and it is there before anything is dropped');
    assert.ok(v.cue && v.lockAnim === 'firstCue', 'the pad’s DROP button pulses from frame one: ' + v.lockAnim);
    // the job line goes once the first box is down
    const after = await page.evaluate(() => {
      const N = window.__nsc;
      N.input.pressed.add('Space');
      N.sim(4);
      return { cue: document.body.classList.contains('firstcue'), job: !!document.querySelector('#jobline:not(.out)') };
    });
    assert.ok(!after.cue && !after.job, 'cue and job line clear after the first drop: ' + JSON.stringify(after));
    assert.deepEqual(page.errors, []);
  });
});

test('desktop, first launch: the job line and a pulsing DROP with its SPACE key from the first frame', { skip, timeout: 300000 }, async () => {
  await withPage({ width: 1280, height: 720 }, async (page) => {
    const v = await firstFrame(page);
    assert.match(v.job, /LOAD\s4\sBOXES\s·\sSHIP\s1/);
    assert.ok(v.drop && v.dropAnim === 'firstCue' && /DROP/.test(v.dropText) && /SPACE/.test(v.dropText), 'DROP + SPACE, pulsing: ' + JSON.stringify(v));
    assert.ok(await page.evaluate(() => window.__nsc.app.cams.introOn), 'all during the opening camera move');
    assert.deepEqual(page.errors, []);
  });
});

test('ship card: one named next goal, and this week’s record', { skip, timeout: 300000 }, async () => {
  await withPage({ width: 1280, height: 720 }, async (page) => {
    await freshRun(page, 99);
    const r = await page.evaluate(() => {
      const N = window.__nsc;
      const s = N.app.session;
      N.app.warming = true;
      N.save.data.week = { key: '', best: 0, ships: 0 };
      N.sim(s.time + 0.5); // (the clock runs out: she sails, the card comes up)
      const card = document.querySelector('.shipcard');
      return {
        goals: card ? card.querySelectorAll('.nextgoal').length : -1,
        goal: card ? card.querySelector('.nextgoal').textContent : '',
        week: card && card.querySelector('.weekrec') ? card.querySelector('.weekrec').textContent : '',
      };
    });
    assert.equal(r.goals, 1, 'exactly one goal');
    assert.match(r.goal, /in \d+ ships?|unlock it now|opens at \d+ boxes \(\d+\/\d+\)/, 'a specific, named goal: ' + r.goal);
    assert.match(r.week, /WEEK (BEST|RECORD)/, 'the weekly record is on the card: ' + r.week);
    assert.deepEqual(page.errors, []);
  });
});

/** A returning player whose last visit was yesterday (day `streak` of the ladder). */
const returning = (streak) => [
  ([streak]) => {
    const p = (n) => String(n).padStart(2, '0');
    const y = new Date(Date.now() - 864e5);
    const key = `${y.getFullYear()}-${p(y.getMonth() + 1)}-${p(y.getDate())}`;
    localStorage.setItem(
      'night-shift-crane.save.v1',
      JSON.stringify({ v: 2, money: 40, flags: { played: true, hud: 3, coach: 4, rookie: 5, keysIntro: true }, stats: { placed: 30 }, login: { last: key, streak, best: streak }, install: key })
    );
  },
  [streak],
];

test('daily ladder: coming back on day 2 unlocks (and paints on) Dawn Orange, no cash; day 3 the LED lamp', { skip, timeout: 300000 }, async () => {
  await withPage({ width: 1280, height: 720, init: returning(1) }, async (page) => {
    await page.waitForFunction(() => document.querySelector('#strip .strip'), null, { timeout: 15000 });
    const r = await page.evaluate(() => {
      const N = window.__nsc;
      return {
        strip: document.querySelector('#strip').textContent,
        unlocked: !!N.save.data.unlocks.paint_dawn,
        paint: N.save.data.paint,
        crane: N.app.crane.paintId,
        money: N.save.data.money,
        streak: N.save.data.login.streak,
      };
    });
    assert.equal(r.streak, 2);
    assert.match(r.strip, /DAY 2/);
    assert.match(r.strip, /UNLOCKED · Dawn Orange paint/);
    assert.ok(r.unlocked && r.paint === 'dawn' && r.crane === 'dawn', 'on the crane at once: ' + JSON.stringify(r));
    assert.equal(r.money, 40, 'no cash from the ladder');
    assert.deepEqual(page.errors, []);
  });
  await withPage({ width: 1280, height: 720, init: returning(2) }, async (page) => {
    await page.waitForFunction(() => document.querySelector('#strip .strip'), null, { timeout: 15000 });
    const r = await page.evaluate(() => ({ strip: document.querySelector('#strip').textContent, lamp: window.__nsc.save.data.lamp, color: window.__nsc.app.crane.workLight.color.getHex() }));
    assert.match(r.strip, /UNLOCKED · LED floodlight/);
    assert.equal(r.lamp, 'led');
    assert.equal(r.color, 0xe8f2ff, 'the lamp changes colour');
    assert.deepEqual(page.errors, []);
  });
});

test('storm ship: announced a ship ahead; two boxes overboard and she sails without the bonus; full she pays double + jackpot; ordinary ships stay fail-free', { skip, timeout: 300000 }, async () => {
  await withPage({ width: 1280, height: 720 }, async (page) => {
    await freshRun(page, 31);
    await injectDriver(page);
    const r = await page.evaluate(() => {
      const N = window.__nsc;
      const s = Q.s();
      N.app.warming = true;
      const out = {};
      const dones = [];
      s.on('shipDone', (e) => dones.push(e));
      // the announcement while the ship before her is worked
      s.emit('prebuilt', { def: N.endlessShip(4, s.seed) });
      out.toast = document.getElementById('toasts').textContent;
      // throw the carried box (and the next one) into the sea
      const overboard = () => {
        let g = 0;
        while (!s.rig.carry && g++ < 300) {
          const tr = s.lanes[0].truck;
          if (tr && tr.parked && tr.cargo) {
            const p = tr.cargo.mesh.getWorldPosition(new N.THREE.Vector3());
            Q.hoistTo(7);
            Q.goto(p.x, p.z, 0.08);
            Q.lowerUntil((s) => s.grab && s.grab.ready);
            Q.press('Space');
            N.sim(0.3);
          } else N.sim(0.2);
        }
        Q.hoistTo(5);
        Q.goto(s.ship.origin.x + s.ship.halfBeam + 3.5, 0, 0.3);
        Q.press('Space');
        N.sim(6);
      };
      // an ordinary ship: two boxes lost, still the same ship, still playing
      const ship0 = s.shipIndex;
      overboard();
      overboard();
      out.normal = { lost: s.stats.lost, phase: s.phase, same: s.shipIndex === ship0, dones: dones.length };
      // now she is the storm ship
      s.level = { ...s.level, storm: true };
      s.stormLosses = 0;
      overboard();
      out.afterOne = s.phase;
      overboard();
      N.sim(1);
      out.lost = {
        phase: s.phase,
        storm: dones.length ? dones[dones.length - 1].storm : null,
        bonus: dones.length ? dones[dones.length - 1].bonus : -1,
        banner: document.getElementById('bursts').textContent,
      };
      return out;
    });
    assert.match(r.toast, /Storm ship next/, 'telegraphed a ship ahead');
    assert.ok(r.normal.lost >= 2 && r.normal.same && r.normal.phase === 'play' && r.normal.dones === 0, 'an ordinary ship cannot be lost: ' + JSON.stringify(r.normal));
    assert.equal(r.afterOne, 'play', 'one loss: a warning, she waits');
    assert.equal(r.lost.phase, 'swap', 'the second: she sails');
    assert.ok(r.lost.storm && r.lost.storm.lost && r.lost.storm.why === 'losses' && r.lost.bonus === 0, 'lost, no bonus: ' + JSON.stringify(r.lost));
    assert.match(r.lost.banner, /SHE SAILED WITHOUT YOU/);
    assert.deepEqual(page.errors, []);
  });
  // full: double and the jackpot
  await withPage({ width: 1280, height: 720 }, async (page) => {
    await freshRun(page, 7);
    const r = await page.evaluate(() => {
      const N = window.__nsc;
      const s = N.app.session;
      N.app.warming = true;
      let e = null;
      s.on('shipDone', (x) => (e = x));
      const quota = s.manifest.filter((m) => !m.black).length;
      const run = (storm) => {
        s.level = { ...s.level, storm };
        s.delivered = s.shipBase + quota;
        s.time = 20;
        s._beginSwap();
        const out = { bonus: e.bonus, storm: e.storm };
        let g = 0;
        while (s.phase !== 'play' && g++ < 600) N.sim(0.1);
        return out;
      };
      const plain = run(false);
      const storm = run(true);
      return { plain, storm, banner: document.getElementById('bursts').textContent };
    });
    assert.ok(r.storm.storm && r.storm.storm.won && r.storm.storm.jackpot > 0, JSON.stringify(r.storm));
    assert.ok(r.storm.bonus >= r.plain.bonus * 2 + r.storm.storm.jackpot - 200, `double + jackpot (${r.plain.bonus} → ${r.storm.bonus})`);
    assert.match(r.banner, /STORM SHIP LOADED/);
    assert.deepEqual(page.errors, []);
  });
});
