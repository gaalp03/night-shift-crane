// Night Shift Crane — application shell: boot, world, game flow, main loop.
import * as THREE from 'three';
import { DIM, PAL } from './config.js';
import { clamp, damp, rand, fmtNum, isMobile, isIOS, Tweens } from './core/util.js';
import { save } from './core/save.js';
import { sdk } from './core/sdk.js';
import { input } from './core/input.js';
import { audio } from './core/audio.js';
import { SOUNDS } from './core/sounds.js';
import { gfx } from './core/gfx.js';
import { initPhysics } from './game/physics.js';
import { initMaterials, MAT } from './world/vox.js';
import { Harbor } from './world/env.js';
import { Water } from './world/water.js';
import { Weather } from './world/weather.js';
import { Fx } from './world/fx.js';
import { CraneView } from './world/crane.js';
import { Crew } from './world/crew.js';
import { CameraRig } from './game/cameras.js';
import { Session } from './game/session.js';
import { Tutorial } from './game/tutorial.js';
import { SHIFTS, UPGRADES, endlessShip, upgradeMods, dailyShift, todayKey, dayBefore, portLevel } from './game/levels.js';
import { Coach } from './game/coach.js';
import { checkAwards } from './game/awards.js';
import { Juice } from './ui/juice.js';
import { Hud } from './ui/hud.js';
import { TouchControls } from './ui/touch.js';
import { Screens } from './ui/screens.js';
import { Radio } from './ui/radio.js';
import { DeepLight } from './world/deep.js';
import { WetShine } from './world/shine.js';
import { Tug, Gulls } from './world/harborlife.js';
import { CLIFFHANGERS, episodeFor, SHIFT_OPEN, SHIFT_BEATS, CHECK_INTRO, LONG_INTRO, BLACK_BOXES, BLACKOUT, SMUGGLE_FOUND, epilogue } from './game/story.js';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const app = {
  mode: 'boot', // boot | menu | intro | play | paused | results
  session: null,
  level: null,
  tutorial: null,
  time: 0,
  busy: false,
  shiftsStarted: 0,
  lastResult: null,
  nowPlaying: null,
  touchMode: isMobile(),
  cabGhost: null,
  hitStop: 0,
  ambT: { crow: rand(12, 30), bell: rand(8, 20), horn: rand(40, 90), smoke: 0, deep: rand(25, 45) },
  blackout: false,
  timers: [], // game-time callbacks tied to a session (they freeze with the pause menu)
  /** Run `fn` after `sec` seconds of game time, unless the shift has ended by then. */
  after(sec, fn, session = app.session) {
    app.timers.push({ t: sec, fn, session });
  },
  /** How muffled the mix should be right now (cab glass, a power cut). */
  muffle: () => Math.max(app.cams && app.cams.mode === 'cab' ? 0.32 : 0, app.blackout ? 0.45 : 0),
  openEpilogue(from) {
    app.screens.epilogue(from);
  },

  // ---------------------------------------------------------------- queries used by the UI
  mods: () => upgradeMods(save.data.upgrades),
  adsAvailable: () => sdk.available,
  shiftUnlocked(i) {
    if (i === 0) return true;
    const prev = SHIFTS[i - 1];
    return (save.data.shifts[prev.id] || {}).stars > 0;
  },
  endlessUnlocked() {
    return true; // the endless night is the main game now
  },
  /** Tonight's Shift opens once the first ship has sailed. */
  dailyUnlocked() {
    return !!save.data.flags.played || (save.data.shifts.s02 || {}).stars > 0;
  },
  /** Today's record (empty if the stored one is from another day). */
  dailyRecord() {
    const dd = save.data.daily;
    const today = todayKey();
    const fresh = dd.date === today;
    // a streak survives until a whole day is missed
    const alive = dd.last === today || dd.last === dayBefore(today);
    return { date: today, best: fresh ? dd.best : 0, stars: fresh ? dd.stars : 0, order: dd.order === today, streak: alive ? dd.streak : 0, bestStreak: dd.bestStreak || 0, plays: dd.plays || 0 };
  },

  /** Touch controls follow the device actually in use: a finger shows them, a key press hides them. */
  setTouchMode(v) {
    v = !!v;
    if (app.touchMode === v) return;
    app.touchMode = v;
    document.body.classList.toggle('touch', v);
    if (app.touch) app.touch.show(v && app.mode === 'play');
    if (app.tutorial) app.tutorial.setTouch(v);
    if (!v) input.touch.x = input.touch.z = input.touch.hoist = 0;
  },

  // ---------------------------------------------------------------- settings
  applySettings() {
    const st = save.data.settings;
    audio.setVolume('music', st.music);
    audio.setVolume('sfx', st.sfx);
    if (app.cams) app.cams.shakeEnabled = st.shake !== false;
    if (gfx.renderer && app._quality !== st.quality) {
      // (a manual change wipes whatever the automatic mode had learned about this machine)
      if (app._quality != null) st.autoLevel = 0;
      app._quality = st.quality;
      gfx.applyQuality(st.quality, st.autoLevel || 0);
      document.body.classList.toggle('post', gfx.usePost);
    }
  },
  applyPaint() {
    if (app.crane) app.crane.setPaint(save.data.paint || 'yellow');
  },
  shake(a) {
    if (app.cams) app.cams.shake(a);
  },
  celebrate() {
    sdk.happytime();
  },

  // ---------------------------------------------------------------- navigation
  gotoTitle() {
    app.mode = 'menu';
    app.screens.title();
    audio.music.setPlaylist(['menu']);
  },
  openBoard() {
    app.screens.board();
  },
  openWorkshop(from) {
    app.screens.workshop(from);
  },
  /** Mid-shift upgrade stop: the game pauses behind the workshop and resumes after. */
  openWorkshopInPlay() {
    if (app.mode !== 'play') return;
    app.pause();
    app.screens.workshop('play');
  },
  /** Cash on hand vs the cheapest upgrade still to buy. */
  canUpgrade() {
    const d = save.data;
    return UPGRADES.some((u) => {
      const lvl = d.upgrades[u.id] || 0;
      return lvl < u.costs.length && d.money >= u.costs[lvl];
    });
  },
  /** Something was bought: a running shift feels it straight away. */
  upgradesChanged() {
    if (app.session && !app.session.attract) app.session.refreshMods();
    app.hud.setMoney(save.data.money, app.canUpgrade());
  },
  openBriefing(level) {
    app.screens.briefing(level);
  },
  openEndlessBriefing() {
    app.screens.endlessBriefing();
  },
  openDailyBriefing() {
    app.screens.dailyBriefing(dailyShift(todayKey()));
  },
  openLogbook() {
    app.screens.logbook();
  },
  reopenResults() {
    if (app.lastResult) app.screens.results(app.lastResult.res, app.lastResult.meta);
    else app.gotoTitle();
  },

  startShift(level) {
    return beginRun(level);
  },
  startDaily(level) {
    return beginRun(level || dailyShift(todayKey()));
  },
  startEndless(first = false) {
    const seed = Math.floor(Math.random() * 1e9);
    return beginRun(endlessShip(0, seed), { seed, first: first === true });
  },
  retry() {
    if (!app.level) return app.gotoTitle();
    if (app.level.endless) return app.startEndless();
    return beginRun(app.level);
  },
  resume() {
    if (app.mode !== 'paused') return;
    app.screens.hide();
    input.clear(); // the key that closed the menu must not double as "release"
    app.mode = 'play';
    audio.setMuffle(app.muffle());
    showHud(true);
    sdk.gameplayStart();
  },
  pause() {
    if (app.mode !== 'play') return;
    app.mode = 'paused';
    input.clear();
    audio.setMuffle(1);
    audio.play('ui_open');
    app.screens.pause();
    sdk.gameplayStop();
  },
  async quitToBoard() {
    if (app.busy) return;
    // clocking out of the endless night: the shift report first, then home
    const s = app.session;
    if (s && s.endless && !s.attract && (s.phase === 'play' || s.phase === 'swap')) {
      app.screens.hide();
      app.mode = 'play';
      s._finish(true, 'clockout');
      return;
    }
    app.busy = true;
    sdk.gameplayStop();
    await app.juice.transition(async () => {
      app.screens.hide();
      teardownRun();
      makeAttract();
      app.mode = 'menu';
      audio.setMuffle(0);
      audio.music.setPlaylist(['menu']);
      app.screens.title();
    });
    app.busy = false;
  },
  async rewardedContinue() {
    if (app.busy || !app.session || !app.lastResult) return;
    app.busy = true;
    let ok = true;
    if (sdk.available) {
      const r = await sdk.rewarded({ pause: () => audio.setMuted(true, 'ad'), resume: () => audio.setMuted(false, 'ad') });
      ok = r.rewarded;
      if (!ok) app.juice.toast({ text: 'No ad available right now — try again in a moment', kind: 'warn' });
    }
    app.busy = false;
    if (!ok) return;
    app.screens.hide();
    app.lastResult = null;
    app.session.continueRun();
    app.cams.setMode(save.data.settings.cabDefault ? 'cab' : 'chase', 1.0);
    setCab(app.cams.mode === 'cab');
    app.mode = 'play';
    showHud(true);
    audio.music.setPlaylist(musicFor(app.level), { shuffle: true });
    app.juice.banner('SECOND CHANCE', app.session.strikes < app.session.maxStrikes ? 'Back on the crane' : '');
    sdk.gameplayStart();
  },
};

// ====================================================================== run lifecycle

function musicFor(level) {
  if (level.music === 'storm' || (level.weather && level.weather.storm > 0.5)) return ['storm', 'shift_c'];
  if (level.endless) return ['shift_b', 'storm', 'shift_a', 'shift_c'];
  return ['shift_a', 'shift_b', 'shift_c'];
}

function teardownRun() {
  if (app.tutorial) {
    app.tutorial.dispose();
    app.tutorial = null;
  }
  setCab(false, true);
  app.timers.length = 0;
  app.radio.clear();
  setPower(true, true);
  setDawn(false);
  app.deep.target = 0;
  if (app.session) {
    app.session.dispose();
    app.session = null;
  }
  app.juice.clear();
  app.juice.letterbox(false);
  showHud(false);
}

/** First light (the end of the last shift), or back to night. */
function setDawn(on) {
  const h = app.harbor;
  h.dayTarget = on ? 1 : 0;
  if (on) {
    h.setSky('dawn');
    app.weather.set({ rain: 0, wind: 0.25, windDir: 0.4, gusts: 0, fog: 0.0092, sea: 0.22, clouds: 0.55, storm: 0 });
    // the lamps go off one by one as the day comes up
    h.power = 0;
  } else {
    h.daylight = 0;
    h.power = 1;
    h.powerNow = 1;
  }
}

function makeAttract() {
  // a docked ship + idle crane behind the menus
  app.level = null;
  setDawn(false);
  const s = new Session(app.ctx, SHIFTS[0], { attract: true });
  s.attract = true;
  app.session = s;
  app.cams.setMode('menu', 0);
  // behind the menus: rain most of the year, snow in the depth of winter
  const m = new Date().getMonth();
  const winter = m === 11 || m === 0 || m === 1;
  app.weather.set(winter ? { snow: 0.7, rain: 0, wind: 0.35, gusts: 0, fog: 0.012, sea: 0.15, clouds: 0.75 } : { rain: 0.45, wind: 0.5, gusts: 0, fog: 0.011, sea: 0.2, clouds: 0.6 });
}

function showHud(v) {
  app.hud.show(v);
  // (one-touch play: the old stick and hoist buttons stay hidden; see bindGlobalInput)
  app.touch.show(false);
}

function setCab(on, silent) {
  const want = on ? 'cab' : 'chase';
  $('cab-overlay').classList.toggle('hidden', !on);
  app.crane.setCabView(on);
  app.hud.setCameraMode(want);
  if (!silent) audio.setMuffle(Math.max(on ? 0.32 : 0, app.blackout ? 0.45 : 0));
  if (!on) applyCabGhost(null);
}

/** Quay mains on / off. The trolley lamp keeps burning on its battery. */
function setPower(on, silent) {
  if (app.blackout === !on) return;
  app.blackout = !on;
  app.harbor.power = on ? 1 : 0;
  document.body.classList.toggle('blackout', !on);
  if (silent) {
    app.harbor.powerNow = app.harbor.power;
    return;
  }
  audio.play(on ? 'power_up' : 'power_down');
  audio.setMuffle(app.muffle());
}

/** Scripted power cut; on some nights something uses the dark to come and look at the ship. */
function runBlackout(s, e) {
  setPower(false);
  app.juice.banner('POWER CUT', 'Battery lamp only', 2400);
  app.radio.say(BLACKOUT.start, { urgent: true });
  buzz([40, 60, 40]);
  if (e.deep) {
    app.after(e.dur * 0.3, () => {
      app.deep.pass(13.5, 6.5);
      audio.play('deep_call', { vol: 0.9 });
      app.radio.say(BLACKOUT.deep, { urgent: true });
      // the hull feels it go underneath
      for (const t of [2.5, 5, 7.5]) app.after(t, () => s.ship.bump(rand(-0.02, 0.02), 0.35), s);
    }, s);
  }
  app.after(e.dur, () => {
    setPower(true);
    app.radio.say(e.deep ? BLACKOUT.end : [{ who: 'dispatch', text: 'Power is back. Carry on, Seven.' }]);
  }, s);
}

function toggleCamera() {
  if (app.mode !== 'play') return;
  const on = app.cams.mode !== 'cab';
  app.cams.setMode(on ? 'cab' : 'chase', 0.6);
  setCab(on);
  audio.play('ui_toggle');
  audio.play('servo', { vol: 0.5 });
}

/** In the cab view the carried box (and spreader) turn glassy so the target below stays visible. */
function applyCabGhost(cargo) {
  if (app.cabGhost === cargo) return;
  const g = app.cabGhost;
  if (g && g.box && g._origMat) {
    g.box.material.dispose();
    g.box.material = g._origMat;
    g._origMat = null;
    g.box.castShadow = true;
  }
  app.cabGhost = cargo;
  const sm = app.crane.spreaderMesh;
  if (cargo) {
    cargo._origMat = cargo.box.material;
    const m = cargo.box.material.clone();
    m.transparent = true;
    m.opacity = 0.34;
    m.depthWrite = false;
    cargo.box.material = m;
    if (!app._sprGhostMat) {
      app._sprGhostMat = MAT.vox.clone();
      app._sprGhostMat.transparent = true;
      app._sprGhostMat.opacity = 0.4;
      app._sprGhostMat.depthWrite = false;
    }
    sm.material = app._sprGhostMat;
  } else if (sm) sm.material = MAT.vox;
}

async function beginRun(level, opts = {}) {
  if (app.busy) return;
  app.busy = true;
  sdk.gameplayStop();
  // ad break between shifts (never before the first one of a visit)
  if (app.shiftsStarted > 0 && sdk.available && !opts.first) {
    await sdk.midgame({ pause: () => audio.setMuted(true, 'ad'), resume: () => audio.setMuted(false, 'ad') });
  }
  app.shiftsStarted++;
  // (the very first load is already behind the loading screen: no doors needed)
  const cover = opts.first ? async (fn) => fn() : (fn) => app.juice.transition(fn);
  await cover(async () => {
    app.screens.hide();
    teardownRun();
    app.level = level;
    app.lastResult = null;
    audio.setMuffle(0);
    const s = new Session(app.ctx, level, opts);
    app.session = s;
    bindSession(s);
    app.hud.build(level, s);
    showHud(false);
    app.mode = 'intro';
    app.cams.yaw = 0;
    app.cams.pitch = 0;
    app.cams.zoom = 1;
    audio.music.setPlaylist(musicFor(level), { shuffle: !level.tutorial });
    // start from a wide establishing pose behind the doors
    app.cams.mode = 'free';
    app.cams.pos.set(-16, 30, 62);
    app.cams.look.set(2, 9, 0);
    app.cams.up.set(0, 1, 0);
    app.cams.fov = 46;
  });
  app.busy = false;
  runIntro(level, app.session, opts);
}

async function runIntro(level, s, opts = {}) {
  // (no tours, no cards: the night starts at the controls)
  const tour = false;
  const j = app.juice;
  if (tour) {
    j.letterbox(true, app.touchMode ? 'Tap to skip' : 'Click or press Space to skip');
    const skip = () => app.cams.skipShots();
    const lb = $('letterbox');
    lb.addEventListener('pointerdown', skip);
    app._skipTour = skip;
    const caps = [
      ['PIER SEVEN', '22:00 · your shift begins'],
      [s.ship.name, 'Feeder vessel · four boxes to load'],
      ['CRANE 07', 'Ship-to-shore gantry · that is you up there'],
      ['TRUCKS BRING THE CARGO', 'Lift it · carry it · lock it down'],
    ];
    const skipped = await app.cams.playShots(
      [
        { p0: [96, 8, 66], l0: [0, 14, -8], p1: [72, 10, 50], l1: [0, 13, -6], fov: 40, dur: 4.2 },
        { p0: [23, 5.5, 34], l0: [9, 6, 6], p1: [17, 8.5, 12], l1: [8, 6, -8], fov: 46, dur: 3.8 },
        { p0: [-15, 3.6, 24], l0: [-7, 20, 0], p1: [-11, 6, 17], l1: [-6, 23, 0], fov: 50, dur: 3.8 },
        { p0: [-12.5, 4.4, 13], l0: [-7.2, 4.6, 0], p1: [-10, 5.4, 9.5], l1: [-7.2, 5.2, 0], fov: 44, dur: 3.6 },
      ],
      {
        onCut: (i) => {
          j.caption(caps[i][0], caps[i][1]);
          if (i === 0) audio.play('horn_ship', { vol: 0.6 });
          if (i === 2) audio.play('sax_start', { vol: 0.9 });
        },
      }
    );
    lb.removeEventListener('pointerdown', skip);
    app._skipTour = null;
    if (app.session !== s) return;
    j.letterbox(false);
    save.data.flags.introSeen = true;
    save.commit();
    app.cams.setMode(save.data.settings.cabDefault ? 'cab' : 'chase', skipped ? 0.9 : 1.8);
    await wait(skipped ? 500 : 1100);
  } else if (opts.first) {
    // first ever load: straight into the cab with a box on the hook
    app.cams.setMode('chase', 0);
  } else {
    app.cams.setMode(save.data.settings.cabDefault ? 'cab' : 'chase', 1.2);
    const t1 = level.endless ? 'CLOCKED IN' : level.daily ? 'TONIGHT’S SHIFT' : `SHIFT ${String(level.n).padStart(2, '0')}`;
    const t2 = level.endless ? s.ship.name : level.daily ? level.twists.map((t) => t.name).join(' · ') : `${level.name} · ${level.clock}`;
    j.banner(t1, t2, 2000);
    audio.play('sax_start', { vol: 0.8, delay: 0.15 });
    await wait(level.endless ? 900 : 1500);
  }
  if (app.session !== s) return;
  setCab(app.cams.mode === 'cab');
  input.clear();
  app.mode = 'play';
  showHud(true);
  s.start();
  if (level.endless) {
    // tonight's episode of the Pier Seven file rides in on the second ship
    s.onShip = (def, n) => injectEpisode(def, n);
    if (opts.first || (save.data.flags.coach || 0) === 0) s.prehook();
    app.hud.setMoney(save.data.money, app.canUpgrade());
  }
  if (level.feature && !(save.data.shifts[level.id] || {}).stars) {
    j.toast({ text: `${level.feature.title}: ${level.feature.text}`, kind: 'info', dur: 7000 });
    if (level.also) app.after(7.5, () => j.toast({ text: `${level.also.title}: ${level.also.text}`, kind: 'info', dur: 7000 }), s);
  }
  if (level.daily) {
    const tw = level.twists.map((t) => t.name.toLowerCase());
    app.after(2.5, () => app.radio.say([{ who: 'dispatch', text: `Tonight: ${tw.join(' and ')}. Every crane on the coast works this same shift — make yours the one they talk about.` }]), s);
  }
  // the tower checks in at the start of a shift you have not cleared yet
  if (!level.endless && SHIFT_OPEN[level.id] && !(save.data.shifts[level.id] || {}).stars) app.after(level.feature ? (level.also ? 15 : 7.5) : 2.5, () => app.radio.say(SHIFT_OPEN[level.id]), s);
  sdk.gameplayStart();
}

/** Short vibration on phones that support it (Android); silently ignored elsewhere. */
function buzz(pattern) {
  if (!app.touchMode || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch (e) {}
}

/** Money in: coins fly from `pos` to the wallet, which counts up as they land. */
function earn(amount, pos) {
  const d = save.data;
  d.money += amount;
  d.stats.earned += amount;
  save.commit();
  let shown = app._walletShown == null ? d.money - amount : app._walletShown;
  app._walletShown = shown;
  app.juice.coins(pos, amount, app.hud.el.wallet, (share, last) => {
    app._walletShown = last ? save.data.money : Math.min(save.data.money, app._walletShown + share);
    app.hud.setMoney(app._walletShown, app.canUpgrade());
  });
  updatePort(true);
}

/** Lifetime boxes (yours and the crew's) decide how big the port has grown. */
function updatePort(announce) {
  const st = save.data.stats;
  const l = portLevel((st.placed || 0) + (st.crew || 0) + (app.session && app.session.stats ? app.session.stats.placed : 0));
  if (l === app.harbor.portLevel) return;
  const grew = app.harbor.portLevel != null && l > app.harbor.portLevel;
  app.harbor.setPortLevel(l);
  if (grew && announce) {
    app.juice.toast({ text: ['', 'Pier Seven is growing: the gate sign is lit', 'The neighbouring berths have opened', 'The yard is filling up', 'More stacks, more ships — the port keeps growing', 'Pier Seven is the busiest berth on the coast'][l] || 'The port has grown', kind: 'good', key: 'port' + l, dur: 4200 });
    audio.play('sting_levelup', { vol: 0.7 });
  }
}

/** Tonight's black box joins the second ship of the night, once per calendar day. */
function injectEpisode(def, n) {
  if (n !== 1) return def;
  const key = episodeFor(save.data.story, todayKey());
  if (!key) return def;
  const m = def.manifest.slice();
  m.splice(Math.min(2, m.length), 0, { zone: 'ANY', type: 'black', black: true, episode: key });
  return { ...def, manifest: m };
}

function recordEpisode(s, key, outcome) {
  const st = (save.data.story = save.data.story || { boxes: {}, opened: {}, ending: null });
  if (st.boxes[key]) return;
  st.boxes[key] = outcome;
  st.lastEpisode = todayKey();
  if (outcome === 'ship') earn(300 + (BLACK_BOXES[key] ? BLACK_BOXES[key].n * 40 : 0), s.rig.sprPos.clone());
  const end = epilogue(st);
  if (end) st.ending = end.id;
  save.commit(true);
  // every episode ends on tomorrow
  app.after(9, () => {
    app.radio.say(CLIFFHANGERS[key]);
    if (end) app.after(6, () => app.juice.toast({ text: 'The Pier Seven file is complete — the morning paper is in your Logbook', kind: 'good', dur: 6000 }), s);
    else app.after(7, () => app.juice.toast({ text: 'Episode complete · the next box arrives tomorrow night', kind: 'info', key: 'ep', dur: 5000 }), s);
  }, s);
}

function bindSession(s) {
  const j = app.juice;
  s.on('grab', () => buzz(18));
  s.on('release', () => buzz(10));
  s.on('burst', (b) => j.burst(b));
  s.on('points', (p) => j.points(p));
  s.on('toast', (t) => j.toast(t));
  s.on('flash', () => {
    const calm = save.data.settings.flashes === false;
    gfx.flash = calm ? 0.25 : 1;
    if (!calm) j.flash();
    app.hitStop = 0.12;
  });
  s.on('strike', (e) => {
    const left = e.max - e.strikes;
    j.toast({
      text: left > 0 ? `Container lost — ${left} strike${left === 1 ? '' : 's'} left` : 'Third strike!',
      kind: 'warn',
      key: 'strike' + e.strikes,
      silent: true,
    });
    if (e.reason === 'sea') audio.play('vox_yell', { vol: 0.5, delay: 0.5 });
    if (save.data.settings.flashes !== false) j.flash('red');
    buzz([60, 50, 90]);
  });
  s.on('shipDone', (e) => {
    const cash = Math.round(e.bonus * 0.3);
    if (e.complete) {
      j.banner('SHIP LOADED', cash ? `+$${cash} full-ship bonus · next vessel inbound` : 'next vessel inbound', 2600);
      sdk.happytime();
    } else j.banner('SHIP SAILED', `${e.placed} of ${e.quota} aboard · next vessel inbound`, 2600);
    if (cash) earn(cash, s.ship.group.position);
    // the very first ship: now the game can introduce itself
    if (!save.data.flags.played) {
      save.data.flags.played = true;
      save.commit();
      app.after(3.2, () => {
        j.banner('NIGHT SHIFT CRANE', 'Pier Seven · your shift has begun', 3200);
        app.radio.say([{ who: 'dispatch', text: 'Nice work, Seven. Ships keep coming all night — fill each one before its clock runs out.' }, { who: 'dispatch', text: 'Every box pays. Spend it in the workshop. And keep your radio on.' }]);
      }, s);
    }
    // a natural break for an ad, now and then
    if (sdk.available && e.n % 5 === 0) app.after(4.5, () => sdk.midgame({ pause: () => audio.setMuted(true, 'ad'), resume: () => audio.setMuted(false, 'ad') }), s);
  });
  s.on('shipIncoming', (e) => {
    app.hud.build(s.level, s);
    j.toast({ text: `${e.def.ship.name} is coming alongside`, kind: 'info', dur: 4200 });
  });
  s.on('shipDocked', (e) => {
    j.banner(e.def.ship.name, `Ship ${e.n} · ${e.def.manifest.filter((m) => !m.black).length} boxes · ${Math.round(s.timeTotal)}s on the clock`, 2400);
  });
  s.on('finish', (res) => onFinish(s, res));
  // ---- the Pier Seven file
  s.on('truck', ({ cargo }) => {
    const box = BLACK_BOXES[cargo.episode || s.level.id];
    if (cargo.black) {
      app.harbor.surge = 1.6;
      app.crew.react('wince', 2.2);
      if (box) app.radio.say(box.arrive, { urgent: true, key: 'black-arrive' });
    } else if (cargo.long && !save.data.flags.longSeen) {
      save.data.flags.longSeen = true;
      save.commit();
      app.radio.say(LONG_INTRO, { urgent: true, key: 'long-intro' });
    } else if (cargo.check && !save.data.flags.checkSeen) {
      save.data.flags.checkSeen = true;
      save.commit();
      app.radio.say(CHECK_INTRO, { urgent: true, key: 'check-intro' });
    }
  });
  s.on('weighed', (e) => buzz(e.ok ? 14 : [30, 40, 30]));
  s.on('thump', (e) => {
    if (e.carried) {
      app.harbor.surge = Math.max(app.harbor.surge, 0.45);
      buzz(35);
    }
  });
  s.on('black', (e) => {
    const key = (e.cargo && e.cargo.episode) || s.level.id;
    const box = BLACK_BOXES[key];
    if (e.cargo && e.cargo.episode) recordEpisode(s, key, e.outcome);
    const out = box && box[e.outcome];
    if (out && out.say) app.radio.say(out.say, { key: 'black-' + e.outcome });
    if (e.outcome === 'sea') {
      // the harbour answers
      const p = e.pos || s.rig.sprPos;
      app.harbor.surge = 3.5;
      app.after(1.4, () => {
        app.deep.bloom(p.x, p.z, 1);
        audio.play('deep_call', { vol: 1 });
        s.ship.bump(rand(-0.03, 0.03), 0.5);
        app.crew.react('wince', 3);
      }, s);
    } else if (e.outcome === 'ship') {
      app.harbor.surge = 0.8;
    }
  });
  s.on('blackDumped', () => {
    app.radio.say([{ who: 'unknown', text: 'Not fast enough, Seven. It is on your quay now. It is still your choice.' }], { urgent: true, key: 'dumped' });
  });
  s.on('event', (e) => {
    if (e.type === 'blackout') runBlackout(s, e);
  });
  s.on('smuggled', (e) => {
    app.radio.say(SMUGGLE_FOUND, { key: 'smug' });
    j.toast({ text: `Customs found ${e.n} mis-declared box${e.n === 1 ? '' : 'es'} on that ship`, kind: 'warn', silent: true });
  });
  s.on('horn', () => {
    app.crew.react('wave', 1.6);
    if (Math.random() < 0.4) audio.play('vox_laugh', { delay: 0.6, vol: 0.5 });
  });
  s.on('placed', (e) => {
    // the main shift pays per box, straight into the wallet
    if (s.endless && e.pts > 0) {
      e.cargo.mesh.getWorldPosition(_tmp);
      earn(Math.round(e.pts * 0.25), _tmp.clone());
    }
    app.coach.onPlaced();
    const beat = SHIFT_BEATS[s.level.id];
    if (beat && !s._beatDone && s.delivered >= beat.at && !(save.data.shifts[s.level.id] || {}).stars) {
      s._beatDone = true;
      app.after(1.6, () => app.radio.say(beat.lines), s);
    }
    if (e.grade === 'perfect' || e.grade === 'great') app.crew.react('cheer', e.grade === 'perfect' ? 1.9 : 1.1);
    if (e.grade === 'perfect') {
      app.hitStop = 0.07;
      buzz([12, 40, 24]);
    }
  });
  s.on('overboard', () => app.crew.react('wince', 2.6));
  s.on('impact', (e) => {
    if (e.dv > 7) {
      app.crew.react('duck', 1.2);
      app.hitStop = Math.max(app.hitStop, 0.05);
    }
    if (e.dv > 4) buzz(Math.min(60, Math.round(e.dv * 5)));
  });
}

async function onFinish(s, res) {
  if (app.session !== s) return;
  app.mode = 'results';
  sdk.gameplayStop();
  input.clear();
  if (app.tutorial) {
    app.tutorial.dispose();
    app.tutorial = null;
  }
  const level = app.level;
  const endless = !!level.endless;
  const d = save.data;
  let payout = 0;
  let newBest = false;
  let newStars = 0;
  if (endless) {
    payout = 0; // (the main shift pays as it goes)
    d.endless.runs++;
    if (res.score > d.endless.best) {
      d.endless.best = res.score;
      newBest = true;
    }
    d.endless.bestShips = Math.max(d.endless.bestShips || 0, res.ships);
  } else if (level.daily) {
    const dd = d.daily;
    if (dd.date !== level.date) Object.assign(dd, { date: level.date, best: 0, stars: 0 });
    dd.plays = (dd.plays || 0) + 1;
    if (res.success) {
      newBest = res.score > dd.best;
      if (newBest) dd.best = res.score;
      newStars = Math.max(0, res.stars - dd.stars);
      dd.stars = Math.max(dd.stars, res.stars);
      // a completed shift on a new date extends (or restarts) the run of nights
      if (dd.last !== level.date) {
        dd.streak = dd.last === dayBefore(level.date) ? (dd.streak || 0) + 1 : 1;
        dd.last = level.date;
        dd.bestStreak = Math.max(dd.bestStreak || 0, dd.streak);
      }
      payout = Math.round(res.score * 0.3) + newStars * 60;
    } else payout = Math.round(res.score * 0.1);
  } else if (res.success) {
    const r = save.recordShift(level.id, res.stars, res.score);
    newStars = r.gainedStars;
    newBest = r.newBest;
    payout = Math.round(res.score * 0.3) + newStars * 80;
  } else {
    payout = Math.round(res.score * 0.1);
  }
  // the unlisted box: remember what became of it, and pay whoever keeps leaving envelopes
  let hush = 0;
  let ending = null;
  d.story = d.story || { boxes: {}, opened: {}, ending: null };
  if (!endless && res.success && res.black) {
    d.story.boxes[level.id] = res.black;
    if (res.black === 'ship') hush = 300 + (BLACK_BOXES[level.id] ? BLACK_BOXES[level.id].n * 40 : 0);
    payout += hush;
    if (level.id === 's12') {
      ending = epilogue(d.story);
      if (ending) d.story.ending = ending.id;
    }
  }
  // the foreman's side job: paid the first time it is pulled off
  let order = null;
  if (!endless && res.success && level.order) {
    let done = false;
    try {
      done = !!level.order.test(res);
    } catch (e) {}
    const rec = level.daily ? null : d.shifts[level.id];
    const first = done && (level.daily ? d.daily.order !== level.date : rec && !rec.order);
    if (first) {
      if (level.daily) d.daily.order = level.date;
      else rec.order = true;
      payout += level.order.cash;
    }
    order = { text: level.order.text, done, cash: first ? level.order.cash : 0 };
  }
  d.stats.busted = (d.stats.busted || 0) + (res.stats.busted || 0);
  d.stats.smuggled = (d.stats.smuggled || 0) + (res.stats.smuggled || 0);
  d.stats.long = (d.stats.long || 0) + (res.stats.long || 0);
  d.money += payout;
  d.stats.placed += res.stats.placed;
  d.stats.lost += res.stats.lost;
  d.stats.perfects += res.stats.perfect;
  d.stats.earned += payout;
  d.stats.bestCombo = Math.max(d.stats.bestCombo || 0, res.bestCombo);
  const fresh = checkAwards(d, res, level);
  save.commit(true);
  const idx = SHIFTS.indexOf(level);
  const meta = { level, payout, newStars, newBest, endless, hush, ending, order, nextLevel: !endless && res.success && idx >= 0 && idx < SHIFTS.length - 1 ? SHIFTS[idx + 1] : null };
  app.lastResult = { res, meta };
  showHud(false);
  setCab(false, true);
  app.timers.length = 0;
  setPower(true);
  if (endless) {
    app.juice.banner('CLOCKED OUT', `${res.ships} ship${res.ships === 1 ? '' : 's'} · ${fmtNum(res.score)} points`, 2200);
    audio.play('horn_ship', { vol: 0.6 });
  } else if (res.success) {
    app.juice.banner(res.stars >= 3 ? 'FLAWLESS SHIFT' : 'SHIFT COMPLETE', s.ship.name + ' is ready to sail', 2200);
    audio.play('horn_ship', { vol: 0.7 });
    audio.play(res.stars >= 3 ? 'sting_win3' : 'sting_win', { delay: 0.5 });
  } else {
    app.juice.banner(endless ? 'OVERTIME OVER' : 'SHIFT FAILED', res.reason === 'strikes' ? 'Too many boxes lost' : 'Out of time', 2200);
    audio.play('sting_fail', { delay: 0.2 });
  }
  app.cams.setMode('menu', 2.6);
  await wait(res.success ? 2100 : 1900);
  if (app.session !== s || app.mode !== 'results') return;
  // the last ship of the night sails into the sunrise
  if (res.success && level.id === 's12') {
    setDawn(true);
    app.radio.clear();
    app.juice.clearToasts();
    audio.music.setPlaylist(['menu']);
    app.juice.letterbox(true, '');
    app.juice.caption('05:58', 'First light over Pier Seven');
    await wait(4200);
    if (app.session !== s || app.mode !== 'results') return;
    app.juice.caption('MV LOW TIDE', 'Outbound · all boxes accounted for');
    await wait(3600);
    app.juice.letterbox(false);
    await wait(500);
    if (app.session !== s || app.mode !== 'results') return;
  }
  audio.play('ui_open');
  app.radio.clear();
  app.screens.results(res, meta);
  if (endless && newBest) sdk.happytime();
  // commendations arrive after the report has had its moment
  fresh.forEach((a, i) =>
    setTimeout(() => {
      if (app.mode !== 'results') return;
      app.juice.toast({ text: `Commendation earned — ${a.name}`, kind: 'good', dur: 4200, silent: true });
      audio.play('sting_levelup', { vol: 0.8 });
    }, 4200 + i * 1500)
  );
}

// ====================================================================== boot

function setLoad(p, text) {
  $('loadfill').style.width = Math.round(clamp(p, 0, 1) * 100) + '%';
  if (text) $('loadtext').textContent = text;
}

function fail(msg) {
  $('loadtext').textContent = msg;
  $('loadfill').style.background = '#b3382d';
  $('loadfill').style.width = '100%';
}

async function boot() {
  save.load();
  const mobile = isMobile();
  document.body.classList.toggle('touch', app.touchMode);
  document.body.classList.toggle('ios', isIOS());
  const orient = () => {
    document.body.classList.toggle('landscape', window.innerWidth >= window.innerHeight);
    document.body.classList.toggle('portrait', window.innerWidth < window.innerHeight);
  };
  orient();
  window.addEventListener('resize', orient);
  setLoad(0.04, 'Clocking in…');

  const sdkReady = sdk.init().then(() => {
    sdk.loadingStart();
    const apply = (st) => audio.setMuted(!!(st && st.muteAudio), 'platform');
    apply(sdk.settings());
    sdk.onSettings(apply);
  });

  if (!gfx.init($('game'))) {
    fail('This device could not start WebGL. Try another browser.');
    return;
  }
  audio.init(SOUNDS);
  audio.onTrack = (t) => {
    app.nowPlaying = t;
    if (app.screens) app.screens._setTrack(t);
  };
  app.applySettings();

  // fonts feed the canvas-drawn textures, so wait for them (briefly)
  const fonts = ['400 32px "Saira Stencil One"', '700 32px "Barlow Condensed"', '400 32px "Bungee"'];
  await Promise.race([Promise.all(fonts.map((f) => (document.fonts && document.fonts.load ? document.fonts.load(f) : null))).catch(() => {}), wait(1200)]);
  setLoad(0.12, 'Warming up the winches…');

  try {
    await initPhysics();
  } catch (e) {
    fail('Could not start the physics engine (WebAssembly is unavailable).');
    if (typeof __DEV__ !== 'undefined' && __DEV__) console.error('physics init', e && (e.stack || e.message || e));
    return;
  }
  setLoad(0.35, 'Building the pier…');

  // ---- world
  initMaterials({ mobile });
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(PAL.fog, 0.0105);
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 1400);
  camera.position.set(-10, 20, 50);
  app.scene = scene;
  app.camera = camera;
  camera.layers.enable(1); // haze fakes (see FX_LAYER): seen by the player, left out of the sea's mirror image
  gfx.setup(scene, camera);
  app._quality = save.data.settings.quality;
  gfx.applyQuality(save.data.settings.quality, save.data.settings.autoLevel || 0);
  gfx.onAdapt = (lvl) => {
    save.data.settings.autoLevel = lvl;
    save.commit();
    document.body.classList.toggle('post', gfx.usePost);
  };
  document.body.classList.toggle('post', gfx.usePost);

  app.harbor = new Harbor(scene, { mobile, aniso: Math.min(8, gfx.maxAniso) });
  await wait(0);
  app.water = new Water(scene, { mobile });
  app.weather = new Weather(scene, { count: gfx.rainCount, mobile });
  app.fx = new Fx(scene, { budget: gfx.particleBudget, mobile });
  app.crane = new CraneView(scene, { paint: save.data.paint, mobile });
  app.crew = new Crew(scene);
  app.cams = new CameraRig(camera);
  app.cams.shakeEnabled = save.data.settings.shake !== false;
  app.tweens = new Tweens();
  app.juice = new Juice(camera);
  app.touch = new TouchControls();
  app.radio = new Radio();
  app.deep = new DeepLight(scene);
  app.tug = new Tug(scene);
  app.gulls = new Gulls(scene, mobile ? 4 : 7);
  app.wet = new WetShine(scene, { y: DIM.QUAY_Y, bounds: { minX: -90, maxX: -0.3, halfZ: 160 }, count: mobile ? 12 : 22 });
  app.hud = new Hud({ onPause: () => app.pause(), onCamera: toggleCamera, onUpgrade: () => app.openWorkshopInPlay(), touch: app.touchMode });
  app.coach = new Coach(save, () => app.touchMode);
  app.screens = new Screens(app);
  app.ctx = { scene, harbor: app.harbor, water: app.water, weather: app.weather, fx: app.fx, crane: app.crane, cams: app.cams, save, mobile };

  app.weather.onThunder = (delay) => audio.play('thunder', { delay, vol: 1 });
  app.weather.onGustWarn = () => {
    if (app.mode === 'play') {
      app.juice.toast({ text: 'Gust incoming — brace the load!', kind: 'warn', key: 'gust' + Math.floor(app.time / 4), dur: 2000, silent: true });
      audio.play('ui_warn', { vol: 0.5 });
    }
  };
  app.weather.onGust = () => audio.play('gust', { vol: 0.9 });

  setLoad(0.8, 'Fuelling the trucks…');
  makeAttract();
  // compile shaders + upload textures before the doors open
  gfx.renderer.compile(scene, camera);
  bindGlobalInput();
  // the platform gets a moment to answer; sounds stream in after the first frame
  await Promise.race([sdkReady.catch(() => {}), wait(1500)]);
  // signed-in CrazyGames players carry their progress between devices
  if (save.attachCloud(sdk.data)) {
    app.applySettings();
    app.applyPaint();
  }
  setLoad(1, 'Ready');
  sdk.loadingStop();
  updatePort(false);
  const idle = idleEarnings();
  save.data.lastSeen = Date.now();
  save.commit();
  startAmbience();
  requestAnimationFrame(frame);
  const first = !save.data.flags.played && !(save.data.stats.placed > 0);
  if (first) {
    // a brand-new player starts at the controls, a box on the hook
    app.mode = 'menu';
    await app.startEndless(true);
  } else {
    app.mode = 'menu';
    if (idle) app.screens.welcome(idle);
    else app.screens.title();
    audio.music.setPlaylist(['menu']);
  }
  await wait(250);
  $('loading').classList.add('out');
  setTimeout(() => $('loading').remove(), 800);
  setTimeout(() => audio.load(), 400);
}

/** What the night crew got done while the player was away (up to eight hours of it). */
function idleEarnings() {
  const d = save.data;
  if (!d.lastSeen || !d.flags.played) return null;
  const mins = (Date.now() - d.lastSeen) / 60000;
  if (mins < 10) return null;
  const hrs = Math.min(8, mins / 60);
  const l = app.harbor.portLevel || 0;
  const boxes = Math.max(1, Math.floor(hrs * (6 + 4 * l)));
  return { boxes, cash: boxes * (12 + 5 * l), hrs, episode: !!episodeFor(d.story, todayKey()) };
}

/** Collect the crew's takings (doubled after a rewarded ad when the platform offers one). */
app.collectIdle = async (idle, double) => {
  if (double && sdk.available) {
    const r = await sdk.rewarded({ pause: () => audio.setMuted(true, 'ad'), resume: () => audio.setMuted(false, 'ad') });
    if (!r.rewarded) double = false;
  }
  const cash = idle.cash * (double ? 2 : 1);
  const d = save.data;
  d.money += cash;
  d.stats.earned += cash;
  d.stats.crew = (d.stats.crew || 0) + idle.boxes;
  save.commit(true);
  audio.play('ui_cash');
  updatePort(true);
  app.screens.title();
};

// ====================================================================== input glue

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -5);
const _hit = new THREE.Vector3();
/** Screen point -> the spot on the quay / deck under it (a plane at roughly box-top height). */
function pickGround(cx, cy) {
  _ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  _ray.setFromCamera(_ndc, app.camera);
  return _ray.ray.intersectPlane(_plane, _hit);
}

function bindGlobalInput() {
  const canvas = $('game');
  let drag = null;
  let finger = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (app.mode !== 'play') return;
    const s = app.session;
    // one-touch play: a finger puts the spreader where it points; a tap locks or lets go
    if (e.pointerType === 'touch' && s && !s.attract) {
      app.setTouchMode(true);
      finger = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, t: performance.now() };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (err) {}
      return;
    }
    if (app.cams.mode !== 'chase') return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: app.cams.yaw, pitch: app.cams.pitch };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {}
  });
  canvas.addEventListener('pointermove', (e) => {
    if (finger && e.pointerId === finger.id) {
      if (!finger.moved && Math.hypot(e.clientX - finger.x, e.clientY - finger.y) < 12) return;
      finger.moved = true;
      const p = pickGround(e.clientX, e.clientY);
      if (p && app.session) app.session.setTarget(p.x, p.z, true);
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    const k = 2.4 / Math.max(320, window.innerHeight);
    app.cams.yaw = clamp(drag.yaw - (e.clientX - drag.x) * k, -0.95, 1.05);
    app.cams.pitch = clamp(drag.pitch + (e.clientY - drag.y) * k, -0.24, 0.6);
  });
  const end = (e) => {
    if (finger && e.pointerId === finger.id) {
      const s = app.session;
      if (s && app.mode === 'play') {
        if (!finger.moved && performance.now() - finger.t < 450) input.fire('lock');
        else {
          // let go: settle on whatever the finger was obviously aiming for
          const p = pickGround(e.clientX, e.clientY);
          if (p) {
            const t = s.snapTarget(p.x, p.z);
            s.setTarget(t.x, t.z, false);
          } else if (s.target) s.target.held = false;
        }
      }
      finger = null;
      return;
    }
    if (drag && e.pointerId === drag.id) drag = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (app.mode !== 'play') return;
      app.cams.zoom = clamp(app.cams.zoom * (1 + Math.sign(e.deltaY) * 0.08), 0.7, 1.4);
      e.preventDefault();
    },
    { passive: false }
  );
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && app.mode === 'play') app.pause();
  });
  window.addEventListener('blur', () => {
    if (app.mode === 'play' && !sdk.adActive) app.pause();
  });
  // stop the page from scrolling / zooming under the game
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener(
    'touchmove',
    (e) => {
      if (!e.target.closest || !e.target.closest('.card-body, .rows')) e.preventDefault();
    },
    { passive: false }
  );
  // whichever device the player actually touches decides which controls are on screen
  window.addEventListener('pointerdown', (e) => e.pointerType === 'touch' && app.setTouchMode(true), true);
  input.anyKeyHandlers.add((e) => {
    if (!e.ctrlKey && !e.metaKey && !e.altKey && /^(Key[A-Z]|Arrow|Space|Shift|Enter|Page)/.test(e.code)) app.setTouchMode(false);
    if (app.mode === 'intro' && app._skipTour && (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape')) app._skipTour();
    // Enter = the highlighted action, Esc = back, on any open menu
    const scr = app.screens && app.screens.current;
    if (!scr || app.busy) return;
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      const b = scr.querySelector('.btn.primary:not([disabled]), .btn.teal:not([disabled])');
      if (b) b.click();
    } else if (e.code === 'Escape' && app.mode !== 'paused') {
      const b = scr.querySelector('.btn[data-sound="ui_back"]:not([disabled])');
      if (b) b.click();
    }
  });
}

// ====================================================================== gamepad in menus

/** Every clickable thing on the open screen, in reading order. */
function menuTargets(scr) {
  return [...scr.querySelectorAll('.btn, .tcard:not(.locked), .paint:not(.locked), .seg button, input[type=range]')].filter((el) => !el.disabled && el.offsetParent !== null);
}

/** D-pad / stick moves a highlight between buttons, A presses, B goes back. */
function padMenus() {
  if (input.lastDevice !== 'gamepad') {
    if (app._padFocus) {
      app._padFocus.classList.remove('padfocus');
      app._padFocus = null;
    }
    return;
  }
  const A = input.touchPressed.has('lock');
  const B = input.touchPressed.has('horn');
  if (app.mode === 'intro' && app._skipTour && A) return app._skipTour();
  const scr = app.screens && app.screens.current;
  if (!scr || app.busy || app.mode === 'play') return;
  const p = input.pad;
  const dir = Math.abs(p.z) > 0.55 ? (p.z > 0 ? 1 : -1) : Math.abs(p.x) > 0.55 ? (p.x > 0 ? 1 : -1) : 0;
  const list = menuTargets(scr);
  let cur = app._padFocus && list.includes(app._padFocus) ? app._padFocus : null;
  const slider = cur && cur.tagName === 'INPUT';
  if (dir !== app._padDir) {
    app._padDir = dir;
    if (dir && slider && Math.abs(p.x) > 0.55) {
      // left / right on a slider changes its value
      cur.value = String(clamp(Number(cur.value) + dir * 10, 0, 100));
      cur.dispatchEvent(new Event('input'));
      cur.dispatchEvent(new Event('change'));
    } else if (dir && list.length) {
      const i = cur ? list.indexOf(cur) : -1;
      const next = list[(i + dir + list.length) % list.length];
      if (cur) cur.classList.remove('padfocus');
      next.classList.add('padfocus');
      next.scrollIntoView({ block: 'nearest' });
      app._padFocus = cur = next;
      audio.play('ui_hover');
    }
  }
  if (A) {
    const target = cur || scr.querySelector('.btn.primary:not([disabled]), .btn.teal:not([disabled]), .btn.night:not([disabled])');
    if (target && target.tagName !== 'INPUT') target.click();
  } else if (B) {
    // on the pause card B means "back to work" (its ghost button would clock you out)
    if (app.mode === 'paused' && app.screens.name === 'pause') return app.resume();
    const back = scr.querySelector('.btn[data-sound="ui_back"]:not([disabled])');
    if (back) back.click();
  }
}

// ====================================================================== ambience

function startAmbience() {
  app.amb = {
    rain: audio.loop('rain_loop'),
    rainCab: audio.loop('rain_cab_loop'),
    sea: audio.loop('sea_loop'),
    waves: audio.loop('waves_loop'),
    wind: audio.loop('wind_loop'),
    cab: audio.loop('cab_hum'),
  };
}

function updateAmbience(dt) {
  const a = app.amb;
  if (!a || !audio.ctx || audio.ctx.state !== 'running') return;
  const w = app.weather.cur;
  const cab = app.cams.mode === 'cab' ? 1 : 0;
  const menuDuck = app.mode === 'menu' ? 0.6 : 1;
  a.rain.set(clamp(w.rain, 0, 1) * 0.85 * (1 - cab * 0.55) * menuDuck);
  a.rainCab.set(clamp(w.rain, 0, 1) * cab * 0.9);
  a.sea.set((0.55 + w.sea * 0.3) * menuDuck);
  a.waves.set(clamp((w.sea - 0.25) * 1.3, 0, 1) * 0.8 * menuDuck);
  a.wind.set(clamp(app.weather.windSpeed / 2.2, 0, 1) * 0.95 * menuDuck + 0.06);
  a.cab.set(cab * 0.8);
  // sparse harbour life
  const T = app.ambT;
  T.crow -= dt;
  T.bell -= dt;
  T.horn -= dt;
  if (T.crow < 0) {
    T.crow = rand(18, 50);
    audio.play('crow', { pan: rand(-0.8, 0.8), vol: rand(0.4, 1) });
  }
  if (T.bell < 0) {
    T.bell = rand(9, 22) / (0.5 + w.sea);
    audio.play('bell_buoy', { pan: rand(0.2, 0.9), vol: rand(0.5, 1) });
  }
  if (T.horn < 0) {
    T.horn = rand(70, 150);
    audio.play('horn_ship', { pan: rand(-0.6, 0.6), vol: 0.14, rate: rand(0.8, 1.1) });
  }
}

// ====================================================================== frame

const _fogA = new THREE.Color(PAL.fog);
const _moonCol = new THREE.Color(PAL.moon);
const _sunCol = new THREE.Color(0xffb27a);
const _skyCol = new THREE.Color(0x5f7fa8);
const _daySkyCol = new THREE.Color(0x9a8fb0);
const _dawnFog = new THREE.Color(0x56495a);
const _fogB = new THREE.Color(0x2a3338);
const _crewCtx = { focus: null, shadow: { x: 0, z: 0, h: 99 }, carrying: false };
const _lights = [];
const _lightPool = Array.from({ length: 16 }, () => ({ pos: new THREE.Vector3(), color: new THREE.Color(), power: 1 }));
const _tmp = new THREE.Vector3();
function waterLights() {
  _lights.length = 0;
  let n = 0;
  const add = (x, y, z, hex, power) => {
    if (n >= _lightPool.length) return null;
    const l = _lightPool[n++];
    l.pos.set(x, y, z);
    l.color.set(hex);
    l.power = power;
    _lights.push(l);
    return l;
  };
  const s = app.session;
  const crane = app.crane;
  // whatever is under the pier lights the swell from below
  const dg = app.deep.glow;
  if (dg > 0.02) add(app.deep.pos.x, 5, app.deep.pos.z, 0x45ffc8, 1.7 * dg);
  // trolley work light: the brightest thing over the water
  add(crane.trolley.position.x, DIM.RAIL_Y - 0.6, crane.gantry.position.z, PAL.sodiumHot, 1.3 * (0.5 + 0.5 * crane.power));
  for (let i = 0; i < crane.floodPositions.length; i += 2) {
    const p = crane.floodPositions[i];
    if (p.x < 0 || crane.power < 0.05) continue;
    add(p.x, p.y, p.z + crane.gantry.position.z, PAL.sodiumHot, 0.7 * crane.power);
  }
  if (s && s.ship) {
    const sh = s.ship;
    for (const p of [sh.mastTop, sh.foreLight, sh.deckLamps[0], sh.deckLamps[1]]) {
      sh.localToWorld(p, _tmp);
      add(_tmp.x, _tmp.y, _tmp.z, 0xffe2b0, 0.7);
    }
  }
  for (const l of app.harbor.lampHeads) {
    if (l.pos.x < -30) continue;
    const lit = l.flick == null ? 1 : l.flick;
    if (lit < 0.05) continue;
    const e = add(l.pos.x, l.pos.y, l.pos.z, 0, (l.hgt > 12 ? 0.8 : 0.6) * lit);
    if (e) e.color.copy(l.color);
  }
  const lh = app.harbor.lighthouse.position;
  add(lh.x, lh.y, lh.z, 0xfff2d0, 0.8);
  app.water.setLights(_lights);
}

// ---- wet quay: every lamp over the concrete gets a reflection streak
const _wetList = [];
const _wetPool = Array.from({ length: 32 }, () => ({ pos: new THREE.Vector3(), color: new THREE.Color(), power: 1, width: 0, gain: 1, len: 0 }));
function wetLights() {
  _wetList.length = 0;
  let n = 0;
  const add = (x, y, z, power, width = 0, gain = 1) => {
    if (n >= _wetPool.length || power < 0.03) return null;
    const l = _wetPool[n++];
    l.pos.set(x, y, z);
    l.power = power;
    l.width = width;
    l.gain = gain;
    l.len = 0;
    _wetList.push(l);
    return l;
  };
  const crane = app.crane;
  const gz = crane.gantry.position.z;
  // nearest the action first: the pool is small
  const tx = crane.trolley.position.x;
  if (tx < -1.5) {
    const e = add(tx, DIM.RAIL_Y - 0.6, gz, 0.9 * (0.62 + 0.38 * crane.power), 2.6);
    if (e) e.color.set(PAL.sodiumHot);
  }
  for (const nz of app.harbor.neons) {
    const e = add(nz.pos.x, nz.pos.y, nz.pos.z, nz.power, nz.width, 1.25);
    if (e) e.color.copy(nz.color);
  }
  // trucks: headlights ahead, tail lights behind
  if (app.session) {
    for (const tr of app.session.trucks) {
      if (tr.state === 'gone' || Math.abs(tr.z) > 60) continue;
      if (tr.livery !== 'unmarked') {
        const e = add(tr.laneX, DIM.QUAY_Y + 1.0, tr.z + 6.6, 0.55, 2.0);
        if (e) {
          e.color.set(0xfff2d0);
          e.len = 11;
        }
      }
      const t = add(tr.laneX, DIM.QUAY_Y + 0.8, tr.z - 4.0, 0.3, 1.7);
      if (t) {
        t.color.set(0xff2a1e);
        t.len = 6;
      }
    }
  }
  for (const l of app.harbor.lampHeads) {
    const e = add(l.pos.x, l.pos.y, l.pos.z, (l.flick == null ? 1 : l.flick) * (l.hgt > 12 ? 0.85 : 0.6));
    if (e) e.color.copy(l.color);
  }
  for (let i = 0; i < crane.floodPositions.length; i++) {
    const p = crane.floodPositions[i];
    if (p.x > -1) continue;
    const e = add(p.x, p.y, p.z + gz, 0.5 * crane.power, 1.6);
    if (e) e.color.set(PAL.sodiumHot);
  }
  const w = app.weather.cur;
  // (without bloom the streaks need more of their own light to read)
  // (snow on the ground soaks up the reflections a wet quay would show)
  app.wet.update(_wetList, app.camera, clamp(0.42 + w.rain * 0.7 - app.weather.cover * 0.6, 0, 1), w.fog, gfx.usePost ? 1 : 1.8);
}

let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const raw = Math.min(0.1, Math.max(0, (now - last) / 1000 || 0.016));
  last = now;
  tick(raw);
  // mirror image for the sea: every other frame is plenty (and skipped behind blurred menus)
  const mirror = gfx.reflections && !gfx.softTarget && !gfx.contextLost;
  if (mirror && (app._mirrorTick = !app._mirrorTick)) {
    const s = app.session;
    app.water.renderReflection(gfx.renderer, app.scene, app.camera, [app.harbor.sky, app.weather.rain, app.weather.snow, app.weather.splashes, app.weather.bolt, app.wet.mesh, app.deep.group, s && s.guides && s.guides.group], app.water.uniforms.uSkyTop.value);
  }
  app.water.setReflection(mirror || (gfx.reflections && gfx.softTarget), raw);
  gfx.render(raw, app.time);
  input.endFrame();
}

function tick(raw) {
  input.poll();
  const frozen = app.mode === 'paused' || sdk.adActive;
  // hit-stop: a few frozen frames on the big moments
  let dt = frozen ? 0 : raw;
  if (app.hitStop > 0 && !frozen) {
    app.hitStop -= raw;
    dt = raw * 0.05;
  }
  app.time += dt;
  const s = app.session;

  padMenus();
  // --- global actions
  if (app.mode === 'play') {
    if (input.action('pause')) app.pause();
    else if (input.action('camera')) toggleCamera();
  } else if (app.mode === 'paused' && input.action('pause')) app.resume();

  input.enabled = app.mode === 'play';
  if (s && !frozen) {
    s.update(dt);
    if (app.tutorial) app.tutorial.update(dt);
  }
  const focus = app.cams.focus;
  app.weather.update(dt, app.camera, focus, window.innerHeight * gfx.pixelRatio);
  // (photosensitivity option: lightning still shows, but only as a soft brightening)
  const flash = app.weather.flash * (save.data.settings.flashes === false ? 0.22 : 1);
  app.harbor.update(dt, app.time, flash, app.weather);
  const gantryMove = s ? Math.abs(s.rig.vz) / 4.8 : 0;
  app.crane.update(dt, app.time, gantryMove);
  if (s) {
    _crewCtx.focus = s.rig.sprPos;
    _crewCtx.shadow.x = s.rig.sprPos.x;
    _crewCtx.shadow.z = s.rig.sprPos.z;
    _crewCtx.shadow.h = s.rig.sprPos.y - DIM.QUAY_Y;
    _crewCtx.carrying = !!s.rig.carry && app.mode === 'play';
    app.crew.update(dt, app.time, _crewCtx);
  }
  app.fx.update(dt);
  app.tweens.update(dt);
  app.radio.update(frozen ? 0 : raw);
  app.deep.update(dt, app.time);
  // the tug comes out whenever a ship is being moved; gulls keep off in a storm
  app.tug.update(dt, s && s.ship, !!(s && s.ship && Math.abs(s.ship.offsetZ) > 0.3), app.water);
  app.gulls.setVisible(app.weather.cur.storm < 0.4 && app.weather.cur.snow < 0.5);
  app.gulls.update(dt, app.time, app.weather.wind);
  app.crane.setPower(app.harbor.powerNow);
  if (app.timers.length && dt > 0) {
    for (const tm of [...app.timers]) {
      tm.t -= dt;
      if (tm.t > 0) continue;
      app.timers.splice(app.timers.indexOf(tm), 1);
      if (tm.session === app.session && app.mode === 'play') tm.fn();
    }
  }
  // now and then, behind the menus, something swims past the berth
  if (app.mode === 'menu') {
    app.ambT.deep -= dt;
    if (app.ambT.deep < 0) {
      app.ambT.deep = rand(70, 130);
      app.deep.pass(15, 7);
    }
  }

  // --- lighting reacts to weather
  const w = app.weather.cur;
  app.scene.fog.density = w.fog;
  // thick fog scatters the sodium light: the haze itself brightens and warms
  const thick = clamp((w.fog - 0.0105) / 0.024, 0, 1);
  app.scene.fog.color.copy(_fogA).lerp(_fogB, thick);
  app.harbor.skyUniforms.uFogCol.value.copy(app.scene.fog.color);
  app.harbor.skyUniforms.uFogMix.value = clamp(thick * 1.15, 0, 0.96);
  const day = app.harbor.daylight;
  app.harbor.hemi.intensity = app.harbor.hemiBase * app.harbor.hemiPower + day * 0.75 + flash * 3.5;
  app.harbor.moon.intensity = 0.42 * (1 - w.clouds * 0.45) + day * 0.9 + flash * 2.2;
  if (day > 0.001) {
    app.harbor.moon.color.copy(_moonCol).lerp(_sunCol, day);
    app.harbor.hemi.color.copy(_skyCol).lerp(_daySkyCol, day);
    app.scene.fog.color.lerp(_dawnFog, day * 0.85);
    app.harbor.skyUniforms.uFogCol.value.copy(app.scene.fog.color);
  } else if (app._wasDay) {
    app.harbor.moon.color.copy(_moonCol);
    app.harbor.hemi.color.copy(_skyCol);
  }
  app._wasDay = day > 0.001;
  app.harbor.skyUniforms.uClouds.value = w.clouds;
  app.harbor.setVisibility(clamp(1.25 - w.fog * 38, 0.06, 1));
  if (flash > 0.02 && gfx.flash < flash * 0.5) gfx.flash = flash * 0.5;
  app.water.setSky(app.harbor.skyUniforms.uMid.value, app.harbor.skyUniforms.uGlow.value);
  app.water.update(dt, { amp: 0.16 + w.sea * 0.9, fogColor: app.scene.fog.color, fogDensity: w.fog, rain: w.rain, flash });
  waterLights();

  // --- funnel smoke
  if (s && s.ship && !frozen) {
    app.ambT.smoke -= dt;
    if (app.ambT.smoke < 0) {
      app.ambT.smoke = 0.42;
      const p = s.ship.localToWorld(s.ship.funnelTop, _tmp);
      app.fx.puff(p.x, p.y, p.z, 0.55, 0x4a5056, 1.5, app.weather.wind.x * 0.8, app.weather.wind.z * 0.8);
    }
  }

  app.cams.update(raw, s ? { rig: s.rig, groundY: s.groundY } : null);
  wetLights();
  audio.setListener(app.camera);
  if (app.mode === 'play' && s) {
    const hs = s.hud();
    app.hud.update(hs);
    applyCabGhost(app.cams.mode === 'cab' ? s.rig.carry : null);
  }
  // coaching (one prompt at a time) and the automatic helpers it hands out
  if (app.mode === 'play' && s && !s.attract && !app.tutorial) {
    app.coach.update(s);
    app.coach.tick(dt);
  } else app.coach.hide();
  // a heartbeat for the night crew's clock
  app._seenT = (app._seenT || 0) - raw;
  if (app._seenT < 0) {
    app._seenT = 20;
    save.data.lastSeen = Date.now();
    save.commit();
  }
  updateAmbience(dt);
  audio.update();
}

window.addEventListener('error', (e) => {
  if (app.mode === 'boot') fail('Something went wrong while loading. Please reload.');
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.error(e.error || e.message);
});

if (typeof __DEV__ !== 'undefined' && __DEV__) {
  // development-only hooks (stripped from the production bundle)
  window.__nsc = {
    app,
    gfx,
    audio,
    save,
    input,
    SHIFTS,
    THREE,
    dailyShift,
    endlessShip,
    sim(sec, step = 1 / 60) {
      const n = Math.round(sec / step);
      for (let i = 0; i < n; i++) {
        tick(step);
        input.endFrame();
      }
    },
  };
}

boot();
