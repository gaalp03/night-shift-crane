// One running shift: owns the physics world, crane rig, ship, trucks and cargo, and implements
// the rules (grab / place / lock, scoring, strikes, hazards, time, endless ship rotation).
import * as THREE from 'three';
const _iv = new THREE.Vector3();
const _va = new THREE.Vector3();
const _iq = new THREE.Quaternion();
const _it = new THREE.Vector3();
import { DIM, TUNE, SCORE, ZONES } from '../config.js';
import { Phys, STEP, GROUPS } from './physics.js';
import { Rig, MASS_UNIT } from './rig.js';
import { Guides, zoneColor } from './guides.js';
import { zoneFn, starsFor, starThresholds, upgradeMods, endlessShip, STORM_LOSSES, STORM_JACKPOT, SHIFT_SHIPS } from './levels.js';
import { Ship } from '../world/ship.js';
import { Cargo, BRAND_COUNT } from '../world/cargo.js';
import { Truck } from '../world/trucks.js';
import { input } from '../core/input.js';
import { audio } from '../core/audio.js';
import { Emitter, clamp, damp, rand, randPick, lerp } from '../core/util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const IDENT = new THREE.Quaternion();

const LANE2_X = DIM.LANE_X - 4.6;
const FRAGILE_LIMIT = 3.4;
const HAZMAT_LIMIT = 7.5;

const CLANGS = ['CLANG!', 'BONG!', 'KLONK!', 'WHAM!', 'CRUNCH!'];

// countering a swing: armed when the load is this far out (m), paid when it is back under this,
// with at least minHold s of steering towards it within window s
// snap assist: engage radius (m, at full strength), height above the slot it engages from (m) and how
// close it must be over the slot before it lowers
const SNAP = { radius: 2.6, height: 3.2, align: 0.32 };
const _vs = new THREE.Vector3();
const COUNTER = { armAt: 0.85, quietAt: 0.35, quietSpeed: 0.6, quietHold: 0.45, minHold: 0.22, window: 6, cooldown: 7, bonus: 40, gust: 7.5 };

export class Session extends Emitter {
  /**
   * @param ctx   shared systems: { scene, harbor, water, weather, fx, crane, cams, save, mobile }
   * @param level shift definition (see levels.js)
   */
  constructor(ctx, level, opts = {}) {
    super();
    this.ctx = ctx;
    this.level = level;
    this.endless = !!level.endless;
    this.mods = upgradeMods(ctx.save.data.upgrades, ctx.save.data.rigSetup, ctx.save.data.unlocks, ctx.save.data.settings.berth);
    this.lockTol = TUNE.lockTol * this.mods.tolMul;
    this.phase = 'pre'; // pre | play | swap | over
    this.simT = 0;
    this.acc = 0;
    this.elapsed = 0;
    this.time = (level.time || 0) * this.mods.timeMul;
    this.timeTotal = this.time;
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.strikes = 0;
    this.maxStrikes = (level.strikes || 3) + this.mods.extraStrike;
    this.delivered = 0;
    this.quota = level.quota;
    this.stats = { perfect: 0, great: 0, good: 0, sloppy: 0, lost: 0, soft: 0, rough: 0, placed: 0, discharged: 0, ships: 0, timeBonus: 0, busted: 0, falseAlarm: 0, smuggled: 0 };
    this.scale = { read: 0, t: 0 }; // load cell: live reading + how long it has hung steady
    this.blackSeen = false; // an unlisted box turned up this shift
    this.blackOutcome = null; // 'ship' | 'customs' | 'sea' | 'left'
    this.events = (level.events || []).map((e) => ({ ...e, fired: false }));
    this.cargos = [];
    this.trucks = [];
    this.manifest = level.manifest.slice();
    this.manifestIdx = 0;
    this.lanes = [
      { x: DIM.LANE_X, z: 0, truck: null, cool: 0.6 },
      { x: LANE2_X, z: 0, truck: null, cool: 2.5 },
    ];
    this.carryT = 0;
    this.touch = { t: -9, dv: 0 }; // last touchdown of the carried box
    this.grab = null; // best grab candidate this step
    this.seat = null; // best set-down candidate this step
    this.assist = { x: 0, z: 0 };
    this.env = { wind: { x: 0, z: 0 }, assist: this.assist };
    this.cool = { clang: 0, honk: 0, rough: 0, creak: 3, chain: 0, bridge: 0, beep: 0, tick: 0 };
    this.controlsLocked = false;
    this.allow = { x: true, z: true, hoist: true, lock: true }; // tutorial gates
    this.usedContinue = false;
    this.shipIndex = 0;
    this.shipBase = 0; // boxes delivered before the current ship (Overtime)
    this.seed = opts.seed || Math.floor(Math.random() * 1e9);
    this.loops = {};
    this.sprVis = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), t: 1 };
    this.cabGhost = null;
    this.zoned = level.ship.zones.some((z) => z !== 'ANY');
    this.altitude = 0;
    this.lastSeatGrade = null;
    this.windScale = 1;
    this._build();
  }

  // ====================================================================== setup

  _build() {
    const { scene, harbor, crane, weather } = this.ctx;
    this.phys = new Phys();
    const p = this.phys;
    // quay slab
    p.box(47.5, 4, 170, { x: -47.5, y: DIM.QUAY_Y - 4, friction: 0.9, tag: { kind: 'quay' } });
    // crane legs + sills travel with the gantry
    this.gantryBody = p.kinematicBody(0, 0, 0);
    const tag = { kind: 'crane' };
    for (const x of [DIM.LEG_WATER_X, DIM.LEG_LAND_X]) {
      for (const sz of [-1, 1]) p.box(0.55, 14, 0.55, { body: this.gantryBody, x, y: DIM.QUAY_Y + 14, z: sz * DIM.LEG_HALF_Z, groups: GROUPS.crane, tag });
      p.box(0.4, 0.95, DIM.LEG_HALF_Z, { body: this.gantryBody, x, y: DIM.QUAY_Y + 0.95, groups: GROUPS.crane, tag });
    }
    this._makeShip(this.level);
    const st = this.level.start || { x: DIM.LANE_X, z: 0 };
    this.rig = new Rig(p, {
      x: st.x,
      z: st.z,
      rope: 7.5,
      mods: { trolley: this.mods.trolley, gantry: this.mods.gantry, hoist: this.mods.hoist, sway: TUNE.swayDamp * this.mods.swayMul },
    });
    this.guides = new Guides(scene);
    crane.setFlippers(this.mods.spreader);
    harbor.clearPickupMarks();
    harbor.markPickup(this.lanes[0].x, this.lanes[0].z);
    if (this._needsLane2()) harbor.markPickup(this.lanes[1].x, this.lanes[1].z);
    weather.set(this.level.weather, true);
    harbor.setSky(this.level.sky || (this.level.n >= 9 ? 'predawn' : this.level.n >= 4 ? 'night' : 'evening'), true);
    crane.setPose(this.rig.z, this.rig.x);
    this._syncVisuals(0);
    // a couple of physics steps so everything rests before the camera shows it
    for (let i = 0; i < 4; i++) this._fixedStep(STEP, true);
    this._syncVisuals(0);
  }

  _needsLane2() {
    return (this.level.preload || []).some((p) => p.discharge) || this.level.lanes === 2 || this.level.manifest.some((c) => c.check || c.black);
  }

  _makeShip(level) {
    this._makeHull(level);
    this._populateShip(level);
  }

  _makeHull(level) {
    const def = { ...level.ship, zoneOf: zoneFn(level.ship.zones), seed: (this.seed % 97) + this.shipIndex * 3.1 };
    this.ship = new Ship(def, this.phys);
    this.ctx.scene.add(this.ship.group);
    this.ship.paintZones();
    this.ship.setSea(level.weather.sea || 0);
  }

  _populateShip(level) {
    this.ship.setSea(level.weather.sea || 0);
    let brand = this.shipIndex * 2;
    for (const pre of level.preload || []) {
      for (let i = 0; i < (pre.n || 1); i++) {
        if (this.ship.height(pre.r, pre.b) >= this.ship.maxTiers) break;
        const c = this._newCargo({ zone: pre.zone || 'ANY', type: pre.type || 'std' }, brand++);
        c.preload = true;
        c.discharge = !!pre.discharge;
        c.state = 'locked';
        c.grade = 'pre';
        this.ship.lock(c, pre.r, pre.b);
      }
    }
    const P = this.ship;
    this.ctx.water.setHull(P.origin.x, P.origin.z + (P.zBow + P.zStern) / 2, P.halfBeam * 0.96, (P.zBow - P.zStern) / 2 - 2, 1);
  }

  _newCargo(spec, brand, look) {
    const c = new Cargo({ zone: spec.zone, type: spec.type, brand: (brand == null ? this.cargos.length : brand) % BRAND_COUNT, mobile: this.ctx.mobile, check: !!spec.check, look });
    c.spec = spec;
    c.mass = c.typeDef.mass;
    if (spec.episode) c.episode = spec.episode;
    // what the papers say it weighs, and what the load cell will say
    const range = { std: [9, 21], heavy: [28, 30.4], fragile: [6, 11], reefer: [14, 22], hazmat: [12, 20], black: [17, 19] }[c.type] || [9, 21];
    c.declT = Math.round(rand(range[0], range[1]) * 10) / 10;
    c.realT = c.declT + rand(-0.25, 0.25);
    if (spec.check && spec.contra) {
      c.contra = true;
      c.realT = Math.max(3.5, c.declT + (Math.random() < 0.6 ? rand(5, 9) : -rand(4, 6.5)));
      c.mass *= clamp(c.realT / c.declT, 0.7, 1.5);
    }
    if (c.black) c.thumpT = rand(5, 9);
    this.cargos.push(c);
    return c;
  }

  // ====================================================================== flow

  start() {
    this.phase = 'play';
    if (this.endless) this.time = this.timeTotal = this.level.roundTime * this.mods.timeMul;
    this.emit('start');
  }

  /** Upgrades bought mid-run take effect at once. */
  refreshMods() {
    this.mods = upgradeMods(this.ctx.save.data.upgrades, this.ctx.save.data.rigSetup, this.ctx.save.data.unlocks, this.ctx.save.data.settings.berth);
    // a brand-new operator's first few boxes: wider lock window, calmer swing, stronger centring
    if (this.rookieLeft > 0) {
      const m = this.mods;
      this.mods = { ...m, tolMul: m.tolMul * 1.7, grabMul: m.grabMul * 1.5, swayMul: m.swayMul * 2.4, assist: m.assist * 1.7 };
    }
    this.lockTol = TUNE.lockTol * this.mods.tolMul;
    Object.assign(this.rig.mods, { trolley: this.mods.trolley, gantry: this.mods.gantry, hoist: this.mods.hoist, sway: TUNE.swayDamp * this.mods.swayMul });
    this.ctx.crane.setFlippers(this.mods.spreader);
  }

  /** Combo multiplier: the main (endless) mode climbs to x3, the challenge shifts to x2. */
  multFor(combo) {
    return 1 + (this.endless ? 0.2 : 0.1) * Math.min(10, Math.max(0, combo - 1));
  }

  /**
   * Opening of the very first night: the first box already hangs on the spreader, seated over
   * its slot, so the first thing the player ever does is let go of it.
   */
  prehook(story = false) {
    const ship = this.ship;
    const spec = this.manifest[this.manifestIdx++];
    // (the story opening: a scuffed box with no name on it — scored like any other)
    const c = this._newCargo(spec, undefined, story ? 'unmarked' : '');
    // the free deck cell nearest the quay, in a bay that takes this box
    let cell = null;
    for (let r = 0; r < ship.rows && !cell; r++) for (let b = 0; b < ship.bays && !cell; b++) if (this._zoneOk(c, r, b) && !this._ruleProblem(c, r, b) && ship.height(r, b) === 0) cell = { r, b };
    if (!cell) cell = { r: 0, b: 0 };
    const wp = ship.localToWorld(ship.cellLocal(cell.r, cell.b, 0));
    const rig = this.rig;
    rig.reset(wp.x, wp.z, 7);
    this.ctx.scene.add(c.mesh);
    c.state = 'carried';
    rig.attach(c);
    // settle the rope so the box hangs a hand's width over the deck
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i < 6; i++) this._fixedStep(1 / 60, true);
      const gap = rig.bottomWorld(_v).y - (DIM.DECK_Y + 0.12 + ship.pose.y) - 0.07;
      rig.rope = clamp(rig.rope + gap, DIM.ROPE_MIN, DIM.ROPE_MAX);
      rig._setRope(rig.rope);
    }
    for (let i = 0; i < 30; i++) this._fixedStep(1 / 60, true);
    // the story opening: it is still swinging a little when the picture comes up
    if (story) {
      rig.sprBody.setLinvel({ x: 0.32, y: 0, z: 0.18 }, true);
      this.storyOpening = true;
    }
    this.carryT = 0;
    c.pickedAt = this.elapsed;
    this._resetInterp();
    this._syncVisuals(0);
    this.prehooked = c;
    this._prehookCell = cell;
    this._firstNight = true;
    // until the first input the hanging crate is off limits for penalties (and loud bursts)
    this.calm = true;
    return c;
  }

  // ---------------------------------------------------------------- automation (one-touch play + coaching)

  /** Point the crane at (x, z); `held` = a finger is still on it (nothing automatic happens meanwhile). */
  setTarget(x, z, held) {
    if (x == null) {
      this.target = null;
      return;
    }
    this.target = this.target || {};
    this.target.x = clamp(x, DIM.TROLLEY_MIN_X, DIM.TROLLEY_MAX_X);
    this.target.z = clamp(z, -DIM.GANTRY_RANGE, DIM.GANTRY_RANGE);
    this.target.held = !!held;
  }

  /** Where a released finger most likely meant: the nearest box to pick up, or the nearest legal slot. */
  snapTarget(x, z) {
    const ship = this.ship;
    let best = null;
    let bd = 3.2;
    const consider = (px, pz) => {
      const d = Math.hypot(px - x, (pz - z) * 0.7);
      if (d < bd) {
        bd = d;
        best = { x: px, z: pz };
      }
    };
    const c = this.rig.carry;
    if (!c) {
      for (const k of this.cargos) {
        if (k.state === 'truck' && k.truck && k.truck.parked && !k.truck.departing && k.truck.purpose === 'deliver') consider(k.truck.laneX, k.truck.z + k.truck.zOff);
        else if ((k.state === 'loose' && k.settled && !k.inWater) || (k.state === 'locked' && (k.discharge || k.misplaced) && ship.top(k.cell.r, k.cell.b) === k)) {
          k.mesh.getWorldPosition(_v);
          consider(_v.x, _v.z);
        }
      }
    } else {
      for (let r = 0; r < ship.rows; r++) {
        for (let b = 0; b < ship.bays - (c.long ? 1 : 0); b++) {
          if (!this._zoneOk(c, r, b) || this._ruleProblem(c, r, b)) continue;
          const lp = c.long ? ship.pairLocal(r, b, 0) : ship.cellLocal(r, b, 0);
          ship.localToWorld(lp, _v);
          consider(_v.x, _v.z);
        }
      }
      for (const tr of this.trucks) if (tr.parked && !tr.cargo && (tr.purpose === 'collect' || tr.purpose === 'customs')) consider(tr.laneX, tr.z + tr.zOff);
    }
    return best || { x, z };
  }

  /** Steer trolley and gantry towards the target, braking in time. */
  _steer(ctl) {
    const T = this.target;
    const rig = this.rig;
    const axis = (err, v, vmax, acc) => {
      if (Math.abs(err) < 0.04 && Math.abs(v) < 0.15) return 0;
      const want = Math.sign(err) * Math.min(vmax, Math.sqrt(2 * acc * Math.abs(err)) * 0.8);
      return clamp(want / vmax + (want - v) * 0.6, -1, 1);
    };
    ctl.x = axis(T.x - rig.x, rig.vx, TUNE.trolleySpeed * this.mods.trolley, TUNE.trolleyAccel);
    ctl.z = axis(T.z - rig.z, rig.vz, TUNE.gantrySpeed * this.mods.gantry, TUNE.gantryAccel);
  }

  /** Is a box that wants picking up right under the spreader (any height)? */
  _boxBelow(tol) {
    const sp = this.rig.sprPos;
    for (const k of this.cargos) {
      let ok = false;
      if (k.state === 'truck') ok = k.truck && k.truck.parked && !k.truck.departing && k.truck.purpose === 'deliver';
      else if (k.state === 'loose') ok = k.settled && !k.inWater;
      else if (k.state === 'locked') ok = (k.misplaced || k.discharge) && this.ship.top(k.cell.r, k.cell.b) === k;
      if (!ok) continue;
      k.mesh.getWorldPosition(_v2);
      if (Math.abs(_v2.x - sp.x) < tol && Math.abs(_v2.z - sp.z) < tol * 1.6 && sp.y > _v2.y) return true;
    }
    return false;
  }

  /** A grab worth making: not a box that is already where it belongs on the ship. */
  wantedGrab() {
    const g = this.grab;
    if (!g) return null;
    const c = g.cargo;
    if (c.state === 'locked' && !c.misplaced && !c.discharge && !(c.preload && c.discharge)) return null;
    return g;
  }

  /** Automatic hoist: lift clear while travelling, lower onto whatever the spreader is lined up with. */
  _autoHoist(ctl) {
    const rig = this.rig;
    const moving = Math.abs(ctl.x) + Math.abs(ctl.z) > 0.12 || (this.target && Math.hypot(this.target.x - rig.x, this.target.z - rig.z) > 0.6);
    const swing = Math.hypot(rig.sprVel.x - rig.vx, rig.sprVel.z - rig.vz);
    const clear = 6.3;
    let lower = false;
    if (!moving && swing < 1.3 && !(this.target && this.target.held)) {
      if (rig.carry) {
        const s = this.seat;
        lower = !!(s && s.err < 0.7 && !s.seated && s.problem !== 'full' && s.problem !== 'heavy' && s.problem !== 'uneven' && (s.kind !== 'truck' || !s.problem));
        if (s && s.seated) return 0;
      } else {
        const g = this.wantedGrab();
        if (g && g.ready) return 0;
        // (the grab finder only looks a few metres down: from travelling height, check the boxes directly)
        lower = !!(g && Math.hypot(g.lx, g.lz) < 0.5) || this._boxBelow(0.5);
      }
    }
    if (lower) return -1;
    return rig.rope > clear + 0.2 ? 1 : 0;
  }

  /** Automatic lock / release once the spreader is settled where it should be. */
  _autoActions(dt) {
    const A = this.auto;
    if (!A || this.phase !== 'play' || this.controlsLocked || (this.target && this.target.held)) {
      this._autoT = 0;
      return;
    }
    const rig = this.rig;
    const wg = this.wantedGrab();
    if (!rig.carry && A.lock && wg && wg.ready) {
      this._autoT = (this._autoT || 0) + dt;
      if (this._autoT > 0.18) {
        this._autoT = 0;
        this.tryGrab();
      }
      return;
    }
    const s = this.seat;
    const good = s && s.seated && s.valid && (s.kind === 'truck' ? !s.problem : s.zoneOk && !s.problem);
    if (rig.carry && A.release && rig.carry !== this.holdBack && good) {
      this._autoT = (this._autoT || 0) + dt;
      if (this._autoT > 0.3) {
        this._autoT = 0;
        this.release();
      }
      return;
    }
    this._autoT = 0;
  }

  setControlsLocked(v) {
    this.controlsLocked = v;
  }

  /** Rewarded-ad continue. */
  continueRun() {
    if (this.phase !== 'over') return;
    this.usedContinue = true;
    if (this.failReason === 'time') {
      this.time = 50;
      this.timeTotal = Math.max(this.timeTotal, 50);
    } else {
      this.strikes = Math.max(0, this.maxStrikes - 1);
    }
    this.failReason = null;
    this.phase = 'play';
    this.emit('continue');
  }

  _finish(success, reason) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.failReason = success ? null : reason;
    const smuggled = this.endless ? 0 : this._sweep();
    let timeBonus = 0;
    if (success && !this.endless) {
      timeBonus = Math.round(Math.max(0, this.time) * 2);
      this.score += timeBonus;
    }
    this.stats.timeBonus = timeBonus;
    const stars = this.endless ? 0 : success ? Math.max(1, starsFor(this.level, this.score)) : 0;
    this.result = {
      success,
      reason,
      score: Math.max(0, Math.round(this.score)),
      stars,
      thresholds: this.endless ? null : starThresholds(this.level),
      delivered: this.delivered,
      quota: this.quota,
      strikes: this.strikes,
      bestCombo: this.bestCombo,
      stats: { ...this.stats },
      canContinue: !success && !this.usedContinue,
      smuggled,
      timeLeft: Math.max(0, this.time),
      black: this.blackSeen ? this.blackOutcome || 'left' : null,
      ships: this.stats.ships,
      time: this.elapsed,
    };
    this.emit('finish', this.result);
  }

  // ====================================================================== main update

  update(dt) {
    const run = this.phase === 'play' || this.phase === 'swap' || this.phase === 'pre' || this.phase === 'over';
    if (!run) return;
    // Fixed timestep (1/60 s) with an accumulator: the same input gives the same swing and the same
    // landing at 30, 60 or 144 Hz. What is drawn is interpolated between the last two steps, so a
    // high refresh rate stays perfectly smooth.
    const frame = Math.min(dt, 0.1);
    this.acc = (this.acc || 0) + frame;
    let steps = 0;
    while (this.acc >= STEP - 1e-6 && steps < 8) {
      this._capturePrev();
      this._fixedStep(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps >= 8 || Math.abs(this.acc) < 1e-6) this.acc = 0; // (no float dust carried over)
    this.alpha = clamp(this.acc / STEP, 0, 1);

    if (this.phase === 'play') {
      this.elapsed += dt;
      if ((!this.endless || this.time > 0) && !this.timeFrozen) this.time -= dt;
      this._handleActions();
      this._autoActions(dt);
      this._updateTrucks(dt);
      this._checkEnd(dt);
    } else {
      this._updateTrucks(dt);
    }
    if (this.phase === 'swap') {
      this.swapClock = (this.swapClock || 0) + dt;
      // the crane answers again a moment after the ship leaves: grab the next box while she comes in
      if (this.swapClock > 1.2) {
        this._handleActions();
        this._autoActions(dt);
      }
      this._updateSwap(dt);
    }
    // the next ship is built well before she is needed (spreads the cost; the swap stays smooth)
    if (this.endless && this.phase === 'play' && !this._nextShip && !this.attract && this.elapsed - (this._dockedAt || 0) > 4 && (!this.rig.carry || this.elapsed - (this._dockedAt || 0) > 20)) this._prebuildNext();
    if (this.phase === 'over' && this.result && this.result.success && !this.endless) {
      // the loaded ship eases off the berth behind the results
      this.departT = (this.departT || 0) + dt;
      const k = Math.max(0, this.departT - 2.2);
      this.ship.offsetZ = Math.min(170, 0.42 * k * k);
      this.ship.offsetX = Math.min(9, 0.05 * k * k);
    }
    for (const k in this.cool) this.cool[k] -= dt;
    if (this.rig.carry) this.carryT += dt;
    this._updateReefers(dt);
    this._updateScale(dt);
    this._updateBlack(dt);
    if (this.phase === 'play' && !this.timeFrozen) {
      for (const e of this.events) {
        if (e.fired || this.elapsed < e.at) continue;
        e.fired = true;
        this.emit('event', e);
      }
    }
    // the scripted gust: a beat of warning, then the push
    const sg = this._sgust;
    if (sg && sg.warn > 0 && (sg.warn -= dt) <= 0) {
      sg.push = 1.15;
      this.emit('scriptedGust', { dir: sg.dir });
    }
    this._syncVisuals(dt);
    this._updateGuides(dt);
    this._updateAudio(dt);
  }

  /** Snapshot of everything drawn from physics, taken before each step (for interpolation). */
  _capturePrev() {
    const r = this.rig;
    const P = this._prev || (this._prev = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), trolley: new THREE.Vector3(), x: 0, z: 0, rope: 0, ok: false });
    P.x = r.x;
    P.z = r.z;
    P.rope = r.rope;
    P.pos.copy(r.sprPos);
    P.quat.copy(r.sprQuat);
    P.trolley.copy(r.trolleyPos);
    P.ok = true;
    for (const k of this.cargos) {
      if (k.state !== 'loose' || !k.body) {
        k._ip = false;
        continue;
      }
      const t = k.body.translation();
      const q = k.body.rotation();
      (k._p0 || (k._p0 = new THREE.Vector3())).set(t.x, t.y, t.z);
      (k._q0 || (k._q0 = new THREE.Quaternion())).set(q.x, q.y, q.z, q.w);
      k._ip = true;
    }
  }

  /** After a teleport (prehook, grab snap): draw the current state, not a blend from the old one. */
  _resetInterp() {
    if (this._prev) this._prev.ok = false;
  }

  _controls() {
    // while ships change over the crane is free after a moment (fetch the next box), but over the
    // water the spreader stays clear of the passing wheelhouse
    if (this.phase === 'swap') {
      if (this.swapClock < 1.2 || this.controlsLocked) return { x: 0, z: 0, hoist: this.rig.rope > 4.6 ? 1 : 0 };
      const ctl = this._playerControls();
      if (this.rig.x > -1 && this.rig.rope > 4.6) ctl.hoist = Math.max(ctl.hoist, 1);
      return ctl;
    }
    // shift done: lift clear so the ship can cast off
    if (this.phase === 'over' && this.result && this.result.success) return { x: 0, z: 0, hoist: this.rig.rope > 6 ? 1 : 0 };
    // menu backdrop: the crane idles through a slow cycle on its own
    if (this.attract) {
      const t = this.simT;
      // (kept high: the idle cycle must never touch the ship)
      return { x: Math.sin(t * 0.21) * 0.45, z: Math.sin(t * 0.13 + 1) * 0.3, hoist: this.rig.rope > 8.5 ? 0.6 : Math.sin(t * 0.33 + 2) * 0.35 };
    }
    if (this.phase !== 'play' || this.controlsLocked) return { x: 0, z: 0, hoist: 0 };
    return this._playerControls();
  }

  /** What the player (or the one-touch helpers) ask of the crane this step. */
  _playerControls() {
    const ctl = { x: this.allow.x ? input.axisX : 0, z: this.allow.z ? input.axisZ : 0, hoist: 0 };
    // a finger (or any manual axis input, which cancels it) steers the crane to a point
    if (this.target) {
      if (Math.abs(ctl.x) + Math.abs(ctl.z) > 0.2) this.target = null;
      else this._steer(ctl);
    }
    let hoist = this.allow.hoist ? input.hoist : 0;
    if (this.auto && this.auto.hoist && Math.abs(hoist) < 0.1) hoist = this._autoHoist(ctl);
    if (hoist < 0 && this.altitude < 2.3) {
      // creep speed for the last couple of metres, like a real hoist: no accidental slams
      const cap = TUNE.creepSpeed / (TUNE.hoistSpeed * this.mods.hoist);
      hoist = Math.max(hoist, -lerp(cap, 1, clamp((this.altitude - 0.4) / 1.9, 0, 1)));
    }
    ctl.hoist = hoist;
    // snap assist: lowered near a legal slot, the box slides over it, sits down and locks by itself
    const k = this.snapK();
    if (k > 0) this._snapAssist(ctl, k);
    else this._snap = null;
    return ctl;
  }

  /**
   * How strong the snap assist is now: full on a session's first ship (and for its very first box,
   * whatever the mode), half on the second ship, then gone — the skill is the player's from ship 3.
   */
  snapK() {
    if (this.attract) return 0;
    if (!this._firstLockDone) return 1;
    if (!this.endless) return 0;
    return this.shipIndex === 0 ? 1 : this.shipIndex === 1 ? 0.5 : 0;
  }

  _snapAssist(ctl, k) {
    const rig = this.rig;
    const c = rig.carry;
    const slot = this.guideSlot;
    // (boxes with their own rules keep them: outbound, unlisted, spot checks, returns)
    if (!c || !slot || this.phase !== 'play' || c.discharge || c.black || c.returning || c.weighed === 'mismatch' || (c.check && !c.weighed) || c === this.prehooked) {
      this._snap = null;
      return;
    }
    const b = rig.bottomWorld(_vs);
    const dx = slot.x - b.x;
    const dz = slot.z - b.z;
    const d = Math.hypot(dx, dz);
    const gap = b.y - (slot.y - c.hy);
    const R = SNAP.radius * k;
    const steer = Math.hypot(ctl.x, ctl.z);
    // steering hard away cancels it; it engages once the player lowers within reach of the slot
    const away = steer > 0.6 && (ctl.x * dx + ctl.z * dz) / (steer * Math.max(d, 1e-3)) < -0.2;
    if (this._snap && (away || d > R * 1.4 || gap > SNAP.height + 2)) this._snap = null;
    if (!this._snap && !away && d < R && gap < SNAP.height + k && ctl.hoist < -0.05) {
      this._snap = { t: 0 };
      this.emit('snapStart', { k });
    }
    if (!this._snap) return;
    this._snap.t += 1 / 60;
    // slide: the trolley and gantry carry the box over the slot
    const T = (this._snapT || (this._snapT = { x: 0, z: 0 }));
    T.x = clamp(rig.x + dx, DIM.TROLLEY_MIN_X, DIM.TROLLEY_MAX_X);
    T.z = clamp(rig.z + dz, -DIM.GANTRY_RANGE, DIM.GANTRY_RANGE);
    const keep = this.target;
    this.target = T;
    this._steer(ctl);
    this.target = keep;
    // and down, once it is over the slot (never onto a neighbour)
    ctl.hoist = d < SNAP.align ? Math.min(ctl.hoist, -0.7) : Math.max(ctl.hoist, 0);
    const seat = this.seat;
    if (seat && seat.kind === 'ship' && seat.seated && seat.valid && seat.zoneOk && !seat.problem && d < SNAP.align) this._snapReady = true;
  }

  _fixedStep(h, warm = false) {
    this.simT += h;
    this.phys.world.timestep = h;
    const rig = this.rig;
    const w = this.ctx.weather.wind;
    this.env.wind.x = w.x * this.windScale;
    this.env.wind.z = w.z * this.windScale;
    // a scripted gust (the opening's second box): a short, hard push on the load
    const sg = this._sgust;
    if (sg && sg.push > 0) {
      sg.push -= h;
      this.env.wind.x += sg.x;
      this.env.wind.z += sg.z;
    }
    // height of the load above whatever is under it, measured every step (the hoist's creep speed
    // depends on it, so it must not wait for the next rendered frame)
    if (!warm) {
      const b = rig.bottomWorld(_va);
      const hit = this.phys.rayDown(b.x, b.y + 0.4, b.z, 60, rig.sprBody);
      this.altitude = hit ? Math.max(0, hit.dist - 0.4) : Math.max(0, b.y);
    }
    const ctl = warm ? { x: 0, z: 0, hoist: 0 } : this._controls();
    if (!warm) {
      const base = TUNE.swayDamp * this.mods.swayMul;
      if (this.touchAssist) {
        const steer = Math.max(Math.abs(ctl.x), Math.abs(ctl.z));
        this._stickIdle = steer < 0.08 ? (this._stickIdle || 0) + h : 0;
        let k = steer < 0.08 ? lerp(2.1, 3.4, clamp(this._stickIdle / 0.6, 0, 1)) : 1.7;
        // (it fades out over the last two metres: touching down, the box must not be dragged sideways)
        k = lerp(1, k, clamp((this.altitude - 0.3) / 2, 0, 1));
        rig.mods.sway = Math.min(9, base * k);
      } else rig.mods.sway = base;
    }
    this._computeAssist(ctl);
    if (!warm) this._watchCounter(h, ctl);
    rig.fixedUpdate(h, ctl, this.env);
    this.gantryBody.setNextKinematicTranslation({ x: 0, y: 0, z: rig.z });
    this.ship.fixedUpdate(this.simT, h);
    // water forces on anything that went overboard
    for (const c of this.cargos) {
      if (c.state !== 'loose' || !c.body) continue;
      if (c.inWater) {
        const t = c.body.translation();
        const sub = clamp((0.9 - t.y) / 2.2, 0, 1);
        c.body.resetForces(true);
        c.body.addForce({ x: 0, y: c.body.mass() * -TUNE.gravity * (0.35 + 0.5 * sub), z: 0 }, true);
      }
    }
    this.phys.step();
    rig.sync();
    this.ship.syncVisual();
    if (!warm) this._postStep(h);
  }

  // ====================================================================== assist + candidates

  _cargoWorld(c, pos, quat) {
    c.mesh.updateWorldMatrix(true, false);
    c.mesh.matrixWorld.decompose(pos, quat, _s);
  }

  _findGrab() {
    const rig = this.rig;
    let best = null;
    let bestD = 1e9;
    const bottom = rig.bottomWorld(_v);
    for (const c of this.cargos) {
      const st = c.state;
      if (st === 'truck') {
        if (!c.truck || !c.truck.parked || c.truck.departing) continue;
      } else if (st === 'locked') {
        if (this.ship.top(c.cell.r, c.cell.b) !== c) continue;
        if (c.long && this.ship.top(c.cell.r, c.cell.b + 1) !== c) continue;
      } else if (st !== 'loose') continue;
      if (c.inWater) continue;
      this._cargoWorld(c, _v2, _q);
      const dx0 = bottom.x - _v2.x;
      const dz0 = bottom.z - _v2.z;
      if (dx0 * dx0 + dz0 * dz0 > 16) continue;
      // spreader bottom in the box's local frame
      _q2.copy(_q).invert();
      _v3.copy(bottom).sub(_v2).applyQuaternion(_q2);
      const dy = _v3.y - c.hy;
      if (dy < -0.6 || dy > 5) continue;
      const up = _s.set(0, 1, 0).applyQuaternion(_q);
      if (up.y < 0.965) continue;
      const d = Math.hypot(_v3.x, _v3.z);
      if (d >= bestD) continue;
      // relative yaw
      _q2.multiply(rig.sprQuat);
      const yaw = Math.abs(Math.atan2(2 * (_q2.w * _q2.y + _q2.x * _q2.z), 1 - 2 * (_q2.y * _q2.y + _q2.x * _q2.x)));
      const tiltOk = _s.set(0, 1, 0).applyQuaternion(rig.sprQuat).dot(up) > 0.975;
      bestD = d;
      best = {
        cargo: c,
        lx: _v3.x,
        lz: _v3.z,
        dy,
        ready: Math.abs(_v3.x) < TUNE.grabTolX * this.mods.grabMul && Math.abs(_v3.z) < TUNE.grabTolZ * this.mods.grabMul && dy > -0.3 && dy < 0.34 && yaw < 0.2 && tiltOk,
        top: new THREE.Vector3(0, c.hy, 0).applyQuaternion(_q).add(_v2),
        quat: _q.clone(),
        pos: _v2.clone(),
      };
    }
    return best;
  }

  _zoneOk(cargo, r, b) {
    if (cargo.long && cargo.zone !== 'ANY') return [b, b + 1].every((bb) => ['ANY', cargo.zone].includes(this.ship.zoneOf(r, bb)));
    const z = this.ship.zoneOf(r, b);
    return z === 'ANY' || cargo.zone === 'ANY' || z === cargo.zone;
  }

  /** Reasons a box may not be twist-locked at (r, b). Returns null when fine. */
  _ruleProblem(cargo, r, b) {
    const ship = this.ship;
    if (cargo.long) {
      // a forty-footer needs two neighbouring columns at the same height to sit on
      if (b < 0 || b >= ship.bays - 1) return 'full';
      const h0 = ship.height(r, b);
      const h1 = ship.height(r, b + 1);
      if (Math.max(h0, h1) >= ship.maxTiers) return 'full';
      if (h0 !== h1) return 'uneven';
      return null;
    }
    const t = ship.height(r, b);
    if (t >= ship.maxTiers) return 'full';
    const below = ship.top(r, b);
    if (cargo.type === 'heavy' && below && below.type !== 'heavy') return 'heavy';
    if (cargo.type === 'hazmat') {
      const near = [];
      if (below) near.push(below);
      for (const [dr, db] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const rr = r + dr;
        const bb = b + db;
        if (rr < 0 || bb < 0 || rr >= ship.rows || bb >= ship.bays) continue;
        const n = ship.grid[rr][bb][t];
        if (n) near.push(n);
      }
      if (near.some((n) => n.type === 'hazmat')) return 'hazmat';
    }
    return null;
  }

  _findSeat() {
    const rig = this.rig;
    const cargo = rig.carry;
    if (!cargo) return null;
    const ship = this.ship;
    const bottom = rig.bottomWorld(_v);
    // --- ship cells
    const l = ship.worldToLocal(bottom, _v2);
    const col = cargo.long ? ship.pairAt(l.x, l.z, 0.12) : ship.columnAt(l.x, l.z, 0.12);
    if (col && this.phase === 'play') {
      const t = cargo.long ? ship.pairHeight(col.r, col.b) : ship.height(col.r, col.b);
      const supportY = DIM.DECK_Y + 0.12 + t * DIM.CONT_H;
      const gap = l.y - supportY;
      if (gap > -0.8) {
        const err = Math.max(Math.abs(col.dx) / this.lockTol, Math.abs(col.dz) / (this.lockTol * 1.3));
        const tilt = _s.set(0, 1, 0).applyQuaternion(rig.sprQuat).dot(ship.up(_v3));
        const problem = this._ruleProblem(cargo, col.r, col.b);
        const zoneOk = this._zoneOk(cargo, col.r, col.b);
        return {
          kind: 'ship',
          r: col.r,
          b: col.b,
          t,
          dx: col.dx,
          dz: col.dz,
          gap,
          err,
          problem,
          zoneOk,
          seated: gap < 0.17,
          valid: err <= 1 && tilt > 0.985 && problem !== 'full' && problem !== 'heavy' && problem !== 'uneven',
          grade: err <= TUNE.perfect / this.lockTol ? 'perfect' : err <= TUNE.great / this.lockTol ? 'great' : err <= 1 ? 'good' : 'off',
        };
      }
    }
    // --- collector trucks
    for (const tr of this.trucks) {
      if ((tr.purpose !== 'collect' && tr.purpose !== 'customs') || !tr.parked || tr.cargo) continue;
      const c = tr.bedCenter(cargo.hy, _v3);
      const dx = bottom.x - c.x;
      const dz = bottom.z - c.z;
      if (Math.abs(dx) > 1.6 || Math.abs(dz) > 3.4) continue;
      const gap = bottom.y - (c.y - cargo.hy);
      const tol = this.lockTol * 1.15;
      const err = Math.max(Math.abs(dx) / tol, Math.abs(dz) / (tol * 1.3));
      return {
        kind: 'truck',
        truck: tr,
        dx,
        dz,
        gap,
        err,
        zoneOk: true,
        problem: cargo.returning ? null : tr.purpose === 'customs' ? (cargo.check || cargo.black ? null : 'notcustoms') : cargo.discharge ? null : 'notout',
        seated: gap < 0.2,
        valid: err <= 1 && gap > -0.8,
        grade: err <= 0.3 ? 'perfect' : err <= 0.62 ? 'great' : err <= 1 ? 'good' : 'off',
      };
    }
    return null;
  }

  _computeAssist(ctl) {
    const rig = this.rig;
    const a = this.assist;
    a.x = 0;
    a.z = 0;
    const k = 4.2 * this.mods.assist;
    let tx = null;
    let tz = null;
    let gap = 9;
    if (rig.carry) {
      const s = (this.seat = this._findSeat());
      this.grab = null;
      if (s && s.err < 2.4 && s.problem !== 'full') {
        tx = -s.dx;
        tz = -s.dz;
        gap = s.gap;
        if (s.kind === 'ship') {
          // dx/dz are ship-local: good enough (ship yaw is zero, roll small)
        }
      }
    } else {
      const g = (this.grab = this._findGrab());
      this.seat = null;
      if (g && Math.hypot(g.lx, g.lz) < 1.5) {
        // candidate offsets are in the box frame; boxes are near axis-aligned when grabbable
        tx = -g.lx;
        tz = -g.lz;
        gap = g.dy;
      }
    }
    if (tx !== null && gap < 6.5 && gap > -0.4) {
      // Flipper / cell-guide assist: starts centring well above the neighbouring stacks so the box
      // does not snag on them, and backs off while the player is actively steering.
      const steer = ctl ? Math.max(Math.abs(ctl.x), Math.abs(ctl.z)) : 0;
      const near = clamp(1 - gap / 6.5, 0.3, 1) * (1 - 0.65 * steer);
      const v = rig.sprVel;
      a.x = clamp(tx * k * 1.25 * near - (v.x - rig.vx) * 1.2 * near, -5, 5);
      a.z = clamp(tz * k * 1.25 * near - (v.z - rig.vz) * 1.2 * near, -5, 5);
    }
  }

  /**
   * Countering a swing (any time): the load is well out from under the trolley and the player drives
   * the trolley towards it until it hangs quiet again. Small bonus, and a word for it.
   */
  _watchCounter(h, ctl) {
    const rig = this.rig;
    this._counterCool = Math.max(0, (this._counterCool || 0) - h);
    if (this.phase !== 'play' || !rig.carry || this.calm) {
      this._cw = null;
      return;
    }
    const ox = rig.sprPos.x - rig.x;
    const oz = rig.sprPos.z - rig.z;
    const off = Math.hypot(ox, oz);
    let w = this._cw;
    if (!w) {
      if (off > COUNTER.armAt && this._counterCool <= 0) w = this._cw = { t: 0, peak: off, held: 0 };
      else return;
    }
    w.t += h;
    w.peak = Math.max(w.peak, off);
    // driving the trolley under the load (towards where it has swung) takes the energy out
    const steer = Math.hypot(ctl.x, ctl.z);
    w.off = off;
    w.steering = steer > 0.25 && off > 0.25 && (ctl.x * ox + ctl.z * oz) / (steer * off) > 0.35;
    if (w.steering) w.held += h;
    // quiet means hanging still under the trolley, not just swinging through the middle
    const rv = Math.hypot(rig.sprVel.x - rig.vx, rig.sprVel.z - rig.vz);
    w.quiet = off < COUNTER.quietAt && rv < COUNTER.quietSpeed ? (w.quiet || 0) + h : 0;
    if (w.quiet >= COUNTER.quietHold && w.held >= COUNTER.minHold) {
      this._cw = null;
      this._counterCool = COUNTER.cooldown;
      this.score += COUNTER.bonus;
      this.stats.countered = (this.stats.countered || 0) + 1;
      this.emit('countered', { pts: COUNTER.bonus, pos: rig.sprPos.clone(), peak: w.peak });
      this.emit('steady', { pos: rig.sprPos.clone(), countered: true });
    } else if (w.quiet >= COUNTER.quietHold) {
      // damped without the player's help: still a STEADY, but nothing paid
      this._cw = null;
      this._counterCool = 2;
      this.emit('steady', { pos: rig.sprPos.clone(), countered: false });
    } else if (w.t > COUNTER.window) this._cw = null;
  }

  /** The opening's second box: a gust is coming (called once). Returns the push direction. */
  scriptGust() {
    const dir = this.rig.sprPos.z > 0 ? -1 : 1;
    this._sgust = { warn: 0.9, push: 0, x: 0, z: COUNTER.gust * dir, dir };
    this.emit('gustWarn', { dir });
  }

  // ====================================================================== player actions

  _handleActions() {
    if (this.controlsLocked) return;
    // the snap assist sets the box down: it locks with a clunk
    if (this._snapReady) {
      this._snapReady = false;
      this._snap = null;
      if (this.rig.carry) {
        this.rig.carry.snapLock = true;
        this.release();
        if (this.rig.carry) this.rig.carry.snapLock = false;
      }
    }
    if (this.calm && (input.action('lock') || Math.abs(input.axisX) + Math.abs(input.axisZ) + Math.abs(input.hoist) > 0.05 || this.target)) this.calm = false;
    if (input.action('lock') && this.allow.lock) {
      if (this.rig.carry) this.release();
      else this.tryGrab();
    }
    if (input.action('horn') && this.cool.honk < 0) {
      this.cool.honk = 0.9;
      audio.play('horn_crane', { pos: this.rig.trolleyPos });
      this.emit('horn');
    }
  }

  tryGrab() {
    const g = this.grab;
    const rig = this.rig;
    if (!g || !g.ready) {
      audio.play('ui_error', { vol: 0.7 });
      this.ctx.crane.setLed('error');
      this._ledT = 0.35;
      this.emit('toast', { text: g && Math.hypot(g.lx, g.lz) < 2.5 ? 'Line up, then lower' : 'Lower onto a box first', kind: 'hint', key: 'grabfail' });
      return false;
    }
    const c = g.cargo;
    // snap the spreader onto the corner castings (the flippers guide it home)
    this._cargoWorld(c, _v, _q);
    const sprTarget = _v2.set(0, c.hy + DIM.SPR_H / 2 + 0.03, 0).applyQuaternion(_q).add(_v);
    this.sprVis.pos.copy(rig.sprPos).sub(sprTarget);
    this.sprVis.t = 0;
    rig.sprBody.setTranslation({ x: sprTarget.x, y: sprTarget.y, z: sprTarget.z }, true);
    rig.sprBody.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    this._resetInterp();
    const from = c.state;
    if (from === 'truck') {
      const tr = c.truck;
      this.ctx.scene.attach(c.mesh);
      tr.release();
      if (c.type === 'reefer') c.thawing = true;
    } else if (from === 'locked') {
      if (c.counted) this._uncount(c);
      this.ship.unlock(c, this.ctx.scene);
    } else if (from === 'loose') {
      if (c.counted) this._uncount(c);
      this.phys.removeBody(c.body);
      c.body = null;
    }
    c.state = 'carried';
    c.settled = false;
    c.misplaced = false;
    c.unsecured = false;
    this.scale.t = 0;
    if (c.black) {
      this.blackOutcome = null;
      c.thumpT = rand(2.4, 4.2);
    }
    rig.attach(c);
    rig.sync();
    this.carryT = 0;
    this.touch.t = -9;
    this.touch.dv = 0;
    c.pickedAt = this.elapsed;
    audio.play('lock', { pos: rig.sprPos });
    this.ctx.fx.sparks(sprTarget.x, sprTarget.y - 0.2, sprTarget.z, 6, null, 3);
    this.ctx.cams.punch(0, -0.12, 0);
    this.emit('grab', c);
    return true;
  }

  release() {
    const rig = this.rig;
    const c = rig.carry;
    if (!c) return;
    const seat = this._findSeat();
    // (only a contact in the last moment says how hard the box is sitting down)
    const soft = this.simT - this.touch.t > 0.05 ? 0 : this.touch.dv;
    const pose = rig.detach();
    audio.play('unlock', { pos: rig.sprPos });
    // a short drop straight over a cell is decided now, not by how the box happens to bounce
    const shortDrop = seat && seat.kind === 'ship' && !seat.seated && seat.err <= 1 && seat.gap < 1.2 && c.type !== 'fragile' && !['full', 'heavy', 'uneven'].includes(seat.problem);
    if (seat && seat.seated && seat.valid && seat.kind === 'ship') {
      this._lockToShip(c, seat, { dropped: false, touchDv: soft });
    } else if (shortDrop) {
      this._lockToShip(c, { ...seat, grade: 'good' }, { dropped: true, touchDv: 1.5 + seat.gap * 2 });
    } else if (seat && seat.seated && seat.valid && seat.kind === 'truck' && !seat.problem) {
      this._lockToTruck(c, seat);
    } else {
      this._makeLoose(c, pose);
      if (seat && seat.seated && seat.kind === 'ship') {
        if (seat.problem === 'heavy') this.emit('toast', { text: 'Too heavy for that stack', kind: 'warn' });
        else if (seat.problem === 'uneven') this.emit('toast', { text: '40 ft: both columns level', kind: 'warn' });
        else if (seat.problem === 'full') this.emit('toast', { text: 'Stack is full', kind: 'warn' });
        else if (seat.err > 1) this.emit('toast', { text: 'Off the lock points', kind: 'warn', key: 'loose' });
      } else if (seat && seat.kind === 'truck' && seat.problem === 'notout') {
        this.emit('toast', { text: 'Not on the list', kind: 'hint' });
      } else if (seat && seat.kind === 'truck' && seat.problem === 'notcustoms') {
        this.emit('toast', { text: 'Customs: sealed boxes only', kind: 'hint' });
      } else if (seat && seat.gap > 0.6) {
        this.emit('drop', c);
      }
    }
    this.emit('release', c);
  }

  // ====================================================================== cargo state changes

  _makeLoose(c, pose) {
    const p = this.phys;
    if (!pose) {
      this._cargoWorld(c, _v, _q);
      pose = { pos: { x: _v.x, y: _v.y, z: _v.z }, rot: { x: _q.x, y: _q.y, z: _q.z, w: _q.w }, linvel: { x: 0, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 } };
    }
    if (c.mesh.parent !== this.ctx.scene) this.ctx.scene.attach(c.mesh);
    const body = p.dynamicBody(pose.pos.x, pose.pos.y, pose.pos.z, { canSleep: true, linDamp: 0.04, angDamp: 0.25, ccd: true });
    body.setRotation(pose.rot, true);
    body.setLinvel(pose.linvel, true);
    body.setAngvel(pose.angvel, true);
    const vol = c.hx * 2 * c.hy * 2 * c.hz * 2;
    c.collider = p.box(c.hx, c.hy, c.hz, {
      body,
      density: (c.mass * MASS_UNIT) / vol,
      friction: 0.72,
      restitution: 0.05,
      groups: GROUPS.loose,
      events: true,
      eventThreshold: 40,
      tag: { kind: 'cargo', cargo: c },
    });
    c.body = body;
    c.state = 'loose';
    c.restT = 0;
    c.sideT = 0;
    c.settled = false;
    c.inWater = false;
    c.waterT = 0;
    c.prevVel = { x: pose.linvel.x, y: pose.linvel.y, z: pose.linvel.z };
    return body;
  }

  _snapVisual(c) {
    // the mesh was just re-parented + moved: animate the inner box from its old world pose
    c.snap = { t: 0 };
    c.box.position.copy(c._snapFrom).sub(c.mesh.position);
    c.box.quaternion.copy(c._snapQuat);
  }

  _lockToShip(c, seat, { dropped, touchDv }) {
    const ship = this.ship;
    // remember where the box visually was, in the ship's cargo frame
    this._cargoWorld(c, _v, _q);
    ship.cargoGroup.updateWorldMatrix(true, false);
    const inv = _m.copy(ship.cargoGroup.matrixWorld).invert();
    c._snapFrom = _v.clone().applyMatrix4(inv);
    c._snapQuat = _q2.copy(ship.group.quaternion).invert().multiply(_q).clone();
    ship.lock(c, seat.r, seat.b);
    c.state = 'locked';
    c.settled = true;
    this._snapVisual(c);
    const wp = ship.localToWorld(c.long ? ship.pairLocal(seat.r, seat.b, seat.t) : ship.cellLocal(seat.r, seat.b, seat.t), _v3);
    const hazard = seat.problem === 'hazmat';
    const zoneOk = seat.zoneOk;
    c.misplaced = !zoneOk || hazard;
    // physical response: the hull dips and rolls under the new weight
    const lever = ship.rowX(seat.r) / (ship.halfBeam || 6);
    ship.bump(-lever * 0.012 * c.mass * (1 + touchDv * 0.4), -0.05 * c.mass * (1 + touchDv * 0.5));
    audio.play('lock', { pos: wp, vol: 0.9, rate: 0.9 });
    audio.play(touchDv > 3 ? 'impact_heavy' : 'impact_deck', { pos: wp, vol: clamp(0.35 + touchDv * 0.12, 0.3, 1) });
    this.ctx.cams.shake(clamp(0.12 + touchDv * 0.05, 0, 0.5));
    this.ctx.fx.dust(wp.x, wp.y - c.hy, wp.z, 8, 0x6f777c, 2.2);

    if (c.black) {
      // not on any manifest: no points, no questions
      this.emit('burst', { text: 'STOWED', pos: wp.clone(), kind: 'info', sub: 'NO QUESTIONS' });
      this._blackDone(c, 'ship', wp.clone());
      return;
    }
    if (c.preload && !c.discharge) {
      // re-stowed existing cargo: no points either way
      this.emit('burst', { text: 'RE-STOWED', pos: wp.clone(), kind: 'info' });
      return;
    }
    if (c.discharge) {
      c.misplaced = true;
      this.emit('burst', { text: 'GOES ASHORE!', pos: wp.clone(), kind: 'bad' });
      this.emit('toast', { text: 'Outbound box → lane 2', kind: 'warn' });
      return;
    }
    if (c.misplaced) {
      this.combo = 0;
      audio.play('ui_error');
      // never a silent zero: a little pay now, and the way to the right spot (moving it pays the rest)
      const part = c.partPaid ? 0 : Math.round(SCORE.sloppy * 1.5);
      if (part) {
        c.partPaid = true;
        this.score += part;
      }
      this.emit('burst', { text: hazard ? 'TOO CLOSE!' : 'WRONG BAY!', pos: wp.clone(), kind: 'bad', sub: part ? `+${part} · MOVE IT` : 'MOVE IT' });
      this.emit('toast', { text: hazard ? 'Hazmat: keep apart' : `Wrong bay → ${(ZONES[c.zone] || ZONES.ANY).name}`, kind: 'warn' });
      this.emit('misplaced', { cargo: c, pos: wp.clone(), pts: part, hazard });
      return;
    }
    // the very first box (it hung right over its slot): always the big PERFECT moment
    // (set down where it hung: carried off and slammed in elsewhere, it is graded like any other)
    const pc = this._prehookCell;
    const first = c === this.prehooked && !c.scored && !!pc && seat.r === pc.r && seat.b === pc.b;
    const snapped = !!c.snapLock && !dropped;
    const grade = first || snapped ? 'perfect' : dropped ? 'good' : seat.grade === 'off' ? 'good' : seat.grade;
    this._firstLockDone = true;
    this._award(c, grade, { soft: first || snapped || (!dropped && touchDv < TUNE.softLanding), pos: wp.clone(), dropped: dropped && !first, big: first || snapped, sub: first ? 'FIRST BOX' : undefined });
    if (snapped) {
      this.stats.snaps = (this.stats.snaps || 0) + 1;
      this.emit('snapLock', { cargo: c, pos: wp.clone() });
    }
    if (first) {
      this.prehooked = null;
      this.ctx.fx.confetti(wp.x - 1.2, wp.y + c.hy + 0.4, wp.z, [0xffd070, 0xfff2c0, 0x7ee08a]);
      this.ctx.fx.confetti(wp.x + 1.2, wp.y + c.hy + 0.4, wp.z, [0xffd070, 0xfff2c0, zoneColor(c.zone)]);
      this.emit('firstPerfect', { cargo: c, pos: wp.clone() });
    }
  }

  _lockToTruck(c, seat) {
    const tr = seat.truck;
    const wp = tr.bedCenter(c.hy, _v3).clone();
    tr.accept(c);
    audio.play('lock', { pos: wp, rate: 0.95 });
    audio.play('impact_deck', { pos: wp, vol: 0.5 });
    this.ctx.fx.dust(wp.x, wp.y - c.hy, wp.z, 8);
    if (c.returning) {
      // a box that had nowhere to go aboard goes back ashore: off this ship's list, no penalty
      c.returning = false;
      c.returned = true;
      c.counted = true;
      c.scored = true;
      if (c.spec) c.spec.returned = true;
      if (this.noSlotCargo === c) this.noSlotCargo = null;
      this.emit('burst', { text: 'RETURNED', pos: wp.clone(), kind: 'info', sub: 'NO SPACE ABOARD' });
      this.emit('returned', { cargo: c });
      return;
    }
    const grade = seat.grade === 'off' ? 'good' : seat.grade;
    const soft = this.touch.dv < TUNE.softLanding;
    if (tr.purpose !== 'customs') {
      this.stats.discharged++;
      this._award(c, grade, { soft, pos: wp, discharge: true });
      return;
    }
    // ---- handed to customs
    c.customs = true;
    if (c.black) {
      this.score += SCORE.handover;
      this.emit('burst', { text: 'HANDED OVER', pos: wp.clone(), kind: 'great', sub: 'EVIDENCE' });
      this.emit('points', { pts: SCORE.handover, pos: wp.clone(), mult: 1 });
      audio.play('great');
      this._blackDone(c, 'customs', wp.clone());
    } else if (c.contra) {
      this.stats.busted++;
      c.weighed = 'mismatch';
      this._award(c, grade, { soft, pos: wp, discharge: true, bonus: SCORE.busted, label: 'BUSTED!', sub: 'MIS-DECLARED' });
    } else {
      // an honest box: customs wave it through, but the detour costs
      this.stats.falseAlarm++;
      c.weighed = 'match';
      this.combo = 0;
      this.score += SCORE.falseAlarm;
      c.scored = true;
      c.grade = 'good';
      if (!c.counted) {
        c.counted = true;
        this.delivered++;
      }
      audio.play('ui_error', { vol: 0.7 });
      this.emit('burst', { text: 'FALSE ALARM', pos: wp.clone(), kind: 'bad', sub: 'PAPERS WERE FINE' });
      this.emit('points', { pts: SCORE.falseAlarm, pos: wp.clone(), rough: true });
      this.emit('placed', { cargo: c, grade: 'good', pts: SCORE.falseAlarm });
    }
  }

  /** An ignored unlisted box is set down on the land side of the quay, so lane 1 is free again. */
  _dumpBlack(tr) {
    const c = tr.cargo;
    const z = tr.z + tr.zOff + 9;
    const x = DIM.LANE_X - 7.8; // beyond lane 2, inside the trolley's reach, clear of the crane legs
    tr.release();
    this.ctx.scene.attach(c.mesh);
    const body = this._makeLoose(c, { pos: { x, y: DIM.QUAY_Y + c.hy + 0.25, z }, rot: { x: 0, y: 0, z: 0, w: 1 }, linvel: { x: 0, y: -1, z: 0 }, angvel: { x: 0, y: 0, z: 0 } });
    body.setAngvel({ x: 0, y: rand(-0.15, 0.15), z: 0 }, true);
    c.mesh.position.set(x, DIM.QUAY_Y + c.hy + 0.25, z);
    tr.leaveDelay = 1.2;
    _v.set(x, DIM.QUAY_Y, z);
    this.ctx.fx.dust(x, DIM.QUAY_Y + 0.1, z, 18, 0x6f777c, 3);
    audio.play('impact_heavy', { pos: _v, vol: 0.8 });
    this.emit('blackDumped', { cargo: c, pos: _v.clone() });
  }

  /** The player has decided what happens to an unlisted box. */
  _blackDone(c, outcome, pos) {
    if (c.resolved === outcome) return;
    c.resolved = outcome;
    this.blackOutcome = outcome;
    this.emit('black', { outcome, pos, cargo: c });
  }

  /** Customs go through what was loaded: mis-declared boxes on board come out of the score. */
  _sweep() {
    let n = 0;
    for (const c of this.cargos) {
      if (!c.contra || c.customs || !c.counted || c.swept) continue;
      c.swept = true;
      n++;
    }
    if (n) {
      this.stats.smuggled += n;
      this.score += SCORE.smuggled * n;
    }
    return n;
  }

  _award(c, grade, { soft, pos, dropped, discharge, bonus, label: labelOverride, sub, big }) {
    let pts = (SCORE[grade] || SCORE.good) + (bonus || 0);
    const parts = sub ? [sub] : [];
    if (soft && grade !== 'sloppy') {
      pts += SCORE.soft;
      this.stats.soft++;
      parts.push('SOFT');
    }
    if (this.zoned && !discharge && grade !== 'sloppy') pts += SCORE.zone;
    if (grade !== 'sloppy') {
      const sp = SCORE.speedMax * clamp(1 - (this.carryT - 13) / 24, 0, 1);
      pts += sp;
      if (sp > SCORE.speedMax * 0.8) parts.push('FAST');
    }
    if (c.typeDef.value && grade !== 'sloppy') {
      let v = c.typeDef.value;
      if (c.type === 'reefer') v = Math.round(v * (0.25 + 0.75 * c.temp));
      pts += v;
    }
    if (c.long && !c.scored) this.stats.long = (this.stats.long || 0) + 1;
    if (grade === 'perfect' || grade === 'great') this.combo++;
    else if (grade === 'sloppy' || dropped) this.combo = 0;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const mult = this.multFor(this.combo);
    pts = Math.round(pts * mult);
    if (!c.scored) {
      this.score += pts;
      c.scored = true;
      c.points = pts;
      this.stats[grade]++;
      this.stats.placed++;
    } else pts = 0;
    c.grade = grade;
    if (!c.counted) {
      c.counted = true;
      this.delivered++;
    }
    c.thawing = false;
    const label = labelOverride || (grade === 'perfect' ? 'PERFECT!' : grade === 'great' ? 'GREAT!' : grade === 'good' ? (dropped ? 'DROPPED IN' : 'LOCKED') : 'SLOPPY');
    this.emit('burst', { text: label, pos, kind: grade, sub: parts.join(' · '), big });
    if (pts) this.emit('points', { pts, pos, mult, combo: this.combo });
    audio.play(grade === 'perfect' ? 'perfect' : grade === 'great' ? 'great' : 'good', { vol: grade === 'sloppy' ? 0.4 : 1 });
    if (grade === 'perfect') {
      this.ctx.fx.confetti(pos.x, pos.y + c.hy, pos.z, [0xffd070, 0xfff2c0, zoneColor(c.zone), 0x7ee08a]);
      if (this.combo >= 3 && this.combo % 3 === 0) audio.play('sax_combo', { delay: 0.25 });
    }
    this.emit('placed', { cargo: c, grade, pts });
  }

  _uncount(c) {
    if (c.counted) {
      c.counted = false;
      this.delivered = Math.max(0, this.delivered - 1);
    }
  }

  _lose(c, reason, pos) {
    if (c.lost) return;
    c.lost = true;
    this._uncount(c);
    this.combo = 0;
    this.stats.lost++;
    this.strikes++;
    this.score += Math.round(SCORE.lost * this.mods.lossMul);
    audio.play('strike', { delay: 0.25 });
    let again = false;
    if (this.endless && !c.preload && !c.black && !c.discharge && this.phase === 'play' && !c.requeued) {
      c.requeued = true;
      this.manifest.push({ zone: c.zone, type: c.type === 'long' ? 'long' : c.type });
      again = true;
    }
    this.emit('strike', { cargo: c, reason, pos: pos ? pos.clone() : null, strikes: this.strikes, max: this.maxStrikes, again });
    // the storm ship is the one that can be lost: her second lost box and she sails
    if (this.endless && this.level.storm && this.phase === 'play' && !c.preload && !c.black) {
      this.stormLosses = (this.stormLosses || 0) + 1;
      this.emit('stormLoss', { n: this.stormLosses, max: STORM_LOSSES });
      if (this.stormLosses >= STORM_LOSSES) this._stormSail = true;
    }
    // (a lost box costs its bonus and the combo — never the shift)
  }

  _removeCargo(c) {
    if (this.rig.carry === c) this.rig.detach();
    if (c.body) {
      this.phys.removeBody(c.body);
      c.body = null;
    } else if (c.state === 'locked' && c.cell) {
      this.ship.unlock(c, this.ctx.scene);
    }
    c.collider = null;
    c.state = 'gone';
    c.dispose();
  }

  /** Break a twist-locked box (and everything stacked on it) free. */
  _knockLoose(c, vel) {
    if (c.state !== 'locked') return;
    const stack = [c, ...this.ship.stackAbove(c).reverse()];
    const shipV = this.ship.kick.heaveV;
    for (let i = stack.length - 1; i >= 0; i--) {
      const k = stack[i];
      if (k.counted) this._uncount(k);
      this.ship.unlock(k, this.ctx.scene);
      const body = this._makeLoose(k, null);
      const share = i === 0 ? 1 : 0.45;
      body.setLinvel({ x: vel.x * share, y: shipV + Math.abs(vel.x + vel.z) * 0.08, z: vel.z * share }, true);
      body.setAngvel({ x: rand(-0.4, 0.4), y: rand(-0.3, 0.3), z: -vel.x * 0.12 }, true);
      k.unsecured = true;
    }
    this._cargoWorld(c, _v, _q);
    this.combo = 0;
    audio.play('boom', { pos: _v });
    audio.play('chain', { pos: _v, vol: 0.8 });
    this.ctx.fx.sparks(_v.x, _v.y - c.hy, _v.z, 26, null, 11);
    this.ctx.cams.shake(0.55);
    this.emit('burst', { text: 'LOCKS SNAPPED!', pos: _v.clone(), kind: 'bad' });
  }

  _shatter(c, pos) {
    if (c.broken) return;
    c.broken = true;
    this._cargoWorld(c, _v, _q);
    audio.play('glass', { pos: _v });
    audio.play('impact_med', { pos: _v });
    this.ctx.fx.glassBurst(_v.x, _v.y, _v.z);
    this.ctx.fx.debris(_v.x, _v.y, _v.z, 16, [zoneColor(c.zone), 0xf1ecdd, 0x59646d], undefined, 6);
    this.ctx.cams.shake(0.4);
    this.emit('burst', { text: 'SMASHED!', pos: _v.clone(), kind: 'bad' });
    this._removeCargo(c);
    this._lose(c, 'fragile', _v);
  }

  _explode(c) {
    if (c.broken) return;
    c.broken = true;
    this._cargoWorld(c, _v, _q);
    const pos = _v.clone();
    audio.play('explosion', { pos });
    this.ctx.fx.explosion(pos.x, pos.y, pos.z);
    this.ctx.cams.shake(1);
    this.emit('flash', 1);
    this.emit('burst', { text: 'KABOOM!', pos: pos.clone(), kind: 'bad', big: true });
    this._removeCargo(c);
    // blast: shove loose boxes, snap nearby locks, kick the spreader
    for (const o of [...this.cargos]) {
      if (o === c || o.state === 'gone') continue;
      this._cargoWorld(o, _v2, _q2);
      const d = _v2.distanceTo(pos);
      if (d > 11) continue;
      const dir = _v3.copy(_v2).sub(pos).setY(0.4).normalize();
      const power = 13 * clamp(1 - d / 11, 0, 1);
      if (o.state === 'locked' && d < 5.2) this._knockLoose(o, { x: dir.x * power, y: 0, z: dir.z * power });
      else if (o.state === 'loose' && o.body) {
        const v = o.body.linvel();
        o.body.setLinvel({ x: v.x + dir.x * power, y: v.y + power * 0.5, z: v.z + dir.z * power }, true);
      }
      if (o.type === 'hazmat' && d < 4.5 && !o.broken) setTimeout(() => this.phase !== 'over' && o.state !== 'gone' && this._explode(o), 260);
    }
    const sv = this.rig.sprBody.linvel();
    const sd = _v3.copy(this.rig.sprPos).sub(pos);
    if (sd.length() < 10) {
      sd.normalize();
      this.rig.sprBody.setLinvel({ x: sv.x + sd.x * 9, y: sv.y + 4, z: sv.z + sd.z * 9 }, true);
    }
    this.ship.bump(rand(-0.03, 0.03), -0.5);
    this._lose(c, 'explosion', pos);
  }

  // ====================================================================== impacts + loose boxes

  _partnerFor(colliderA, colliderB) {
    let best = null;
    for (const im of this.phys.impacts) {
      let other = null;
      let mine = null;
      if (colliderA && (im.h1 === colliderA.handle || (colliderB && im.h1 === colliderB.handle))) {
        other = im.b;
        mine = im.h1;
      } else if (colliderA && (im.h2 === colliderA.handle || (colliderB && im.h2 === colliderB.handle))) {
        other = im.a;
        mine = im.h2;
      } else continue;
      if (!best || im.force > best.force) best = { other, force: im.force, h1: im.h1, h2: im.h2, mine };
    }
    return best;
  }

  _postStep(h) {
    const rig = this.rig;
    // ---- hanging load
    const dvx = rig.sprVel.x - rig.prevVel.x;
    const dvy = rig.sprVel.y - rig.prevVel.y;
    const dvz = rig.sprVel.z - rig.prevVel.z;
    const dv = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
    if (dv > 0.9) {
      const partner = this._partnerFor(rig.sprCollider, rig.carryCollider);
      if (partner) {
        const pt = this.phys.contactPoint(partner.h1, partner.h2) || rig.bottomWorld(_v);
        this._impact({
          dv,
          pos: _v.set(pt.x, pt.y, pt.z),
          cargo: rig.carry && partner.mine === (rig.carryCollider && rig.carryCollider.handle) ? rig.carry : rig.carry,
          viaSpreader: !rig.carry || partner.mine === rig.sprCollider.handle,
          other: partner.other,
          mass: rig.sprBody.mass(),
          vel: rig.prevVel,
          carried: true,
        });
        if (rig.carry && Math.abs(dvy) > 0.5) {
          this.touch.t = this.simT;
          this.touch.dv = Math.max(dv, this.simT - this.touch.t < 0.6 ? this.touch.dv : 0);
        }
      } else if (dv > 2.2 && this.cool.chain < 0) {
        // cable snatched tight
        this.cool.chain = 0.6;
        audio.play('chain', { pos: rig.sprPos, vol: clamp(dv / 6, 0.3, 1) });
        this.ctx.cams.shake(clamp(dv / 30, 0, 0.25));
      }
    }
    if (rig.carry && this.seat && !this.seat.seated) {
      // airborne again: forget the previous touchdown
      if (this.seat.gap > 0.35) this.touch.dv = 0;
    }
    // spreader dunked in the sea
    if (rig.sprPos.y - (rig.carry ? 2.9 : 0.3) < 0.1 && rig.sprPos.x > 0.2) {
      if (!this._sprWet) {
        this._sprWet = true;
        const b = rig.bottomWorld(_v);
        this.ctx.fx.splash(b.x, b.z, 0.5);
        audio.play('splash_small', { pos: b });
      }
    } else if (rig.sprPos.y > 3.5) this._sprWet = false;

    // ---- loose boxes
    for (const c of this.cargos) {
      if (c.state !== 'loose' || !c.body) continue;
      const body = c.body;
      const t = body.translation();
      const v = body.linvel();
      const pv = c.prevVel;
      const ldv = Math.hypot(v.x - pv.x, v.y - pv.y, v.z - pv.z);
      if (ldv > 1.3 && !c.inWater) {
        const partner = this._partnerFor(c.collider, null);
        if (partner) {
          const pt = this.phys.contactPoint(partner.h1, partner.h2) || t;
          this._impact({ dv: ldv, pos: _v.set(pt.x, pt.y, pt.z), cargo: c, other: partner.other, mass: body.mass(), vel: pv, carried: false });
        }
      }
      if (c.state !== 'loose') continue; // destroyed by its own impact
      pv.x = v.x;
      pv.y = v.y;
      pv.z = v.z;
      // overboard?
      if (!c.inWater && t.y < 0.9 && (t.x > 0.3 || t.y < -1)) {
        c.inWater = true;
        c.waterT = 0;
        body.setLinearDamping(2.4);
        body.setAngularDamping(2.2);
        const power = clamp(0.8 + Math.abs(v.y) * 0.1, 0.8, 2.2) * c.mass;
        this.ctx.fx.splash(t.x, t.z, power);
        audio.play('splash_big', { pos: t, vol: clamp(0.6 + power * 0.2, 0.6, 1.2) });
        audio.play('bubbles', { pos: t, delay: 0.7 });
        this.ctx.cams.shake(0.35);
        this.emit('burst', { text: 'SPLASH!', pos: new THREE.Vector3(t.x, 1.5, t.z), kind: 'water', big: true });
        if (c.black) this._blackDone(c, 'sea', new THREE.Vector3(t.x, 0, t.z));
        else this.emit('overboard', c);
      }
      if (c.inWater) {
        c.waterT += h;
        if (c.waterT > 0.7 && Math.random() < 0.25) this.ctx.fx.puff(t.x + rand(-1, 1), 0.2, t.z + rand(-2.5, 2.5), 0.3, 0xbfe0e6, 1.2);
        if (c.waterT > 3.4) {
          const pos = new THREE.Vector3(t.x, 0.5, t.z);
          this._removeCargo(c);
          if (!c.black) this._lose(c, 'sea', pos);
        }
        continue;
      }
      if (t.y < -15) {
        this._removeCargo(c);
        if (c.black) this._blackDone(c, 'sea', null);
        else this._lose(c, 'sea', null);
        continue;
      }
      // rest / settle
      const w = body.angvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      const spin = Math.hypot(w.x, w.y, w.z);
      const r = body.rotation();
      const upY = 1 - 2 * (r.x * r.x + r.z * r.z);
      // relative to the ship if it is riding the deck (so swell does not count as motion)
      if (speed < 0.7 && spin < 0.6) {
        c.restT += h;
        // leaning badly, or come to rest where the crane cannot reach it: either way it is a write-off
        const reach = t.x > DIM.TROLLEY_MIN_X - 0.8 && t.x < DIM.TROLLEY_MAX_X + 0.8 && Math.abs(t.z) < DIM.GANTRY_RANGE + 0.8;
        if (upY < 0.93 || !reach) c.sideT += h * (upY < 0.6 ? 1.4 : 1);
        else c.sideT = 0;
        if (!c.settled && c.restT > 0.55) this._settleLoose(c);
        if (c.sideT > 3.6) {
          // lying on its side: a write-off
          const pos = new THREE.Vector3(t.x, t.y, t.z);
          this.ctx.fx.dust(t.x, t.y, t.z, 16, 0x7a8086, 4);
          this.ctx.fx.debris(t.x, t.y, t.z, 14, [zoneColor(c.zone), 0x59646d, 0x23292e], t.x < 0 ? DIM.QUAY_Y : undefined, 5);
          audio.play('impact_heavy', { pos });
          if (c.black) {
            // it bursts open — and there is nothing in it
            this.emit('burst', { text: 'EMPTY?!', pos: pos.clone(), kind: 'water' });
            this._removeCargo(c);
            this._blackDone(c, 'left', pos);
            continue;
          }
          this.emit('burst', { text: reach ? 'WRECKED!' : 'OUT OF REACH!', pos: pos.clone(), kind: 'bad' });
          this._removeCargo(c);
          this._lose(c, 'wreck', pos);
        }
      } else {
        c.restT = 0;
        if (speed > 1.6) {
          if (c.settled && c.counted && c.grade === 'sloppy') {
            // it is on the move again: do not count it until it rests
            this._uncount(c);
          }
          c.settled = false;
        }
      }
    }

  }

  /** A loose box came to rest: lock it if it happens to sit right, otherwise score it as sloppy. */
  _settleLoose(c) {
    c.settled = true;
    if (this.phase !== 'play') return;
    const ship = this.ship;
    const body = c.body;
    const t = body.translation();
    const r = body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    const l = ship.worldToLocal(_v.set(t.x, t.y, t.z), _v2);
    const col = c.long ? ship.pairAt(l.x, l.z, 0.0) : ship.columnAt(l.x, l.z, 0.0);
    const upDot = _s.set(0, 1, 0).applyQuaternion(_q).dot(ship.up(_v3));
    if (!col || upDot < 0.97) return;
    const tier = c.long ? ship.pairHeight(col.r, col.b) : ship.height(col.r, col.b);
    const expectY = ship.tierY(tier);
    const err = Math.max(Math.abs(col.dx) / this.lockTol, Math.abs(col.dz) / (this.lockTol * 1.3));
    const yaw = Math.abs(Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x)));
    const problem = this._ruleProblem(c, col.r, col.b);
    if (Math.abs(l.y - expectY) < 0.3 && err <= 1 && yaw < 0.14 && problem !== 'full' && problem !== 'heavy' && problem !== 'uneven') {
      const seat = { kind: 'ship', r: col.r, b: col.b, t: tier, dx: col.dx, dz: col.dz, zoneOk: this._zoneOk(c, col.r, col.b), problem, grade: 'good' };
      this.phys.removeBody(c.body);
      c.body = null;
      c.collider = null;
      this._lockToShip(c, seat, { dropped: true, touchDv: 2.5 });
      return;
    }
    // aboard but not on the lock points
    c.unsecured = true;
    if (c.preload || c.discharge) return;
    if (c.black) {
      this._blackDone(c, 'ship', new THREE.Vector3(t.x, t.y, t.z));
      return;
    }
    if (!this._zoneOk(c, col.r, col.b)) {
      c.misplaced = true;
      return;
    }
    const pos = new THREE.Vector3(t.x, t.y, t.z);
    if (!c.scored) this._award(c, 'sloppy', { soft: false, pos, dropped: true });
    else if (!c.counted) {
      c.counted = true;
      c.grade = 'sloppy';
      this.delivered++;
    }
  }

  _impact({ dv, pos, cargo, other, mass, vel, carried, viaSpreader }) {
    if (this.attract) return;
    const kind = other ? other.kind : 'none';
    const fx = this.ctx.fx;
    const onMetal = kind === 'cargo' || kind === 'spreader' || kind === 'crane' || kind === 'bridge';
    // --- audio
    const vol = clamp(dv / 7, 0.25, 1.15);
    const name = dv > 5.2 ? 'impact_heavy' : dv > 2.4 ? (onMetal ? 'impact_med' : 'impact_deck') : onMetal ? 'impact_light' : 'impact_deck';
    audio.play(name, { pos, vol, rate: cargo ? 1 / Math.sqrt(0.6 + cargo.mass * 0.5) : 1.1 });
    if (dv > 8.5) audio.play('boom', { pos, vol: clamp(dv / 14, 0.5, 1) });
    // --- visuals
    if (dv > 2.2) fx.sparks(pos.x, pos.y, pos.z, Math.min(30, Math.round(dv * 2.6)), null, 4 + dv);
    if (!onMetal && dv > 1.8) fx.dust(pos.x, pos.y + 0.1, pos.z, Math.min(14, Math.round(dv * 1.6)));
    this.ctx.cams.shake(clamp(dv / 18, 0.04, 0.7));
    if (dv > 4.6 && this.cool.clang < 0 && !this.calm) {
      this.cool.clang = 0.55;
      this.emit('burst', { text: randPick(CLANGS), pos: pos.clone(), kind: 'hit' });
    }
    // --- consequences
    const otherCargo = kind === 'cargo' ? other.cargo : null;
    if (cargo && cargo.type === 'fragile' && dv > FRAGILE_LIMIT && !viaSpreader) return this._shatter(cargo, pos);
    if (otherCargo && otherCargo.type === 'fragile' && otherCargo.state === 'loose' && dv > FRAGILE_LIMIT) this._shatter(otherCargo, pos);
    if (cargo && cargo.type === 'hazmat' && dv > HAZMAT_LIMIT && !viaSpreader) return this._explode(cargo);
    if (otherCargo && otherCargo.type === 'hazmat' && dv > HAZMAT_LIMIT * 1.15 && otherCargo.state !== 'gone') return this._explode(otherCargo);
    if (otherCargo && otherCargo.state === 'locked') {
      const ratio = clamp(mass / (otherCargo.mass * MASS_UNIT), 0.3, 1.6);
      const horiz = Math.hypot(vel.x, vel.z);
      if (dv * ratio > TUNE.lockBreakImpulse && horiz > 2.6) {
        this._knockLoose(otherCargo, { x: vel.x * 0.7 * ratio, y: 0, z: vel.z * 0.7 * ratio });
      }
    }
    if (kind === 'ship' || (otherCargo && otherCargo.state === 'locked')) {
      const lx = pos.x - this.ship.origin.x;
      this.ship.bump((-lx / 6) * 0.004 * (mass / MASS_UNIT) * dv, -0.02 * (mass / MASS_UNIT) * Math.min(dv, 8));
    }
    if (carried && cargo && dv > 5.4 && this.cool.rough < 0 && !viaSpreader && !this.calm) {
      this.cool.rough = 1.2;
      this.combo = 0;
      this.stats.rough++;
      this.score += SCORE.rough;
      this.emit('points', { pts: SCORE.rough, pos: pos.clone(), rough: true });
      this.emit('toast', { text: 'Easy — rough handling', kind: 'warn', key: 'rough' });
    }
    if ((kind === 'truck' || kind === 'truckcab') && dv > 2.5 && this.cool.honk < 0) {
      this.cool.honk = 2.5;
      audio.play('horn_truck', { pos, delay: 0.25 });
      audio.play('vox_hey', { pos, delay: 0.5 });
      this.emit('burst', { text: 'HEY!', pos: pos.clone().add(_v3.set(0, 2.5, 0)), kind: 'info' });
    }
    if (kind === 'bridge' && dv > 2 && this.cool.bridge < 0) {
      this.cool.bridge = 3;
      this.emit('toast', { text: 'Mind the wheelhouse!', kind: 'warn' });
    }
    this.emit('impact', { dv, pos, kind });
  }

  // ====================================================================== trucks + timers + end

  _updateTrucks(dt) {
    const t = this.simT;
    for (const tr of this.trucks) {
      tr.update(dt, t);
      // the unmarked truck will not wait all night: ignore its box and they tip it off on the apron
      if (this.phase === 'play' && tr.state === 'wait' && tr.cargo && tr.cargo.black && tr.waitT > 42 && !tr.leaveDelay) {
        this._dumpBlack(tr);
        continue;
      }
      // an impatient driver leans on the horn now and then
      if (this.phase === 'play' && tr.state === 'wait' && tr.cargo && tr.purpose === 'deliver' && !tr.cargo.black && tr.waitT > (tr.nextHonk || 45)) {
        tr.nextHonk = tr.waitT + rand(26, 40);
        audio.play('horn_truck', { pos: tr.group.position, vol: 0.8 });
        audio.play('horn_truck', { pos: tr.group.position, vol: 0.8, delay: 0.32 });
      }
    }
    this.trucks = this.trucks.filter((tr) => tr.state !== 'gone');
    // (during a ship change the next ship's cargo already rolls in once her manifest is known)
    const early = this.phase === 'swap' && this._manifestEarly;
    if (this.phase !== 'play' && this.phase !== 'pre' && !early) return;
    // lane 1: deliveries
    const l1 = this.lanes[0];
    if (!l1.truck || l1.truck.state === 'gone' || (l1.truck.state === 'out' && l1.truck.z > l1.z + 13)) {
      l1.cool -= dt;
      if (l1.cool <= 0 && this.manifestIdx < this.manifest.length) {
        const spec = this.manifest[this.manifestIdx++];
        const c = this._newCargo(spec);
        const quick = this._firstNight && !this._quickTruck;
        const tr = new Truck(this.ctx.scene, this.phys, { laneX: l1.x, stopZ: l1.z, purpose: 'deliver', color: this.manifestIdx + this.shipIndex, livery: c.black ? 'unmarked' : null, long: c.long, startZ: quick ? l1.z - 50 : undefined });
        if (quick) {
          this._quickTruck = true;
          tr.speed = 13;
        }
        tr.load(c);
        if (c.black) this.blackSeen = true;
        tr.onPark = (trk) => {
          audio.play('air_brake', { pos: trk.group.position });
          if (c.type === 'reefer') c.thawing = true;
          this.emit('truck', { truck: trk, cargo: c });
        };
        this.trucks.push(tr);
        l1.truck = tr;
        l1.cool = 1.2;
      }
    }
    if (early) return; // (lane 2 waits for the ship herself)
    // lane 2: collectors, while there is something to take off the ship
    const l2 = this.lanes[1];
    const pendingOut = this.cargos.some((c) => c.discharge && !c.counted && c.state !== 'gone' && !c.lost);
    const pendingRet = this.cargos.some((c) => c.returning && !c.counted && c.state !== 'gone' && !c.lost);
    // customs wait in lane 2 while a sealed or unlisted box is still to be dealt with
    const pendingCus =
      !pendingOut &&
      this.cargos.some((c) => {
        if (c.state === 'gone' || c.lost || c.inWater) return false;
        if (c.check) return !c.counted;
        return c.black && (c.state === 'carried' || c.state === 'loose' || (c.state === 'truck' && c.truck && c.truck.purpose === 'deliver'));
      });
    // an empty lane-2 truck with nothing left to take drives off (never blocks the lane)
    const idleL2 = l2.truck && l2.truck.state === 'wait' && !l2.truck.cargo && !pendingRet && !(l2.truck.leaveDelay > 0);
    if (idleL2 && ((l2.truck.purpose === 'customs' && !pendingCus) || (l2.truck.purpose === 'collect' && !pendingOut))) l2.truck.leaveDelay = 1.2;
    if ((pendingOut || pendingCus || pendingRet) && (!l2.truck || l2.truck.state === 'gone' || (l2.truck.state === 'out' && l2.truck.z > l2.z + 13))) {
      l2.cool -= dt;
      if (l2.cool <= 0) {
        const tr = new Truck(this.ctx.scene, this.phys, { laneX: l2.x, stopZ: l2.z, purpose: pendingOut || pendingRet ? 'collect' : 'customs', color: 2 + this.trucks.length });
        tr.onPark = (trk) => audio.play('air_brake', { pos: trk.group.position });
        this.trucks.push(tr);
        l2.truck = tr;
        l2.cool = 1.5;
      }
    }
  }

  _updateReefers(dt) {
    if (this.phase !== 'play') return;
    for (const c of this.cargos) {
      if (c.type !== 'reefer' || !c.thawing || c.counted) continue;
      c.temp = Math.max(0, c.temp - dt / 75);
      if (c.temp <= 0 && !c.spoiled) {
        c.spoiled = true;
        this.emit('toast', { text: 'Reefer thawed · bonus lost', kind: 'warn' });
      }
    }
  }

  /** Load cell. Spot-check boxes get a verdict once the load has hung still for a moment. */
  _updateScale(dt) {
    const rig = this.rig;
    const c = rig.carry;
    const sc = this.scale;
    if (!c) {
      sc.t = 0;
      sc.read = 0;
      return;
    }
    const rel = Math.hypot(rig.sprVel.x - rig.vx, rig.sprVel.z - rig.vz);
    const vy = Math.abs(rig.sprVel.y);
    const hanging = this.altitude > 0.45 && rig.slack < 0.06;
    const t = this.simT;
    const jitter = Math.sin(t * 23.1) * 0.6 + Math.sin(t * 37.7 + 1.3) * 0.4;
    let read = c.realT + jitter * (rel * 1.1 + vy * 2.2);
    // whatever is in a black box, it will not hold still on the scale
    if (c.black) read = c.realT + Math.sin(t * 0.9) * 5.5 + Math.sin(t * 2.7) * 2.4 + jitter * 1.5;
    if (!hanging) read *= 0.15;
    sc.read = damp(sc.read, Math.max(0, read), 9, dt);
    if (this.phase !== 'play' || !c.check || c.weighed) return;
    const steady = hanging && rel < 0.85 && vy < 0.5 && Math.abs(rig.vr) < 0.5;
    sc.t = steady ? sc.t + dt : Math.max(0, sc.t - dt * 2.5);
    if (sc.t >= TUNE.weighTime) {
      const ok = Math.abs(c.realT - c.declT) <= TUNE.weighTol;
      c.weighed = ok ? 'match' : 'mismatch';
      audio.play(ok ? 'ui_confirm' : 'ui_warn', { vol: 0.9 });
      this._cargoWorld(c, _v, _q);
      this.emit('burst', { text: ok ? 'PAPERS MATCH' : 'MIS-DECLARED!', pos: _v.clone(), kind: ok ? 'good' : 'bad', sub: `${c.realT.toFixed(1)} t · declared ${c.declT.toFixed(1)} t` });
      this.emit('weighed', { cargo: c, ok });
    }
  }

  /** Unlisted boxes: the glow in the seams, and whatever keeps knocking from the inside. */
  _updateBlack(dt) {
    if (!this.blackSeen) return;
    for (const c of this.cargos) {
      if (!c.black || c.state === 'gone') continue;
      c.updateGlow(dt);
      if (this.phase !== 'play' || c.inWater) continue;
      if (c.state === 'truck' && !(c.truck && c.truck.parked)) continue;
      c.thumpT -= dt;
      if (c.thumpT > 0) continue;
      const carried = c.state === 'carried';
      c.thumpT = carried ? rand(3.4, 6.4) : rand(8, 15);
      c.pulse = 1;
      this._cargoWorld(c, _v, _q);
      audio.play('thump', { pos: _v, vol: carried ? 1 : 0.55, rate: rand(0.85, 1.1) });
      if (carried) {
        // it throws its weight about: a shove on the hanging load
        const a = Math.random() * Math.PI * 2;
        const k = rand(1.5, 2.6);
        const v = this.rig.sprBody.linvel();
        this.rig.sprBody.setLinvel({ x: v.x + Math.cos(a) * k, y: v.y, z: v.z + Math.sin(a) * k * 0.8 }, true);
        this.ctx.cams.shake(0.16);
        if (this.cool.clang < 0) {
          this.cool.clang = 0.5;
          this.emit('burst', { text: 'THUMP', pos: _v.clone(), kind: 'hit' });
        }
      }
      this.emit('thump', { cargo: c, carried, pos: _v.clone() });
    }
  }

  _pendingCargo() {
    let n = 0;
    for (const c of this.cargos) {
      if (c.state === 'gone' || c.lost || c.black) continue;
      if (c.preload && !c.discharge) continue;
      if (!c.counted) n++;
    }
    return n;
  }

  _checkEnd(dt) {
    if (this.phase !== 'play') return;
    // low-time warnings
    if (!this.endless || this.time > 0) {
      if (this.time <= 10.4 && this.time > 0 && this.cool.tick < 0) {
        this.cool.tick = 1;
        audio.play('tick_alarm', { rate: this.time < 5 ? 1.25 : 1 });
      }
      if (this.time <= 30 && !this._warn30 && this.timeTotal > 60) {
        this._warn30 = true;
        audio.play('ui_warn');
        this.emit('toast', { text: '30 s to departure!', kind: 'warn' });
      }
      if (this.time > 32) this._warn30 = false;
    }
    const allOut = this.manifestIdx >= this.manifest.length;
    const pending = this._pendingCargo();
    if (allOut && pending === 0 && !this.rig.carry) {
      this._doneT = (this._doneT || 0) + dt;
      if (this._doneT > 0.9) {
        this._doneT = 0;
        if (this.endless) this._beginSwap();
        else this._finish(this.delivered >= Math.ceil(this.quota * 0.6), 'complete');
      }
    } else this._doneT = 0;
    if (this._stormSail && this.phase === 'play') {
      this._stormSail = false;
      this._beginSwap({ timeout: true, stormLost: 'losses' });
      return;
    }
    if (this.time <= 0 && this.phase === 'play') {
      // a ship never waits: when its clock runs out it sails with whatever is aboard
      if (this.endless) this._beginSwap({ timeout: true });
      else this._finish(this.delivered >= Math.ceil(this.quota * 0.6), 'time');
    }
  }

  // ====================================================================== endless: ship rotation

  /** Build the next ship's hull now, parked out of sight at sea; the swap only has to bring her in. */
  _prebuildNext() {
    let def = endlessShip(this.shipIndex + 1, this.seed);
    if (this.onShip) def = this.onShip(def, this.shipIndex + 1) || def;
    const keep = this.ship;
    this.shipIndex++;
    this._makeHull(def);
    const next = this.ship;
    this.shipIndex--;
    this.ship = keep;
    next.offsetZ = -150;
    next.offsetX = 8;
    next._applyPose(this.simT);
    next.snapBody();
    next.group.visible = false;
    this._nextShip = { def, ship: next };
    this.emit('prebuilt', { def });
  }

  _beginSwap(o = {}) {
    this.phase = 'swap';
    this.swapT = 0;
    this.swapClock = 0;
    this.swapRate = 1;
    this.swapStage = 0;
    this.stats.ships++;
    const quota = this.manifest.filter((m) => !m.black && !m.returned).length;
    const placed = Math.max(0, this.delivered - this.shipBase);
    const complete = !o.timeout && placed >= quota;
    // full ships in a row raise the ship bonus: keep going and it keeps paying more
    this.fullStreak = complete ? (this.fullStreak || 0) + 1 : 0;
    if (complete) this.fullShips = (this.fullShips || 0) + 1;
    const streakMul = 1 + 0.25 * Math.min(4, Math.max(0, this.fullStreak - 1));
    // a full ship pays a bonus, more the sooner it is done; a ship that sails short just sails
    let bonus = complete ? Math.round((150 + this.shipIndex * 25 + Math.max(0, this.time) * 3) * this.multFor(this.combo) * streakMul) : 0;
    // the storm ship: double and a jackpot when she is full; lost otherwise
    const storm = this.level.storm ? { won: complete, lost: !complete, why: o.stormLost || (complete ? '' : 'time'), jackpot: complete ? STORM_JACKPOT : 0 } : null;
    if (storm && complete) bonus = bonus * 2 + STORM_JACKPOT;
    if (storm) {
      this.stats.storms = (this.stats.storms || 0) + 1;
      if (complete) this.stats.stormsWon = (this.stats.stormsWon || 0) + 1;
    }
    this.stormLosses = 0;
    this.score += bonus;
    // whatever did not make it aboard stays behind
    if (this.rig.carry) {
      const c = this.rig.carry;
      if (c.black) this._blackDone(c, 'left', null);
      this._removeCargo(c);
    }
    for (const c of this.cargos) {
      if (c.state === 'gone') continue;
      const stranded = c.state === 'truck' || (c.state === 'loose' && (!c.body || c.body.translation().x <= 1));
      if (!stranded) continue;
      if (c.black && !c.resolved) this._blackDone(c, 'left', null);
      if (c.state === 'truck' && c.truck) c.truck.depart();
      else this._removeCargo(c);
    }
    this.manifestIdx = this.manifest.length;
    if (o.timeout && !complete) this.combo = 0;
    audio.play('horn_ship', { pos: this.ship.group.position });
    audio.play(complete ? 'sting_win' : 'ui_warn', { delay: 0.3 });
    this.emit('shipDone', { n: this.shipIndex + 1, bonus, complete, placed, quota, timeLeft: Math.max(0, this.time), streak: this.fullStreak, streakMul, storm, nextStorm: !!(this._nextShip && this._nextShip.def.storm) });
    const smug = this._sweep();
    if (smug) this.emit('smuggled', { n: smug });
    // anything loose rides away lashed down
    for (const c of this.cargos) {
      if (c.state === 'loose' && c.body && !c.inWater) {
        const t = c.body.translation();
        if (t.x > 1) {
          this.phys.removeBody(c.body);
          c.body = null;
          c.collider = null;
          this.ship.cargoGroup.attach(c.mesh);
          c.state = 'shipped';
        }
      }
    }
    this.guides.setGhosts(null, []);
    // the next ship is already built: her cargo starts rolling in now, so there is a box to fetch
    // while she comes alongside
    if (this._nextShip) {
      this.manifest = this._nextShip.def.manifest.slice();
      this.manifestIdx = 0;
      this._manifestEarly = true;
      this.lanes[0].cool = Math.max(this.lanes[0].cool || 0, 1.5);
    }
  }

  /** The player is ready: bring the next ship in fast. */
  hurrySwap() {
    if (this.phase === 'swap') this.swapRate = 3.2;
  }

  _updateSwap(dt) {
    this.swapT += dt * (this.swapRate || 1);
    const ship = this.ship;
    if (this.swapStage === 0) {
      // sail out ahead (+Z)
      const k = clamp(this.swapT / 4.5, 0, 1);
      ship.offsetZ = k * k * 150;
      ship.offsetX = k * k * 10;
      // (06:00: the next night's ship waits out at sea while the shift report is up, a few seconds at most)
      if (this.swapHold > 0) this.swapHold -= dt;
      if (k >= 1 && !(this.swapHold > 0)) {
        for (const c of this.cargos) if (c.state === 'locked' || c.state === 'shipped') c.state = 'gone';
        // sailed boxes free their own material (their geometry and atlas are shared and stay)
        for (const c of this.cargos) if (c.state === 'gone') c.dispose();
        this.cargos = this.cargos.filter((c) => c.state !== 'gone');
        ship.dispose();
        this.shipIndex++;
        this.shipBase = this.delivered;
        const pre = this._nextShip;
        this._nextShip = null;
        let def = pre ? pre.def : endlessShip(this.shipIndex, this.seed);
        if (!pre && this.onShip) def = this.onShip(def, this.shipIndex) || def;
        this.level = def;
        if (!this._manifestEarly) {
          this.manifest = def.manifest.slice();
          this.manifestIdx = 0;
        }
        this._manifestEarly = false;
        this.quota += def.quota;
        this.zoned = true;
        if (pre) {
          this.ship = pre.ship;
          this.ship.group.visible = true;
          this._populateShip(def);
        } else this._makeShip(def);
        this.ship.offsetZ = -150;
        this.ship.offsetX = 8;
        this.ship._applyPose(this.simT);
        this.ship.snapBody();
        this.ctx.weather.set(def.weather);
        // the sky follows the hour: dusk for the first ships of a night, deep night, then the grey before dawn
        const hr = this.shipIndex % SHIFT_SHIPS;
        this.ctx.harbor.setSky(hr < 2 ? 'evening' : hr < 6 ? 'night' : 'predawn');
        this.swapStage = 1;
        this.swapT = 0;
        this.emit('shipIncoming', { n: this.shipIndex + 1, def });
      }
    } else {
      const k = clamp(this.swapT / 6, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      this.ship.offsetZ = (1 - e) * -150;
      this.ship.offsetX = (1 - e) * 8;
      if (k >= 1) {
        this.ship.offsetZ = 0;
        this.ship.offsetX = 0;
        this.time = this.timeTotal = this.level.roundTime * this.mods.timeMul;
        this.phase = 'play';
        this._dockedAt = this.elapsed;
        this.lanes[0].cool = 0.3;
        audio.play('horn_ship', { pos: this.ship.group.position, vol: 0.7 });
        this.emit('shipDocked', { n: this.shipIndex + 1, def: this.level, bonusTime: this.level.bonusTime });
      }
    }
  }

  // ====================================================================== visuals

  _syncVisuals(dt) {
    const rig = this.rig;
    const crane = this.ctx.crane;
    // drawn state = blend of the last two physics steps
    const PV = this._prev;
    const a = this.alpha == null ? 1 : this.alpha;
    const blend = !!(PV && PV.ok && a < 0.999);
    const ix = blend ? PV.x + (rig.x - PV.x) * a : rig.x;
    const iz = blend ? PV.z + (rig.z - PV.z) * a : rig.z;
    const ipos = blend ? _iv.lerpVectors(PV.pos, rig.sprPos, a) : _iv.copy(rig.sprPos);
    const iquat = blend ? _iq.slerpQuaternions(PV.quat, rig.sprQuat, a) : _iq.copy(rig.sprQuat);
    const itrolley = blend ? _it.lerpVectors(PV.trolley, rig.trolleyPos, a) : _it.copy(rig.trolleyPos);
    const irope = blend ? PV.rope + (rig.rope - PV.rope) * a : rig.rope;
    crane.setPose(iz, ix);
    // spreader (with a short ease after it snaps onto a box)
    const sv = this.sprVis;
    crane.spreader.position.copy(ipos);
    crane.spreader.quaternion.copy(iquat);
    if (sv.t < 1) {
      sv.t = Math.min(1, sv.t + dt / 0.14);
      const k = 1 - sv.t;
      crane.spreader.position.addScaledVector(sv.pos, k * k);
    }
    crane.spreader.updateMatrixWorld(true);
    crane.updateRopes(itrolley, crane.spreader.matrixWorld, irope);
    const c = rig.carry;
    if (c) {
      c.mesh.position.set(0, rig.carryOffsetY(), 0).applyMatrix4(crane.spreader.matrixWorld);
      c.mesh.quaternion.copy(iquat);
    }
    for (const k of this.cargos) {
      if (k.state === 'loose' && k.body) {
        const t = k.body.translation();
        const r = k.body.rotation();
        k.mesh.position.set(t.x, t.y, t.z);
        k.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        if (k._ip && a < 0.999) {
          k.mesh.position.lerpVectors(k._p0, k.mesh.position, a);
          k.mesh.quaternion.slerpQuaternions(k._q0, k.mesh.quaternion, a);
        }
      }
      if (k.snap) {
        k.snap.t = Math.min(1, k.snap.t + dt / 0.16);
        const e = 1 - Math.pow(1 - k.snap.t, 3);
        k.box.position.multiplyScalar(1 - e);
        k.box.quaternion.slerp(IDENT, e);
        if (k.snap.t >= 1) {
          k.box.position.set(0, 0, 0);
          k.box.quaternion.identity();
          k.snap = null;
        }
      }
    }
    // telescopic spreader: out to forty feet over (or under) a long box
    const g = this.grab;
    crane.setSpreaderLong(!!(c ? c.long : g && g.cargo.long && Math.hypot(g.lx, g.lz) < 2.6));
    // LED state
    if (this._ledT > 0) this._ledT -= dt;
    else crane.setLed(c ? 'locked' : this.grab && this.grab.ready ? 'ready' : 'idle');
    this.ship.syncVisual(this.simT);
    const P = this.ship;
    this.ctx.water.setHull(P.pose.x, P.pose.z + (P.zBow + P.zStern) / 2, P.halfBeam * 0.96, (P.zBow - P.zStern) / 2 - 2, 1);
  }

  _updateGuides(dt) {
    const g = this.guides;
    const rig = this.rig;
    const ship = this.ship;
    const playing = this.phase === 'play';
    // --- reticle under the load
    const bottom = rig.bottomWorld(_v);
    const hit = this.phys.rayDown(bottom.x, bottom.y + 0.4, bottom.z, 60, rig.sprBody);
    let state = 'idle';
    let quat = IDENT;
    let height = 30;
    let visible = false;
    if (hit) {
      height = Math.max(0, hit.dist - 0.4);
      visible = playing;
      const tag = this.phys.dataOf(hit.collider.handle);
      if (tag && (tag.kind === 'ship' || tag.kind === 'bridge' || (tag.kind === 'cargo' && tag.cargo.state === 'locked'))) quat = ship.group.quaternion;
      this.groundY = bottom.y - height;
    } else {
      // over open water
      height = Math.max(0, bottom.y);
      visible = playing && bottom.x > 0;
      this.groundY = 0;
    }
    this.altitude = height;
    if (rig.carry) {
      const s = this.seat;
      if (s) {
        if (s.problem === 'full' || s.problem === 'heavy' || s.problem === 'uneven' || (s.kind === 'truck' && s.problem)) state = 'bad';
        else if (!s.zoneOk || s.problem === 'hazmat') state = s.err <= 1 ? 'bad' : 'near';
        else state = s.err <= 1 ? 'good' : 'near';
      }
    } else if (this.grab) {
      state = this.grab.ready ? 'good' : Math.hypot(this.grab.lx, this.grab.lz) < 1.6 ? 'near' : 'idle';
    }
    g.setReticle(
      visible
        ? { visible: true, pos: _v2.set(bottom.x, bottom.y - height, bottom.z), quat, height, state, from: bottom, fromQuat: rig.sprQuat, long: !!(rig.carry && rig.carry.long) }
        : null,
      dt
    );
    this.reticleState = state;

    // --- target ghosts
    const cells = [];
    this.guideSlot = null;
    if (playing && rig.carry && !rig.carry.discharge && rig.carry.weighed !== 'mismatch') {
      const c = rig.carry;
      const lb = ship.worldToLocal(bottom, _v3);
      let best = null;
      let bestD = 1e9;
      for (let r = 0; r < ship.rows; r++) {
        for (let b = 0; b < ship.bays - (c.long ? 1 : 0); b++) {
          if (!this._zoneOk(c, r, b)) continue;
          const prob = this._ruleProblem(c, r, b);
          if (prob === 'full') continue;
          const t = c.long ? ship.pairHeight(r, b) : ship.height(r, b);
          const cell = { pos: c.long ? ship.pairLocal(r, b, t) : ship.cellLocal(r, b, t), color: zoneColor(c.zone === 'ANY' ? ship.zoneOf(r, b) : c.zone), ok: !prob, best: false, long: c.long };
          if (c.zone === 'ANY' && ship.zoneOf(r, b) === 'ANY') cell.color = 0x9fd8ff;
          if (c.black) cell.color = 0x6dffd9;
          cells.push(cell);
          const d = Math.hypot(cell.pos.x - lb.x, cell.pos.z - lb.z);
          if (!prob && d < bestD) {
            bestD = d;
            best = cell;
          }
        }
      }
      if (best) {
        best.best = true;
        this.guideSlot = ship.localToWorld(best.pos, this._guideV || (this._guideV = new THREE.Vector3()));
      }
      // no legal cell anywhere aboard: never a silent dead end — after a moment the box is marked to
      // go back ashore (a collector comes to lane 2, the coach and the arrow point at it)
      if (!best && !c.black && !c.returning) {
        this._noSlotT = (this._noSlotT || 0) + dt;
        if (this._noSlotT > 0.8) {
          c.returning = true;
          this.noSlotCargo = c;
          this.emit('noslot', { cargo: c });
        }
      } else this._noSlotT = 0;
      if (best && c.returning) {
        // (room came free after all: it can stay)
        c.returning = false;
        this.noSlotCargo = null;
      }
    } else this._noSlotT = 0;
    // a box going back ashore aims at lane 2 (the collector's bed once it is parked)
    if (playing && rig.carry && rig.carry.returning) {
      const l2 = this.lanes[1];
      const tr = l2.truck && l2.truck.parked && !l2.truck.cargo ? l2.truck : null;
      this.guideSlot = tr ? tr.bedCenter(rig.carry.hy, this._guideV || (this._guideV = new THREE.Vector3())) : (this._guideV || (this._guideV = new THREE.Vector3())).set(l2.x, DIM.QUAY_Y + 2, l2.z);
    }
    g.setGhosts(cells.length ? ship.group : null, cells);

    // --- floating tags
    const tags = [];
    if (playing) {
      for (const c of this.cargos) {
        if (c.state === 'gone') continue;
        if (c.state === 'carried') continue;
        let kind = null;
        if (!rig.carry && c.state === 'truck' && c.truck && c.truck.parked && !c.truck.departing) kind = c.black ? 'black' : c.check ? 'check' : 'pick';
        else if (c.discharge && !c.counted && c.state !== 'truck') kind = 'out';
        else if (c.misplaced) kind = 'bad';
        else if (c.state === 'loose' && c.settled && !c.inWater && !c.preload) kind = c.black ? 'black' : 'warn';
        if (!kind) continue;
        c.mesh.updateWorldMatrix(true, false);
        tags.push({ pos: new THREE.Vector3(0, c.hy, 0).applyMatrix4(c.mesh.matrixWorld), kind });
      }
      if (rig.carry && rig.carry.discharge) {
        for (const tr of this.trucks) if (tr.purpose === 'collect' && tr.parked && !tr.cargo) tags.push({ pos: tr.bedCenter(0, new THREE.Vector3()), kind: 'out' });
      }
      if (rig.carry && (rig.carry.black || (rig.carry.check && rig.carry.weighed !== 'match'))) {
        for (const tr of this.trucks) if (tr.purpose === 'customs' && tr.parked && !tr.cargo) tags.push({ pos: tr.bedCenter(0, new THREE.Vector3()), kind: 'customs' });
      }
    }
    g.setTags(tags);
    g.update(dt);
  }

  _updateAudio(dt) {
    if (this.attract) return;
    const rig = this.rig;
    const L = this.loops;
    if (!L.trolley) {
      L.trolley = audio.loop('motor_trolley');
      L.hoist = audio.loop('motor_hoist');
      L.gantry = audio.loop('motor_gantry');
      L.truck = audio.loop('truck_idle');
    }
    const live = this.phase !== 'over' || true;
    const sx = Math.abs(rig.vx) / TUNE.trolleySpeed;
    const sz = Math.abs(rig.vz) / TUNE.gantrySpeed;
    const sr = Math.abs(rig.vr) / TUNE.hoistSpeed;
    const load = rig.carry ? 1.25 : 1;
    L.trolley.set(live ? clamp(sx * 1.2, 0, 1) * 0.9 : 0, 0.75 + sx * 0.45);
    L.hoist.set(live ? clamp(sr * 1.3, 0, 1) * load * 0.8 : 0, (0.8 + sr * 0.4) * (rig.vr < 0 ? 0.92 * (rig.carry ? 0.9 : 1) : 1.05));
    L.gantry.set(live ? clamp(sz * 1.4, 0, 1) : 0, 0.8 + sz * 0.5);
    if (sz > 0.12 && this.cool.beep < 0) {
      this.cool.beep = 0.62;
      audio.play('beep', { pos: _v.set(DIM.LEG_WATER_X, DIM.QUAY_Y + 2, rig.z) });
    }
    // hoist start accent
    const moving = sr > 0.25;
    if (moving && !this._hoistWas) audio.play('hydraulic', { pos: rig.trolleyPos, vol: 0.6 });
    this._hoistWas = moving;
    // nearest idling truck
    let near = 0;
    for (const tr of this.trucks) {
      if (tr.state === 'gone') continue;
      const d = Math.hypot(tr.group.position.x - this.ctx.cams.focus.x, tr.z - this.ctx.cams.focus.z);
      near = Math.max(near, clamp(1 - d / 45, 0, 1) * (tr.state === 'wait' ? 0.6 : 1));
    }
    L.truck.set(near * 0.8, 0.8 + near * 0.25);
    // an unlisted box hums to itself; louder on the hook
    if (this.blackSeen) {
      let hum = 0;
      for (const c of this.cargos) {
        if (!c.black || c.state === 'gone' || c.inWater) continue;
        c.mesh.getWorldPosition(_v);
        const d = _v.distanceTo(this.ctx.cams.focus);
        hum = Math.max(hum, c.state === 'carried' ? 0.9 : 0.55 * clamp(1 - d / 40, 0, 1));
        this._humRate = 0.9 + (c.pulse || 0) * 0.25;
      }
      if (hum > 0 && !L.hum) L.hum = audio.loop('box_hum');
      if (L.hum) L.hum.set(hum, this._humRate || 1);
    }
    // hull groans with the swell
    const sea = this.ctx.weather.cur.sea;
    if (this.cool.creak < 0) {
      this.cool.creak = rand(3.5, 9) / (0.4 + sea * 2);
      audio.play('creak', { pos: this.ship.group.position, vol: clamp(0.3 + sea * 0.9, 0.2, 1) });
    }
    // swinging load whoosh
    const rel = Math.hypot(rig.sprVel.x - rig.vx, rig.sprVel.z - rig.vz);
    if (rel > 5.2 && this.cool.clang < -0.4 && !this._whooshed) {
      this._whooshed = true;
      audio.play('whoosh', { pos: rig.sprPos, vol: clamp(rel / 9, 0.4, 1), rate: rig.carry ? 0.8 : 1.1 });
    } else if (rel < 2.5) this._whooshed = false;
  }

  stopLoops() {
    for (const k in this.loops) this.loops[k].stop(0.3);
    this.loops = {};
  }

  // ====================================================================== HUD snapshot

  hud() {
    const rig = this.rig;
    const c = rig.carry;
    const s = this.seat;
    const g = this.grab;
    let action = 'none';
    let hint = '';
    if (c) {
      action = 'release';
      if (s && s.seated && s.valid && (s.kind !== 'truck' || !s.problem)) hint = s.kind === 'truck' ? 'ON THE TRUCK — RELEASE' : !s.zoneOk ? 'WRONG BAY' : s.problem === 'hazmat' ? 'TOO CLOSE TO HAZMAT' : `${s.grade.toUpperCase()} — RELEASE`;
      else if (s && s.problem === 'heavy') hint = 'TOO HEAVY FOR THIS STACK';
      else if (s && s.problem === 'full') hint = 'STACK FULL';
      else if (s && s.problem === 'uneven') hint = 'UNEVEN — NEEDS TWO LEVEL COLUMNS';
      else if (s && s.seated) hint = 'OFF THE LOCK POINTS';
      else if (s && rig.slack > 0.12 && s.gap > 0.45) hint = 'SNAGGED — LIFT AND RE-CENTRE';
      else if (c.black) hint = 'NO PAPERS — SHIP IT, OR HAND IT IN?';
      else if (c.check && !c.weighed) hint = this.scale.t > 0.05 ? 'WEIGHING — HOLD STILL' : 'SPOT CHECK — HOLD IT STEADY';
      else if (c.weighed === 'mismatch') hint = 'MIS-DECLARED — CUSTOMS, LANE 2';
      else if (c.weighed === 'match') hint = 'PAPERS MATCH — LOAD IT';
      else hint = 'CARRYING';
    } else if (g && g.ready) {
      action = 'lock';
      hint = 'LANDED — LOCK ON';
    } else {
      action = 'lock-off';
      hint = g && Math.hypot(g.lx, g.lz) < 2.2 ? 'LINE UP AND LOWER' : 'SPREADER EMPTY';
    }
    const next = [];
    for (let i = this.manifestIdx; i < Math.min(this.manifest.length, this.manifestIdx + 4); i++) next.push(this.manifest[i]);
    const waiting = [];
    for (const k of this.cargos) if (k.state === 'truck' && k.truck && k.truck.purpose === 'deliver') waiting.push(k);
    return {
      phase: this.phase,
      time: this.time,
      timeTotal: this.timeTotal,
      endless: this.endless,
      score: Math.max(0, Math.round(this.score)),
      combo: this.combo,
      strikes: this.strikes,
      maxStrikes: this.maxStrikes,
      delivered: this.delivered,
      quota: this.endless ? this.manifest.filter((m) => !m.black && !m.returned).length : this.quota,
      mult: this.multFor(this.combo),
      shipDelivered: this.delivered - this.shipBase,
      carry: c,
      seat: s,
      action,
      hint,
      state: c ? (s && s.seated ? (s.valid && s.zoneOk && !s.problem ? 'good' : 'bad') : s && rig.slack > 0.12 && s.gap > 0.45 ? 'bad' : 'carry') : g && g.ready ? 'ready' : 'idle',
      altitude: this.altitude,
      wind: this.ctx.weather.windSpeed * this.windScale,
      windAngle: this.ctx.weather.windAngle,
      gustWarn: this.ctx.weather.gustWarn,
      next,
      waiting,
      ship: this.ship,
      shipIndex: this.shipIndex,
      thresholds: this.endless ? null : starThresholds(this.level),
      slack: rig.slack,
      rope: rig.rope,
      reefers: this.cargos.filter((k) => k.type === 'reefer' && k.thawing && !k.counted && k.state !== 'gone'),
      scale: c && (c.check || c.black) ? { read: this.scale.read, decl: c.declT, k: clamp(this.scale.t / TUNE.weighTime, 0, 1), verdict: c.weighed, black: c.black } : null,
    };
  }

  // ====================================================================== teardown

  dispose() {
    this.stopLoops();
    this.guides.dispose();
    for (const tr of this.trucks) tr.dispose();
    for (const c of this.cargos) c.dispose();
    this.ship.dispose();
    if (this._nextShip) {
      this._nextShip.ship.dispose();
      this._nextShip = null;
    }
    this.rig.dispose();
    this.phys.dispose();
    this.ctx.harbor.clearPickupMarks();
    this.ctx.crane.setLed('idle');
    this.ctx.crane.setSpreaderLong(false);
    this.cargos.length = 0;
    this.trucks.length = 0;
  }
}
