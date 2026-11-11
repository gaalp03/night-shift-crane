// One running shift: owns the physics world, crane rig, ship, trucks and cargo, and implements
// the rules (grab / place / lock, scoring, strikes, hazards, time, endless ship rotation).
import * as THREE from 'three';
import { DIM, TUNE, SCORE, ZONES } from '../config.js';
import { Phys, STEP, GROUPS } from './physics.js';
import { Rig, MASS_UNIT } from './rig.js';
import { Guides, zoneColor } from './guides.js';
import { zoneFn, starsFor, starThresholds, upgradeMods, endlessShip } from './levels.js';
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
    this.mods = upgradeMods(ctx.save.data.upgrades);
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
    this.stats = { perfect: 0, great: 0, good: 0, sloppy: 0, lost: 0, soft: 0, rough: 0, placed: 0, discharged: 0, ships: 0, timeBonus: 0 };
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
    this.rig = new Rig(p, {
      x: DIM.LANE_X,
      z: 0,
      rope: 7.5,
      mods: { trolley: this.mods.trolley, gantry: this.mods.gantry, hoist: this.mods.hoist, sway: TUNE.swayDamp * this.mods.swayMul },
    });
    this.guides = new Guides(scene);
    harbor.clearPickupMarks();
    harbor.markPickup(this.lanes[0].x, this.lanes[0].z);
    if (this._needsLane2()) harbor.markPickup(this.lanes[1].x, this.lanes[1].z);
    weather.set(this.level.weather, true);
    crane.setPose(this.rig.z, this.rig.x);
    this._syncVisuals(0);
    // a couple of physics steps so everything rests before the camera shows it
    for (let i = 0; i < 4; i++) this._fixedStep(STEP, true);
    this._syncVisuals(0);
  }

  _needsLane2() {
    return (this.level.preload || []).some((p) => p.discharge) || this.level.lanes === 2;
  }

  _makeShip(level) {
    const def = { ...level.ship, zoneOf: zoneFn(level.ship.zones), seed: (this.seed % 97) + this.shipIndex * 3.1 };
    this.ship = new Ship(def, this.phys);
    this.ctx.scene.add(this.ship.group);
    this.ship.paintZones();
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

  _newCargo(spec, brand) {
    const c = new Cargo({ zone: spec.zone, type: spec.type, brand: (brand == null ? this.cargos.length : brand) % BRAND_COUNT, mobile: this.ctx.mobile });
    c.mass = c.typeDef.mass;
    this.cargos.push(c);
    return c;
  }

  // ====================================================================== flow

  start() {
    this.phase = 'play';
    this.emit('start');
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
    let timeBonus = 0;
    if (success && !this.endless) {
      timeBonus = Math.round(Math.max(0, this.time) * 5);
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
      ships: this.stats.ships,
      time: this.elapsed,
    };
    this.emit('finish', this.result);
  }

  // ====================================================================== main update

  update(dt) {
    const run = this.phase === 'play' || this.phase === 'swap' || this.phase === 'pre' || this.phase === 'over';
    if (!run) return;
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= STEP && n < 4) {
      this._fixedStep(STEP);
      this.acc -= STEP;
      n++;
    }
    if (this.acc > STEP * 2) this.acc = 0;

    if (this.phase === 'play') {
      this.elapsed += dt;
      if (!this.endless || this.time > 0) this.time -= dt;
      this._handleActions();
      this._updateTrucks(dt);
      this._checkEnd(dt);
    } else {
      this._updateTrucks(dt);
    }
    if (this.phase === 'swap') this._updateSwap(dt);
    for (const k in this.cool) this.cool[k] -= dt;
    if (this.rig.carry) this.carryT += dt;
    this._updateReefers(dt);
    this._syncVisuals(dt);
    this._updateGuides(dt);
    this._updateAudio(dt);
  }

  _controls() {
    if (this.phase !== 'play' || this.controlsLocked) return { x: 0, z: 0, hoist: 0 };
    return {
      x: this.allow.x ? input.axisX : 0,
      z: this.allow.z ? input.axisZ : 0,
      hoist: this.allow.hoist ? input.hoist : 0,
    };
  }

  _fixedStep(h, warm = false) {
    this.simT += h;
    const rig = this.rig;
    const w = this.ctx.weather.wind;
    this.env.wind.x = w.x * this.windScale;
    this.env.wind.z = w.z * this.windScale;
    this._computeAssist();
    rig.fixedUpdate(h, warm ? { x: 0, z: 0, hoist: 0 } : this._controls(), this.env);
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
        ready: Math.abs(_v3.x) < TUNE.grabTolX && Math.abs(_v3.z) < TUNE.grabTolZ && dy > -0.3 && dy < 0.34 && yaw < 0.2 && tiltOk,
        top: new THREE.Vector3(0, c.hy, 0).applyQuaternion(_q).add(_v2),
        quat: _q.clone(),
        pos: _v2.clone(),
      };
    }
    return best;
  }

  _zoneOk(cargo, r, b) {
    const z = this.ship.zoneOf(r, b);
    return z === 'ANY' || cargo.zone === 'ANY' || z === cargo.zone;
  }

  /** Reasons a box may not be twist-locked at (r, b). Returns null when fine. */
  _ruleProblem(cargo, r, b) {
    const ship = this.ship;
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
    const col = ship.columnAt(l.x, l.z, 0.12);
    if (col && this.phase === 'play') {
      const t = ship.height(col.r, col.b);
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
          valid: err <= 1 && tilt > 0.985 && problem !== 'full' && problem !== 'heavy',
          grade: err <= TUNE.perfect / this.lockTol ? 'perfect' : err <= TUNE.great / this.lockTol ? 'great' : err <= 1 ? 'good' : 'off',
        };
      }
    }
    // --- collector trucks
    for (const tr of this.trucks) {
      if (tr.purpose !== 'collect' || !tr.parked || tr.cargo) continue;
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
        problem: cargo.discharge ? null : 'notout',
        seated: gap < 0.2,
        valid: err <= 1 && gap > -0.8,
        grade: err <= 0.3 ? 'perfect' : err <= 0.62 ? 'great' : err <= 1 ? 'good' : 'off',
      };
    }
    return null;
  }

  _computeAssist() {
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
    if (tx !== null && gap < 2.6 && gap > -0.4) {
      const near = clamp(1 - gap / 2.6, 0.15, 1);
      const v = rig.sprVel;
      a.x = clamp(tx * k * near - (v.x - rig.vx) * 1.1 * near, -4.5, 4.5);
      a.z = clamp(tz * k * near - (v.z - rig.vz) * 1.1 * near, -4.5, 4.5);
    }
  }

  // ====================================================================== player actions

  _handleActions() {
    if (this.controlsLocked) return;
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
      this.emit('toast', { text: g && Math.hypot(g.lx, g.lz) < 2.5 ? 'Line the spreader up on the container, then lower onto it' : 'Lower the spreader onto a container first', kind: 'hint', key: 'grabfail' });
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
    const soft = this.simT - this.touch.t > 0.05 ? this.touch.dv : this.touch.dv;
    const pose = rig.detach();
    audio.play('unlock', { pos: rig.sprPos });
    if (seat && seat.seated && seat.valid && seat.kind === 'ship') {
      this._lockToShip(c, seat, { dropped: false, touchDv: soft });
    } else if (seat && seat.seated && seat.valid && seat.kind === 'truck' && !seat.problem) {
      this._lockToTruck(c, seat);
    } else {
      this._makeLoose(c, pose);
      if (seat && seat.seated && seat.kind === 'ship') {
        if (seat.problem === 'heavy') this.emit('toast', { text: 'Too heavy for that stack — the twist-locks will not hold', kind: 'warn' });
        else if (seat.problem === 'full') this.emit('toast', { text: 'That stack is at its limit', kind: 'warn' });
        else if (seat.err > 1) this.emit('toast', { text: 'Not on the lock points — it is sitting loose', kind: 'warn', key: 'loose' });
      } else if (seat && seat.kind === 'truck' && seat.problem === 'notout') {
        this.emit('toast', { text: 'That box is not on the discharge list', kind: 'hint' });
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
    const wp = ship.localToWorld(ship.cellLocal(seat.r, seat.b, seat.t), _v3);
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

    if (c.preload && !c.discharge) {
      // re-stowed existing cargo: no points either way
      this.emit('burst', { text: 'RE-STOWED', pos: wp.clone(), kind: 'info' });
      return;
    }
    if (c.discharge) {
      c.misplaced = true;
      this.emit('burst', { text: 'GOES ASHORE!', pos: wp.clone(), kind: 'bad' });
      this.emit('toast', { text: 'This box is leaving the ship — set it on a truck in Lane 2', kind: 'warn' });
      return;
    }
    if (c.misplaced) {
      this.combo = 0;
      audio.play('ui_error');
      this.emit('burst', { text: hazard ? 'TOO CLOSE!' : 'WRONG BAY!', pos: wp.clone(), kind: 'bad' });
      this.emit('toast', {
        text: hazard ? 'Hazmat boxes may not touch — move it' : `That bay is for ${(ZONES[ship.zoneOf(seat.r, seat.b)] || ZONES.ANY).name}. Pick it up and move it to ${(ZONES[c.zone] || ZONES.ANY).name}`,
        kind: 'warn',
      });
      return;
    }
    const grade = dropped ? 'good' : seat.grade === 'off' ? 'good' : seat.grade;
    this._award(c, grade, { soft: !dropped && touchDv < TUNE.softLanding, pos: wp.clone(), dropped });
  }

  _lockToTruck(c, seat) {
    const tr = seat.truck;
    const wp = tr.bedCenter(c.hy, _v3).clone();
    tr.accept(c);
    audio.play('lock', { pos: wp, rate: 0.95 });
    audio.play('impact_deck', { pos: wp, vol: 0.5 });
    this.ctx.fx.dust(wp.x, wp.y - c.hy, wp.z, 8);
    this.stats.discharged++;
    this._award(c, seat.grade === 'off' ? 'good' : seat.grade, { soft: this.touch.dv < TUNE.softLanding, pos: wp, discharge: true });
  }

  _award(c, grade, { soft, pos, dropped, discharge }) {
    let pts = SCORE[grade] || SCORE.good;
    const parts = [];
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
    if (grade === 'perfect' || grade === 'great') this.combo++;
    else if (grade === 'sloppy' || dropped) this.combo = 0;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const mult = 1 + 0.1 * Math.min(10, Math.max(0, this.combo - 1));
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
    const label = grade === 'perfect' ? 'PERFECT!' : grade === 'great' ? 'GREAT!' : grade === 'good' ? (dropped ? 'DROPPED IN' : 'LOCKED') : 'SLOPPY';
    this.emit('burst', { text: label, pos, kind: grade, sub: parts.join(' · ') });
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
    this.emit('strike', { cargo: c, reason, pos: pos ? pos.clone() : null, strikes: this.strikes, max: this.maxStrikes });
    if (this.strikes >= this.maxStrikes && this.phase === 'play') {
      this._failT = 1.6;
    }
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
    const { r, b } = c.cell;
    const stack = this.ship.grid[r][b].slice(c.cell.t);
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
        this.emit('overboard', c);
      }
      if (c.inWater) {
        c.waterT += h;
        if (c.waterT > 0.7 && Math.random() < 0.25) this.ctx.fx.puff(t.x + rand(-1, 1), 0.2, t.z + rand(-2.5, 2.5), 0.3, 0xbfe0e6, 1.2);
        if (c.waterT > 3.4) {
          const pos = new THREE.Vector3(t.x, 0.5, t.z);
          this._removeCargo(c);
          this._lose(c, 'sea', pos);
        }
        continue;
      }
      if (t.y < -15) {
        this._removeCargo(c);
        this._lose(c, 'sea', null);
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
        if (upY < 0.6) c.sideT += h;
        else c.sideT = 0;
        if (!c.settled && c.restT > 0.55) this._settleLoose(c);
        if (c.sideT > 2.6) {
          // lying on its side: a write-off
          const pos = new THREE.Vector3(t.x, t.y, t.z);
          this.ctx.fx.dust(t.x, t.y, t.z, 16, 0x7a8086, 4);
          this.ctx.fx.debris(t.x, t.y, t.z, 14, [zoneColor(c.zone), 0x59646d, 0x23292e], t.x < 0 ? DIM.QUAY_Y : undefined, 5);
          audio.play('impact_heavy', { pos });
          this.emit('burst', { text: 'WRECKED!', pos: pos.clone(), kind: 'bad' });
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

    if (this._failT != null) {
      this._failT -= h;
      if (this._failT <= 0) {
        this._failT = null;
        if (this.phase === 'play') this._finish(false, 'strikes');
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
    const col = ship.columnAt(l.x, l.z, 0.0);
    const upDot = _s.set(0, 1, 0).applyQuaternion(_q).dot(ship.up(_v3));
    if (!col || upDot < 0.97) return;
    const tier = ship.height(col.r, col.b);
    const expectY = ship.tierY(tier);
    const err = Math.max(Math.abs(col.dx) / this.lockTol, Math.abs(col.dz) / (this.lockTol * 1.3));
    const yaw = Math.abs(Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x)));
    const problem = this._ruleProblem(c, col.r, col.b);
    if (Math.abs(l.y - expectY) < 0.3 && err <= 1 && yaw < 0.14 && problem !== 'full' && problem !== 'heavy') {
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
    if (dv > 4.6 && this.cool.clang < 0) {
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
    if (carried && cargo && dv > 5.4 && this.cool.rough < 0 && !viaSpreader) {
      this.cool.rough = 1.2;
      this.combo = 0;
      this.stats.rough++;
      this.score += SCORE.rough;
      this.emit('points', { pts: SCORE.rough, pos: pos.clone(), rough: true });
      this.emit('toast', { text: 'Rough handling — easy on the cargo', kind: 'warn', key: 'rough' });
    }
    if ((kind === 'truck' || kind === 'truckcab') && dv > 2.5 && this.cool.honk < 0) {
      this.cool.honk = 2.5;
      audio.play('horn_truck', { pos, delay: 0.25 });
      audio.play('vox_hey', { pos, delay: 0.5 });
      this.emit('burst', { text: 'HEY!', pos: pos.clone().add(_v3.set(0, 2.5, 0)), kind: 'info' });
    }
    if (kind === 'bridge' && dv > 2 && this.cool.bridge < 0) {
      this.cool.bridge = 3;
      this.emit('toast', { text: 'Mind the wheelhouse! The captain is not amused', kind: 'warn' });
    }
    this.emit('impact', { dv, pos, kind });
  }

  // ====================================================================== trucks + timers + end

  _updateTrucks(dt) {
    const t = this.simT;
    for (const tr of this.trucks) tr.update(dt, t);
    this.trucks = this.trucks.filter((tr) => tr.state !== 'gone');
    if (this.phase !== 'play') return;
    // lane 1: deliveries
    const l1 = this.lanes[0];
    if (!l1.truck || l1.truck.state === 'gone' || (l1.truck.state === 'out' && l1.truck.z > l1.z + 13)) {
      l1.cool -= dt;
      if (l1.cool <= 0 && this.manifestIdx < this.manifest.length) {
        const spec = this.manifest[this.manifestIdx++];
        const c = this._newCargo(spec);
        const tr = new Truck(this.ctx.scene, this.phys, { laneX: l1.x, stopZ: l1.z, purpose: 'deliver', color: this.manifestIdx + this.shipIndex });
        tr.load(c);
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
    // lane 2: collectors, while there is something to take off the ship
    const l2 = this.lanes[1];
    const pendingOut = this.cargos.some((c) => c.discharge && !c.counted && c.state !== 'gone' && !c.lost);
    if (pendingOut && (!l2.truck || l2.truck.state === 'gone' || (l2.truck.state === 'out' && l2.truck.z > l2.z + 13))) {
      l2.cool -= dt;
      if (l2.cool <= 0) {
        const tr = new Truck(this.ctx.scene, this.phys, { laneX: l2.x, stopZ: l2.z, purpose: 'collect', color: 2 + this.trucks.length });
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
        this.emit('toast', { text: 'A reefer has thawed — bonus lost', kind: 'warn' });
      }
    }
  }

  _pendingCargo() {
    let n = 0;
    for (const c of this.cargos) {
      if (c.state === 'gone' || c.lost) continue;
      if (c.preload && !c.discharge) continue;
      if (!c.counted) n++;
    }
    return n;
  }

  _checkEnd(dt) {
    if (this.phase !== 'play' || this._failT != null) return;
    // low-time warnings
    if (!this.endless || this.time > 0) {
      if (this.time <= 10.4 && this.time > 0 && this.cool.tick < 0) {
        this.cool.tick = 1;
        audio.play('tick_alarm', { rate: this.time < 5 ? 1.25 : 1 });
      }
      if (this.time <= 30 && !this._warn30 && this.timeTotal > 60) {
        this._warn30 = true;
        audio.play('ui_warn');
        this.emit('toast', { text: '30 seconds to departure!', kind: 'warn' });
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
    if (this.time <= 0 && this.phase === 'play') {
      if (this.endless) this._finish(false, 'time');
      else this._finish(this.delivered >= this.quota, 'time');
    }
  }

  // ====================================================================== endless: ship rotation

  _beginSwap() {
    this.phase = 'swap';
    this.swapT = 0;
    this.swapStage = 0;
    this.stats.ships++;
    const bonus = 400 + this.shipIndex * 60;
    this.score += bonus;
    audio.play('horn_ship', { pos: this.ship.group.position });
    audio.play('sting_win', { delay: 0.3 });
    this.emit('shipDone', { n: this.shipIndex + 1, bonus });
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
  }

  _updateSwap(dt) {
    this.swapT += dt;
    const ship = this.ship;
    if (this.swapStage === 0) {
      // sail out ahead (+Z)
      const k = clamp(this.swapT / 7.5, 0, 1);
      ship.offsetZ = k * k * 150;
      ship.offsetX = k * k * 10;
      if (k >= 1) {
        for (const c of this.cargos) if (c.state === 'locked' || c.state === 'shipped') c.state = 'gone';
        this.cargos = this.cargos.filter((c) => c.state !== 'gone');
        ship.dispose();
        this.shipIndex++;
        const def = endlessShip(this.shipIndex, this.seed);
        this.level = def;
        this.manifest = def.manifest.slice();
        this.manifestIdx = 0;
        this.quota += def.quota;
        this.zoned = true;
        this._makeShip(def);
        this.ship.offsetZ = -150;
        this.ship.offsetX = 8;
        this.ship._applyPose(this.simT);
        this.ship.snapBody();
        this.ctx.weather.set(def.weather);
        this.swapStage = 1;
        this.swapT = 0;
        this.emit('shipIncoming', { n: this.shipIndex + 1, def });
      }
    } else {
      const k = clamp(this.swapT / 8, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      this.ship.offsetZ = (1 - e) * -150;
      this.ship.offsetX = (1 - e) * 8;
      if (k >= 1) {
        this.ship.offsetZ = 0;
        this.ship.offsetX = 0;
        this.time = Math.min(this.time + this.level.bonusTime, 420);
        this.timeTotal = Math.max(this.time, 1);
        this.phase = 'play';
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
    crane.setPose(rig.z, rig.x);
    // spreader (with a short ease after it snaps onto a box)
    const sv = this.sprVis;
    crane.spreader.position.copy(rig.sprPos);
    crane.spreader.quaternion.copy(rig.sprQuat);
    if (sv.t < 1) {
      sv.t = Math.min(1, sv.t + dt / 0.14);
      const k = 1 - sv.t;
      crane.spreader.position.addScaledVector(sv.pos, k * k);
    }
    crane.spreader.updateMatrixWorld(true);
    crane.updateRopes(rig.trolleyPos, crane.spreader.matrixWorld, rig.rope);
    const c = rig.carry;
    if (c) {
      c.mesh.position.set(0, rig.carryOffsetY(), 0).applyMatrix4(crane.spreader.matrixWorld);
      c.mesh.quaternion.copy(rig.sprQuat);
    }
    for (const k of this.cargos) {
      if (k.state === 'loose' && k.body) {
        const t = k.body.translation();
        const r = k.body.rotation();
        k.mesh.position.set(t.x, t.y, t.z);
        k.mesh.quaternion.set(r.x, r.y, r.z, r.w);
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
        if (s.problem === 'full' || s.problem === 'heavy' || (s.kind === 'truck' && s.problem)) state = 'bad';
        else if (!s.zoneOk || s.problem === 'hazmat') state = s.err <= 1 ? 'bad' : 'near';
        else state = s.err <= 1 ? 'good' : 'near';
      }
    } else if (this.grab) {
      state = this.grab.ready ? 'good' : Math.hypot(this.grab.lx, this.grab.lz) < 1.6 ? 'near' : 'idle';
    }
    g.setReticle(
      visible
        ? { visible: true, pos: _v2.set(bottom.x, bottom.y - height, bottom.z), quat, height, state, from: bottom, fromQuat: rig.sprQuat }
        : null,
      dt
    );
    this.reticleState = state;

    // --- target ghosts
    const cells = [];
    if (playing && rig.carry && !rig.carry.discharge) {
      const c = rig.carry;
      const lb = ship.worldToLocal(bottom, _v3);
      let best = null;
      let bestD = 1e9;
      for (let r = 0; r < ship.rows; r++) {
        for (let b = 0; b < ship.bays; b++) {
          if (!this._zoneOk(c, r, b)) continue;
          const prob = this._ruleProblem(c, r, b);
          if (prob === 'full') continue;
          const t = ship.height(r, b);
          const cell = { pos: ship.cellLocal(r, b, t), color: zoneColor(c.zone === 'ANY' ? ship.zoneOf(r, b) : c.zone), ok: !prob, best: false };
          if (c.zone === 'ANY' && ship.zoneOf(r, b) === 'ANY') cell.color = 0x9fd8ff;
          cells.push(cell);
          const d = Math.hypot(cell.pos.x - lb.x, cell.pos.z - lb.z);
          if (!prob && d < bestD) {
            bestD = d;
            best = cell;
          }
        }
      }
      if (best) best.best = true;
    }
    g.setGhosts(cells.length ? ship.group : null, cells);

    // --- floating tags
    const tags = [];
    if (playing) {
      for (const c of this.cargos) {
        if (c.state === 'gone') continue;
        if (c.state === 'carried') continue;
        let kind = null;
        if (!rig.carry && c.state === 'truck' && c.truck && c.truck.parked && !c.truck.departing) kind = 'pick';
        else if (c.discharge && !c.counted && c.state !== 'truck') kind = 'out';
        else if (c.misplaced) kind = 'bad';
        else if (c.state === 'loose' && c.settled && !c.inWater && !c.preload) kind = 'warn';
        if (!kind) continue;
        c.mesh.updateWorldMatrix(true, false);
        tags.push({ pos: new THREE.Vector3(0, c.hy, 0).applyMatrix4(c.mesh.matrixWorld), kind });
      }
      if (rig.carry && rig.carry.discharge) {
        for (const tr of this.trucks) if (tr.purpose === 'collect' && tr.parked && !tr.cargo) tags.push({ pos: tr.bedCenter(0, new THREE.Vector3()), kind: 'out' });
      }
    }
    g.setTags(tags);
    g.update(dt);
  }

  _updateAudio(dt) {
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
      else if (s && s.seated) hint = 'OFF THE LOCK POINTS';
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
      quota: this.endless ? this.manifest.length : this.quota,
      shipDelivered: this.endless ? this.manifestIdx - waiting.length - (c && !c.preload ? 1 : 0) : this.delivered,
      carry: c,
      seat: s,
      action,
      hint,
      state: c ? (s && s.seated ? (s.valid && s.zoneOk && !s.problem ? 'good' : 'bad') : 'carry') : g && g.ready ? 'ready' : 'idle',
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
    };
  }

  // ====================================================================== teardown

  dispose() {
    this.stopLoops();
    this.guides.dispose();
    for (const tr of this.trucks) tr.dispose();
    for (const c of this.cargos) c.dispose();
    this.ship.dispose();
    this.rig.dispose();
    this.phys.dispose();
    this.ctx.harbor.clearPickupMarks();
    this.ctx.crane.setLed('idle');
    this.cargos.length = 0;
    this.trucks.length = 0;
  }
}
