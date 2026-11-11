// Terminal tractors with flatbed trailers that deliver / collect containers on the quay lanes.
import * as THREE from 'three';
import { Vox, MAT, glowSprite, lightCone } from './vox.js';
import { DIM } from '../config.js';
import { clamp, damp } from '../core/util.js';

const CAB_COLORS = [0xe2ddd0, 0xe8a61c, 0x34609f, 0xc23d2b, 0x2c8f85];
const SPAWN_Z = -74;
const EXIT_Z = 86;

let geoCache = null;
function truckGeometry(cabColor) {
  const v = new Vox();
  const g = new Vox();
  g.shade = false;
  const dark = 0x1c2125;
  const bed = DIM.TRAILER_Y;
  // trailer: skeletal chassis with twist-lock pads
  v.box(0, bed - 0.12, -0.1, 2.3, 0.22, 7.0, 0x3a4248);
  v.box(0, bed - 0.38, -0.1, 0.7, 0.3, 7.2, dark);
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) v.box(sx * 1.05, bed + 0.03, -0.1 + sz * 2.85, 0.3, 0.1, 0.3, 0xe8b21e);
  for (const z of [-2.9, -1.8]) for (const sx of [-1, 1]) v.cyl(sx * 1.05, 0.48, z, 0.48, 0.4, 0x0e1012, 10, 1, [0, 0, Math.PI / 2]);
  v.box(0, 0.75, -3.75, 2.3, 0.5, 0.14, 0xc23d2b);
  // tractor
  const cz = 4.75;
  v.box(0, 0.78, cz - 0.2, 2.2, 0.5, 3.0, dark);
  v.box(-0.35, 1.95, cz + 0.3, 1.5, 1.8, 1.7, cabColor);
  v.box(-0.35, 2.92, cz + 0.3, 1.6, 0.14, 1.8, dark);
  v.box(0.75, 1.5, cz + 0.2, 0.6, 0.9, 1.4, 0x3a4248); // engine cover
  v.cyl(0.95, 2.6, cz - 0.55, 0.09, 1.9, 0x8a949b, 6); // exhaust
  for (const z of [cz - 1.1, cz + 0.9]) for (const sx of [-1, 1]) v.cyl(sx * 1.05, 0.5, z, 0.5, 0.42, 0x0e1012, 10, 1, [0, 0, Math.PI / 2]);
  v.box(0, 0.62, cz + 1.4, 2.3, 0.3, 0.2, 0x8a949b); // bumper
  // glass + lights
  g.box(-0.35, 2.25, cz + 1.16, 1.3, 0.8, 0.04, 0x7fb8d8, null, 0.25);
  g.box(-0.75, 0.95, cz + 1.42, 0.34, 0.2, 0.06, 0xfff2d0);
  g.box(0.75, 0.95, cz + 1.42, 0.34, 0.2, 0.06, 0xfff2d0);
  g.box(-0.9, 0.78, -3.83, 0.3, 0.16, 0.04, 0xff2a1e, null, 0.6);
  g.box(0.9, 0.78, -3.83, 0.3, 0.16, 0.04, 0xff2a1e, null, 0.6);
  return { body: v.build(), glow: g.build() };
}

export class Truck {
  /**
   * @param opts { laneX, stopZ, color, purpose: 'deliver' | 'collect' }
   */
  constructor(scene, phys, opts) {
    this.scene = scene;
    this.phys = phys;
    this.laneX = opts.laneX;
    this.stopZ = opts.stopZ;
    this.purpose = opts.purpose || 'deliver';
    this.state = 'in'; // in | wait | out | gone
    this.z = opts.startZ != null ? opts.startZ : SPAWN_Z;
    this.speed = 0;
    this.cargo = null;
    this.body = null;
    this.waitT = 0;
    this.leaveDelay = 0;
    this.honked = false;
    this.bounce = 0;
    this.bounceV = 0;
    this.id = Truck._n = (Truck._n || 0) + 1;

    const col = CAB_COLORS[(opts.color || 0) % CAB_COLORS.length];
    geoCache = geoCache || new Map();
    if (!geoCache.has(col)) geoCache.set(col, truckGeometry(col));
    const geo = geoCache.get(col);
    this.group = new THREE.Group();
    const m = new THREE.Mesh(geo.body, MAT.vox);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    const gm = new THREE.Mesh(geo.glow, MAT.glow);
    this.group.add(gm);
    // headlight throw + amber roof beacon
    const cone = lightCone(0xfff2d0, 3.4, 15, 0.1);
    cone.rotation.x = -Math.PI / 2 + 0.12;
    cone.position.set(0, 0.95, 6.2);
    this.group.add(cone);
    const h1 = glowSprite(0xfff2d0, 2.4, 0.9);
    h1.position.set(0, 0.95, 6.3);
    this.group.add(h1);
    this.beacon = glowSprite(0xffa020, 1.6, 1);
    this.beacon.position.set(-0.35, 3.1, 5.05);
    this.group.add(this.beacon);
    this.group.position.set(this.laneX, DIM.QUAY_Y, this.z);
    scene.add(this.group);
  }

  /** World-space centre for a container sitting on the bed. */
  bedCenter(hy, out = new THREE.Vector3()) {
    return out.set(this.laneX, DIM.QUAY_Y + DIM.TRAILER_Y + hy + 0.02, this.z);
  }

  /** Put a container on the bed as pure scenery (no physics until parked). */
  load(cargo) {
    this.cargo = cargo;
    cargo.truck = this;
    cargo.state = 'truck';
    this.group.add(cargo.mesh);
    cargo.mesh.position.set(0, DIM.TRAILER_Y + cargo.hy + 0.02, 0);
    cargo.mesh.quaternion.identity();
  }

  _park() {
    this.state = 'wait';
    this.speed = 0;
    this.body = this.phys.fixedBody(this.laneX, DIM.QUAY_Y, this.z);
    const tag = { kind: 'truck', truck: this };
    this.phys.box(1.15, 0.2, 3.5, { body: this.body, y: DIM.TRAILER_Y - 0.2, z: -0.1, friction: 0.9, tag });
    this.phys.box(1.1, 1.25, 1.45, { body: this.body, x: -0.1, y: 1.6, z: 4.85, tag: { kind: 'truckcab', truck: this } });
    if (this.cargo) this._solidCargo(this.cargo);
    this.bounceV = -1.2;
  }

  _solidCargo(cargo) {
    cargo.collider = this.phys.box(cargo.hx, cargo.hy, cargo.hz, {
      body: this.body,
      y: DIM.TRAILER_Y + cargo.hy + 0.02,
      friction: 0.8,
      tag: { kind: 'cargo', cargo },
    });
  }

  /** Called when the crane lifts the box off: the truck may leave shortly after. */
  release() {
    if (this.cargo) {
      this.phys.removeCollider(this.cargo.collider);
      this.cargo.collider = null;
      this.cargo.truck = null;
      this.cargo = null;
    }
    this.leaveDelay = 1.4;
    this.bounceV = 2.2;
  }

  /** A container was set down on an empty collector truck. */
  accept(cargo) {
    this.cargo = cargo;
    cargo.truck = this;
    cargo.state = 'truck';
    this.group.add(cargo.mesh);
    cargo.mesh.position.set(0, DIM.TRAILER_Y + cargo.hy + 0.02, 0);
    cargo.mesh.quaternion.identity();
    this._solidCargo(cargo);
    this.leaveDelay = 1.6;
    this.bounceV = -3.2;
    this.departing = true;
  }

  depart() {
    if (this.state !== 'wait') return;
    this.state = 'out';
    if (this.body) {
      if (this.cargo) this.cargo.collider = null;
      this.phys.removeBody(this.body);
      this.body = null;
    }
  }

  get parked() {
    return this.state === 'wait';
  }

  update(dt, t) {
    if (this.state === 'gone') return;
    if (this.state === 'in') {
      const dist = this.stopZ - this.z;
      const want = clamp(dist * 1.5, 1.2, 13);
      this.speed = damp(this.speed, want, 3.2, dt);
      this.z += this.speed * dt;
      if (dist < 0.06 || this.z >= this.stopZ) {
        this.z = this.stopZ;
        this._park();
        if (this.onPark) this.onPark(this);
      }
    } else if (this.state === 'wait') {
      this.waitT += dt;
      if (this.leaveDelay > 0) {
        this.leaveDelay -= dt;
        if (this.leaveDelay <= 0) {
          this.depart();
          if (this.onDepart) this.onDepart(this);
        }
      }
    } else if (this.state === 'out') {
      this.speed = Math.min(15, this.speed + 5.5 * dt);
      this.z += this.speed * dt;
      if (this.z > EXIT_Z) {
        this.state = 'gone';
        this.dispose();
        if (this.onGone) this.onGone(this);
        return;
      }
    }
    // suspension bob
    this.bounceV += (-this.bounce * 120 - this.bounceV * 9) * dt;
    this.bounce += this.bounceV * dt;
    const idle = this.state === 'wait' ? Math.sin(t * 31 + this.id) * 0.006 : 0;
    this.group.position.set(this.laneX, DIM.QUAY_Y + this.bounce * 0.05 + idle, this.z);
    this.beacon.material.opacity = (t * 1.7 + this.id * 0.37) % 1 < 0.28 ? 1 : 0.1;
  }

  dispose() {
    if (this.body) {
      this.phys.removeBody(this.body);
      this.body = null;
    }
    if (this.cargo) {
      this.cargo.state = 'gone';
      this.cargo.collider = null;
    }
    this.scene.remove(this.group);
  }
}
