// Night Shift Crane — application shell: boot, world, game flow, main loop.
import * as THREE from 'three';
import { DIM, PAL } from './config.js';
import { clamp, damp, rand, isMobile, isTouchDevice, isIOS, Tweens } from './core/util.js';
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
import { CameraRig } from './game/cameras.js';
import { Session } from './game/session.js';
import { Tutorial } from './game/tutorial.js';
import { SHIFTS, endlessShip, upgradeMods } from './game/levels.js';
import { Juice } from './ui/juice.js';
import { Hud } from './ui/hud.js';
import { TouchControls } from './ui/touch.js';
import { Screens } from './ui/screens.js';

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
  touchMode: isTouchDevice() && isMobile(),
  cabGhost: null,
  ambT: { crow: rand(12, 30), bell: rand(8, 20), horn: rand(40, 90), smoke: 0 },

  // ---------------------------------------------------------------- queries used by the UI
  mods: () => upgradeMods(save.data.upgrades),
  adsAvailable: () => sdk.available,
  shiftUnlocked(i) {
    if (i === 0) return true;
    const prev = SHIFTS[i - 1];
    return (save.data.shifts[prev.id] || {}).stars > 0;
  },
  endlessUnlocked() {
    return (save.data.shifts.s04 || {}).stars > 0;
  },

  // ---------------------------------------------------------------- settings
  applySettings() {
    const st = save.data.settings;
    audio.setVolume('music', st.music);
    audio.setVolume('sfx', st.sfx);
    if (app.cams) app.cams.shakeEnabled = st.shake !== false;
    if (gfx.renderer && app._quality !== st.quality) {
      app._quality = st.quality;
      gfx.applyQuality(st.quality);
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
  openBriefing(level) {
    app.screens.briefing(level);
  },
  openEndlessBriefing() {
    app.screens.endlessBriefing();
  },
  reopenResults() {
    if (app.lastResult) app.screens.results(app.lastResult.res, app.lastResult.meta);
    else app.gotoTitle();
  },

  startShift(level) {
    return beginRun(level);
  },
  startEndless() {
    const seed = Math.floor(Math.random() * 1e9);
    return beginRun(endlessShip(0, seed), { seed });
  },
  retry() {
    if (!app.level) return app.gotoTitle();
    if (app.level.endless) return app.startEndless();
    return beginRun(app.level);
  },
  resume() {
    if (app.mode !== 'paused') return;
    app.screens.hide();
    app.mode = 'play';
    audio.setMuffle(app.cams.mode === 'cab' ? 0.32 : 0);
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
    app.busy = true;
    sdk.gameplayStop();
    await app.juice.transition(async () => {
      app.screens.hide();
      teardownRun();
      makeAttract();
      app.mode = 'menu';
      audio.setMuffle(0);
      audio.music.setPlaylist(['menu']);
      app.screens.board();
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
  if (app.session) {
    app.session.dispose();
    app.session = null;
  }
  app.juice.clear();
  app.juice.letterbox(false);
  showHud(false);
}

function makeAttract() {
  // a docked ship + idle crane behind the menus
  app.level = null;
  const s = new Session(app.ctx, SHIFTS[0], { attract: true });
  s.attract = true;
  app.session = s;
  app.cams.setMode('menu', 0);
  app.weather.set({ rain: 0.45, wind: 0.5, gusts: 0, fog: 0.011, sea: 0.2, clouds: 0.6 });
}

function showHud(v) {
  app.hud.show(v);
  app.touch.show(v && app.touchMode);
}

function setCab(on, silent) {
  const want = on ? 'cab' : 'chase';
  $('cab-overlay').classList.toggle('hidden', !on);
  app.hud.setCameraMode(want);
  if (!silent) audio.setMuffle(on ? 0.32 : 0);
  if (!on) applyCabGhost(null);
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
  if (app.shiftsStarted > 0 && sdk.available) {
    await sdk.midgame({ pause: () => audio.setMuted(true, 'ad'), resume: () => audio.setMuted(false, 'ad') });
  }
  app.shiftsStarted++;
  await app.juice.transition(async () => {
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
  runIntro(level, app.session);
}

async function runIntro(level, s) {
  const tour = level.tour && !save.data.flags.introSeen;
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
  } else {
    app.cams.setMode(save.data.settings.cabDefault ? 'cab' : 'chase', 2.0);
    j.banner(level.endless ? 'OVERTIME' : `SHIFT ${String(level.n).padStart(2, '0')}`, level.endless ? s.ship.name : `${level.name} · ${level.clock}`, 2300);
    audio.play('sax_start', { vol: 0.8, delay: 0.15 });
    await wait(1700);
  }
  if (app.session !== s) return;
  setCab(app.cams.mode === 'cab');
  app.mode = 'play';
  showHud(true);
  s.start();
  if (level.endless) {
    s.time = level.bonusTime + 30;
    s.timeTotal = s.time;
  }
  if (level.tutorial && !save.data.flags.tutorialDone) {
    app.tutorial = new Tutorial(s, { touch: app.touchMode });
    app.tutorial.onDone = () => {
      save.data.flags.tutorialDone = true;
      save.commit();
    };
  } else if (level.feature && !(save.data.shifts[level.id] || {}).stars) {
    j.toast({ text: `${level.feature.title}: ${level.feature.text}`, kind: 'info', dur: 7000 });
  }
  sdk.gameplayStart();
}

function bindSession(s) {
  const j = app.juice;
  s.on('burst', (b) => j.burst(b));
  s.on('points', (p) => j.points(p));
  s.on('toast', (t) => j.toast(t));
  s.on('flash', () => {
    gfx.flash = 1;
    j.flash();
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
  });
  s.on('shipDone', (e) => {
    j.banner('SHIP LOADED', `+${e.bonus} · next vessel inbound`, 3000);
    sdk.happytime();
  });
  s.on('shipIncoming', (e) => {
    app.hud.build(s.level, s);
    j.toast({ text: `${e.def.ship.name} is coming alongside`, kind: 'info', dur: 4200 });
  });
  s.on('shipDocked', (e) => {
    j.banner(e.def.ship.name, `Ship ${e.n} · +${e.bonusTime}s on the clock`, 2600);
  });
  s.on('finish', (res) => onFinish(s, res));
  s.on('horn', () => {
    if (Math.random() < 0.4) audio.play('vox_laugh', { delay: 0.6, vol: 0.5 });
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
    payout = Math.round(res.score * 0.2);
    d.endless.runs++;
    if (res.score > d.endless.best) {
      d.endless.best = res.score;
      newBest = true;
    }
    d.endless.bestShips = Math.max(d.endless.bestShips || 0, res.ships);
  } else if (res.success) {
    const r = save.recordShift(level.id, res.stars, res.score);
    newStars = r.gainedStars;
    newBest = r.newBest;
    payout = Math.round(res.score * 0.3) + newStars * 80;
  } else {
    payout = Math.round(res.score * 0.1);
  }
  d.money += payout;
  d.stats.placed += res.stats.placed;
  d.stats.lost += res.stats.lost;
  d.stats.perfects += res.stats.perfect;
  d.stats.earned += payout;
  save.commit(true);
  const idx = SHIFTS.indexOf(level);
  const meta = { level, payout, newStars, newBest, endless, nextLevel: !endless && res.success && idx >= 0 && idx < SHIFTS.length - 1 ? SHIFTS[idx + 1] : null };
  app.lastResult = { res, meta };
  showHud(false);
  setCab(false, true);
  if (res.success) {
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
  audio.play('ui_open');
  app.screens.results(res, meta);
  if (endless && newBest) sdk.happytime();
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
  await Promise.race([Promise.all(fonts.map((f) => (document.fonts && document.fonts.load ? document.fonts.load(f) : null))).catch(() => {}), wait(2500)]);
  setLoad(0.12, 'Warming up the winches…');

  try {
    await initPhysics();
  } catch (e) {
    fail('Could not start the physics engine (WebAssembly is unavailable).');
    return;
  }
  setLoad(0.2, 'Loading the night’s sounds…');
  const audioLoad = audio.load((p) => setLoad(0.2 + p * 0.55));

  // ---- world
  initMaterials({ mobile });
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(PAL.fog, 0.0105);
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 1400);
  camera.position.set(-10, 20, 50);
  app.scene = scene;
  app.camera = camera;
  gfx.setup(scene, camera);
  app._quality = save.data.settings.quality;
  gfx.applyQuality(save.data.settings.quality);
  document.body.classList.toggle('post', gfx.usePost);

  app.harbor = new Harbor(scene, { mobile, aniso: Math.min(8, gfx.maxAniso) });
  await wait(0);
  app.water = new Water(scene, { mobile });
  app.weather = new Weather(scene, { count: gfx.rainCount, mobile });
  app.fx = new Fx(scene, { budget: gfx.particleBudget, mobile });
  app.crane = new CraneView(scene, { paint: save.data.paint, mobile });
  app.cams = new CameraRig(camera);
  app.cams.shakeEnabled = save.data.settings.shake !== false;
  app.tweens = new Tweens();
  app.juice = new Juice(camera);
  app.touch = new TouchControls();
  app.hud = new Hud({ onPause: () => app.pause(), onCamera: toggleCamera, touch: app.touchMode });
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
  await Promise.all([audioLoad, sdkReady.catch(() => {})]);
  setLoad(1, 'Ready');
  sdk.loadingStop();

  startAmbience();
  app.mode = 'menu';
  app.screens.title();
  audio.music.setPlaylist(['menu']);
  requestAnimationFrame(frame);
  await wait(350);
  $('loading').classList.add('out');
  setTimeout(() => $('loading').remove(), 800);
}

// ====================================================================== input glue

function bindGlobalInput() {
  const canvas = $('game');
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (app.mode !== 'play' || app.cams.mode !== 'chase') return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: app.cams.yaw, pitch: app.cams.pitch };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {}
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const k = 2.4 / Math.max(320, window.innerHeight);
    app.cams.yaw = clamp(drag.yaw - (e.clientX - drag.x) * k, -0.95, 1.05);
    app.cams.pitch = clamp(drag.pitch + (e.clientY - drag.y) * k, -0.24, 0.6);
  });
  const end = (e) => {
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
  input.anyKeyHandlers.add((e) => {
    if (app.mode === 'intro' && app._skipTour && (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape')) app._skipTour();
  });
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

const _lights = [];
const _col = new THREE.Color();
const _tmp = new THREE.Vector3();
function waterLights() {
  _lights.length = 0;
  const s = app.session;
  const crane = app.crane;
  // trolley work light: the brightest thing over the water
  _tmp.set(crane.trolley.position.x, DIM.RAIL_Y - 0.6, crane.gantry.position.z);
  _lights.push({ pos: _tmp.clone(), color: _col.set(PAL.sodiumHot).clone(), power: 1.3 });
  for (let i = 0; i < crane.floodPositions.length; i += 2) {
    const p = crane.floodPositions[i];
    if (p.x < 0) continue;
    _lights.push({ pos: new THREE.Vector3(p.x, p.y, p.z + crane.gantry.position.z), color: _col.set(PAL.sodiumHot).clone(), power: 0.7 });
  }
  if (s && s.ship) {
    const sh = s.ship;
    for (const p of [sh.mastTop, sh.foreLight, ...sh.deckLamps]) {
      _lights.push({ pos: sh.localToWorld(p, new THREE.Vector3()), color: _col.set(0xffe2b0).clone(), power: 0.7 });
    }
  }
  for (const l of app.harbor.lampHeads) {
    if (_lights.length >= 16) break;
    if (l.pos.x < -30) continue;
    _lights.push({ pos: l.pos, color: l.color, power: (l.hgt > 12 ? 0.8 : 0.6) * (l.flick == null ? 1 : l.flick) });
  }
  if (_lights.length < 16) _lights.push({ pos: app.harbor.lighthouse.position, color: _col.set(0xfff2d0).clone(), power: 0.8 });
  app.water.setLights(_lights);
}

let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const raw = Math.min(0.1, Math.max(0, (now - last) / 1000 || 0.016));
  last = now;
  input.poll();
  const frozen = app.mode === 'paused' || sdk.adActive;
  const dt = frozen ? 0 : raw;
  app.time += dt;
  const s = app.session;

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
  const flash = app.weather.flash;
  app.harbor.update(dt, app.time, flash);
  const gantryMove = s ? Math.abs(s.rig.vz) / 4.8 : 0;
  app.crane.update(dt, app.time, gantryMove);
  app.fx.update(dt);
  app.tweens.update(dt);

  // --- lighting reacts to weather
  const w = app.weather.cur;
  app.scene.fog.density = w.fog;
  app.harbor.hemi.intensity = 0.5 + flash * 3.5;
  app.harbor.moon.intensity = 0.42 * (1 - w.clouds * 0.45) + flash * 2.2;
  app.harbor.skyUniforms.uClouds.value = w.clouds;
  app.harbor.setVisibility(clamp(1.25 - w.fog * 38, 0.06, 1));
  if (flash > 0.02 && gfx.flash < flash * 0.5) gfx.flash = flash * 0.5;
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
  audio.setListener(app.camera);
  if (app.mode === 'play' && s) {
    const hs = s.hud();
    app.hud.update(hs);
    if (app.touchMode) app.touch.setAction(hs.action, hs.state);
    applyCabGhost(app.cams.mode === 'cab' ? s.rig.carry : null);
  }
  updateAmbience(dt);
  audio.update();
  gfx.render(raw, app.time);
  input.endFrame();
}

window.addEventListener('error', (e) => {
  if (app.mode === 'boot') fail('Something went wrong while loading. Please reload.');
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.error(e.error || e.message);
});

if (typeof __DEV__ !== 'undefined' && __DEV__) window.__nsc = { app, gfx, audio, save, input, SHIFTS, THREE };

boot();
