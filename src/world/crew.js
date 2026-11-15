// Harbour life: blocky dock workers who guide, cheer and wince, a patrolling watchman, and the pier cat.
import * as THREE from 'three';
import { MAT, glowSprite, lightCone } from './vox.js';
import { DIM, PAL } from '../config.js';
import { clamp, damp, rand } from '../core/util.js';

const SKIN = [0xd8a47a, 0x9c6b4a, 0xe8c09a, 0x6f4a34];
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const matCache = new Map();
function mat(color, glow) {
  const k = color + (glow ? 'g' : '');
  if (!matCache.has(k)) {
    const m = glow ? new THREE.MeshBasicMaterial({ color, fog: true }) : new THREE.MeshLambertMaterial({ color });
    if (glow) m.color.multiplyScalar(1.3);
    matCache.set(k, m);
  }
  return matCache.get(k);
}

function part(parent, x, y, z, sx, sy, sz, color, glow) {
  const m = new THREE.Mesh(boxGeo, mat(color, glow));
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = !glow;
  parent.add(m);
  return m;
}

/** A limb that swings from its top end. */
function limb(parent, x, y, z, w, len, color) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  parent.add(pivot);
  part(pivot, 0, -len / 2, 0, w, len, w, color);
  return pivot;
}

class Worker {
  constructor(scene, { x, z, vest = PAL.vestOrange, helmet = 0xf1ecdd, skin = 0, role = 'signal', batons = false }) {
    this.role = role;
    this.home = new THREE.Vector3(x, DIM.QUAY_Y, z);
    this.pos = this.home.clone();
    this.group = new THREE.Group();
    this.group.scale.setScalar(1.18);
    scene.add(this.group);
    const g = this.group;
    this.body = new THREE.Group();
    g.add(this.body);
    this.legL = limb(this.body, -0.16, 0.82, 0, 0.26, 0.82, 0x24364a);
    this.legR = limb(this.body, 0.16, 0.82, 0, 0.26, 0.82, 0x24364a);
    this.torso = new THREE.Group();
    this.torso.position.y = 0.82;
    this.body.add(this.torso);
    part(this.torso, 0, 0.38, 0, 0.62, 0.76, 0.36, vest);
    part(this.torso, 0, 0.3, 0, 0.64, 0.08, 0.38, 0xf6f2c8, true);
    part(this.torso, 0, 0.52, 0, 0.64, 0.08, 0.38, 0xf6f2c8, true);
    this.armL = limb(this.torso, -0.42, 0.72, 0, 0.2, 0.7, vest);
    this.armR = limb(this.torso, 0.42, 0.72, 0, 0.2, 0.7, vest);
    this.head = new THREE.Group();
    this.head.position.y = 0.78;
    this.torso.add(this.head);
    part(this.head, 0, 0.2, 0, 0.4, 0.4, 0.4, SKIN[skin % SKIN.length]);
    part(this.head, 0, 0.44, 0, 0.48, 0.16, 0.48, helmet);
    part(this.head, 0, 0.38, 0.22, 0.4, 0.06, 0.16, helmet);
    if (batons) {
      for (const arm of [this.armL, this.armR]) part(arm, 0, -0.86, 0.06, 0.09, 0.4, 0.09, 0xff7a1a, true);
    }
    if (role === 'clerk') part(this.armL, 0.12, -0.66, 0.16, 0.34, 0.04, 0.26, 0xe8e2cf);
    if (role === 'patrol') {
      const cone = lightCone(0xfff0c8, 1.6, 7, 0.16);
      cone.rotation.x = -Math.PI / 2 + 0.5;
      cone.position.set(0, -0.6, 0.15);
      this.armR.add(cone);
      const sp = glowSprite(0xfff0c8, 0.7, 0.9);
      sp.position.set(0, -0.7, 0.15);
      this.armR.add(sp);
    }
    this.facing = 0;
    this.mood = 'idle';
    this.moodT = 0;
    this.phase = rand(10);
    this.walkT = 0;
    this.dir = 1;
    this.dodge = new THREE.Vector3();
    this.group.position.copy(this.pos);
  }

  react(mood, dur = 1.8) {
    this.mood = mood;
    this.moodT = dur;
  }

  update(dt, t, ctx) {
    const p = this.pos;
    let moving = 0;
    if (this.role === 'patrol') {
      // slow beat along the walkway
      this.walkT += dt;
      p.z += this.dir * 1.25 * dt;
      if (p.z > this.home.z + 30) this.dir = -1;
      if (p.z < this.home.z - 30) this.dir = 1;
      moving = 1;
      this.facing = damp(this.facing, this.dir > 0 ? 0 : Math.PI, 3, dt);
    } else if (ctx && ctx.focus) {
      // watch the load
      const want = Math.atan2(ctx.focus.x - p.x, ctx.focus.z - p.z);
      let d = want - this.facing;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.facing += d * Math.min(1, dt * 3);
    }
    // step out from under anything hanging low overhead
    if (ctx && ctx.shadow && this.role !== 'patrol') {
      const dx = p.x + this.dodge.x - ctx.shadow.x;
      const dz = p.z + this.dodge.z - ctx.shadow.z;
      const d = Math.hypot(dx, dz);
      const danger = d < 4.2 && ctx.shadow.h < 14;
      if (danger) {
        const k = (4.6 - d) / (d || 1);
        this.dodge.x = clamp(this.dodge.x + dx * k * dt * 2.2, -5, 5);
        this.dodge.z = clamp(this.dodge.z + dz * k * dt * 2.2, -5, 5);
        moving = 1;
      } else {
        const back = Math.exp(-dt * 0.6);
        if (this.dodge.lengthSq() > 0.01) moving = 0.6;
        this.dodge.multiplyScalar(back);
      }
    }
    const g = this.group;
    g.position.set(p.x + this.dodge.x, p.y, p.z + this.dodge.z);
    g.rotation.y = this.facing;

    // --- pose
    const ph = t * 2 + this.phase;
    let aL = 0;
    let aR = 0;
    let aLz = 0;
    let aRz = 0;
    let legs = 0;
    let hop = 0;
    let lean = 0;
    let headX = 0;
    if (this.moodT > 0) this.moodT -= dt;
    else if (this.mood !== 'idle') this.mood = 'idle';
    const mood = this.mood;
    if (mood === 'cheer') {
      aL = aR = -2.7 + Math.sin(t * 14) * 0.25;
      hop = Math.abs(Math.sin(t * 9)) * 0.28;
    } else if (mood === 'wince') {
      aL = aR = -2.5;
      aLz = 0.75;
      aRz = -0.75;
      lean = 0.16;
      headX = 0.35;
    } else if (mood === 'wave') {
      aR = -2.8;
      aRz = Math.sin(t * 10) * 0.5;
    } else if (mood === 'duck') {
      lean = 0.6;
      aL = aR = -2.2;
      aLz = 0.6;
      aRz = -0.6;
    } else if (this.role === 'signal' && ctx && ctx.carrying) {
      // marshalling: slow alternate beckoning
      aL = -1.9 + Math.sin(ph * 1.4) * 0.5;
      aR = -1.9 + Math.sin(ph * 1.4 + Math.PI) * 0.5;
      aLz = 0.3;
      aRz = -0.3;
    } else if (this.role === 'clerk') {
      aL = -1.15;
      headX = 0.3 + Math.sin(ph * 0.3) * 0.1;
      aR = Math.sin(ph * 0.5) * 0.06;
    } else {
      aL = Math.sin(ph * 0.5) * 0.06;
      aR = -Math.sin(ph * 0.5) * 0.06;
    }
    if (moving > 0.5) {
      legs = Math.sin(t * 7 + this.phase) * 0.55;
      if (mood === 'idle' && this.role === 'patrol') {
        aL = -legs * 0.6;
        aR = -0.9;
      }
    }
    const k = Math.min(1, dt * 12);
    this.armL.rotation.x += (aL - this.armL.rotation.x) * k;
    this.armR.rotation.x += (aR - this.armR.rotation.x) * k;
    this.armL.rotation.z += (aLz - this.armL.rotation.z) * k;
    this.armR.rotation.z += (aRz - this.armR.rotation.z) * k;
    this.legL.rotation.x = legs;
    this.legR.rotation.x = -legs;
    this.torso.rotation.x += (lean - this.torso.rotation.x) * k;
    this.head.rotation.x += (headX - this.head.rotation.x) * k;
    this.body.position.y = hop + Math.sin(ph * 0.8) * 0.012 - (mood === 'duck' ? 0.28 : 0);
  }
}

class Cat {
  constructor(scene, x, y, z) {
    this.group = new THREE.Group();
    this.group.position.set(x, y, z);
    this.group.rotation.y = 1.9;
    scene.add(this.group);
    const g = this.group;
    const fur = 0x2a2a2e;
    part(g, 0, 0.19, 0, 0.26, 0.3, 0.44, fur);
    this.head = new THREE.Group();
    this.head.position.set(0, 0.42, 0.2);
    g.add(this.head);
    part(this.head, 0, 0, 0, 0.26, 0.22, 0.22, fur);
    part(this.head, -0.09, 0.15, 0, 0.07, 0.1, 0.07, fur);
    part(this.head, 0.09, 0.15, 0, 0.07, 0.1, 0.07, fur);
    part(this.head, -0.06, 0.02, 0.115, 0.05, 0.05, 0.02, 0xd8e63a, true);
    part(this.head, 0.06, 0.02, 0.115, 0.05, 0.05, 0.02, 0xd8e63a, true);
    part(g, 0, 0.05, 0.16, 0.24, 0.1, 0.16, 0xe8e2cf);
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.1, -0.22);
    g.add(this.tail);
    part(this.tail, 0, 0.16, -0.05, 0.07, 0.36, 0.07, fur);
    this.baseY = y;
    this.hopV = 0;
    this.hop = 0;
    this.phase = rand(10);
  }
  startle() {
    if (this.hop <= 0.001) this.hopV = 4.2;
  }
  update(dt, t, focus) {
    this.tail.rotation.z = Math.sin(t * 1.3 + this.phase) * 0.5;
    this.tail.rotation.x = -0.4 + Math.sin(t * 0.7) * 0.15;
    if (focus) {
      const want = Math.atan2(focus.x - this.group.position.x, focus.z - this.group.position.z) - this.group.rotation.y;
      this.head.rotation.y += (clamp(want, -1.1, 1.1) - this.head.rotation.y) * Math.min(1, dt * 2);
    }
    if (this.hopV !== 0 || this.hop > 0) {
      this.hopV -= 16 * dt;
      this.hop = Math.max(0, this.hop + this.hopV * dt);
      if (this.hop === 0) this.hopV = 0;
    }
    this.group.position.y = this.baseY + this.hop;
  }
}

export class Crew {
  constructor(scene) {
    this.workers = [
      new Worker(scene, { x: -4.4, z: 5.4, role: 'signal', batons: true, vest: PAL.vestOrange, helmet: 0xf1ecdd, skin: 0 }),
      new Worker(scene, { x: -14.6, z: -5.6, role: 'clerk', vest: PAL.vestYellow, helmet: 0xe8b21e, skin: 1 }),
      new Worker(scene, { x: DIM.LEG_LAND_X - 2.6, z: -6, role: 'patrol', vest: PAL.vestOrange, helmet: 0xc23d2b, skin: 2 }),
    ];
    this.workers[1].facing = 1.2;
    this.cat = new Cat(scene, -21.3, DIM.QUAY_Y + 1.1, 12.4);
  }

  /** mood: cheer | wince | wave | duck */
  react(mood, dur) {
    for (const w of this.workers) if (w.role !== 'patrol' || mood === 'wave') w.react(mood, (dur || 1.8) * rand(0.85, 1.15));
    if (mood === 'wave' || mood === 'duck') this.cat.startle();
  }

  update(dt, t, ctx) {
    for (const w of this.workers) w.update(dt, t, ctx);
    this.cat.update(dt, t, ctx && ctx.focus);
  }
}
