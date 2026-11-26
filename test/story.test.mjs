// The story-first opening, countering a swing, and the 06:00 end of a night shift (headless Chromium).
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

test(
  'opening: the unlisted box on the hook, Harbour Control on the radio, a held close shot, PERFECT, the UNLISTED stamp, "…noted.", then the gust on the second box',
  { skip, timeout: 300000 },
  async () => {
    await withPage({ width: 1280, height: 720 }, async (page) => {
      await injectDriver(page);
      const r = await page.evaluate(() => {
        const N = window.__nsc;
        const app = N.app;
        app.warming = true;
        const s = app.session;
        const radio = () => (document.getElementById('radio') || {}).textContent || '';
        const dist = () => app.camera.position.distanceTo(s.rig.sprPos);
        const out = { look: s.rig.carry && s.rig.carry.look, cue: document.body.classList.contains('firstcue'), drop: !!document.querySelector('.dropbtn:not(.hidden)') };
        N.sim(2);
        out.radio = radio();
        out.close2 = dist();
        N.sim(4.5);
        out.far6 = dist();
        N.input.pressed.add('Space');
        N.sim(1 / 60);
        N.sim(2);
        out.perfect = s.stats.perfect;
        out.card = (document.getElementById('manifestcard') || {}).textContent || '';
        N.sim(1.5);
        out.noted = radio();
        // the second box: fetch it and lift it; the gust comes, the coach says COUNTER with the ghost hand
        const ev = [];
        s.on('gustWarn', () => ev.push('warn'));
        s.on('scriptedGust', () => ev.push('gust'));
        let g = 0;
        while (!(s.lanes[0].truck && s.lanes[0].truck.parked && s.lanes[0].truck.cargo) && g++ < 200) N.sim(0.1);
        const p = s.lanes[0].truck.cargo.mesh.getWorldPosition(new N.THREE.Vector3());
        Q.hoistTo(7);
        Q.goto(p.x, p.z, 0.08);
        Q.lowerUntil((s) => s.grab && s.grab.ready);
        Q.press('Space');
        N.sim(0.3);
        Q.hoistTo(6);
        let peak = 0;
        for (let i = 0; i < 90; i++) {
          N.sim(1 / 30);
          peak = Math.max(peak, Math.hypot(s.rig.sprPos.x - s.rig.x, s.rig.sprPos.z - s.rig.z));
        }
        out.ev = ev;
        out.peak = peak;
        out.coach = document.getElementById('coach').textContent;
        out.hand = document.querySelector('.ghand.on.drag, .ghand.drag.on') ? true : !!document.querySelector('[class*="hand"].on.drag');
        return out;
      });
      assert.equal(r.look, 'unmarked', 'a scuffed, unmarked box on the hook');
      assert.ok(r.cue && r.drop, 'the DROP prompt from the first frame');
      assert.match(r.radio, /Harbour Control\. That one’s not on the manifest\. Set it down soft\./);
      assert.ok(r.close2 < 20, `the close shot holds for the first seconds (${r.close2.toFixed(1)} m at 2 s)`);
      assert.ok(r.far6 > 28, `then it pulls back to the ship (${r.far6.toFixed(1)} m at 6.5 s)`);
      assert.equal(r.perfect, 1, 'the first PERFECT stays');
      assert.match(r.card, /UNLISTED/, 'the stamp on the manifest card');
      assert.match(r.noted, /…noted\./);
      assert.deepEqual(r.ev, ['warn', 'gust'], 'the gust is telegraphed, then hits');
      assert.ok(r.peak > 0.85, `it swings the load out (${r.peak.toFixed(2)} m)`);
      assert.match(r.coach, /COUNTER/, 'the coach shows the counter-swing');
      assert.ok(r.hand, 'with the ghost hand');
      assert.deepEqual(page.errors, []);
    });
  }
);

test('countering a swing pays COUNTERED +$40 — only once the load hangs quiet, not when it swings through the middle', { skip, timeout: 300000 }, async () => {
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
      s.on('countered', (e) => ev.push(e.pts));
      Q.hoistTo(6);
      const money0 = N.save.data.money;
      // a hard swing (run the trolley, stop dead), then counter: steer towards the load while it is
      // well out, and let go
      N.input.keys.add('KeyD');
      N.sim(1.2);
      N.input.keys.clear();
      for (let i = 0; i < 180 && !ev.length; i++) {
        const ox = s.rig.sprPos.x - s.rig.x;
        N.input.keys.clear();
        if (Math.abs(ox) > 0.35 && i < 90) N.input.keys.add(ox > 0 ? 'KeyD' : 'KeyA');
        N.sim(1 / 30);
      }
      N.input.keys.clear();
      const paid = N.save.data.money - money0;
      N.sim(0.4);
      const burst = document.getElementById('bursts').textContent;
      // the same swing left alone (it dies away by itself) pays nothing
      N.sim(8);
      N.input.keys.add('KeyA');
      N.sim(1.2);
      N.input.keys.clear();
      N.sim(9);
      const idle = ev.length - 1;
      return { idle, ev: ev.slice(0, 1), paid, burst };
    });
    assert.equal(r.idle, 0, 'a swing left alone pays nothing');
    assert.deepEqual(r.ev, [40], 'countered once');
    assert.ok(r.paid >= 40, `+$40 (${r.paid})`);
    assert.match(r.burst, /COUNTERED/);
    assert.deepEqual(page.errors, []);
  });
});

test('06:00: after eight ships dawn comes up and the shift report has the night’s numbers, one goal, one teaser and the 7-day ladder; one tap starts night 2', { skip, timeout: 300000 }, async () => {
  await withPage({ width: 1280, height: 720 }, async (page) => {
    await freshRun(page, 11);
    const r = await page.evaluate(() => {
      const N = window.__nsc;
      const s = N.app.session;
      N.app.warming = true;
      const heads = [];
      let teaser = '';
      for (let k = 0; k < 8; k++) {
        N.sim(s.time + 0.5);
        const c = document.querySelector('#shipcard .shipcard');
        heads.push(c ? c.querySelector('.t1').textContent : '-');
        if (k === 0 && c && c.querySelector('.teaser')) teaser = c.querySelector('.teaser').textContent;
        if (k < 7) {
          let g = 0;
          while (s.phase !== 'play' && g++ < 400) N.sim(0.1);
        }
      }
      N.sim(3);
      const card = document.querySelector('.shiftcard');
      const out = {
        heads,
        teaser,
        card: card ? card.textContent : '',
        goals: card ? card.querySelectorAll('.nextgoal').length : 0,
        teasers: card ? card.querySelectorAll('.teaser').length : 0,
        days: card ? card.querySelectorAll('.lday').length : 0,
        lit: card && card.querySelector('.lday.lit') ? card.querySelector('.lday.lit').textContent : '',
        dawn: N.app.harbor.dayTarget,
        held: s.phase === 'swap' && s.swapHold > 0,
        night: N.save.data.night,
        preview: (document.getElementById('strip') || {}).textContent || '',
        input: !!N.input.enabled,
      };
      card.querySelector('.btn.primary').click();
      let g = 0;
      while (s.phase !== 'play' && g++ < 400) N.sim(0.1);
      N.sim(0.5);
      out.after = { phase: s.phase, dawn: N.app.harbor.dayTarget, job: (document.getElementById('jobline') || {}).textContent || '' };
      // and the new night counts from zero: its first ship ends on a normal ship card
      N.sim(s.time + 0.5);
      const c2 = document.querySelector('#shipcard .shipcard');
      out.next = c2 ? c2.querySelector('.t1').textContent : '';
      return out;
    });
    assert.match(r.heads[0], /^NIGHT 1 · \d+\/\d+ · Pier Seven$/, 'ship cards name the night: ' + r.heads[0]);
    assert.match(r.teaser, /Tomorrow’s box has a name on it\./);
    assert.match(r.heads[7], /06:00 · NIGHT 1 DONE/);
    assert.match(r.card, /Ships worked\s*8/);
    assert.match(r.card, /Boxes placed/);
    assert.match(r.card, /Perfects/);
    assert.match(r.card, /Takings\s*\$/);
    assert.equal(r.goals, 1, 'exactly one next goal');
    assert.equal(r.teasers, 1, 'one story teaser');
    assert.match(r.card, /Night 2: /);
    assert.equal(r.days, 7, 'the 7-day ladder');
    assert.match(r.lit, /2/, 'tomorrow (day 2) lit: ' + r.lit);
    assert.equal(r.dawn, 1, 'dawn comes up');
    assert.ok(r.held, 'the next ship waits while the report is up');
    assert.equal(r.night, 2);
    assert.match(r.preview, /TOMORROW/, 'the return preview at the end of the shift');
    assert.ok(r.input, 'nothing blocks the controls');
    assert.equal(r.after.phase, 'play', 'one tap: the next night is on');
    assert.equal(r.after.dawn, 0, 'night again');
    assert.match(r.after.job, /NIGHT 2/);
    assert.match(r.next, /^NIGHT 2 · /, 'night 2 counts its own ships: ' + r.next);
    assert.deepEqual(page.errors, []);
  });
});

test('boot: the 7-day ladder strip shows for a moment, day 2 lit as an item', { skip, timeout: 300000 }, async () => {
  await withPage({ width: 1280, height: 720, until: 'frame' }, async (page) => {
    await page.waitForFunction(() => document.getElementById('ladderstrip'), null, { timeout: 8000, polling: 50 });
    const r = await page.evaluate(() => {
      const el = document.getElementById('ladderstrip');
      return { text: el.textContent, lit: el.querySelector('.lday.lit').textContent, days: el.querySelectorAll('.lday').length, pe: getComputedStyle(el).pointerEvents, mode: window.__nsc.app.mode };
    });
    assert.equal(r.days, 7);
    assert.match(r.lit, /2.*Dawn Orange paint/, 'day 2 lit with its item: ' + r.lit);
    assert.equal(r.pe, 'none', 'never in the way');
    assert.equal(r.mode, 'play', 'over live play');
    await page.waitForFunction(() => !document.getElementById('ladderstrip'), null, { timeout: 8000, polling: 100 });
    assert.deepEqual(page.errors, []);
  });
});
