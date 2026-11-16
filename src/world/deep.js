// The light under the pier: a large, slow glow that moves beneath the surface. Nobody on the
// quay has ever seen what makes it. Purely visual — the session never knows it is there.
import * as THREE from 'three';
import { glowTexture } from './vox.js';
import { clamp } from '../core/util.js';

const COLOR = 0x45ffc8;

export class DeepLight {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    const tex = glowTexture();
    const disc = (size, opacity) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: tex, color: COLOR, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
      );
      m.rotation.x = -Math.PI / 2;
      m.scale.set(size, size * 1.9, 1);
      m.renderOrder = 3;
      m.userData.base = opacity;
      this.group.add(m);
      return m;
    };
    // a long body and a brighter head, with a few motes trailing behind
    this.body = disc(15, 0.5);
    this.head = disc(7, 0.8);
    this.motes = [];
    for (let i = 0; i < 5; i++) {
      const m = disc(1.6 + (i % 3) * 0.7, 0.5);
      m.scale.y = m.scale.x;
      this.motes.push(m);
    }
    this.pos = new THREE.Vector3(12, 0.32, -90);
    this.level = 0; // 0..1 brightness
    this.target = 0;
    this.mode = 'idle'; // idle | pass | linger | bloom
    this.t = 0;
    this.speed = 8;
    this.center = new THREE.Vector3();
    this.radius = 6;
  }

  /** Swim past the berth on the seaward side of the ship, bow to stern. */
  pass(x = 14, speed = 9) {
    this.mode = 'pass';
    this.pos.set(x, 0.32, -78);
    this.speed = speed;
    this.target = 1;
    this.group.visible = true;
  }

  /** Rise where something has just gone into the water, circle once or twice, then sink away. */
  bloom(x, z, strength = 1) {
    this.mode = 'bloom';
    this.center.set(Math.max(4, x), 0.32, z);
    this.pos.copy(this.center);
    this.t = 0;
    this.strength = strength;
    this.target = 1;
    this.level = Math.max(this.level, 0.5);
    this.group.visible = true;
  }

  /** Whether (and how strongly) the sea should pick up its colour this frame. */
  get glow() {
    return this.group.visible ? this.level : 0;
  }

  update(dt, time) {
    if (!this.group.visible) return;
    this.t += dt;
    if (this.mode === 'pass') {
      this.pos.z += this.speed * dt;
      this.pos.x += Math.sin(time * 0.7) * dt * 1.2;
      if (this.pos.z > 70) this.target = 0;
    } else if (this.mode === 'bloom') {
      const a = this.t * 0.75;
      const r = Math.min(this.radius, this.t * 1.4);
      this.pos.set(this.center.x + Math.cos(a) * r, 0.32, this.center.z + Math.sin(a) * r * 1.6);
      if (this.t > 9 * (this.strength || 1)) {
        // heads out to sea
        this.mode = 'pass';
        this.speed = 11;
        this.target = 1;
      }
    }
    this.level += (this.target - this.level) * Math.min(1, dt * (this.target ? 0.9 : 0.6));
    if (this.target === 0 && this.level < 0.02) {
      this.group.visible = false;
      this.mode = 'idle';
      return;
    }
    const pulse = 0.78 + 0.22 * Math.sin(time * 2.1);
    const k = clamp(this.level, 0, 1) * pulse;
    this.body.position.set(this.pos.x, this.pos.y, this.pos.z - 4);
    this.head.position.set(this.pos.x + Math.sin(time * 1.3) * 0.6, this.pos.y + 0.02, this.pos.z + 3);
    this.body.material.opacity = this.body.userData.base * k;
    this.head.material.opacity = this.head.userData.base * k;
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i];
      const ph = time * (0.5 + i * 0.13) + i * 2.1;
      m.position.set(this.pos.x + Math.sin(ph) * (3.5 + i), this.pos.y + 0.03, this.pos.z - 9 - i * 2.6 + Math.cos(ph * 0.8) * 2);
      m.material.opacity = m.userData.base * k * (0.5 + 0.5 * Math.sin(ph * 2.3));
    }
  }
}
