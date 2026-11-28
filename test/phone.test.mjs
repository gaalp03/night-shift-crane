// Phones, upright and sideways (headless Chromium, emulated devices): nothing on screen overlaps or is
// cut off, all text is readable (11 px+), the box, its slot and the spreader are never under the
// interface, and on an upright phone the pad is in thumb reach at the bottom.
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

const AUDIT = () => {
  const W = innerWidth;
  const H = innerHeight;
  const R = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 3 || r.height < 3 || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.2) return null;
    let p = el;
    while (p && p !== document.body) {
      const c = getComputedStyle(p);
      if (c.display === 'none' || +c.opacity < 0.2) return null;
      p = p.parentElement;
    }
    return { l: r.left, t: r.top, r: r.right, b: r.bottom };
  };
  const items = [];
  const add = (name, sel) => document.querySelectorAll(sel).forEach((el, i) => { const r = R(el); if (r) items.push({ name: name + (i ? i : ''), ...r }); });
  add('clock', '.hud-tc .timer');
  add('progress', '.hud-tc .progress');
  add('btns', '.hud-btns');
  add('money', '.hud-tr .wallet, .hud-tr .money');
  add('upgrade', '.hud-tr .upgrade');
  add('job', '#jobline');
  add('ladder', '#ladderstrip');
  add('strip', '#strip .strip');
  add('toast', '#toasts .toast');
  add('radio', '#radio.on .rx');
  add('coach', '#coach.on .coachpill');
  add('stick', '#touch .stick');
  add('lock', '#touch .tbtn.lock');
  add('up', '#touch .tbtn.up');
  add('dn', '#touch .tbtn.dn');
  add('drop', '.dropbtn:not(.hidden)');
  add('card', '.shipcard:not(.out)');
  add('manifest', '#manifestcard');
  const ov = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 3 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 3;
  const issues = [];
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (a.l < -1 || a.t < -1 || a.r > W + 1 || a.b > H + 1) issues.push('cut off: ' + a.name);
    for (let j = i + 1; j < items.length; j++) if (ov(a, items[j]) && !(a.name.startsWith('card') || items[j].name.startsWith('card'))) issues.push(`overlap: ${a.name} / ${items[j].name}`);
  }
  // text size
  const small = [];
  document.querySelectorAll('#ui *').forEach((el) => {
    if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
    if (!R(el)) return;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 11) small.push(el.className || el.tagName + ':' + fs);
  });
  // the box and its target: on screen, clear of the UI
  const N = window.__nsc;
  const s = N.app.session;
  const proj = (v) => N.app.juice.project(v);
  const pts = [];
  if (s && s.rig.carry) pts.push(['box', s.rig.carry.mesh.getWorldPosition(new N.THREE.Vector3())]);
  if (s && s.guideSlot && s.rig.carry) pts.push(['target', s.guideSlot.clone()]);
  if (s) pts.push(['spreader', s.rig.sprPos.clone()]);
  const covered = [];
  const at = pts.map(([n, v]) => { const p = proj(v); return n + '@' + Math.round(p.y); });
  for (const [n, v] of pts) {
    const p = proj(v);
    if (p.behind || p.x < 8 || p.x > W - 8 || p.y < 8 || p.y > H - 8) covered.push(n + ' off screen');
    else for (const it of items) if (p.x > it.l && p.x < it.r && p.y > it.t && p.y < it.b && !it.name.startsWith('card') && !it.name.startsWith('coach')) covered.push(`${n} under ${it.name}`);
  }
  return { W, H, at, issues, small: [...new Set(small)].slice(0, 8), covered, items: items.map((i) => `${i.name}:${Math.round(i.t)}-${Math.round(i.b)}`) };
};
const returning = () =>
  localStorage.setItem(
    'night-shift-crane.save.v1',
    JSON.stringify({ v: 2, money: 260, flags: { played: true, hud: 3, coach: 4, rookie: 5, keysIntro: true, introSeen: true }, settings: { controls: 'manual' }, stats: { placed: 30 }, login: { last: new Date().toISOString().slice(0, 10), streak: 2 } })
  );

/** A returning player carrying a box towards its slot, with a toast and a radio message up. */
const carry = () => {
  const N = window.__nsc;
  const s = Q.s();
  N.app.warming = true;
  let g = 0;
  while (!(s.lanes[0].truck && s.lanes[0].truck.parked && s.lanes[0].truck.cargo) && g++ < 300) N.sim(0.1);
  const p = s.lanes[0].truck.cargo.mesh.getWorldPosition(new N.THREE.Vector3());
  Q.hoistTo(7);
  Q.goto(p.x, p.z, 0.08);
  Q.lowerUntil((s) => s.grab && s.grab.ready);
  Q.press('Space');
  N.sim(0.3);
  Q.hoistTo(6);
  const slot = s.guideSlot.clone();
  Q.goto(slot.x - 1.5, slot.z + 1, 0.2);
  N.app.juice.toast({ text: 'Gust incoming!', kind: 'warn', dur: 6000 });
  N.app.radio.say([{ who: 'dispatch', text: 'Seven, the next one is riding a storm in — load her full and she pays double.', dur: 8000 }]);
  N.app.warming = false;
};

const check = (where, a) => {
  assert.deepEqual(a.issues, [], where + ': overlaps / cut off');
  assert.deepEqual(a.small, [], where + ': text under 11 px');
  assert.deepEqual(a.covered, [], where + ': the action is covered');
};

for (const dev of ['iPhone SE', 'iPhone 13', 'iPhone 14 Pro Max', 'iPhone 13 landscape']) {
  test(`${dev}: the opening and play are clear — no overlaps, readable text, box / slot / spreader never under the UI`, { skip, timeout: 300000 }, async () => {
    let page = await game.open({ device: dev, until: 'frame' });
    try {
      await page.waitForTimeout(900);
      check(dev + ' opening', await page.evaluate(AUDIT));
      await page.waitForTimeout(3600);
      check(dev + ' opening +4 s', await page.evaluate(AUDIT));
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close().catch(() => {});
    }
    page = await game.open({ device: dev, init: returning });
    try {
      await injectDriver(page);
      await page.evaluate(carry);
      await page.waitForTimeout(1400);
      const a = await page.evaluate(AUDIT);
      check(dev + ' carrying', a);
      if (a.H > a.W) {
        // upright: the pad is at the bottom, in thumb reach; the action sits above it
        const pad = await page.evaluate(() => Math.min(...['.stick', '.tbtn.lock', '.tbtn.up'].map((s) => document.querySelector('#touch ' + s).getBoundingClientRect().top)));
        assert.ok(pad > a.H * 0.7, `the pad is in the bottom 30% (${Math.round(pad)} of ${a.H})`);
        for (const at of a.at) assert.ok(+at.split('@')[1] < pad - 20, 'above the pad: ' + at);
      }
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close().catch(() => {});
    }
  });
}
