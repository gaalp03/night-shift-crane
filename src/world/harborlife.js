// Harbour life: a tug that takes the ship in and out, and seabirds that ride the night air
// over the lit water. Pure scenery — nothing here touches the physics or the rules.
import * as THREE from 'three';
import { Vox, MAT, glowSprite, lightCone } from './vox.js';
import { clamp, damp, rand } from '../core/util.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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


/** A herring gull, built small: a smooth body with head, beak and tail; two-panel wings that bend at the wrist. */
function seabirdGeometry() {
  const paint = (g, rgb) => {
    g.deleteAttribute('uv');
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set(rgb, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  };
  // body: a lathe profile tail -> breast -> neck -> head, turned to point along +Z
  const prof = [
    [0.0, -0.42],
    [0.05, -0.36],
    [0.09, -0.26],
    [0.125, -0.12],
    [0.135, 0.0],
    [0.125, 0.1],
    [0.095, 0.18],
    [0.08, 0.23],
    [0.088, 0.29],
    [0.075, 0.35],
    [0.04, 0.39],
    [0.0, 0.405],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.LatheGeometry(prof, 9);
  body.rotateX(Math.PI / 2);
  body.scale(0.82, 0.74, 1.18); // (long and slim: a gull, not a ball)
  paint(body, [0.96, 0.96, 0.94]);
  const beak = new THREE.ConeGeometry(0.022, 0.12, 5);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, -0.005, 0.45);
  paint(beak, [0.95, 0.74, 0.18]);
  // tail: a short fan behind
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0.01, -0.34, -0.1, 0.0, -0.6, 0.1, 0.0, -0.6]), 3));
  tail.computeVertexNormals();
  paint(tail, [0.93, 0.93, 0.92]);
  const merged = mergeGeometries([body.toNonIndexed(), beak.toNonIndexed(), tail]);
  // a grey back on the body (the mantle), white below and on the head
  {
    const p = merged.attributes.position;
    const col = merged.attributes.color;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const z = p.getZ(i);
      if (y > 0.045 && z > -0.36 && z < 0.2 && col.getX(i) > 0.9) col.setXYZ(i, 0.7, 0.73, 0.78);
    }
  }
  // wings: cambered surfaces built from chord sections (leading edge, the arch, trailing edge), grey
  // on top and white beneath, root at x = 0 (the shoulder) spanning +x; the left one is mirrored
  const M = [0.6, 0.64, 0.7]; // mantle grey
  const Wt = [0.95, 0.95, 0.94];
  const K = [0.1, 0.1, 0.11]; // black tips
  const surface = (secs, topCol, botCol) => {
    // secs: [x, zLE, zTE, camber, dy] spanwise; each becomes LE / 35 % arch / TE
    const rows = secs.map(([x, le, te, cam, dy], k) => [
      [x, dy, le],
      [x, dy + cam, le + (te - le) * 0.35],
      [x, dy - cam * 0.2, te],
    ]);
    const pos = [];
    const cols = [];
    for (let k = 0; k < rows.length - 1; k++)
      for (let j = 0; j < 2; j++) {
        const a = rows[k][j];
        const b = rows[k][j + 1];
        const c = rows[k + 1][j];
        const d = rows[k + 1][j + 1];
        const ct = topCol(k, j);
        const cb = botCol(k, j);
        // top (facing +y), then the same quad wound the other way a hair lower (facing -y)
        for (const v of [a, c, b, b, c, d]) pos.push(v), cols.push(ct(v));
        for (const v of [a, b, c, b, d, c]) pos.push([v[0], v[1] - 0.012, v[2]]), cols.push(cb(v));
      }
    return { pos, cols };
  };
  const build = (...parts) => {
    const g = new THREE.BufferGeometry();
    const pos = parts.flatMap((p) => p.pos);
    const cols = parts.flatMap((p) => p.cols);
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos.flat()), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols.flat()), 3));
    g.computeVertexNormals();
    return g;
  };
  const top = () => () => M;
  const under = () => () => Wt;
  // inner wing: shoulder to wrist (0.44 m), broad, arched, a white trailing edge
  const inner = build(
    surface(
      [
        [0, 0.16, -0.2, 0.02, 0],
        [0.15, 0.17, -0.22, 0.03, 0.01],
        [0.3, 0.15, -0.21, 0.026, 0.02],
        [0.44, 0.11, -0.18, 0.02, 0.035],
      ],
      () => (v) => (v[2] < -0.15 ? Wt : M),
      under
    )
  );
  // outer wing (the hand): swept back and tapering to the black primaries, with the finger feathers
  const outerSecs = [
    [0, 0.11, -0.18, 0.018, 0],
    [0.18, 0.06, -0.2, 0.016, -0.004],
    [0.34, -0.03, -0.24, 0.012, -0.012],
    [0.46, -0.12, -0.27, 0.008, -0.02],
  ];
  const tipCol = (v) => (v[0] > 0.3 ? K : v[0] > 0.24 ? [0.35, 0.36, 0.38] : M);
  const outerS = surface(outerSecs, () => tipCol, () => (v) => (v[0] > 0.3 ? [0.22, 0.22, 0.24] : Wt));
  const fingers = { pos: [], cols: [] };
  for (let k = 0; k < 4; k++) {
    const z0 = -0.12 - k * 0.045;
    const tip = [0.58 - k * 0.03, -0.03, z0 - 0.1 - k * 0.012];
    const r1 = [0.44, -0.02, z0 + 0.02];
    const r2 = [0.44, -0.02, z0 - 0.03];
    for (const v of [r1, tip, r2]) fingers.pos.push(v), fingers.cols.push(K);
    for (const v of [r1, r2, tip]) fingers.pos.push([v[0], v[1] - 0.012, v[2]]), fingers.cols.push(K);
  }
  const outer = build(outerS, fingers);
  // the left wings are drawn through a mirroring instance matrix, which turns the triangles inside out:
  // pre-reverse their winding (normals kept) so the lit side stays the top side
  const flip = (g) => {
    const f = g.clone();
    for (const name of ['position', 'color', 'normal']) {
      const at = f.attributes[name];
      for (let i = 0; i < at.count; i += 3)
        for (let k = 0; k < 3; k++) {
          const tmp = at.array[(i + 1) * 3 + k];
          at.array[(i + 1) * 3 + k] = at.array[(i + 2) * 3 + k];
          at.array[(i + 2) * 3 + k] = tmp;
        }
    }
    return f;
  };
  return { body: merged, inner, outer, innerL: flip(inner), outerL: flip(outer) };
}

const _bm = new THREE.Matrix4();
const _bi = new THREE.Matrix4();
const _bo = new THREE.Matrix4();
const _bt = new THREE.Matrix4();
const _bq = new THREE.Quaternion();
const _be = new THREE.Euler(0, 0, 0, 'YXZ');
const _bp = new THREE.Vector3();
const _bs = new THREE.Vector3();
const _mirrorX = new THREE.Matrix4().makeScale(-1, 1, 1);
const _bf = new THREE.Vector3();
const SHOULDER = new THREE.Vector3(0.055, 0.04, 0.06);
const WRIST = new THREE.Vector3(0.44, 0.035, 0);

/**
 * Seabirds over the harbour: circle on the night air, flap and glide, cross to a new patch of sky,
 * now and then come down onto a lamp head or a bollard, sit a while and go again. Five instanced
 * meshes (bodies, inner and outer wing panels each side): five draw calls in all.
 */
export class Seabirds {
  constructor(scene, count = 6) {
    const geo = seabirdGeometry();
    this.geo = geo;
    // (a little self-light: at night they read as pale shapes catching the port's glow)
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: 0x2e2c28 });
    const im = (g) => {
      const m = new THREE.InstancedMesh(g, this.mat, count);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    this.body = im(geo.body);
    this.inL = im(geo.innerL);
    this.inR = im(geo.inner);
    this.outL = im(geo.outerL);
    this.outR = im(geo.outer);
    this.meshes = [this.body, this.inL, this.inR, this.outL, this.outR];
    this.perches = [];
    this.birds = [];
    for (let i = 0; i < count; i++) {
      const b = { pos: new THREE.Vector3(rand(4, 40), rand(14, 22), rand(-40, 40)), prev: new THREE.Vector3(), yaw: 0, bank: 0, pitch: 0, flap: rand(0, 6), flapAmp: 0, mode: 'soar', t: 0, seg: null, perch: null, burst: rand(1, 4) };
      this._soar(b, true);
      b.prev.copy(b.pos);
      this.birds.push(b);
    }
    this.visible = true;
    this.scale = 1.35;
  }

  /** Where they may land: [{ pos: Vector3 (the top to stand on), yaw }] */
  setPerches(list) {
    this.perches = list.map((p) => ({ pos: p.pos.clone(), yaw: p.yaw || 0, taken: false }));
  }

  _soar(b, start) {
    b.mode = 'soar';
    b.join = !start;
    if (!b.soarOff) b.soarOff = new THREE.Vector3();
    if (start) b.soarOff.set(0, 0, 0);
    b.cx = rand(-6, 42);
    b.cz = rand(-38, 38);
    b.rad = rand(8, 18);
    b.h = rand(12, 24);
    b.w = rand(0.16, 0.26) * (Math.random() < 0.5 ? -1 : 1);
    b.ph = start ? rand(0, 6.28) : Math.atan2((b.pos.z - b.cz) / 0.75, b.pos.x - b.cx);
    // (circle the way it is already flying, not a U-turn onto the loop)
    if (!start && (-Math.sin(b.ph) * (b.pos.x - b.prev.x) + 0.75 * Math.cos(b.ph) * (b.pos.z - b.prev.z)) * b.w < 0) b.w = -b.w;
    b.t = rand(10, 24); // how long before it goes somewhere else
  }

  /** A smooth flight from where it is to `to` (cubic: leaving along its heading, arriving level). */
  _transit(b, to, mode, speed = 8.5) {
    const p0 = b.pos.clone();
    const dir = _bp.subVectors(b.pos, b.prev);
    if (dir.lengthSq() < 1e-6) dir.set(Math.sin(b.yaw), 0, Math.cos(b.yaw));
    dir.normalize();
    const dist = p0.distanceTo(to);
    const p1 = p0.clone().addScaledVector(dir, dist * 0.35);
    const p2 = to.clone().add(new THREE.Vector3(0, mode === 'land' ? 2.5 : 0, 0)).addScaledVector(_bs.subVectors(to, p0).setY(0).normalize(), -dist * 0.3);
    b.seg = { p0, p1, p2, p3: to.clone(), dur: Math.max(2.5, dist / speed), u: 0 };
    b.mode = mode;
  }

  update(dt, t, wind) {
    if (!this.visible) return;
    const S = this.scale;
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      b.prev.copy(b.pos);
      let flapping = false;
      if (b.mode === 'soar') {
        b.ph += b.w * dt;
        // never a perfect circle: the loop breathes in and out and wanders downwind; it sinks a little
        // while it glides and climbs back on the beats
        const r = b.rad * (1 + 0.2 * Math.sin(b.ph * 2 + i * 1.7) + 0.08 * Math.sin(b.ph * 3.1 + i));
        b.cx += (wind ? wind.x * 0.15 : 0) * dt + Math.sin(t * 0.07 + i) * 0.25 * dt;
        b.cz += Math.cos(t * 0.05 + i * 2) * 0.25 * dt;
        b.vy = damp(b.vy || 0, b.flapAmp > 0.5 ? 0.55 : -0.22, 1.2, dt);
        b.h = clamp(b.h + b.vy * dt, 9, 27);
        _bf.set(b.cx + Math.cos(b.ph) * r + (wind ? wind.x * 1.5 : 0), b.h + Math.sin(t * 0.37 + i) * 1.2, b.cz + Math.sin(b.ph) * r * 0.75);
        // (joining the loop from a flight: start where it is and blend onto the loop, no jump)
        if (b.join) {
          b.soarOff.subVectors(b.pos, _bf);
          b.join = false;
        }
        b.soarOff.multiplyScalar(Math.exp(-dt * 0.9));
        b.pos.copy(_bf).add(b.soarOff);
        // gulls mostly glide: a short burst of beats now and then
        b.burst -= dt;
        if (b.burst < 0) {
          flapping = true;
          if (b.burst < -1.4) b.burst = rand(3, 8);
        }
        b.t -= dt;
        if (b.t <= 0) {
          const free = this.perches.filter((p) => !p.taken);
          if (free.length && Math.random() < 0.5) {
            const p = free[Math.floor(Math.random() * free.length)];
            p.taken = true;
            b.perch = p;
            this._transit(b, p.pos, 'land', 7);
          } else {
            const to = new THREE.Vector3(rand(-6, 42), rand(12, 24), rand(-38, 38));
            this._transit(b, to, 'cruise');
            b.next = to;
          }
        }
      } else if (b.mode === 'cruise' || b.mode === 'land' || b.mode === 'takeoff') {
        const sg = b.seg;
        sg.u = Math.min(1, sg.u + dt / sg.dur);
        const u = sg.u;
        const v = 1 - u;
        b.pos.set(0, 0, 0).addScaledVector(sg.p0, v * v * v).addScaledVector(sg.p1, 3 * v * v * u).addScaledVector(sg.p2, 3 * v * u * u).addScaledVector(sg.p3, u * u * u);
        flapping = b.mode !== 'cruise' || Math.sin(t * 0.9 + i) > 0.2 || u > 0.85;
        if (u >= 1) {
          if (b.mode === 'land') {
            b.mode = 'perched';
            b.t = rand(8, 20);
            b.yaw = b.perch.yaw + rand(-0.6, 0.6);
          } else {
            this._soar(b, false);
            if (b.next) {
              b.cx = b.next.x - Math.cos(b.ph) * b.rad;
              b.cz = b.next.z - Math.sin(b.ph) * b.rad * 0.75;
              b.h = b.next.y;
            }
          }
        }
      } else if (b.mode === 'perched') {
        b.pos.copy(b.perch.pos);
        b.t -= dt;
        if (b.t <= 0) {
          b.perch.taken = false;
          const up = b.pos.clone().add(new THREE.Vector3(rand(-8, 8), rand(6, 10), rand(-8, 8)));
          b.prev.set(b.pos.x - Math.sin(b.yaw) * 0.1, b.pos.y - 0.05, b.pos.z - Math.cos(b.yaw) * 0.1);
          this._transit(b, up, 'takeoff', 6);
          b.perch = null;
        }
      }
      // heading, pitch and bank from the motion (smoothed): banked into turns, nose with the climb
      const perched = b.mode === 'perched';
      if (!perched) {
        _bp.subVectors(b.pos, b.prev);
        const sp = _bp.length() / Math.max(dt, 1e-4);
        if (sp > 0.2) {
          const yaw = Math.atan2(_bp.x, _bp.z);
          let dy = yaw - b.yaw;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          b.yaw += dy * Math.min(1, dt * 6);
          const turn = dt > 0 ? dy / dt : 0;
          b.bank = damp(b.bank, clamp(-turn * 0.35, -0.7, 0.7), 4, dt);
          b.pitch = damp(b.pitch, clamp(-Math.atan2(_bp.y, Math.hypot(_bp.x, _bp.z)), -0.5, 0.5), 4, dt);
        }
      } else {
        b.bank = damp(b.bank, 0, 6, dt);
        b.pitch = damp(b.pitch, -0.25, 6, dt);
      }
      // wings: smooth beats with the outer panel lagging (the wrist flex), held in a shallow V gliding
      b.flapAmp = damp(b.flapAmp, flapping ? 1 : 0, 5, dt);
      b.flap += dt * (b.mode === 'land' || b.mode === 'takeoff' ? 4.2 : 3.1) * Math.PI * 2 * Math.max(0.25, b.flapAmp);
      // the beat is an arc, not a see-saw: a quick, full downstroke and an easier upstroke (the phase is
      // warped), the hand folding back and in on the way up; gliding, a shallow gull "M" that trembles
      const A = b.flapAmp;
      const ph = b.flap - 0.38 * Math.sin(b.flap);
      const upK = Math.max(0, Math.cos(ph)) * A;
      const tremble = Math.sin(t * 9.3 + i * 2.1) * 0.018 * (1 - A);
      const beat = Math.sin(ph) * 0.62 * A + (0.13 + tremble) * (1 - A);
      const flex = Math.sin(ph - 0.85) * 0.42 * A - (0.09 - tremble) * (1 - A);
      const sweep = 0.5 * upK;
      const fold = 1 - 0.16 * upK;
      _bq.setFromEuler(_be.set(b.pitch, b.yaw, b.bank));
      const bob = perched ? Math.max(0, Math.sin(t * 2.3 + i)) * 0.02 : -Math.cos(ph) * 0.035 * A;
      _bm.compose(_bp.set(b.pos.x, b.pos.y + bob + (perched ? 0.12 * S : 0), b.pos.z), _bq, _bs.set(S, S, S));
      this.body.setMatrixAt(i, _bm);
      for (const side of [1, -1]) {
        // shoulder -> inner panel (beat about the body's long axis); wrist -> outer panel (flex)
        _bi.copy(_bm);
        if (side < 0) _bi.multiply(_mirrorX);
        _bi.multiply(_bt.makeTranslation(SHOULDER.x, SHOULDER.y, SHOULDER.z));
        if (perched) {
          // folded along the back
          _bi.multiply(_bt.makeRotationY(1.35)).multiply(_bt.makeRotationZ(0.25)).multiply(_bt.makeScale(0.62, 1, 0.75));
        } else _bi.multiply(_bt.makeRotationZ(beat)).multiply(_bt.makeRotationY(sweep * 0.25));
        _bo.copy(_bi).multiply(_bt.makeTranslation(WRIST.x, WRIST.y, WRIST.z));
        if (perched) _bo.multiply(_bt.makeRotationY(-2.6)).multiply(_bt.makeScale(0.7, 1, 0.8));
        else _bo.multiply(_bt.makeRotationZ(flex)).multiply(_bt.makeRotationY(sweep)).multiply(_bt.makeScale(fold, 1, 1));
        (side > 0 ? this.inR : this.inL).setMatrixAt(i, _bi);
        (side > 0 ? this.outR : this.outL).setMatrixAt(i, _bo);
      }
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }

  setVisible(v) {
    if (v === this.visible) return;
    this.visible = v;
    for (const m of this.meshes) m.visible = v;
  }
}
