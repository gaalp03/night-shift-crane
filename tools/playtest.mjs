// Simulated playtest (QA tool, not part of npm test): one bot persona per run, real input events
// (keyboard / multi-touch via CDP). Needs `npm run build -- --dev` (the dev bundle has the test hooks)
// and a local server: `npm run serve -- 8123`. Reports go to playtest-out/.
//
// against the dev build in headless Chromium. The bot reads game state through the dev hooks only to
// decide what a human would do next; every action goes through the real input path.
// Game time runs in lockstep (60 Hz steps between the bot's looks), so software rendering speed does
// not distort play; frame rate is measured separately with the real loop running.
// node playtest.mjs <persona 1-5> [max simulated seconds]
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8123/';
mkdirSync('playtest-out', { recursive: true });
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const P = Number(process.argv[2] || 1);
const MAX = Number(process.argv[3] || 150) * 1000;
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const PERSONAS = {
  1: { name: 'iPad landscape · Manual · first-time casual', ctx: { viewport: { width: 1024, height: 712 }, userAgent: IPAD, hasTouch: true }, points: 5, scheme: 'manual', pick: 'manual', patience: 60 },
  2: { name: 'Phone portrait · One-finger · impatient', ctx: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }, scheme: 'onefinger', pick: 'onefinger', patience: 25 },
  3: { name: 'Phone landscape · Manual', ctx: { ...devices['iPhone 13 landscape'], viewport: { width: Number(process.env.PW || 844), height: Number(process.env.PH || 390) } }, scheme: 'manual', pick: 'manual', patience: 60 },
  4: { name: 'Desktop · arrows · first-time', ctx: { viewport: { width: 1366, height: 768 } }, scheme: 'keys', keys: 'arrows', patience: 60 },
  5: { name: 'Desktop · WASD · experienced, 3+ ships, upgrades', ctx: { viewport: { width: 1366, height: 768 } }, scheme: 'keys', keys: 'wasd', patience: 90, ships: 3, buys: true },
};
const per = PERSONAS[P];
const log = [];
const note = (t, m) => log.push(`${(t / 1000).toFixed(1)}s ${m}`);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] });
const ctx = await browser.newContext({ ...per.ctx, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/ERR_FAILED|net::|GPU stall|GL Driver|KHR_parallel/.test(m.text())) errors.push(m.type() + ': ' + m.text().slice(0, 200)); });
if (per.points) await page.addInitScript((n) => Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => n }), per.points);
// frame meter (rAF intervals)
await page.addInitScript(() => {
  window.__ft = [];
  let last = 0;
  const f = (t) => { if (last && window.__nscFirstFrame) window.__ft.push(t - last); last = t; requestAnimationFrame(f); };
  requestAnimationFrame(f);
});
await page.route('**/build/game.js', (r) => r.continue({ url: BASE + 'build/game.dev.js' }));
await page.route('**/sdk.crazygames.com/**', (r) => r.abort());
const cdp = await ctx.newCDPSession(page);
const t0 = Date.now();
const now = () => Date.now() - t0;
await page.goto(BASE + 'index.html');
await page.waitForFunction(() => window.__nscFirstFrame, null, { timeout: 120000 });
const tFirstFrame = now();
note(tFirstFrame, 'first frame');
const W = per.ctx.viewport ? per.ctx.viewport.width : per.ctx.viewport;
const ev = (fn, a) => page.evaluate(fn, a);

// ---------------------------------------------------------------- state the bot "sees"
const look = () =>
  ev(() => {
    const N = window.__nsc;
    const a = N.app;
    const s = a.session;
    // (why boxes are lost: reason, what the box was, where the hook was)
    if (s && !s.__lossHook) {
      s.__lossHook = true;
      window.__losses = window.__losses || [];
      s.on('strike', (e) => window.__losses.push({ reason: e.reason, type: e.cargo && e.cargo.type, t: +s.elapsed.toFixed(1), carry: !!s.rig.carry, x: +s.rig.x.toFixed(1), alt: +s.altitude.toFixed(1) }));
    }
    const vis = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.display !== 'none' && cs.visibility !== 'hidden' && el.offsetParent !== null ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } : null; };
    const out = { mode: a.mode, picker: !!document.getElementById('picker'), keys: !!document.getElementById('keysintro'), coach: (document.getElementById('coach').textContent || '').trim(), card: !!document.querySelector('.shipcard:not(.out)'), money: N.save.data.money, upgrades: Object.values(N.save.data.upgrades).reduce((x, y) => x + y, 0), rig: N.save.data.rigSetup };
    out.btn = { drop: vis('.dropbtn'), lock: vis('#touch .tbtn.lock'), up: vis('#touch .tbtn.up'), dn: vis('#touch .tbtn.dn'), stick: vis('#touch .stick'), pause: vis('.hud-btns .btn:last-child'), unlock: vis('.shipcard .btn.teal'), next: vis('.shipcard .btn.primary'), steady: vis('.shipcard .rigopt') };
    if (!s || s.attract) return out;
    const r = s.rig;
    const g = s.wantedGrab();
    const seat = s.seat;
    out.phase = s.phase;
    out.x = r.x; out.z = r.z; out.rope = r.rope; out.alt = s.altitude; out.vx = r.vx; out.vz = r.vz;
    out.swing = Math.hypot(r.sprVel.x - r.vx, r.sprVel.z - r.vz);
    out.spr = { x: r.sprPos.x, z: r.sprPos.z };
    out.carry = !!r.carry;
    out.check = !!(r.carry && r.carry.check && !r.carry.weighed);
    out.mismatch = !!(r.carry && r.carry.weighed === 'mismatch');
    out.discharge = !!(r.carry && r.carry.discharge);
    out.grabReady = !!(g && g.ready);
    out.grabOff = g ? Math.hypot(g.lx, g.lz) : null;
    out.seated = !!(seat && seat.seated);
    out.seatValid = !!(seat && seat.valid && (seat.kind !== 'truck' || !seat.problem));
    out.seatErr = seat ? seat.err : null;
    const outb = s.cargos.filter((c) => c.discharge && !c.counted && c.state !== 'gone');
    out.dbg3 = outb.length ? `OUT[${outb.map((c) => c.state + (c.cell ? '@' + c.cell.r + ',' + c.cell.b + ',' + c.cell.t + (s.ship.top(c.cell.r, c.cell.b) === c ? 'top' : 'under') : '')).join(' ')}] l2=${s.lanes[1].truck ? s.lanes[1].truck.state + '/' + s.lanes[1].truck.purpose : '-'} grabCand=${g ? g.cargo.discharge + ':' + g.ready + ':' + g.lx.toFixed(2) + ',' + g.lz.toFixed(2) + ',dy' + g.dy.toFixed(2) : '-'}` : '';
    out.dbg2 = `next=${!!s._nextShip} early=${!!s._manifestEarly} mi=${s.manifestIdx}/${s.manifest.length} l0=${s.lanes[0].truck ? s.lanes[0].truck.state + (s.lanes[0].truck.cargo ? '+box' : '') : '-'} cool=${(s.lanes[0].cool || 0).toFixed(1)} el=${s.elapsed.toFixed(0)} dock=${(s._dockedAt || 0).toFixed(0)}`;
    out.dbg = r.carry ? `type=${r.carry.type} target=${s.target ? s.target.x.toFixed(1) + ',' + s.target.z.toFixed(1) + (s.target.held ? 'H' : '') : '-'} auto=${JSON.stringify(s.auto)} prob=${seat && seat.problem} kind=${seat && seat.kind} gap=${seat && seat.gap && seat.gap.toFixed(2)}` : '';
    out.placed = s.stats.placed;
    out.ships = s.stats.ships;
    out.lost = s.stats.lost;
    out.stats = { ...s.stats };
    out.time = s.time;
    // where would a player aim? carried box -> its glowing slot (or lane 2 for outbound / customs);
    // empty spreader -> the misplaced / outbound box first, else the parked truck's box
    const lane2 = s.lanes[1].truck && s.lanes[1].truck.parked ? s.lanes[1] : null;
    if (r.carry) {
      if ((out.mismatch || out.discharge) && lane2) out.tgt = { x: lane2.x, z: lane2.z, kind: 'lane2' };
      else if (s.guideSlot) out.tgt = { x: s.guideSlot.x, z: s.guideSlot.z, kind: 'slot' };
    } else {
      const fix = s.cargos.find((c) => c.state === 'locked' && (c.misplaced || (c.discharge && !c.counted)) && s.ship.top(c.cell.r, c.cell.b) === c);
      if (fix && (!fix.discharge || lane2)) { const p = fix.mesh.getWorldPosition(new N.THREE.Vector3()); out.tgt = { x: p.x, z: p.z, kind: fix.discharge ? 'outbound' : 'misplaced' }; }
      else {
        const l = s.lanes.find((l) => l.truck && l.truck.parked && l.truck.cargo && l.truck.cargo.state === 'truck');
        if (l) { const p = l.truck.cargo.mesh.getWorldPosition(new N.THREE.Vector3()); out.tgt = { x: p.x, z: p.z, kind: 'truck' }; }
        else if (s.phase === 'play' || s.phase === 'swap') out.tgt = { x: s.lanes[0].x, z: s.lanes[0].z, kind: 'wait-truck' };
      }
    }
    if (r.carry && !out.tgt && s.phase === 'play') {
      const c = r.carry, sh = s.ship;
      const cells = [];
      for (let rr = 0; rr < sh.rows; rr++) for (let b = 0; b < sh.bays; b++) cells.push(`${rr},${b}:h${sh.height(rr, b)}:${sh.zoneOf(rr, b)}:${s._zoneOk(c, rr, b) ? 'zone' : '-'}:${s._ruleProblem(c, rr, b) || 'ok'}`);
      out.nowhere = `box ${c.type}/${c.zone}${c.check ? ' check:' + c.weighed : ''}${c.discharge ? ' OUT' : ''}${c.misplaced ? ' MIS' : ''} preload=${!!c.preload} ship#${s.shipIndex + 1} zones=${JSON.stringify(sh.def ? sh.def.zones : s.level.ship.zones)} cells ${cells.join(' ')}`;
    }
    if (out.tgt) { const v = new N.THREE.Vector3(out.tgt.x, 5, out.tgt.z); const q = a.juice.project(v); out.tgtScreen = { x: q.x, y: q.y, behind: q.behind }; }
    const sp = a.juice.project(new N.THREE.Vector3(r.x, 5, r.z));
    out.rigScreen = { x: sp.x, y: sp.y };
    return out;
  });

// ---------------------------------------------------------------- visual audit
const audit = () =>
  ev((scheme) => {
    const W = innerWidth, H = innerHeight;
    const sels = { drop: '.dropbtn', stick: '#touch .stick', tup: '#touch .tbtn.up', tdn: '#touch .tbtn.dn', tlock: '#touch .tbtn.lock', pause: '.hud-btns .btn:last-child', mute: '.hud-btns .mutebtn', cam: '.hud-btns .btn:first-child', wallet: '.wallet', upgrade: '.hud-tr .upgrade', coach: '#coach .coachpill', card: '.shipcard', strip: '#strip .strip', keys: '#keysintro', tl: '.hud-tl', tc: '.hud-tc', score: '.scoreplate', bl: '.hud-bl', bc: '.hud-bc', toast: '#toasts .toast', offarrow: '#offarrow.on' };
    const R = {};
    for (const k in sels) {
      const el = [...document.querySelectorAll(sels[k])].find((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 2 && r.height > 2 && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05 && e.offsetParent !== null; });
      if (el) { const r = el.getBoundingClientRect(); R[k] = { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }; }
    }
    const issues = [];
    const buttons = ['drop', 'stick', 'tup', 'tdn', 'tlock', 'pause', 'mute', 'cam', 'upgrade'];
    for (const k in R) {
      const r = R[k];
      if (r.x0 < -2 || r.y0 < -2 || r.x1 > W + 2 || r.y1 > H + 2) issues.push(`cut-off ${k} [${[r.x0, r.y0, r.x1, r.y1].map(Math.round)}]`);
    }
    const keys = Object.keys(R);
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i], b = keys[j];
      if (!buttons.includes(a) && !buttons.includes(b)) continue; // panels may stack; buttons must not be covered
      if ((a === 'stick' && b === 'drop') || (a === 'drop' && b === 'stick')) {}
      const A = R[a], B = R[b];
      const ix = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), iy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
      if (ix > 6 && iy > 6) issues.push(`overlap ${a}×${b} ${Math.round(ix)}x${Math.round(iy)}`);
    }
    // wrong control scheme on screen
    const kbdVisible = [...document.querySelectorAll('#coach .kbd, .dropbtn .kbd, .controls-hint')].some((e) => e.offsetParent !== null && e.getBoundingClientRect().width > 2);
    if (scheme !== 'keys' && kbdVisible) issues.push('keyboard hints shown on a touch device');
    if (scheme === 'keys' && R.stick) issues.push('touch stick shown on desktop');
    if (scheme === 'manual' && R.drop) issues.push('One-finger DROP shown in Manual');
    if (scheme === 'onefinger' && R.stick) issues.push('stick shown in One-finger');
    return issues;
  }, per.scheme);

// ---------------------------------------------------------------- input: keyboard
const held = new Set();
const setKey = async (k, on) => {
  if (on && !held.has(k)) { held.add(k); await page.keyboard.down(k); }
  else if (!on && held.has(k)) { held.delete(k); await page.keyboard.up(k); }
};
const KEYMAP = per.keys === 'wasd' ? { L: 'KeyA', R: 'KeyD', U: 'KeyW', D: 'KeyS' } : { L: 'ArrowLeft', R: 'ArrowRight', U: 'ArrowUp', D: 'ArrowDown' };
// ---------------------------------------------------------------- input: multi-touch (CDP)
const touches = new Map(); // name -> {id, x, y}
let nextId = 1;
const sendTouch = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...touches.values()].map((t) => ({ x: t.x, y: t.y, id: t.id, radiusX: 4, radiusY: 4, force: 1 })) });
const touchDown = async (name, x, y) => {
  if (touches.has(name)) return touchMove(name, x, y);
  touches.set(name, { id: nextId++, x, y });
  await sendTouch('touchStart');
};
const touchMove = async (name, x, y) => {
  const t = touches.get(name);
  if (!t) return touchDown(name, x, y);
  if (Math.abs(t.x - x) < 0.5 && Math.abs(t.y - y) < 0.5) return;
  t.x = x; t.y = y;
  await sendTouch('touchMove');
};
const touchUp = async (name) => {
  if (!touches.has(name)) return;
  const rest = new Map(touches);
  const t = touches.get(name);
  touches.delete(name);
  // (CDP releases exactly the points listed in a touchEnd)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: t.x, y: t.y, id: t.id }] });
  void rest; void t;
};
const tap = async (pt) => { await touchDown('tap', pt.x, pt.y); await page.waitForTimeout(60); await touchUp('tap'); };

// ---------------------------------------------------------------- metrics
const M = { firstInput: null, understood: true, confused: [], firstCrate: null, upgrades: 0, quit: '', visual: new Set() };
const firstInput = (what) => { if (M.firstInput == null) { M.firstInput = now(); note(M.firstInput, 'first control input: ' + what); } };

// ---------------------------------------------------------------- the play loop
let st = await look();
// touch, first launch: Manual and play at once (no choice screen); a One-finger player switches in
// the pause menu (pause, Switch controls, Back to work: real taps)
if (per.scheme !== 'keys') {
  if (st.picker) M.confused.push('a choice screen blocks the first launch');
  if (st.mode !== 'play' || !st.btn.lock) M.confused.push('touch launch: not straight into play with the pad');
  if (per.pick === 'onefinger') {
    await page.waitForTimeout(700 + Math.random() * 500); // looks for the setting
    if (st.btn.pause) {
      await tap(st.btn.pause);
      firstInput('tapped pause to change the controls');
      await page.waitForTimeout(300);
      const sw = await ev(() => { const b = document.querySelector('.btn.switchctl'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      if (sw) await tap(sw);
      else M.confused.push('no Switch controls in the pause menu');
      await page.waitForTimeout(250);
      const back = await ev(() => { const b = document.querySelector('#screens .btn.primary'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      if (back) await tap(back);
      await page.waitForTimeout(400);
      st = await look();
      if (!st.btn.drop) M.confused.push('One-finger: no DROP button after switching');
    } else M.confused.push('pause button not visible');
  }
} else {
  await page.waitForTimeout(1500); // a first look at the screen
  st = await look();
  if (!st.keys) M.confused.push('no key intro on first desktop launch');
  else note(now(), 'key intro on screen');
}
await page.waitForTimeout(400);
// from here the bot and the game take turns: the bot looks and acts, the game runs 0.1 s
await ev(() => (window.__nsc.app.warming = true));
if (process.env.NOSTEADY) await ev(() => (window.__nsc.save.data.settings.touchSteady = false)); // (A/B: touch anti-sway off)
let sim = 0;
const simNow = () => sim * 1000;
let lastProgress = 0;
let lastPlaced = 0;
let phaseState = 'aim';
let lastAudit = 0;
let lastShipCard = false;
let stuckReported = false;
const lowered = { since: 0 };

const axisTo = (err, v, acc, deadband = 0.18) => {
  const stop = (v * v) / (2 * acc) + 0.05;
  if (Math.abs(err) < deadband && Math.abs(v) < 0.4) return 0;
  if (err > 0 && (v <= 0 || err > stop)) return 1;
  if (err < 0 && (v >= 0 || -err > stop)) return -1;
  return 0;
};

while (simNow() < MAX) {
  st = await look();
  if (!st.phase) { await ev(() => window.__nsc.sim(0.1)); sim += 0.1; continue; }
  if (simNow() - lastAudit > 4000) {
    lastAudit = simNow();
    for (const i of await audit()) if (!M.visual.has(i)) { M.visual.add(i); note(now(), 'VISUAL ' + i); }
  }
  if (st.placed > lastPlaced) {
    if (lastPlaced === 0) {
      M.firstCrate = { grade: st.stats.perfect ? 'perfect' : st.stats.great ? 'great' : st.stats.good ? 'good' : st.stats.sloppy ? 'sloppy' : '?', simT: +sim.toFixed(1), pay: st.money };
      note(now(), 'first crate: ' + M.firstCrate.grade + ', wallet $' + st.money + ' (sim ' + sim.toFixed(1) + 's)');
    }
    lastPlaced = st.placed;
    lastProgress = simNow();
  }
  // ship cards: experienced players pick STEADY and buy upgrades; everyone else lets it auto-continue
  if (st.card && !lastShipCard) {
    note(now(), `ship ${st.ships} done · $${st.money}`);
    lastProgress = simNow();
    if (per.buys) {
      if (st.btn.steady) { await page.mouse.click(st.btn.steady.x, st.btn.steady.y); note(now(), 'picked crane setup'); }
      else if (st.btn.unlock) { await page.mouse.click(st.btn.unlock.x, st.btn.unlock.y); note(now(), 'bought an upgrade from the ship card'); }
      else if (st.btn.next) await page.mouse.click(st.btn.next.x, st.btn.next.y);
    }
  }
  lastShipCard = st.card;
  if (per.ships && st.ships >= per.ships && st.phase === 'play' && simNow() - lastProgress > 3000) { M.quit = `played ${st.ships} ships (goal reached)`; break; }
  // confusion: no progress for a while
  if (simNow() - lastProgress > per.patience * 1000 && st.phase === 'play') {
    M.confused.push(`no progress for ${per.patience}s (coach: "${st.coach}", carry=${st.carry}, target=${st.tgt ? st.tgt.kind : 'none'})`);
    if (per.patience <= 30) { M.quit = 'confused: no progress for ' + per.patience + 's'; break; }
    lastProgress = simNow();
  }
  if (st.phase !== 'play' && st.phase !== 'swap') { await ev(() => window.__nsc.sim(0.1)); sim += 0.1; continue; }
  const tgt = st.tgt;
  if (process.env.TRACE && Math.round(sim * 10) % 20 === 0) note(now(), `sim ${sim.toFixed(1)} x=${st.x.toFixed(2)} z=${st.z.toFixed(2)} rope=${st.rope.toFixed(1)} alt=${st.alt.toFixed(1)} carry=${st.carry} grab=${st.grabReady}/${st.grabOff && st.grabOff.toFixed(2)} tgt=${tgt ? tgt.kind + '@' + tgt.x.toFixed(1) + ',' + tgt.z.toFixed(1) : '-'} touches=${[...touches.keys()].join('+')} coach="${st.coach}" phase=${st.phase} check=${st.check} mm=${st.mismatch} seat=${st.seated}/${st.seatValid}/${st.seatErr && st.seatErr.toFixed(2)} swing=${st.swing.toFixed(2)} ${st.dbg3} ${st.dbg || ''}`);
  // ---------------- decide
  let mx = 0, mz = 0, hoist = 0, act = false;
  if (tgt) {
    // aim the spreader, not the trolley: once it hangs still, lean into any steady offset (wind)
    const lean = st.swing < 0.6;
    const ex = tgt.x - (lean ? st.spr.x : st.x), ez = tgt.z - (lean ? st.spr.z : st.z);
    const near = Math.abs(ex) < 0.35 && Math.abs(ez) < 0.35;
    mx = axisTo(ex, st.vx, 6.2);
    mz = axisTo(ez, st.vz, 3.6);
    if (!near) { hoist = st.alt < 3.2 ? 1 : 0; lowered.since = 0; }
    else if (st.swing > 1.2) hoist = 0; // let it settle
    else if (st.carry && st.check) hoist = 0; // hold still on the scale
    else if (st.carry) { if (st.seated && st.seatValid) act = true; else hoist = -1; }
    else if (tgt.kind === 'wait-truck') hoist = 0;
    else { if (st.grabReady) act = true; else hoist = -1; }
    if (hoist === -1) lowered.since = lowered.since || simNow();
    if (lowered.since && simNow() - lowered.since > 9000) { hoist = 1; lowered.since = 0; } // re-try from above
  }
  // ---------------- act through the real controls
  if (per.scheme === 'keys') {
    await setKey(KEYMAP.R, mx > 0); await setKey(KEYMAP.L, mx < 0);
    await setKey(KEYMAP.D, mz > 0); await setKey(KEYMAP.U, mz < 0);
    await setKey('KeyE', hoist > 0); await setKey('KeyQ', hoist < 0);
    if (mx || mz) firstInput(per.keys === 'wasd' ? 'WASD' : 'arrow keys');
    if (act) { await page.keyboard.press('Space'); firstInput('SPACE'); lowered.since = 0; await page.waitForTimeout(250); }
  } else if (per.scheme === 'manual') {
    const b = st.btn;
    if (!b.stick || !b.lock || !b.up || !b.dn) { M.confused.push('manual controls not all visible'); }
    // stick: put a thumb in the stick zone and push it toward the target
    if (mx || mz) {
      const base = { x: W * 0.12 + 40, y: (per.ctx.viewport ? per.ctx.viewport.height : 700) - 110 };
      if (!touches.has('stick')) await touchDown('stick', base.x, base.y);
      const t = touches.get('stick');
      t.bx = t.bx == null ? t.x : t.bx; t.by = t.by == null ? t.y : t.by;
      // like a person: a big push when far away, a gentle one when close
      const kx = tgt ? Math.min(1, Math.max(0.35, Math.abs(tgt.x - st.x) / 3)) : 1;
      const kz = tgt ? Math.min(1, Math.max(0.35, Math.abs(tgt.z - st.z) / 3)) : 1;
      await touchMove('stick', t.bx + mx * 46 * kx, t.by + mz * 46 * kz);
      firstInput('stick');
    } else if (touches.has('stick')) await touchUp('stick');
    const want = hoist > 0 ? 'up' : hoist < 0 ? 'dn' : null;
    if (touches.has('hoist') && touches.get('hoist').which !== want) await touchUp('hoist');
    if (want && b[want] && !touches.has('hoist')) { await touchDown('hoist', b[want].x, b[want].y); touches.get('hoist').which = want; }
    if (act && b.lock) { await touchUp('hoist'); await tap(b.lock); firstInput('grab/drop button'); lowered.since = 0; await page.waitForTimeout(250); }
  } else {
    // one finger: drag toward the target's screen spot (the crane follows), tap DROP to let go
    if (st.carry && st.seated && st.seatValid && st.btn.drop) { await touchUp('finger'); await tap(st.btn.drop); firstInput('DROP'); await page.waitForTimeout(300); }
    else if (tgt && st.tgtScreen && !st.tgtScreen.behind && (mx || mz)) {
      if (!touches.has('finger')) { await touchDown('finger', st.rigScreen.x, st.rigScreen.y + 30); await page.waitForTimeout(40); }
      await touchMove('finger', st.tgtScreen.x, st.tgtScreen.y);
      firstInput('drag');
    } else if (touches.has('finger')) await touchUp('finger');
    else if (!tgt && st.carry && st.btn.drop && st.coach === '') {}
  }
  if (st.nowhere && !M._nowhere) { M._nowhere = true; note(now(), 'NOWHERE ' + st.nowhere); }
  // stuck: carrying nowhere to go
  if (!tgt && st.phase === 'play' && simNow() - lastProgress > 20000 && !stuckReported) { stuckReported = true; M.confused.push(`no target in sight (carry=${st.carry}, coach "${st.coach}")`); }
  await ev(() => window.__nsc.sim(0.1));
  sim += 0.1;
}
if (!M.quit) M.quit = 'session time limit';
for (const k of [...held]) await setKey(k, false);
for (const k of [...touches.keys()]) await touchUp(k);
st = await look();
await ev(() => { window.__nsc.app.warming = false; window.__ft = []; window.__perf = []; });
await page.waitForTimeout(8000);
const fps = await ev(() => { const js = (window.__perf || []).slice().sort((x, y) => x - y); window.__perf = null; const a = window.__ft.slice(); a.sort((x, y) => x - y); const avg = a.reduce((x, y) => x + y, 0) / Math.max(1, a.length); return { frames: a.length, avgFps: +(1000 / avg).toFixed(1), p95ms: +(a[Math.floor(a.length * 0.95)] || 0).toFixed(1), drops100: a.filter((x) => x > 100).length, mainThreadP50ms: +(js[Math.floor(js.length * 0.5)] || 0).toFixed(1), mainThreadP95ms: +(js[Math.floor(js.length * 0.95)] || 0).toFixed(1) }; });
const out = {
  persona: P,
  name: per.name,
  simulatedPlaytime_s: +sim.toFixed(0),
  loadToFirstFrame_s: +(tFirstFrame / 1000).toFixed(1),
  loadToFirstInput_s: M.firstInput == null ? null : +(M.firstInput / 1000).toFixed(1),
  understoodWithoutHelp: M.confused.length === 0,
  firstCrate: M.firstCrate,
  ships: st.ships || 0,
  placed: st.placed || 0,
  lost: st.lost || 0,
  upgrades: st.upgrades,
  rigSetup: st.rig,
  quit: M.quit,
  confused: M.confused,
  visual: [...M.visual],
  errors: errors.slice(0, 8),
  fps,
  losses: await ev(() => window.__losses || []),
};
console.log(JSON.stringify(out, null, 1));
console.log(log.join('\n'));
writeFileSync(`playtest-out/playtest_p${P}.json`, JSON.stringify(out, null, 1));
await page.screenshot({ path: `playtest-out/p${P}_end.png` });
console.log('notes:', [...M.visual].length, 'visual,', M.confused.length, 'confusion');
await browser.close();
