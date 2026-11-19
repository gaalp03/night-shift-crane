// Harbour life: a tug that takes the ship in and out, and gulls that ride the night air
// over the lit water. Pure scenery — nothing here touches the physics or the rules.
import * as THREE from 'three';
import { Vox, MAT, glowSprite, lightCone } from './vox.js';
import { clamp, damp, rand } from '../core/util.js';

const _v = new THREE.Vector3();

// ------------------------------------------------------------------ tug

function tugGeometry() {
  const v = new Vox();
  const g = new Vox();
  g.shade = false;
  const red = 0xa8352a;
  const dark = 0x1a2026;
  // hull: beamy and short, fender belt all the way round
  v.box(0, 0.2, 0, 4.6, 1.6, 11, 0x1c262f);
  v.box(0, 1.15, 0.3, 4.2, 0.4, 10, red);
  v.box(0, 0.95, 5.3, 3.0, 1.0, 1.4, 0x1c262f, [0.25, 0, 0]);
  v.box(0, 1.0, 0, 4.9, 0.5, 11.3, 0x111417); // fender belt
  // deckhouse + wheelhouse with a wide window band
  v.box(0, 2.3, 1.2, 3.2, 1.8, 4.2, 0xd9d5c8);
  v.box(0, 3.65, 1.7, 2.8, 1.1, 2.8, 0xd9d5c8);
  v.box(0, 4.3, 1.7, 3.2, 0.18, 3.2, dark);
  // funnel, mast, towing hook aft
  v.box(0, 3.4, -0.8, 1.0, 1.6, 1.0, red);
  v.box(0, 4.3, -0.8, 1.05, 0.25, 1.05, dark);
  v.box(0, 5.4, 1.7, 0.12, 2.2, 0.12, dark);
  v.box(0, 1.6, -3.6, 0.6, 0.6, 0.6, dark);
  // windows + nav lights (self-lit)
  g.box(0, 3.75, 3.12, 2.4, 0.5, 0.05, 0xffe2b0, null, 0.85);
  for (const sx of [-1, 1]) g.box(sx * 1.42, 3.75, 1.7, 0.05, 0.45, 2.2, 0xffe2b0, null, 0.6);
  g.box(-1.65, 4.45, 2.6, 0.2, 0.2, 0.3, 0xff2a1e); // port: red
  g.box(1.65, 4.45, 2.6, 0.2, 0.2, 0.3, 0x2aff6a); // starboard: green
  g.box(0, 6.55, 1.7, 0.22, 0.22, 0.22, 0xfff2d0); // masthead
  return { body: v.build(), glow: g.build() };
}

export class Tug {
  constructor(scene) {
    const geo = tugGeometry();
    this.group = new THREE.Group();
    const m = new THREE.Mesh(geo.body, MAT.vox);
    m.castShadow = true;
    this.group.add(m);
    this.group.add(new THREE.Mesh(geo.glow, MAT.glow));
    const mast = glowSprite(0xfff2d0, 2.2, 0.9);
    mast.position.set(0, 6.55, 1.7);
    this.group.add(mast);
    // a searchlight raked down onto the water ahead
    const beam = lightCone(0xfff2d0, 3, 22, 0.08);
    beam.rotation.x = -Math.PI / 2 + 0.28;
    beam.position.set(0, 4.5, 3.2);
    this.group.add(beam);
    this.group.visible = false;
    scene.add(this.group);
    // the towline: a sagging run of thin segments
    this.lineMat = new THREE.LineBasicMaterial({ color: 0x8e8a7c, fog: true });
    this.lineGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(13 * 3), 3));
    this.line = new THREE.Line(this.lineGeo, this.lineMat);
    this.line.frustumCulled = false;
    this.line.visible = false;
    scene.add(this.line);
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.t = 0;
    this.k = 0; // 0 = away, 1 = on station
  }

  /**
   * @param ship    the Ship being moved (or null)
   * @param moving  true while the ship is sailing in or out
   */
  update(dt, ship, moving, water) {
    this.t += dt;
    this.k = damp(this.k, moving ? 1 : 0, moving ? 1.5 : 0.6, dt);
    const vis = this.k > 0.02 && ship;
    this.group.visible = this.line.visible = !!vis;
    if (!vis) return;
    const P = ship.pose;
    // on station ahead of the bow, pulling a little seaward
    const bowZ = P.z + ship.zBow;
    const tx = P.x + 5 + Math.sin(this.t * 0.3) * 1.2;
    const tz = bowZ + 18 + (1 - this.k) * 40;
    if (this.pos.lengthSq() === 0) this.pos.set(tx, 0, tz);
    this.pos.x = damp(this.pos.x, tx, 1.2, dt);
    this.pos.z = damp(this.pos.z, tz, 2.5, dt);
    const y = water ? water.heightAt(this.pos.x, this.pos.z) : 0;
    this.group.position.set(this.pos.x, y + 0.1, this.pos.z);
    // nose into the pull, rolling on the swell
    this.group.rotation.set(Math.sin(this.t * 1.1) * 0.03, Math.atan2(this.pos.x - (P.x + 1), 30) * 0.4, Math.sin(this.t * 0.8) * 0.05);
    // line from the towing hook to the bow
    this.group.updateMatrixWorld(true);
    const a = _v.set(0, 1.6, -3.6).applyMatrix4(this.group.matrixWorld);
    const ax = a.x;
    const ay = a.y;
    const az = a.z;
    const bx = P.x;
    const by = P.y + 3.4;
    const bz = bowZ - 0.6;
    const arr = this.lineGeo.attributes.position.array;
    const n = arr.length / 3 - 1;
    const sag = 1.4 + Math.sin(this.t * 0.9) * 0.3;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      arr[i * 3] = ax + (bx - ax) * u;
      arr[i * 3 + 1] = ay + (by - ay) * u - sag * 4 * u * (1 - u);
      arr[i * 3 + 2] = az + (bz - az) * u;
    }
    this.lineGeo.attributes.position.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ gulls

function gullGeometry() {
  // body and two wings as separate pieces so the wings can beat
  const body = new THREE.ConeGeometry(0.15, 0.85, 5);
  body.rotateX(Math.PI / 2);
  const bc = new Float32Array(body.attributes.position.count * 3).fill(0.92);
  body.setAttribute('color', new THREE.BufferAttribute(bc, 3));
  // the gull's crooked wing: inner panel lifted, outer panel swept back and down, black tips
  const R0f = [0, 0, 0.16];
  const R0b = [0, 0, -0.18];
  const Ef = [0.48, 0.13, 0.08];
  const Eb = [0.48, 0.13, -0.2];
  const T = [1.12, -0.02, -0.36];
  const pos = [...R0f, ...Ef, ...R0b, ...R0b, ...Ef, ...Eb, ...Ef, ...T, ...Eb];
  const W = [0.93, 0.92, 0.88];
  const D = [0.16, 0.17, 0.18];
  const col = [...W, ...W, ...W, ...W, ...W, ...W, ...W, ...D, ...W];
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  wing.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  wing.computeVertexNormals();
  return { body, wing };
}

const _m = new THREE.Matrix4();
const _w = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _mirror = new THREE.Matrix4().makeScale(-1, 1, 1);

/** A handful of gulls drawn as three instanced meshes (bodies, left wings, right wings): 3 draw calls in all. */
export class Gulls {
  constructor(scene, count = 7) {
    const geo = gullGeometry();
    this.geo = geo;
    // (a little self-light: at night gulls read as pale shapes catching the port's glow from below)
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: 0x3a362f });
    this.body = new THREE.InstancedMesh(geo.body, this.mat, count);
    this.left = new THREE.InstancedMesh(geo.wing, this.mat, count);
    this.right = new THREE.InstancedMesh(geo.wing, this.mat, count);
    for (const m of [this.body, this.left, this.right]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
    }
    this.birds = [];
    for (let i = 0; i < count; i++) {
      this.birds.push({
        // each circles its own thermal over the water
        cx: rand(10, 44),
        cz: rand(-40, 40),
        rad: rand(9, 22),
        h: rand(12, 22),
        sp: rand(0.12, 0.22) * (Math.random() < 0.5 ? -1 : 1),
        ph: rand(0, 6.28),
        flap: rand(0, 6),
        glide: 0,
      });
    }
    this.visible = true;
  }

  update(dt, t, wind) {
    if (!this.visible) return;
    for (let i = 0; i < this.birds.length; i++) {
      const B = this.birds[i];
      B.ph += B.sp * dt;
      const x = B.cx + Math.cos(B.ph) * B.rad + (wind ? wind.x * 2 : 0);
      const z = B.cz + Math.sin(B.ph) * B.rad * 0.7;
      const y = B.h + Math.sin(t * 0.4 + B.cx) * 1.5;
      // heading along the circle, banked into the turn
      const hd = Math.atan2(-Math.sin(B.ph) * B.sp, Math.cos(B.ph) * B.sp * 0.7);
      _q.setFromEuler(_e.set(0, hd, -Math.sign(B.sp) * 0.35));
      _m.compose(_p.set(x, y, z), _q, _s.set(1.45, 1.45, 1.45));
      this.body.setMatrixAt(i, _m);
      // mostly gliding, a few beats now and then
      B.glide -= dt;
      if (B.glide < -1.2) B.glide = rand(2, 6);
      const beat = B.glide > 0 ? 0.12 : Math.sin(t * 11 + B.flap) * 0.6;
      this.left.setMatrixAt(i, _w.multiplyMatrices(_m, _w.makeRotationZ(beat)));
      _w.makeRotationZ(beat);
      this.right.setMatrixAt(i, _w.premultiply(_mirror).premultiply(_m));
    }
    for (const m of [this.body, this.left, this.right]) m.instanceMatrix.needsUpdate = true;
  }

  setVisible(v) {
    if (v === this.visible) return;
    this.visible = v;
    this.body.visible = this.left.visible = this.right.visible = v;
  }
}
