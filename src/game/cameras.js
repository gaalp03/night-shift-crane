// Camera director: third-person chase view, crane-cab (top-down) view, cinematic shots, shake.
import * as THREE from 'three';
import { DIM } from '../config.js';
import { clamp, damp, ease, lerp, noise1 } from '../core/util.js';

const _f = new THREE.Vector3();
const _p = new THREE.Vector3();
const _l = new THREE.Vector3();
const _off = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase'; // chase | cab | cine | menu | free
    this.focus = new THREE.Vector3(0, 8, 0);
    this.pos = new THREE.Vector3(-6, 20, 34);
    this.look = new THREE.Vector3(0, 8, 0);
    this.up = new THREE.Vector3(0, 1, 0);
    this.fov = 42;
    this.yaw = 0; // user orbit offset (radians)
    this.pitch = 0;
    this.zoom = 1;
    this.trauma = 0;
    this.shakeEnabled = true;
    this.t = 0;
    this.blend = 1; // 0..1 blend from the previous pose after a mode switch
    this.from = { pos: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fov: 42 };
    this.shots = null;
    this.menuAngle = 0.4;
    this.kick = new THREE.Vector3();
  }

  shake(amount) {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  /** Small directional nudge (impacts) that springs back. */
  punch(x, y, z) {
    this.kick.x += x;
    this.kick.y += y;
    this.kick.z += z;
  }

  setMode(mode, blendTime = 0.7) {
    if (mode === this.mode) return;
    this.from.pos.copy(this.pos);
    this.from.look.copy(this.look);
    this.from.up.copy(this.up);
    this.from.fov = this.fov;
    this.blend = blendTime > 0 ? 0 : 1;
    this.blendTime = blendTime;
    this.mode = mode;
    if (mode !== 'cine') this.shots = null;
  }

  /**
   * Play cinematic shots: [{ p0:[x,y,z], l0:[x,y,z], p1, l1, fov, dur, easing }]
   * Resolves when finished or skipped.
   */
  playShots(shots, { onCut } = {}) {
    this.setMode('cine', 0);
    return new Promise((resolve) => {
      this.shots = { list: shots, i: 0, t: 0, resolve, onCut };
      if (onCut) onCut(0, shots[0]);
    });
  }

  skipShots() {
    if (!this.shots) return;
    const r = this.shots.resolve;
    this.shots = null;
    r(true);
  }

  _chase(dt, ctx) {
    const rig = ctx.rig;
    const aspect = this.camera.aspect;
    const portrait = aspect < 1;
    // look at a point between the load and whatever is under it
    const loadY = rig.sprPos.y - (rig.carry ? 1.6 : 0.3);
    const groundY = ctx.groundY != null ? ctx.groundY : DIM.QUAY_Y;
    _f.set(rig.sprPos.x * 0.86 + rig.x * 0.14, lerp(loadY, groundY, 0.42) + 1.2, rig.sprPos.z * 0.5 + rig.z * 0.5);
    this.focus.x = damp(this.focus.x, _f.x, 3.2, dt);
    this.focus.y = damp(this.focus.y, _f.y, 2.2, dt);
    this.focus.z = damp(this.focus.z, _f.z, 3.0, dt);
    const drop = clamp((DIM.RAIL_Y - rig.sprPos.y - 6) / 16, 0, 1);
    let dist = lerp(39, 44, 1 - drop) * this.zoom;
    let fov = 42;
    if (portrait) {
      dist *= 1.0 + (1 - aspect) * 0.9;
      fov = 58;
    } else if (aspect < 1.5) {
      dist *= 1.0 + (1.5 - aspect) * 0.5;
    }
    const baseYaw = 0.16 + this.yaw; // a touch from seaward: quay on the left, ship in front
    const basePitch = clamp(0.5 + this.pitch, 0.18, 1.15);
    _off.set(Math.sin(baseYaw) * Math.cos(basePitch), Math.sin(basePitch), Math.cos(baseYaw) * Math.cos(basePitch)).multiplyScalar(dist);
    _p.copy(this.focus).add(_off);
    _p.y = Math.max(_p.y, DIM.QUAY_Y + 2.5);
    return { pos: _p, look: this.focus, up: UP, fov };
  }

  _cab(dt, ctx) {
    const rig = ctx.rig;
    // operator's glass floor: straight down, screen-up = away from the default camera (-Z)
    _p.set(rig.x, DIM.RAIL_Y - 1.2, rig.z + 0.01);
    _l.set(rig.sprPos.x * 0.5 + rig.x * 0.5, rig.sprPos.y - 8, rig.sprPos.z * 0.5 + rig.z * 0.5);
    this.focus.copy(_l);
    const aspect = this.camera.aspect;
    const fov = aspect < 1 ? 74 : 60;
    return { pos: _p, look: _l, up: _f.set(0, 0, -1), fov };
  }

  _menu(dt) {
    this.menuAngle += dt * 0.035;
    const a = this.menuAngle;
    const r = 54;
    _p.set(6 + Math.sin(a) * r * 0.8, 15 + Math.sin(a * 0.7) * 4, 8 + Math.cos(a) * r);
    _l.set(1, 11, -4);
    const aspect = this.camera.aspect;
    return { pos: _p, look: _l, up: UP, fov: aspect < 1 ? 64 : 46 };
  }

  update(dt, ctx) {
    this.t += dt;
    let pose;
    if (this.mode === 'cine' && this.shots) {
      const s = this.shots;
      const sh = s.list[s.i];
      s.t += dt;
      const k = clamp(s.t / sh.dur, 0, 1);
      const e = (sh.easing || ease.inOutSine)(k);
      _p.set(lerp(sh.p0[0], sh.p1[0], e), lerp(sh.p0[1], sh.p1[1], e), lerp(sh.p0[2], sh.p1[2], e));
      _l.set(lerp(sh.l0[0], sh.l1[0], e), lerp(sh.l0[1], sh.l1[1], e), lerp(sh.l0[2], sh.l1[2], e));
      pose = { pos: _p, look: _l, up: UP, fov: sh.fov || 40 };
      if (k >= 1) {
        s.i++;
        s.t = 0;
        if (s.i >= s.list.length) {
          const r = s.resolve;
          this.shots = null;
          r(false);
        } else if (s.onCut) s.onCut(s.i, s.list[s.i]);
      }
    } else if (this.mode === 'cab' && ctx && ctx.rig) pose = this._cab(dt, ctx);
    else if (this.mode === 'chase' && ctx && ctx.rig) pose = this._chase(dt, ctx);
    else if (this.mode === 'free') pose = { pos: this.pos, look: this.look, up: this.up, fov: this.fov };
    else pose = this._menu(dt);

    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / (this.blendTime || 0.7));
      const e = ease.inOutCubic(this.blend);
      this.pos.lerpVectors(this.from.pos, pose.pos, e);
      this.look.lerpVectors(this.from.look, pose.look, e);
      this.up.lerpVectors(this.from.up, pose.up, e).normalize();
      this.fov = lerp(this.from.fov, pose.fov, e);
    } else {
      this.pos.copy(pose.pos);
      this.look.copy(pose.look);
      this.up.copy(pose.up);
      this.fov = pose.fov;
    }

    const cam = this.camera;
    cam.position.copy(this.pos);
    cam.up.copy(this.up);
    // spring-back punch
    this.kick.multiplyScalar(Math.max(0, 1 - dt * 9));
    cam.position.add(this.kick);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    cam.lookAt(this.look);
    // trauma shake: smooth noise, squared falloff
    if (this.trauma > 0) {
      const s = this.shakeEnabled ? this.trauma * this.trauma : 0;
      const tt = this.t * 34;
      cam.position.x += noise1(tt) * 0.5 * s;
      cam.position.y += noise1(tt + 31.7) * 0.5 * s;
      cam.rotation.z += noise1(tt + 77.1) * 0.03 * s;
      cam.rotation.x += noise1(tt + 13.3) * 0.016 * s;
      this.trauma = Math.max(0, this.trauma - dt * 1.5);
    }
    cam.updateMatrixWorld();
  }
}
