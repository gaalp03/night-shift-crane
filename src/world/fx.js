// Voxel-style particles: little cubes for spray, sparks, dust, debris and smoke, plus water rings.
import * as THREE from 'three';
import { rand, clamp, lerp } from '../core/util.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

class Pool {
  constructor(scene, material, capacity) {
    this.cap = capacity;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _c.setRGB(1, 1, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
    this.items = [];
  }
  spawn(p) {
    if (this.items.length >= this.cap) this.items.shift();
    this.items.push(p);
  }
  update(dt, waterY) {
    const it = this.items;
    let n = 0;
    for (let i = 0; i < it.length; i++) {
      const p = it[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vy += p.g * dt;
      const dr = Math.max(0, 1 - p.drag * dt);
      p.vx *= dr;
      p.vy *= p.g < 0 ? 1 : dr;
      p.vz *= dr;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.floor != null && p.y < p.floor) {
        p.y = p.floor;
        p.vy = -p.vy * p.bounce;
        p.vx *= 0.6;
        p.vz *= 0.6;
        if (Math.abs(p.vy) < 0.6) p.vy = 0;
      }
      p.rx += p.wx * dt;
      p.ry += p.wy * dt;
      const k = p.age / p.life;
      let s = p.size;
      if (p.grow) s *= 1 + p.grow * k;
      s *= p.shrink ? 1 - k * k : k > 0.8 ? (1 - k) / 0.2 : 1;
      _q.setFromEuler(_e.set(p.rx, p.ry, 0));
      _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(s, s * (p.tall || 1), s));
      this.mesh.setMatrixAt(n, _m);
      if (p.c2) _c.copy(p.c).lerp(p.c2, k);
      else _c.copy(p.c);
      if (p.fade) _c.multiplyScalar(1 - k);
      this.mesh.setColorAt(n, _c);
      it[n++] = p;
    }
    it.length = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

export class Fx {
  constructor(scene, { budget = 1, mobile = false } = {}) {
    this.scene = scene;
    this.budget = budget;
    this.lit = new Pool(scene, new THREE.MeshLambertMaterial(), mobile ? 260 : 520);
    const glowMat = new THREE.MeshBasicMaterial({ fog: false });
    glowMat.color.setScalar(mobile ? 1.5 : 2.4);
    this.glow = new Pool(scene, glowMat, mobile ? 160 : 320);
    // water rings
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.82, 1, 28);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({ color: 0xbfe0e6, transparent: true, opacity: 0, depthWrite: false, fog: true })
      );
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
      this.rings.push({ m, age: 0, life: 0, size: 1 });
    }
    this.ringIdx = 0;
  }

  _n(count) {
    return Math.max(1, Math.round(count * this.budget));
  }

  _mk(pool, x, y, z, vx, vy, vz, o) {
    pool.spawn({
      x,
      y,
      z,
      vx,
      vy,
      vz,
      age: 0,
      life: o.life,
      size: o.size,
      g: o.g == null ? -24 : o.g,
      drag: o.drag || 0,
      c: new THREE.Color(o.color),
      c2: o.color2 != null ? new THREE.Color(o.color2) : null,
      fade: !!o.fade,
      shrink: o.shrink !== false,
      grow: o.grow || 0,
      floor: o.floor,
      bounce: o.bounce || 0.3,
      tall: o.tall,
      rx: rand(6),
      ry: rand(6),
      wx: o.spin == null ? rand(-6, 6) : rand(-o.spin, o.spin),
      wy: o.spin == null ? rand(-6, 6) : rand(-o.spin, o.spin),
    });
  }

  ring(x, y, z, size, life = 1.4) {
    const r = this.rings[this.ringIdx++ % this.rings.length];
    r.m.position.set(x, y + 0.08, z);
    r.age = 0;
    r.life = life;
    r.size = size;
    r.m.visible = true;
  }

  /** Column of spray + crown + expanding rings. power ~ 0.3 (plop) .. 2 (container). */
  splash(x, z, power = 1, waterY = 0) {
    const n = this._n(26 + power * 46);
    for (let i = 0; i < n; i++) {
      const a = rand(Math.PI * 2);
      const crown = i % 3 !== 0;
      const sp = crown ? rand(2.5, 6.5) * (0.6 + power * 0.5) : rand(0.3, 1.6);
      const up = crown ? rand(5, 11) * (0.6 + power * 0.45) : rand(11, 19) * (0.5 + power * 0.4);
      this._mk(this.lit, x + Math.cos(a) * rand(1.2) * power, waterY + 0.1, z + Math.sin(a) * rand(2.2) * power, Math.cos(a) * sp, up, Math.sin(a) * sp, {
        life: rand(0.9, 1.9),
        size: rand(0.14, 0.42) * (0.7 + power * 0.3),
        color: i % 4 === 0 ? 0xe8f4f4 : 0x9cc6cc,
        color2: 0x2f5560,
        g: -22,
      });
    }
    this.ring(x, waterY, z, 3 + power * 4, 1.6);
    setTimeout(() => this.ring(x, waterY, z, 5 + power * 6, 2.2), 180);
    setTimeout(() => this.ring(x, waterY, z, 7 + power * 8, 2.8), 420);
  }

  /** Hot metal sparks. dir optional {x,y,z}. */
  sparks(x, y, z, count = 14, dir = null, speed = 9) {
    const n = this._n(count);
    for (let i = 0; i < n; i++) {
      const a = rand(Math.PI * 2);
      const e = rand(-0.3, 1.1);
      let vx = Math.cos(a) * Math.cos(e);
      let vy = Math.sin(e) + 0.25;
      let vz = Math.sin(a) * Math.cos(e);
      if (dir) {
        vx += dir.x * 1.2;
        vy += dir.y * 1.2;
        vz += dir.z * 1.2;
      }
      const s = rand(0.4, 1) * speed;
      this._mk(this.glow, x, y, z, vx * s, vy * s, vz * s, {
        life: rand(0.25, 0.7),
        size: rand(0.05, 0.12),
        color: 0xfff0b0,
        color2: 0xff5a10,
        fade: true,
        g: -20,
        tall: 2.2,
      });
    }
  }

  dust(x, y, z, count = 10, color = 0x8a8f92, spread = 2.5) {
    const n = this._n(count);
    for (let i = 0; i < n; i++) {
      const a = rand(Math.PI * 2);
      const sp = rand(0.6, 1) * spread;
      this._mk(this.lit, x + Math.cos(a) * rand(0.8), y + rand(0.3), z + Math.sin(a) * rand(1.6), Math.cos(a) * sp, rand(0.4, 1.6), Math.sin(a) * sp, {
        life: rand(0.5, 1.1),
        size: rand(0.18, 0.4),
        color,
        g: 0.6,
        drag: 2.6,
        grow: 0.9,
        spin: 1.5,
      });
    }
  }

  /** Chunky debris that bounces on `floor`. */
  debris(x, y, z, count, colors, floor, speed = 7) {
    const n = this._n(count);
    for (let i = 0; i < n; i++) {
      const a = rand(Math.PI * 2);
      const s = rand(0.3, 1) * speed;
      this._mk(this.lit, x + rand(-1, 1), y + rand(-0.8, 0.8), z + rand(-2, 2), Math.cos(a) * s, rand(3, 9), Math.sin(a) * s, {
        life: rand(1.2, 2.4),
        size: rand(0.12, 0.34),
        color: colors[i % colors.length],
        floor,
        bounce: 0.4,
      });
    }
  }

  glassBurst(x, y, z) {
    this.debris(x, y, z, 30, [0xcfeaff, 0xf1ecdd, 0x8fd0ff, 0xffffff], undefined, 8);
    this.sparks(x, y, z, 10, null, 6);
  }

  explosion(x, y, z) {
    const n = this._n(46);
    for (let i = 0; i < n; i++) {
      const a = rand(Math.PI * 2);
      const e = rand(-0.2, 1.3);
      const s = rand(5, 17);
      this._mk(this.glow, x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s, {
        life: rand(0.4, 1.0),
        size: rand(0.25, 0.7),
        color: 0xfff2c0,
        color2: 0xff3a10,
        fade: true,
        g: -6,
        drag: 1.4,
      });
    }
    for (let i = 0; i < this._n(26); i++) {
      this._mk(this.lit, x + rand(-1.5, 1.5), y + rand(0, 1.5), z + rand(-2.5, 2.5), rand(-2, 2), rand(2, 6), rand(-2, 2), {
        life: rand(1.4, 2.6),
        size: rand(0.5, 1.1),
        color: 0x2a2a2c,
        color2: 0x0c0c0d,
        g: 1.4,
        drag: 0.9,
        grow: 1.6,
        spin: 1,
      });
    }
  }

  /** One soft smoke puff (funnels, exhausts). */
  puff(x, y, z, size = 0.6, color = 0x565c62, rise = 1.6, windX = 0, windZ = 0) {
    this._mk(this.lit, x + rand(-0.2, 0.2), y, z + rand(-0.2, 0.2), windX + rand(-0.2, 0.2), rise, windZ + rand(-0.2, 0.2), {
      life: rand(2.4, 3.6),
      size,
      color,
      color2: 0x15191d,
      g: 0.1,
      drag: 0.25,
      grow: 2.2,
      spin: 0.7,
    });
  }

  /** Sparkle pop used for PERFECT placements. */
  confetti(x, y, z, colors, count = 22) {
    const n = this._n(count);
    for (let i = 0; i < n; i++) {
      const a = rand(Math.PI * 2);
      const s = rand(2, 6.5);
      this._mk(this.glow, x + rand(-1, 1), y, z + rand(-2.5, 2.5), Math.cos(a) * s, rand(4, 10), Math.sin(a) * s, {
        life: rand(0.6, 1.3),
        size: rand(0.08, 0.2),
        color: colors[i % colors.length],
        fade: true,
        g: -16,
        drag: 0.8,
      });
    }
  }

  update(dt) {
    this.lit.update(dt);
    this.glow.update(dt);
    for (const r of this.rings) {
      if (!r.m.visible) continue;
      r.age += dt;
      const k = r.age / r.life;
      if (k >= 1) {
        r.m.visible = false;
        continue;
      }
      const s = lerp(0.4, r.size, 1 - Math.pow(1 - k, 2));
      r.m.scale.set(s, 1, s);
      r.m.material.opacity = clamp((1 - k) * 0.5, 0, 1);
    }
  }
}
