// Crane physics rig: kinematic trolley, cable-suspended spreader (4 rope joints), hoist logic,
// wind / anti-sway forces and carrying a container as part of the spreader body.
import * as THREE from 'three';
import { DIM, TUNE } from '../config.js';
import { GROUPS, RAPIER } from './physics.js';
import { ROPE } from '../world/crane.js';
import { approach, clamp } from '../core/util.js';

export const MASS_UNIT = 100;
const SPREADER_MASS = 42;
const SLACK = 0.22;

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Rig {
  constructor(phys, { x = DIM.LANE_X, z = 0, rope = 8, mods = {} } = {}) {
    this.phys = phys;
    this.mods = Object.assign({ trolley: 1, hoist: 1, sway: TUNE.swayDamp, gantry: 1 }, mods);
    this.x = x;
    this.z = z;
    this.vx = 0;
    this.vz = 0;
    this.rope = rope;
    this.vr = 0;
    this.carry = null;
    this.carryCollider = null;
    this.slack = 0;
    this.tension = 1;
    this.frozen = false;

    this.trolleyBody = phys.kinematicBody(x, DIM.RAIL_Y, z);
    const sy = DIM.RAIL_Y + ROPE.TOP_Y - rope - ROPE.SPR_Y;
    this.sprBody = phys.dynamicBody(x, sy, z, { canSleep: false, linDamp: 0.03, angDamp: 1.4, ccd: true });
    this.hw = DIM.CONT_W / 2 - 0.05;
    this.hl = DIM.CONT_L / 2 - 0.05;
    const vol = this.hw * 2 * DIM.SPR_H * this.hl * 2;
    this.sprCollider = phys.box(this.hw, DIM.SPR_H / 2, this.hl, {
      body: this.sprBody,
      density: SPREADER_MASS / vol,
      friction: 0.7,
      restitution: 0.02,
      groups: GROUPS.load,
      events: true,
      eventThreshold: 40,
      tag: { kind: 'spreader', rig: this },
    });
    this.joints = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const jd = RAPIER.JointData.rope(rope, { x: sx * ROPE.X, y: ROPE.TOP_Y, z: sz * ROPE.Z }, { x: sx * ROPE.X, y: ROPE.SPR_Y, z: sz * ROPE.Z });
        this.joints.push(phys.world.createImpulseJoint(jd, this.trolleyBody, this.sprBody, true));
      }
    }
    this._appliedRope = rope;

    // cached visual state
    this.sprPos = new THREE.Vector3(x, sy, z);
    this.sprQuat = new THREE.Quaternion();
    this.sprMatrix = new THREE.Matrix4();
    this.sprVel = new THREE.Vector3();
    this.prevVel = new THREE.Vector3();
    this.trolleyPos = new THREE.Vector3(x, DIM.RAIL_Y, z);
    this.sync();
  }

  _setRope(len) {
    if (Math.abs(len - this._appliedRope) < 1e-5) return;
    this._appliedRope = len;
    for (const j of this.joints) j.rawSet.jointSetLimits(j.handle, 0, 0, len);
  }

  /** Mean distance between cable anchors (how much cable is actually "used"). */
  anchorDistance() {
    const t = this.trolleyBody.translation();
    const s = this.sprBody.translation();
    const r = this.sprBody.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    let sum = 0;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        _v.set(sx * ROPE.X, ROPE.SPR_Y, sz * ROPE.Z).applyQuaternion(_q);
        const dx = s.x + _v.x - (t.x + sx * ROPE.X);
        const dy = s.y + _v.y - (t.y + ROPE.TOP_Y);
        const dz = s.z + _v.z - (t.z + sz * ROPE.Z);
        sum += Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
    }
    return sum / 4;
  }

  /**
   * @param h    fixed step
   * @param ctl  { x, z, hoist } each -1..1
   * @param env  { wind: {x,z} acceleration on a standard box, assist: {x,z} acceleration }
   */
  fixedUpdate(h, ctl, env) {
    const m = this.mods;
    if (this.frozen) ctl = { x: 0, z: 0, hoist: 0 };

    // --- trolley (X) with soft end stops
    const maxVx = TUNE.trolleySpeed * m.trolley;
    let tx = ctl.x * maxVx;
    const edge = 2.2;
    if (tx > 0) tx *= clamp((DIM.TROLLEY_MAX_X - this.x) / edge, 0, 1);
    if (tx < 0) tx *= clamp((this.x - DIM.TROLLEY_MIN_X) / edge, 0, 1);
    this.vx = approach(this.vx, tx, TUNE.trolleyAccel * m.trolley * h);
    this.x = clamp(this.x + this.vx * h, DIM.TROLLEY_MIN_X, DIM.TROLLEY_MAX_X);

    // --- gantry (Z)
    const maxVz = TUNE.gantrySpeed * m.gantry;
    let tz = ctl.z * maxVz;
    if (tz > 0) tz *= clamp((DIM.GANTRY_RANGE - this.z) / edge, 0, 1);
    if (tz < 0) tz *= clamp((this.z + DIM.GANTRY_RANGE) / edge, 0, 1);
    this.vz = approach(this.vz, tz, TUNE.gantryAccel * m.gantry * h);
    this.z = clamp(this.z + this.vz * h, -DIM.GANTRY_RANGE, DIM.GANTRY_RANGE);

    this.trolleyBody.setNextKinematicTranslation({ x: this.x, y: DIM.RAIL_Y, z: this.z });

    // --- hoist: positive input = up = shorter cable
    const maxVr = TUNE.hoistSpeed * m.hoist;
    const target = -ctl.hoist * maxVr;
    this.vr = approach(this.vr, target, TUNE.hoistAccel * h);
    let len = this.rope + this.vr * h;
    const used = this.anchorDistance();
    this.slack = Math.max(0, this.rope - used);
    if (this.vr > 0 && len > used + SLACK) {
      // load is resting on something: stop paying out cable instead of piling slack on top of it
      len = Math.max(this.rope, used + SLACK);
      if (len <= this.rope + 1e-4) this.vr = 0;
    }
    len = clamp(len, DIM.ROPE_MIN, DIM.ROPE_MAX);
    if (len === DIM.ROPE_MIN || len === DIM.ROPE_MAX) this.vr = 0;
    this.rope = len;
    this._setRope(len);
    this.tension = this.slack < 0.04 ? 1 : 0;

    // --- forces on the hanging load
    const spr = this.sprBody;
    spr.resetForces(true);
    spr.resetTorques(true);
    const mass = spr.mass();
    const v = spr.linvel();
    const damp = m.sway * (this.tension ? 1 : 0.2);
    let fx = -damp * mass * (v.x - this.vx);
    let fz = -damp * mass * (v.z - this.vz);
    if (env) {
      // wind acts on area, not mass: an empty spreader catches little, a box catches a lot
      const area = this.carry ? MASS_UNIT * 1.0 : MASS_UNIT * 0.3;
      if (env.wind) {
        fx += env.wind.x * area;
        fz += env.wind.z * area;
      }
      if (env.assist) {
        fx += env.assist.x * mass;
        fz += env.assist.z * mass;
      }
    }
    spr.addForce({ x: fx, y: 0, z: fz }, true);
    // keep the spreader square to the quay (the four falls resist yaw; this adds a little authority)
    const r = spr.rotation();
    const yaw = Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x));
    const w = spr.angvel();
    const inertiaGuess = mass * 3.2;
    spr.addTorque({ x: 0, y: (-yaw * 9 - w.y * 2.2) * inertiaGuess, z: 0 }, true);
  }

  /** Call after the physics step: refresh cached transforms / velocities. */
  sync() {
    const t = this.sprBody.translation();
    const r = this.sprBody.rotation();
    const v = this.sprBody.linvel();
    this.prevVel.copy(this.sprVel);
    this.sprVel.set(v.x, v.y, v.z);
    this.sprPos.set(t.x, t.y, t.z);
    this.sprQuat.set(r.x, r.y, r.z, r.w);
    this.sprMatrix.compose(this.sprPos, this.sprQuat, _v.set(1, 1, 1));
    const tt = this.trolleyBody.translation();
    this.trolleyPos.set(tt.x, tt.y, tt.z);
  }

  /** Bottom-centre of whatever hangs lowest (spreader, or the carried box). World space. */
  bottomWorld(out = new THREE.Vector3()) {
    const drop = DIM.SPR_H / 2 + (this.carry ? this.carry.hy * 2 + 0.03 : 0);
    return out.set(0, -drop, 0).applyMatrix4(this.sprMatrix);
  }

  carryOffsetY() {
    return -(DIM.SPR_H / 2 + this.carry.hy + 0.03);
  }

  /** Merge a container into the spreader body. */
  attach(cargo) {
    this.carry = cargo;
    const vol = cargo.hx * 2 * cargo.hy * 2 * cargo.hz * 2;
    this.carryCollider = this.phys.box(cargo.hx, cargo.hy, cargo.hz, {
      body: this.sprBody,
      y: -(DIM.SPR_H / 2 + cargo.hy + 0.03),
      density: (cargo.mass * MASS_UNIT) / vol,
      friction: 0.72,
      restitution: 0.03,
      groups: GROUPS.load,
      events: true,
      eventThreshold: 40,
      tag: { kind: 'cargo', cargo, carried: true },
    });
    return this.carryCollider;
  }

  /** Split the container off again. Returns its world pose and velocity. */
  detach() {
    const cargo = this.carry;
    if (!cargo) return null;
    const spr = this.sprBody;
    const t = spr.translation();
    const r = spr.rotation();
    const lv = spr.linvel();
    const av = spr.angvel();
    _q.set(r.x, r.y, r.z, r.w);
    _v.set(0, -(DIM.SPR_H / 2 + cargo.hy + 0.03), 0).applyQuaternion(_q);
    const pose = {
      pos: { x: t.x + _v.x, y: t.y + _v.y, z: t.z + _v.z },
      rot: { x: r.x, y: r.y, z: r.z, w: r.w },
      // v + w x r
      linvel: { x: lv.x + (av.y * _v.z - av.z * _v.y), y: lv.y + (av.z * _v.x - av.x * _v.z), z: lv.z + (av.x * _v.y - av.y * _v.x) },
      angvel: { x: av.x, y: av.y, z: av.z },
    };
    this.phys.removeCollider(this.carryCollider);
    this.carryCollider = null;
    this.carry = null;
    return pose;
  }

  /** Hard reset (level start / retry). */
  reset(x, z, rope) {
    this.x = x;
    this.z = z;
    this.vx = this.vz = this.vr = 0;
    this.rope = rope;
    this._setRope(rope);
    this.trolleyBody.setTranslation({ x, y: DIM.RAIL_Y, z }, true);
    const sy = DIM.RAIL_Y + ROPE.TOP_Y - rope - ROPE.SPR_Y;
    this.sprBody.setTranslation({ x, y: sy, z }, true);
    this.sprBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.sprBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.sprBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.sync();
    this.sprVel.set(0, 0, 0);
    this.prevVel.set(0, 0, 0);
  }

  dispose() {
    this.phys.removeBody(this.sprBody);
    this.phys.removeBody(this.trolleyBody);
  }
}
