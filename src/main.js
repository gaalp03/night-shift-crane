// Night Shift Crane — application shell: boot, world, game flow, main loop.
import * as THREE from 'three';
import { DIM, PAL } from './config.js';
import { clamp, damp, rand, fmtNum, isMobile, isIOS, Tweens } from './core/util.js';
import { save } from './core/save.js';
import { sdk } from './core/sdk.js';
import { input } from './core/input.js';
import { audio } from './core/audio.js';
import { SOUNDS, SOUND_GROUPS, soundsForLevel } from './core/sounds.js';
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
import { SHIFTS, UPGRADES, endlessShip, upgradeMods, dailyShift, todayKey, dayBefore, weekKey, weekDaysLeft, portLevel, PORT_STEPS } from './game/levels.js';
import { Coach } from './game/coach.js';
import { analytics } from './core/analytics.js';
import { icon } from './ui/icons.js';
import { h } from './core/util.js';
import { checkAwards } from './game/awards.js';
import { Juice } from './ui/juice.js';
import { Hud } from './ui/hud.js';
import { TouchControls } from './ui/touch.js';
import { Screens } from './ui/screens.js';
import { Radio } from './ui/radio.js';
import { DeepLight } from './world/deep.js';
import { WetShine } from './world/shine.js';
import { Tug, Gulls } from './world/harborlife.js';
import { BLACK_ORDER, CLIFFHANGERS, episodeFor, SHIFT_OPEN, SHIFT_BEATS, CHECK_INTRO, LONG_INTRO, BLACK_BOXES, BLACKOUT, SMUGGLE_FOUND, epilogue } from './game/story.js';

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
  mods: () => upgradeMods(save.data.upgrades, save.data.rigSetup),
  adsAvailable: () => sdk.adsEnabled,
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
    return { date: today, best: fresh ? dd.best : 0, stars: fresh ? dd.stars : 0, order: dd.order === today, streak: dd.streak || 0, bestStreak: dd.bestStreak || 0, plays: dd.plays || 0 };
  },

  /** Touch controls follow the device actually in use: a finger shows them, a key press hides them. */
  setTouchMode(v, force = false) {
    v = !!v;
    // (when the platform has said what this device is, that answer stands)
    if (app.deviceLocked && !force) return;
    if (app.touchMode === v) return;
    app.touchMode = v;
    document.body.classList.toggle('touch', v);
    if (app.touch) app.touch.show(false); // (one-touch play: the old stick and buttons never come back)
    if (app.tutorial) app.tutorial.setTouch(v);
    if (!v) input.touch.x = input.touch.z = input.touch.hoist = 0;
  },

  /** Sound on / off (remembered; the platform's own mute is separate and always wins). */
  toggleMute(v) {
    const st = save.data.settings;
    st.muted = v == null ? !st.muted : !!v;
    save.commit();
    audio.setMuted(st.muted, 'user');
    app.hud.setMuted(st.muted);
    const b = $('mutebtn');
    if (b) b.innerHTML = icon(st.muted ? 'mute' : 'speaker');
  },

  /** The mouse steers like a finger (drag + click) once it is used on the game. */
  setMouseMode(v) {
    app.mouseMode = !!v && !app.touchMode;
  },

  /** The rest of the sound set (menus, results, flavour) and the music: after the first ship. */
  needLater() {
    if (app._later) return;
    app._later = true;
    audio.need(SOUND_GROUPS.later);
    audio._openMusic();
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
      syncSilhouette();
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
  upgradesChanged(info) {
    if (info) analytics.track('upgrade_bought', info);
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
  startEndless(first = false, boot = false, seedIn = null) {
    const seed = seedIn == null ? Math.floor(Math.random() * 1e9) : seedIn;
    return beginRun(endlessShip(0, seed), { seed, first: first === true, boot });
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
    app.needLater(); // (a menu is open: its sounds may as well arrive now)
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
    // real ads: a rewarded video first. Without them (Basic Launch, no SDK) — or if the ad does not
    // come — the second chance is simply free, once per run: the button never does nothing.
    if (sdk.adsEnabled) await sdk.rewarded(adHooks());
    app.busy = false;
    if (!app.session || !app.lastResult) return;
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
  document.body.classList.toggle('hud-on', !!v);
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

/** The cab's name plate (and the cab-view frame) carry the operator's name. */
function setOperator(name) {
  const n = String(name || '').trim().slice(0, 18) || 'Guest';
  app.operator = n;
  if (app.crane && app.crane.setOperator) app.crane.setOperator(n);
  const ov = $('cab-overlay');
  let tag = ov.querySelector('.nameplate');
  if (!tag) {
    tag = h('div.nameplate');
    ov.appendChild(tag);
  }
  tag.textContent = `Crane 07 · ${n}`;
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
  // title -> new run is a natural break (never the very first run of a visit, never from results:
  // the slip already had its break, and a failed one offers the rewarded second chance instead)
  if (app.mode === 'menu' && app.shiftsStarted > 0 && sdk.available && !opts.first && !opts.boot) {
    await sdk.midgame(adHooks());
  }
  app.shiftsStarted++;
  // this level's sounds (the boot run fetches nothing before its first frame)
  if (!opts.boot) {
    audio.need(SOUND_GROUPS.core);
    audio.need(SOUND_GROUPS.play);
    audio.need(soundsForLevel(level));
    app.needLater();
  }
  // (the very first load is already behind the loading screen: no doors needed)
  const cover = opts.first || opts.boot ? async (fn) => fn() : (fn) => app.juice.transition(fn);
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
    applyHudStage();
    // a brand-new operator's first five boxes are forgiving (and loud)
    const f = save.data.flags;
    if (f.rookie == null) f.rookie = f.played ? 5 : 0;
    s.rookieLeft = Math.max(0, 5 - f.rookie);
    if (s.rookieLeft) s.refreshMods();
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
    // (on a fresh page load the player is at the controls at once; the camera settles while they play)
    if (!opts.boot) await wait(level.endless ? 900 : 1500);
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

/** The big DROP button: the only control on screen in the first minute and on portrait phones. */
function updateDrop(s) {
  const portrait = app.touchMode && document.body.classList.contains('portrait');
  const stage = app.level && app.level.endless ? app.hudStage : 3;
  const carry = !!s.rig.carry;
  const show = !s.attract && s.phase === 'play' && (portrait || (stage === 0 && carry));
  if (!show) return app.hud.setDrop({ show: false });
  const g = s.wantedGrab();
  const seat = s.seat;
  const quota = s.endless ? s.level.manifest.filter((m) => !m.black).length : s.quota;
  const done = s.endless ? s.delivered - (s.shipBase || 0) : s.delivered;
  const label = carry ? 'DROP' : g && g.ready ? 'GRAB' : `${Math.max(0, done)}/${quota}`;
  const ready = carry ? stage === 0 || !!(seat && seat.seated && seat.valid) : !!(g && g.ready);
  app.hud.setDrop({ show: true, label, ready, sub: app.touchMode ? '' : '<span class="kbd">SPACE</span>', timeK: s.timeTotal ? s.time / s.timeTotal : 1 });
}

/** The landing target is never lost: off screen, an arrow on the screen edge points to it. */
function updateOffscreen(s) {
  let el = app._off;
  if (!el) {
    el = app._off = h('div#offarrow', { html: icon('next') });
    $('ui').appendChild(el);
  }
  const t = s.rig.carry && s.phase === 'play' && !s.attract ? s.guideSlot : null;
  let show = false;
  if (t) {
    const p = app.juice.project(t);
    const W = window.innerWidth;
    const H = window.innerHeight;
    const m = 44;
    let x = p.x;
    let y = p.y;
    if (p.behind) {
      x = W - x;
      y = H - y;
    }
    if (p.behind || x < m || x > W - m || y < m || y > H - m) {
      const dx = x - W / 2 || 1e-3;
      const dy = y - H / 2 || 1e-3;
      const k = Math.min((W / 2 - m) / Math.abs(dx), (H / 2 - m) / Math.abs(dy));
      el.style.transform = `translate(${(W / 2 + dx * k).toFixed(0)}px, ${(H / 2 + dy * k).toFixed(0)}px) rotate(${Math.atan2(dy, dx).toFixed(2)}rad)`;
      show = true;
    }
  }
  el.classList.toggle('on', show);
}

/** How much of the HUD a new operator sees: 0 = money + DROP only, then more after each ship, 3 = all. */
app.applyHudStage = () => applyHudStage();
function applyHudStage() {
  const f = save.data.flags;
  if (f.hud == null) f.hud = f.played ? 3 : 0;
  app.hudStage = f.hud;
  const st = app.level && !app.level.endless ? 3 : f.hud;
  for (let i = 0; i <= 3; i++) document.body.classList.toggle('hud' + i, st === i);
}

/** Small helpers for icon-first cards. */
function bar(k, cls = '') {
  return `<span class="pbar${cls}"><i style="width:${Math.round(clamp(k, 0, 1) * 100)}%"></i></span>`;
}
function ladder(day) {
  let out = '<span class="ladder">';
  for (let i = 1; i <= 7; i++) out += `<i class="${i < day ? 'done' : i === day ? 'now' : ''}${i === 7 ? ' jack' : ''}"></i>`;
  return out + '</span>';
}

/** After a ship: what it paid, and the very next thing to play for — it never blocks (auto-continues). */
function showShipCard(s, e, cash) {
  const root = $('shipcard');
  root.innerHTML = '';
  const d = save.data;
  let done = false;
  const close = (hurry) => {
    if (done) return;
    done = true;
    if (hurry && app.session === s) s.hurrySwap();
    card.classList.add('out');
    setTimeout(() => card.remove(), 300);
  };
  const head = h('div.t1', { html: icon(e.complete ? 'check' : 'box') + `<span>${e.complete ? 'SHIP ' + e.n : e.placed + '/' + e.quota}</span>` });
  const pay = h('div.t2', cash ? `+$${fmtNum(cash)}` : '');
  const acts = h('div.acts');
  let body;
  if (s.endless && !d.rigSetup && e.n >= 2) {
    // one felt choice, early: a steadier crane or a faster one (try it on the very next ship)
    const opt = (id, ic, word, speed, swing) =>
      h('button.btn.rigopt', {
        onclick: () => {
          if (done) return;
          d.rigSetup = id;
          save.checkpoint();
          if (app.session === s) s.refreshMods();
          audio.play('ui_buy');
          app.juice.burst({ text: word, sub: 'NEXT SHIP', kind: 'good', big: true });
          analytics.track('rig_setup', { setup: id, ship: e.n });
          close(true);
        },
        html: icon(ic) + `<b>${word}</b><span class="row">${icon('motor')}${bar(speed)}</span><span class="row">${icon('sway')}${bar(swing, ' warn')}</span>`,
      });
    body = h('div.rigpick', h('div.t3', { html: icon('wrench') + '<span>CRANE SETUP</span>' }), h('div.opts', opt('steady', 'shield', 'STEADY', 0.4, 0.25), opt('fast', 'bolt', 'FAST', 0.9, 0.8)));
  } else {
    // the cheapest upgrade still to buy: buy it now, or see how close it is
    let up = null;
    for (const u of UPGRADES) {
      const l = d.upgrades[u.id] || 0;
      if (l < u.costs.length && (!up || u.costs[l] < up.cost)) up = { u, l, cost: u.costs[l] };
    }
    const afford = up && d.money >= up.cost;
    if (up) body = h('div.t3', { html: icon(up.u.icon || 'wrench') + bar(d.money / up.cost, afford ? ' ok' : '') + `<span>$${fmtNum(Math.min(d.money, up.cost))}/${fmtNum(up.cost)}</span>` });
    if (afford) {
      acts.appendChild(
        h('button.btn.teal.big', {
          onclick: () => {
            if (done) return;
            const l = d.upgrades[up.u.id] || 0;
            if (d.money < up.u.costs[l]) return;
            d.money -= up.u.costs[l];
            d.upgrades[up.u.id] = l + 1;
            save.checkpoint();
            audio.play('ui_buy');
            audio.play('sting_levelup', { vol: 0.7 });
            sdk.happytime();
            app.upgradesChanged({ id: up.u.id, level: l + 1, cost: up.u.costs[l] });
            app._walletShown = d.money;
            app.hud.setMoney(d.money, app.canUpgrade());
            app.juice.burst({ text: 'UNLOCKED', sub: up.u.name.toUpperCase(), kind: 'good', big: true });
            close(true);
          },
          html: icon(up.u.icon || 'wrench') + '<span>Unlock</span>',
        })
      );
    }
  }
  if (app.dailyUnlocked() && s.endless)
    acts.appendChild(
      h('button.btn.night.big.daily', {
        title: 'Daily ship',
        onclick: () => {
          if (done) return;
          close(false);
          app.startDaily();
        },
        html: icon('moon') + '<span>Daily</span>',
      })
    );
  acts.appendChild(h('button.btn.primary.big', { onclick: () => close(true), html: icon('next') + '<span>Next</span>' }));
  const card = h('div.shipcard' + (e.complete ? '.good' : ''), head, pay, body || null, acts);
  root.appendChild(card);
  // it never blocks: the card goes by itself when the next ship is alongside
  const watch = setInterval(() => {
    if (app.session !== s || s.phase === 'play' || app.mode === 'results') {
      clearInterval(watch);
      close(false);
    }
  }, 250);
}

/** First session, after ship 2: what coming back tomorrow is worth (streak + the night crew). */
function showReturnPreview() {
  const root = $('strip');
  if (root.firstChild) return;
  const l = app.harbor.portLevel || 0;
  const boxes = Math.floor(8 * (6 + 4 * l));
  const crew = boxes * (12 + 5 * l);
  const card = h(
    'div.strip.preview',
    h('div.row', { html: `<b class="sthead">TOMORROW</b>` }),
    h('div.row', { html: icon('gift') + `<span class="w">DAY 2</span>${ladder(2)}<span class="amt">+$${fmtNum(loginReward(2))}</span>` }),
    h('div.row', { html: icon('truck') + `<span class="w">AWAY</span>${bar(1)}<span class="amt">+$${fmtNum(crew)}</span>` }),
    h('div.acts', h('button.btn.small.primary', { onclick: () => out(), html: icon('check') + 'OK' }))
  );
  const out = () => {
    card.classList.add('out');
    setTimeout(() => card.remove(), 320);
  };
  root.appendChild(card);
  audio.play('ui_open');
  setTimeout(out, 9000);
}

/** Around every ad: silence, freeze (the tick checks sdk.adActive) and tell the platform gameplay stopped. */
function adHooks() {
  return {
    pause: () => {
      audio.setMuted(true, 'ad');
      sdk.gameplayStop();
    },
    resume: () => {
      audio.setMuted(false, 'ad');
      input.clear();
      if (app.mode === 'play') sdk.gameplayStart();
    },
  };
}

/** No shadows (the low preset, or auto stepped all the way down): silhouette lights on. */
function syncSilhouette() {
  if (app.harbor && app.harbor.setSilhouette) app.harbor.setSilhouette(!gfx.shadows);
}

/** Screen punch for every lock / release, at every quality setting (camera kick + a CSS jolt + a snap). */
function punch(k) {
  if (app.cams) {
    app.cams.punch(0, -0.18 * k, 0);
    if (app.cams.shakeEnabled) app.cams.shake(0.12 * k);
  }
  const c = $('game');
  c.classList.remove('punch');
  void c.offsetWidth;
  c.classList.add('punch');
  audio.play('ui_click', { vol: 0.35 + 0.3 * k, rate: 0.7 });
}

/** Short vibration on phones that support it (Android); silently ignored elsewhere. */
function buzz(pattern) {
  if (!app.touchMode || !navigator.vibrate) return;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try {
    navigator.vibrate(pattern);
  } catch (e) {}
}

/** Save now and report how long this visit lasted (once per visit). */
function endSession() {
  save.data.lastSeen = Date.now();
  save.flush();
  if (app._sessionEnded) return;
  app._sessionEnded = true;
  analytics.track('session_end', { duration_s: Math.round(performance.now() / 1000), ships: app.session && app.session.stats ? app.session.stats.ships : 0, money: save.data.money });
}

// ====================================================================== goals (always one in view)

/** Tonight's goals: one at a time, each with a cash reward; they keep coming as long as you play. */
const GOALS = [
  { text: 'Fill 2 ships', val: (s) => s.fullShips || 0, n: 2, reward: 200 },
  { text: 'Land 6 PERFECTs', val: (s) => s.stats.perfect, n: 6, reward: 250 },
  { text: 'Fill 4 ships', val: (s) => s.fullShips || 0, n: 4, reward: 350 },
  { text: 'Build a x5 combo', val: (s) => s.bestCombo, n: 5, reward: 400 },
  { text: 'Load 25 boxes', val: (s) => s.stats.placed, n: 25, reward: 500 },
  { text: 'Fill 8 ships', val: (s) => s.fullShips || 0, n: 8, reward: 700 },
  { text: 'Land 15 PERFECTs', val: (s) => s.stats.perfect, n: 15, reward: 800 },
  { text: 'Build a x8 combo', val: (s) => s.bestCombo, n: 8, reward: 900 },
];
function goalAt(i) {
  if (i < GOALS.length) return GOALS[i];
  const k = i - GOALS.length + 1;
  return { text: `Fill ${8 + k * 4} ships`, val: (s) => s.fullShips || 0, n: 8 + k * 4, reward: 900 + k * 250 };
}

/** The next big thing: an upgrade within reach, the next port expansion, or a ship milestone. */
function nextGoal(s) {
  const d = save.data;
  const cands = [];
  let cheapest = null;
  for (const u of UPGRADES) {
    const l = d.upgrades[u.id] || 0;
    if (l >= u.costs.length) continue;
    if (!cheapest || u.costs[l] < cheapest.cost) cheapest = { name: u.name, cost: u.costs[l] };
  }
  if (cheapest) cands.push({ lbl: 'Next', text: d.money >= cheapest.cost ? `${cheapest.name} — ready to buy` : `${cheapest.name} $${fmtNum(d.money)}/$${fmtNum(cheapest.cost)}`, k: d.money / cheapest.cost, prio: 0.05 });
  const boxes = (d.stats.placed || 0) + (d.stats.crew || 0) + (s.stats.placed || 0);
  const lvl = portLevel(boxes);
  if (lvl < PORT_STEPS.length - 1) {
    const lo = PORT_STEPS[lvl];
    const hi = PORT_STEPS[lvl + 1];
    cands.push({ lbl: 'Port', text: `Expansion ${boxes}/${hi} boxes`, k: (boxes - lo) / (hi - lo), prio: 0 });
  }
  const ships = s.stats.ships || 0;
  const m = (Math.floor(ships / 5) + 1) * 5;
  cands.push({ lbl: 'Ship', text: `Milestone: ship ${m} (${ships}/${m})`, k: (ships % 5) / 5, prio: -0.02 });
  cands.sort((a, b) => b.k + b.prio - (a.k + a.prio));
  return cands[0];
}

function updateGoals(s) {
  if (!s.endless || s.attract) return;
  s.goalIdx = s.goalIdx || 0;
  let g = goalAt(s.goalIdx);
  const v = Math.min(g.n, g.val(s));
  if (v >= g.n && s.phase !== 'over') {
    s.goalIdx++;
    app.juice.banner('GOAL COMPLETE', `${g.text} · +$${g.reward}`, 2200);
    audio.play('sting_levelup', { vol: 0.8 });
    sdk.happytime();
    earn(g.reward, null);
    g = goalAt(s.goalIdx);
  }
  app.hud.setGoals([{ lbl: 'Goal', text: `${g.text} ${Math.min(g.n, g.val(s))}/${g.n}`, k: g.val(s) / g.n, reward: g.reward }, nextGoal(s)]);
}

/** Money in: coins fly from `pos` to the wallet, which counts up as they land. */
function earn(amount, pos, burst = 1) {
  const d = save.data;
  d.money += amount;
  d.stats.earned += amount;
  save.flush(); // every reward is on disk (and in the cloud copy) the moment it is given
  analytics.trackOnce('first_reward', { amount, ms: Math.round(performance.now()) });
  let shown = app._walletShown == null ? d.money - amount : app._walletShown;
  app._walletShown = shown;
  app.juice.coins(
    pos,
    amount,
    app.hud.el.wallet,
    (share, last) => {
      app._walletShown = last ? save.data.money : Math.min(save.data.money, app._walletShown + share);
      app.hud.setMoney(app._walletShown, app.canUpgrade());
    },
    burst
  );
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
  if (n !== (app.newcomer ? 3 : 1)) return def;
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
  s.on('grab', () => {
    buzz(18);
    punch(0.55);
  });
  s.on('release', () => {
    buzz(10);
    punch(0.4);
  });
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
    // the main shift never ends on a lost box: another one is sent, the ship can still be filled
    j.toast({
      text: e.again ? 'Lost · new box coming' : 'Box lost · bonus gone',
      kind: 'warn',
      key: 'strike' + e.strikes,
      silent: true,
    });
    if (e.reason === 'sea') audio.play('vox_yell', { vol: 0.5, delay: 0.5 });
    if (save.data.settings.flashes !== false) j.flash('red');
    buzz([60, 50, 90]);
  });
  // wrong bay: a little pay now, the zone pulses and an arrow shows the right spot
  s.on('misplaced', (e) => {
    if (s.endless && e.pts > 0) earn(Math.round(e.pts * 0.25), e.pos);
    app.coach.fix = { cargo: e.cargo, t: 60 * 20 };
    if (s.guides) s.guides.alert = 3;
    buzz([40, 40, 40]);
  });
  s.on('shipDone', (e) => {
    const cash = Math.round(e.bonus * 0.3);
    app.needLater(); // (the first ship is done: menus, flavour and music can come in now)
    if (e.complete) sdk.happytime();
    if (cash) earn(cash, s.ship.group.position);
    // every ship is a checkpoint: the pay and the save land together
    save.data.stats.ships = (save.data.stats.ships || 0) + 1;
    save.checkpoint();
    showShipCard(s, e, cash);
    // a new operator's HUD fills in one ship at a time
    if (s.endless && save.data.flags.hud < 3) {
      save.data.flags.hud = Math.min(3, e.n);
      save.commit();
      applyHudStage();
    }
    if (e.complete && e.streak >= 2) app.after(1.4, () => j.toast({ text: `STREAK ${e.streak} · x${e.streakMul.toFixed(2)}`, kind: 'good', key: 'streak' + e.streak, dur: 3000 }), s);
    analytics.track('round_complete', { ship: e.n, complete: e.complete ? 1 : 0, placed: e.placed, quota: e.quota, time_left: Math.round(e.timeLeft || 0), streak: e.streak || 0 });
    // every fifth ship: a milestone worth celebrating
    if (s.endless && e.n % 5 === 0) {
      const prize = 100 + 150 * (e.n / 5);
      app.after(2.6, () => {
        j.banner(`${e.n} SHIPS TONIGHT`, `Milestone bonus +$${prize}`, 2600);
        audio.play('sting_levelup', { vol: 0.8 });
        sdk.happytime();
        earn(prize, null);
      }, s);
    }
    // the very first ship: now the game can introduce itself
    if (!save.data.flags.played) {
      save.data.flags.played = true;
      save.commit();
      app.after(3.2, () => {
        // day one of the login streak, and the promise of day two
        app.after(5, () => {
          const pay = loginReward(1);
          earn(pay, null);
          j.toast({ text: `Day 1 bonus +$${pay} · tomorrow +$${loginReward(2)}`, kind: 'good', key: 'login1', dur: 5000 });
          analytics.track('daily_reward_claim', { day: 1, amount: pay });
        }, s);
        app.radio.say([{ who: 'dispatch', text: 'Nice work, Seven.' }]);
      }, s);
    }
    // the longer welcome from the tower waits until the controls are second nature
    if (e.n === 3 && !save.data.flags.towerHello) {
      save.data.flags.towerHello = true;
      save.commit();
      app.after(4, () => app.radio.say([{ who: 'dispatch', text: 'Ships keep coming all night, Seven — fill each one before its clock runs out.' }, { who: 'dispatch', text: 'Every box pays. Spend it in the workshop. And keep your radio on.' }]), s);
    }
  });
  // the next ship was just built: stream whatever its cargo / weather will need
  s.on('prebuilt', (e) => audio.need(soundsForLevel(e.def)));
  s.on('shipIncoming', (e) => {
    app.hud.build(s.level, s);
    j.toast({ text: `${e.def.ship.name} inbound`, kind: 'info', dur: 3200 });
  });
  s.on('shipDocked', (e) => {
    // first session: after the second ship, show what tomorrow is worth
    if (e.n === 3 && app.newcomer && !save.data.flags.previewSeen) {
      save.data.flags.previewSeen = true;
      save.commit();
      app.after(1.5, showReturnPreview, s);
    }
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
    // the first five boxes of a career: a CLANG, a freeze, a flash and a shower of coins
    const rookie = s.rookieLeft > 0 && e.pts > 0;
    if (rookie) {
      s.rookieLeft--;
      save.data.flags.rookie = 5 - s.rookieLeft;
      save.commit();
      audio.play('clang', { vol: 1 });
      app.hitStop = Math.max(app.hitStop, 0.22);
      if (save.data.settings.flashes !== false) j.flash();
      app.cams.shake(0.35);
      if (!s.rookieLeft) s.refreshMods();
    }
    // the main shift pays per box, straight into the wallet
    if (s.endless && e.pts > 0) {
      e.cargo.mesh.getWorldPosition(_tmp);
      earn(Math.round(e.pts * 0.25) + (rookie ? 50 : 0), _tmp.clone(), rookie ? 3 : 1);
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
  app.needLater();
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
  let week = null;
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
    // this week's port record (Monday to Sunday); the platform leaderboard too, if it has one
    const wk = weekKey();
    if (!d.week || d.week.key !== wk) d.week = { key: wk, best: 0, ships: 0 };
    const fresh = res.score > d.week.best;
    if (fresh) d.week.best = res.score;
    d.week.ships = Math.max(d.week.ships || 0, res.ships);
    sdk.submitScore(res.score);
    week = { label: sdk.hasLeaderboard ? 'Weekly tournament · your best' : 'This week’s port record', best: d.week.best, fresh: fresh && res.score > 0 };
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
        dd.streak = (dd.streak || 0) + 1; // nights worked: a missed day costs nothing
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
  save.checkpoint();
  const idx = SHIFTS.indexOf(level);
  const meta = { level, payout, newStars, newBest, endless, hush, ending, order, week, nextLevel: !endless && res.success && idx >= 0 && idx < SHIFTS.length - 1 ? SHIFTS[idx + 1] : null };
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
  // run end: the platform may show an ad before the slip, unless the slip offers the rewarded second chance
  if (!res.canContinue && sdk.available) {
    await sdk.midgame(adHooks());
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

/** Compile the scene's programs for the target the frame really draws into (the post chain's
 *  linear buffer, or the screen without post), without blocking where the browser can help. */
async function warmShaders() {
  const r = gfx.renderer;
  const prev = r.getRenderTarget();
  try {
    r.setRenderTarget(gfx.composer && gfx.usePost ? gfx.composer.renderTarget1 : null);
    const parallel = r.compileAsync && r.extensions && r.extensions.has('KHR_parallel_shader_compile');
    const p = parallel ? r.compileAsync(app.ctx.scene, app.camera) : (r.compile(app.ctx.scene, app.camera), null);
    r.setRenderTarget(prev);
    if (p) await Promise.race([p, wait(6000)]);
    // finish every link now, behind the loading bar (a driver may only compile at first use, which
    // would stall a frame in play), then draw one frame off-screen so the first real one is cheap
    for (const prog of r.info.programs || []) {
      try {
        prog.getUniforms();
      } catch (e) {}
    }
    gfx.render(0, 0);
  } catch (e) {
    r.setRenderTarget(prev);
  }
}

/** The GPU did not come back: save everything, then reload the page on a tap. */
function showReloadCard() {
  if ($('lostcard')) return;
  save.data.lastSeen = Date.now();
  save.flush();
  const reload = () => {
    save.flush();
    location.reload();
  };
  const card = h(
    'div.screen.dim#lostcard',
    { style: { zIndex: 60 }, onclick: reload },
    h('div.card', h('div.card-head', h('h2', 'Graphics paused')), h('div.card-body', h('button.btn.primary.big', { onclick: reload, html: icon('retry') + '<span class="grow">Tap to reload the shift</span>' })))
  );
  $('ui').appendChild(card);
}

/** Boot timeline marks (read them in the browser's performance panel). */
function mark(name) {
  try {
    performance.mark(name);
  } catch (e) {}
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

  sdk.loadingStart(); // (remembered and sent the moment the SDK is ready)
  const sdkReady = sdk.init().then(() => {
    const apply = (st) => audio.setMuted(!!(st && st.muteAudio), 'platform');
    apply(sdk.settings());
    sdk.onSettings(apply);
  });

  if (!gfx.init($('game'), { quality: save.data.settings.quality })) {
    fail('This device could not start WebGL. Try another browser.');
    return;
  }
  // (a modest machine resumes from the preset it had earned last time)
  gfx._startQ = save.data.settings.autoQ;
  audio.init(SOUNDS);
  audio.onTrack = (t) => {
    app.nowPlaying = t;
    if (app.screens) app.screens._setTrack(t);
  };
  app.applySettings();

  // physics (the wasm download) and the fonts load side by side
  const physics = initPhysics();
  physics.catch(() => {});
  // fonts feed the canvas-drawn textures, so wait for them (briefly)
  const fonts = ['400 32px "Saira Stencil One"', '700 32px "Barlow Condensed"', '400 32px "Bungee"'];
  await Promise.race([Promise.all(fonts.map((f) => (document.fonts && document.fonts.load ? document.fonts.load(f) : null))).catch(() => {}), wait(1200)]);
  setLoad(0.12, 'Warming up the winches…');

  mark('nsc-fonts');
  try {
    await physics;
    mark('nsc-physics');
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
    syncSilhouette();
  };
  // a quality step that recompiles shaders waits for a break (between ships, or a menu)
  gfx.quietMoment = () => app.mode !== 'play' || !!(app.session && app.session.phase === 'swap');
  gfx.onClimb = (q) => {
    save.data.settings.autoQ = q;
    save.commit();
    document.body.classList.toggle('post', gfx.usePost);
    syncSilhouette();
  };
  syncSilhouette();
  document.body.classList.toggle('post', gfx.usePost);

  app.harbor = new Harbor(scene, { mobile, aniso: Math.min(8, gfx.maxAniso) });
  syncSilhouette();
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
  app.juice.lite = gfx.lowEnd; // (fewer DOM coins on modest machines)
  app.touch = new TouchControls();
  app.radio = new Radio();
  app.deep = new DeepLight(scene);
  app.tug = new Tug(scene);
  app.gulls = new Gulls(scene, mobile ? 4 : 7);
  app.wet = new WetShine(scene, { y: DIM.QUAY_Y, bounds: { minX: -90, maxX: -0.3, halfZ: 160 }, count: mobile ? 12 : 22 });
  app.hud = new Hud({ onPause: () => app.pause(), onCamera: toggleCamera, onUpgrade: () => app.openWorkshopInPlay(), onMute: () => app.toggleMute(), isMuted: () => !!save.data.settings.muted, onDrop: (ev) => {
    app.lastInput = performance.now();
    // a mouse on the big button is a mouse player: steer like a finger from here on
    if (ev && ev.pointerType !== 'touch' && !app.touchMode && ev.detail > 0) app.setMouseMode(true);
    input.fire('lock');
  }, touch: app.touchMode });
  app.coach = new Coach(
    save,
    () => (app.touchMode ? 'touch' : app.mouseMode ? 'mouse' : 'keys'),
    (v) => app.juice.project(v),
    () => app.hud.dropRect()
  );
  app.screens = new Screens(app);
  app.ctx = { scene, harbor: app.harbor, water: app.water, weather: app.weather, fx: app.fx, crane: app.crane, cams: app.cams, save, mobile };

  // a lost GPU context: pause, and if the browser does not give it back quickly, offer a clean reload
  gfx.onContextLost = () => {
    if (app.mode === 'play') app.pause();
    clearTimeout(app._lostTimer);
    app._lostTimer = setTimeout(() => {
      if (gfx.contextLost) showReloadCard();
    }, 3000);
  };
  gfx.onContextRestored = () => {
    clearTimeout(app._lostTimer);
    const card = $('lostcard');
    if (card) card.remove();
  };
  app.weather.onThunder = (delay) => audio.play('thunder', { delay, vol: 1 });
  app.weather.onGustWarn = () => {
    if (app.mode === 'play') {
      app.juice.toast({ text: 'Gust incoming!', kind: 'warn', key: 'gust' + Math.floor(app.time / 4), dur: 2000, silent: true });
      audio.play('ui_warn', { vol: 0.5 });
    }
  };
  app.weather.onGust = () => audio.play('gust', { vol: 0.9 });

  setLoad(0.8, 'Fuelling the trucks…');
  mark('nsc-world');
  bindGlobalInput();
  // the mute button over every menu (the HUD has its own beside pause)
  const mb = h('button.btn.icon.ghost#mutebtn', { title: 'Sound (M)', html: icon(save.data.settings.muted ? 'mute' : 'speaker'), onclick: () => app.toggleMute() });
  $('ui').appendChild(mb);
  if (save.data.settings.muted) audio.setMuted(true, 'user');
  // the platform gets a moment to answer; sounds stream in after the first frame
  await Promise.race([sdkReady.catch(() => {}), wait(1500)]);
  // the platform knows the device better than a user-agent guess does
  const device = sdk.deviceType;
  if (device) {
    app.setTouchMode(device !== 'desktop', true);
    app.deviceLocked = true;
  }
  // a signed-in CrazyGames player's name goes on the cab's name plate (guests get the default)
  sdk.getUser().then((u) => setOperator(u && u.username));
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
  app.newcomer = first;
  const login = dailyLogin(first);
  const today = todayKey();
  if (!save.data.install) save.data.install = today;
  const returnDay = daysBetween(save.data.install, today);
  // nobody waits behind a menu: new and returning players alike start at the controls
  app.mode = 'menu';
  app.lastInput = performance.now();
  // nothing simulates behind the loading bar: the frame loop waits until the first real frame
  app.warming = true;
  await app.startEndless(first, true);
  mark('nsc-session');
  // every shader the first frame needs (the night's ship and cargo included), compiled in parallel
  // while the loading bar is still up, so the first frame does not stall on them one by one
  // shadow casters match the preset BEFORE anything compiles (a later flip recompiles every lit material)
  app.ctx.scene.traverse((o) => {
    if (o.isLight && o.userData.wantShadow) o.castShadow = gfx.shadows;
  });
  app.warming = true;
  await warmShaders();
  app.warming = false;
  mark('nsc-shaders');
  await wait(120);
  $('loading').classList.add('out');
  setTimeout(() => $('loading').remove(), 800);
  // progressive loading: the first box's sounds right after the first frame, then what this ship
  // needs, then the general set; music only once the first-box sounds are in. Anything for later
  // mechanics streams while the ship before it is being worked (see 'prebuilt').
  // Music (the biggest files) waits for a new player's first ship; a returning one hears it at once.
  setTimeout(() => {
    const core = audio.need(SOUND_GROUPS.core, { front: true });
    audio.need(soundsForLevel(app.level));
    setTimeout(() => audio.need(SOUND_GROUPS.play), 1500);
    if (!first) core.then(() => audio._openMusic());
    setTimeout(() => app.needLater(), first ? 75000 : 20000);
  }, 300);
  // first gameplay frame on screen: the number the conversion target is about
  requestAnimationFrame(() => {
    window.__nscFirstFrame = performance.now();
    try {
      performance.mark('nsc-first-frame');
    } catch (e) {}
    analytics.trackOnce('game_loaded', { ms: Math.round(window.__nscFirstFrame), first: first ? 1 : 0, day: returnDay });
    if (!first && returnDay > 0) analytics.trackOnce('return_day_' + returnDay, { day: returnDay });
  });
  if (!first && (idle || login)) setTimeout(() => showWelcomeStrip(idle, login), 1500);
  // outside analytics on the page (beyond the platform SDK): new players get a small, non-blocking note
  if (first && analytics.external()) setTimeout(showPrivacyNote, 2500);
}

/** Whole calendar days from one 'YYYY-MM-DD' to another. */
function daysBetween(a, b) {
  const p = (k) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.max(0, Math.round((p(b) - p(a)) / 864e5));
}

// ====================================================================== returning players

/** Daily login streak: the reward grows for each day in a row, up to day 7 and its jackpot. */
const LOGIN_PAY = [100, 150, 200, 250, 300, 400, 750];
function loginReward(day) {
  return LOGIN_PAY[Math.min(LOGIN_PAY.length, Math.max(1, day)) - 1];
}
function dailyLogin(first) {
  const L = (save.data.login = save.data.login || { last: '', streak: 0, best: 0 });
  const today = todayKey();
  if (L.last === today) return null;
  // (no missed-day penalty: every day you come back moves you up the ladder)
  L.streak = (L.streak || 0) + 1;
  L.last = today;
  L.best = Math.max(L.best || 0, L.streak);
  save.flush();
  // (a brand-new player gets day one's bonus with their first full ship instead)
  if (first) return null;
  return { day: L.streak, cash: loginReward(L.streak) };
}

/** Night crew + login bonus, shown over the running game (it never pauses or blocks). */
function showWelcomeStrip(idle, login) {
  const root = $('strip');
  root.innerHTML = '';
  const total = (idle ? idle.cash : 0) + (login ? login.cash : 0);
  let done = false;
  const collect = async (double) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (double && sdk.adsEnabled) {
      const r = await sdk.rewarded(adHooks());
      if (!r.rewarded) double = false;
    }
    const k = double ? 2 : 1;
    const rect = card.getBoundingClientRect();
    if (idle) save.data.stats.crew = (save.data.stats.crew || 0) + idle.boxes;
    earn(total * k, { screen: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    if (login) analytics.track('daily_reward_claim', { day: login.day, amount: login.cash * k });
    if (idle) analytics.track('idle_collect', { boxes: idle.boxes, amount: idle.cash * k });
    card.classList.add('out');
    setTimeout(() => (root.innerHTML = ''), 320);
  };
  const rows = [];
  if (idle) rows.push(h('div.row', { html: icon('truck') + `<span class="w">AWAY</span>${bar(idle.hrs / 8)}<span class="amt">+$${fmtNum(idle.cash)}</span>` }));
  if (login) rows.push(h('div.row', { html: icon(login.day >= 7 ? 'trophy' : 'star') + `<span class="w">DAY ${login.day}</span>${ladder(Math.min(7, login.day))}<span class="amt">+$${fmtNum(login.cash)}</span>` }));
  const acts = h('div.acts');
  if (sdk.adsEnabled) acts.appendChild(h('button.btn.small.teal', { onclick: () => collect(true), html: icon('ad') + 'Collect ×2' }));
  acts.appendChild(h('button.btn.small.primary', { onclick: () => collect(false), html: icon('coin') + 'Collect' }));
  const card = h('div.strip', h('div.row', { html: `<b class="sthead">WELCOME BACK</b>` }), ...rows, acts);
  root.appendChild(card);
  audio.play('ui_open');
  // collects itself if ignored: the reward is never lost
  const timer = setTimeout(() => collect(false), 9000);
}

/** "Anonymous stats · Privacy": a corner note that never blocks play and goes away by itself. */
function showPrivacyNote() {
  if ($('privacynote')) return;
  const note = h(
    'div.privacynote#privacynote',
    h('span', 'Anonymous gameplay stats'),
    h('a', { href: 'privacy.html', target: '_blank', rel: 'noopener' }, 'Privacy'),
    h('button', { 'aria-label': 'Close', onclick: () => note.remove(), html: icon('x') })
  );
  $('ui').appendChild(note);
  setTimeout(() => note.remove(), 14000);
}

/** What tomorrow brings — for the pause card and the end-of-shift report. Only things that exist. */
app.tomorrow = () => {
  const L = save.data.login || { streak: 0 };
  const lines = [`Day ${(L.streak || 0) + 1} login bonus: +$${fmtNum(loginReward((L.streak || 0) + 1))}`];
  const weekEnds = weekDaysLeft() === 1;
  lines.push('A new daily challenge ship' + (weekEnds ? (sdk.hasLeaderboard ? ' · a new weekly tournament' : ' · a fresh weekly port record') : ''));
  const st = save.data.story || {};
  const next = BLACK_ORDER.find((k) => !(st.boxes || {})[k]);
  if (next) lines.push(st.lastEpisode === todayKey() ? `Episode ${BLACK_ORDER.indexOf(next) + 1} of the Pier Seven file` : `Tonight's episode is still waiting — clock in`);
  lines.push('Your night crew keeps working (up to 8 h of earnings)');
  return lines;
};

/** The title's line about this week: the local record (or the platform's tournament, if it has one). */
app.weekLine = () => {
  const W = save.data.week || {};
  const best = W.key === weekKey() ? W.best : 0;
  const left = weekDaysLeft();
  const reset = left === 1 ? 'resets tomorrow' : `resets in ${left} days`;
  return `${sdk.hasLeaderboard ? 'Weekly tournament' : 'This week'} · best ${best ? fmtNum(best) : '—'} · ${reset}`;
};

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
    // one-touch play, for a finger and for the mouse alike: the spreader goes where you point
    // (left button / finger), a click or tap locks on or lets go; the right button orbits the view
    const mouse = e.pointerType === 'mouse';
    if ((!mouse || e.button === 0) && s && !s.attract) {
      if (e.pointerType === 'touch') app.setTouchMode(true);
      else app.setMouseMode(true);
      finger = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, t: performance.now(), slop: mouse ? 6 : 12 };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (err) {}
      return;
    }
    if (!mouse || e.button !== 2 || app.cams.mode !== 'chase') return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: app.cams.yaw, pitch: app.cams.pitch };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {}
  });
  canvas.addEventListener('pointermove', (e) => {
    if (finger && e.pointerId === finger.id) {
      if (!finger.moved && Math.hypot(e.clientX - finger.x, e.clientY - finger.y) < finger.slop) return;
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
  // keys must reach the game inside the platform's iframe: focus the page and the canvas on load
  // and again on the first press
  canvas.tabIndex = 0;
  const focusGame = () => {
    try {
      window.focus();
      canvas.focus({ preventScroll: true });
    } catch (err) {}
  };
  focusGame();
  window.addEventListener('pointerdown', (e) => {
    if (!app._focused && !(e.target.closest && e.target.closest('button, input, a, select'))) focusGame();
    app._focused = true;
  }, { capture: true, once: false });
  // the coach's "nothing pressed for a while" nudge
  const touched = () => (app.lastInput = performance.now());
  window.addEventListener('pointerdown', touched, { capture: true, passive: true });
  window.addEventListener('keydown', touched, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && app.mode === 'play') app.pause();
    if (document.hidden) endSession();
  });
  window.addEventListener('pagehide', endSession);
  // funnel: the first deliberate input
  const firstInput = (kind) => {
    if (app.mode === 'play') analytics.trackOnce('first_input', { kind, ms: Math.round(performance.now()) });
  };
  window.addEventListener('keydown', () => firstInput('key'), { capture: true });
  window.addEventListener('pointerdown', (e) => firstInput(e.pointerType || 'pointer'), { capture: true });
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
    if (e.code === 'KeyM' && !e.repeat) app.toggleMute();
    if (!e.ctrlKey && !e.metaKey && !e.altKey && /^(Key[A-Z]|Arrow|Space|Shift|Enter|Page)/.test(e.code)) {
      app.setTouchMode(false);
      // steering with the keys hands the crane back to the full keyboard scheme
      if (/^(Key[WASDEQ]|Arrow)/.test(e.code)) app.setMouseMode(false);
    }
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
  if (app.warming) {
    last = now;
    return;
  }
  const t0 = typeof __DEV__ !== 'undefined' && __DEV__ && window.__perf ? performance.now() : 0;
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
  // (dev builds: per-frame main-thread cost, for the low-end profile)
  if (t0) window.__perf.push(performance.now() - t0);
}

function tick(raw) {
  input.poll();
  const frozen = app.mode === 'paused' || sdk.adActive;
  // hit-stop: a few frozen frames on the big moments
  let dt = frozen ? 0 : raw;
  if (app.hitStop > 0 && !frozen) {
    // (exactly the hit-stop's share of this frame is slowed: the same total game time at any frame rate)
    const hs = Math.min(app.hitStop, raw);
    app.hitStop -= hs;
    dt = raw - hs + hs * 0.05;
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
    updateDrop(s);
    updateOffscreen(s);
    applyCabGhost(app.cams.mode === 'cab' ? s.rig.carry : null);
  }
  // (goal texts are rebuilt five times a second, not every frame: less garbage on slow devices)
  app._goalT = (app._goalT || 0) - raw;
  if (app.mode === 'play' && s && !s.attract && s.endless && app._goalT <= 0) {
    app._goalT = 0.2;
    updateGoals(s);
  }
  // coaching (one prompt at a time) and the automatic helpers it hands out
  if (app.mode === 'play' && s && !s.attract && !app.tutorial) {
    app.coach.update(s, (performance.now() - (app.lastInput || 0)) / 1000);
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
