// Ship-to-shore gantry crane: procedural model (gantry / trolley / spreader / cables) and its lights.
import * as THREE from 'three';
import { Vox, MAT, makeCanvas, canvasTexture, glowSprite, lightCone } from './vox.js';
import { DIM, PAL } from '../config.js';
import { clamp } from '../core/util.js';

export const ROPE = { X: 0.95, Z: 2.5, TOP_Y: -0.35, SPR_Y: DIM.SPR_H / 2 + 0.5 };

export const PAINTS = {
  yellow: { name: 'Safety Yellow', main: 0xe8a61c, accent: 0x1f2529, trim: 0xc23d2b, cost: 0 },
  red: { name: 'Harbour Red', main: 0xc23d2b, accent: 0xe2ddd0, trim: 0x1f2529, cost: 6 },
  teal: { name: 'Sea Teal', main: 0x2c8f85, accent: 0xe2ddd0, trim: 0xe8a61c, cost: 14 },
  white: { name: 'Arctic White', main: 0xe2ddd0, accent: 0x34609f, trim: 0xc23d2b, cost: 24 },
  navy: { name: 'Midnight Navy', main: 0x2a3f66, accent: 0xe8a61c, trim: 0xe2ddd0, cost: 34 },
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();

function plateTexture(text, sub, fg = '#16181a', bg = '#e8a61c') {
  const c = makeCanvas(256, 128);
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = fg;
  g.font = '86px "Saira Stencil One", "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, sub ? 54 : 68);
  if (sub) {
    g.font = '700 24px "Barlow Condensed", Arial, sans-serif';
    g.fillText(sub, 128, 108);
  }
  return canvasTexture(c, { aniso: 8 });
}

export class CraneView {
  constructor(scene, { paint = 'yellow', mobile = false } = {}) {
    this.scene = scene;
    this.mobile = mobile;
    this.root = new THREE.Group();
    this.root.name = 'crane';
    scene.add(this.root);
    this.gantry = new THREE.Group();
    this.root.add(this.gantry);
    this.trolley = new THREE.Group();
    this.gantry.add(this.trolley);
    this.spreader = new THREE.Group();
    scene.add(this.spreader);
    this.beacons = [];
    this.travelBeacons = [];
    this.leds = [];
    this.ledState = '';
    this.paintId = paint;
    this._buildGantry(PAINTS[paint] || PAINTS.yellow);
    this._buildTrolley(PAINTS[paint] || PAINTS.yellow);
    this._buildSpreader(PAINTS[paint] || PAINTS.yellow);
    this._buildRopes();
    this._buildLights();
    this.setLed('idle');
  }

  setPaint(id) {
    if (id === this.paintId) return;
    this.paintId = id;
    const p = PAINTS[id] || PAINTS.yellow;
    for (const m of [this.gantryMesh, this.trolleyMesh, this.spreaderMesh]) {
      m.geometry.dispose();
      m.parent.remove(m);
    }
    for (const m of this.extraDisposables) {
      if (m.parent) m.parent.remove(m);
      if (m.geometry) m.geometry.dispose();
    }
    this.beacons.length = 0;
    this.travelBeacons.length = 0;
    this.leds.length = 0;
    this._buildGantry(p);
    this._buildTrolley(p);
    this._buildSpreader(p);
    this.ledState = '';
    this.setLed('idle');
  }

  // ---------------------------------------------------------------- gantry

  _buildGantry(P) {
    this.extraDisposables = this.extraDisposables || [];
    this.extraDisposables.length = 0;
    const v = new Vox();
    const g = new Vox();
    g.shade = false;
    const q = DIM.QUAY_Y;
    const xw = DIM.LEG_WATER_X;
    const xl = DIM.LEG_LAND_X;
    const LZ = DIM.LEG_HALF_Z;
    const top = DIM.RAIL_Y + 3.5;
    const main = P.main;
    const dark = P.accent === 0x1f2529 ? 0x1f2529 : 0x23292e;

    for (const x of [xw, xl]) {
      for (const sz of [-1, 1]) {
        const z = sz * LZ;
        // bogie + wheels
        v.box(x, q + 0.62, z, 1.5, 0.75, 3.4, dark);
        for (const wz of [-1.1, 0, 1.1]) v.cyl(x, q + 0.32, z + wz, 0.34, 0.5, 0x101315, 8, 1, [0, 0, Math.PI / 2]);
        v.box(x, q + 1.15, z, 1.1, 0.4, 1.6, main);
        // leg
        v.box(x, (q + 1.3 + top) / 2, z, 0.95, top - q - 1.3, 0.95, main);
        // hazard collar
        for (let i = 0; i < 4; i++) v.box(x, q + 1.75 + i * 0.5, z, 1.02, 0.25, 1.02, i % 2 ? dark : 0xe8b21e);
      }
      // sill beam + portal beam
      v.box(x, q + 1.55, 0, 0.8, 0.7, LZ * 2 - 0.9, main);
      v.box(x, top - 0.45, 0, 1.0, 1.1, LZ * 2 + 1.0, main);
      // mid-height tie on the land side only: the water side must stay open for the load and cables
      if (x === xl) v.box(x, q + 13.5, 0, 0.55, 0.55, LZ * 2 - 0.9, main);
      // hangers carrying the girders under the portal beam
      for (const sz of [-1, 1]) v.box(x, (DIM.RAIL_Y + 1.6 + top - 1.0) / 2, sz * 3.35, 0.7, top - 1.0 - DIM.RAIL_Y - 1.6, 0.7, main);
    }
    // side frames (sea-to-land direction): plain portals so the working view stays open
    for (const sz of [-1, 1]) {
      const z = sz * LZ;
      v.box((xw + xl) / 2, q + 13.5, z, xw - xl - 0.9, 0.7, 0.6, main);
      v.box((xw + xl) / 2, top - 0.45, z, xw - xl - 0.9, 0.9, 0.7, main);
      v.beam(xl, q + 10.6, z, xl + 2.9, q + 13.3, z, 0.3, main);
      v.beam(xw, q + 10.6, z, xw - 2.9, q + 13.3, z, 0.3, main);
      v.beam(xl, top - 3.6, z, xl + 3.2, top - 0.9, z, 0.3, main);
      v.beam(xw, top - 3.6, z, xw - 3.2, top - 0.9, z, 0.3, main);
    }
    // the land-side frame carries the cross bracing (edge-on to the camera, clear of the lanes)
    v.beam(xl, q + 13.9, -LZ, xl, top - 1.0, LZ, 0.34, main);
    v.beam(xl, q + 13.9, LZ, xl, top - 1.0, -LZ, 0.34, main);
    v.beam(xl, q + 2.0, -LZ, xl, q + 13.2, 0, 0.3, main);
    v.beam(xl, q + 2.0, LZ, xl, q + 13.2, 0, 0.3, main);

    // twin box girders (the boom) + walkway
    const x0 = -27.5;
    const x1 = 21.5;
    for (const sz of [-1, 1]) {
      v.box((x0 + x1) / 2, DIM.RAIL_Y + 0.95, sz * 3.35, x1 - x0, 1.3, 0.8, main);
      v.box((x0 + x1) / 2, DIM.RAIL_Y + 0.22, sz * 3.35, x1 - x0, 0.16, 1.1, dark); // rail flange
      // handrail posts along the walkway
      for (let x = x0 + 1; x < x1; x += 3.2) v.box(x, DIM.RAIL_Y + 2.1, sz * 3.7, 0.1, 1.0, 0.1, dark);
      v.box((x0 + x1) / 2, DIM.RAIL_Y + 2.6, sz * 3.7, x1 - x0, 0.1, 0.1, dark);
    }
    // cross ties between girders
    for (let x = x0 + 0.6; x <= x1; x += 4.9) v.box(x, DIM.RAIL_Y + 1.45, 0, 0.5, 0.3, 6.7, main);
    // boom tip (red, with bumper)
    v.box(x1 + 0.3, DIM.RAIL_Y + 0.95, 0, 0.6, 1.5, 7.5, P.trim);
    v.box(x0 - 0.3, DIM.RAIL_Y + 0.95, 0, 0.6, 1.5, 7.5, P.trim);

    // A-frame apex with stays
    const ax = xw + 0.8;
    const ay = DIM.RAIL_Y + 14.5;
    for (const sz of [-1, 1]) {
      v.beam(xw, top, sz * 3.4, ax, ay, sz * 0.5, 0.6, main);
      v.beam(xl + 6, top + 0.3, sz * 3.4, ax, ay, sz * 0.5, 0.42, main);
      v.beam(ax, ay - 0.2, sz * 0.5, x1 - 2, DIM.RAIL_Y + 1.9, sz * 3.3, 0.2, dark);
      v.beam(ax, ay - 0.2, sz * 0.5, 7.5, DIM.RAIL_Y + 1.9, sz * 3.3, 0.18, dark);
      v.beam(ax, ay - 0.2, sz * 0.5, x0 + 2, DIM.RAIL_Y + 1.9, sz * 3.3, 0.2, dark);
    }
    v.box(ax, ay, 0, 1.2, 0.9, 2.0, main);
    v.box(ax, ay + 1.3, 0, 0.16, 1.8, 0.16, dark);
    this._beacon(new THREE.Vector3(ax, ay + 2.3, 0), 0xff3b2e, 3.4, 0);
    this._beacon(new THREE.Vector3(x1 + 0.4, DIM.RAIL_Y + 2.1, 0), 0xff3b2e, 2.6, 0.5);
    this._beacon(new THREE.Vector3(x0 - 0.4, DIM.RAIL_Y + 2.1, 0), 0xff3b2e, 2.6, 0.25);

    // machinery house on the back reach
    const hx = -23.2;
    v.box(hx, DIM.RAIL_Y + 3.4, 0, 6.6, 3.6, 6.0, PAL.craneWhite);
    v.box(hx, DIM.RAIL_Y + 5.3, 0, 7.0, 0.25, 6.4, dark);
    v.box(hx - 1.2, DIM.RAIL_Y + 5.8, 1.4, 1.2, 0.8, 1.2, 0x59646d);
    for (let i = 0; i < 4; i++) {
      g.box(hx - 2.2 + i * 1.5, DIM.RAIL_Y + 3.9, 3.02, 0.9, 0.7, 0.06, i === 2 ? 0x1c2a33 : 0xffd89a, null, i === 2 ? 0.2 : 1);
    }
    // stair tower up the land-side leg
    const sx = xl - 1.0;
    for (let i = 0; i < 9; i++) {
      const y0 = q + 1.6 + i * 2.6;
      const dir = i % 2 ? 1 : -1;
      v.beam(sx, y0, LZ - 0.9 - dir * 1.3, sx, y0 + 2.6, LZ - 0.9 + dir * 1.3, 0.14, dark, 0.7);
      v.box(sx, y0 + 2.6, LZ - 0.9 + dir * 1.45, 0.9, 0.08, 0.6, dark);
    }

    // floodlights under the girders
    this.floodPositions = [];
    for (const x of [-13.5, -5.5, 3.5, 11.5, 18.5]) {
      for (const sz of [-1, 1]) {
        v.box(x, DIM.RAIL_Y + 0.05, sz * 4.1, 0.7, 0.3, 0.5, dark);
        g.box(x, DIM.RAIL_Y - 0.12, sz * 4.1, 0.56, 0.1, 0.38, 0xffe2b0);
        this.floodPositions.push(new THREE.Vector3(x, DIM.RAIL_Y - 0.2, sz * 4.1));
      }
    }
    // walk lights up the legs
    for (const sz of [-1, 1]) {
      for (const y of [q + 7, q + 13.5, q + 19]) g.box(xw - 0.52, y, sz * LZ, 0.08, 0.28, 0.28, 0xfff0c8, null, 0.7);
    }

    this.gantryMesh = v.mesh(MAT.vox);
    this.gantry.add(this.gantryMesh);
    const gm = g.mesh(MAT.glow, { cast: false, receive: false });
    this.gantry.add(gm);
    this.extraDisposables.push(gm);

    // number plates
    const tex = plateTexture('07', 'PIER SEVEN', '#16181a', '#' + new THREE.Color(P.main).getHexString());
    const pm = new THREE.MeshLambertMaterial({ map: tex });
    const p1 = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.1), pm);
    p1.position.set(hx, DIM.RAIL_Y + 3.3, 3.03);
    p1.scale.set(0.62, 0.62, 1);
    p1.position.x = hx + 2.1;
    this.gantry.add(p1);
    const p2 = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.3), pm);
    p2.position.set(xw + 0.52, q + 13.5 + 2.2, 0);
    p2.rotation.y = Math.PI / 2;
    this.gantry.add(p2);
    const p3 = p2.clone();
    p3.position.set(xw - 0.52, q + 13.5 + 2.2, 0);
    p3.rotation.y = -Math.PI / 2;
    this.gantry.add(p3);
    this.extraDisposables.push(p1, p2, p3);

    // amber travel beacons on the bogies
    for (const x of [xw, xl]) {
      for (const sz of [-1, 1]) {
        const s = glowSprite(0xffa020, 2.2, 0);
        s.position.set(x, q + 1.65, sz * (LZ + 1.2));
        this.gantry.add(s);
        this.travelBeacons.push(s);
        this.extraDisposables.push(s);
      }
    }
  }

  _beacon(pos, color, size, phase) {
    const s = glowSprite(color, size, 1);
    s.position.copy(pos);
    this.gantry.add(s);
    this.beacons.push({ s, phase });
    this.extraDisposables.push(s);
  }

  // ---------------------------------------------------------------- trolley

  _buildTrolley(P) {
    const v = new Vox();
    const g = new Vox();
    g.shade = false;
    const dark = 0x23292e;
    v.box(0, 0.15, 0, 3.6, 0.6, 7.3, dark);
    v.box(0, 0.75, 0, 2.6, 0.7, 4.4, P.main);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) v.cyl(sx * 1.5, 0.05, sz * 3.35, 0.36, 0.5, 0x101315, 8, 1, [Math.PI / 2, 0, 0]);
    // hoist drums
    v.cyl(0, 1.25, -1.1, 0.55, 2.2, 0x59646d, 10, 1, [0, 0, Math.PI / 2]);
    v.cyl(0, 1.25, 1.1, 0.55, 2.2, 0x59646d, 10, 1, [0, 0, Math.PI / 2]);
    // sheave blocks above each cable
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) v.box(sx * ROPE.X, -0.25, sz * ROPE.Z, 0.34, 0.4, 0.5, dark);
    // operator cab, hung on the far side so it never hides the load from the main camera
    const cz = -5.4;
    v.box(0, -0.6, cz + 1.4, 1.0, 0.5, 2.0, dark);
    v.box(0, -2.0, cz, 2.5, 0.22, 2.7, PAL.craneWhite); // roof
    v.box(0, -4.25, cz, 2.5, 0.22, 2.7, dark); // floor frame
    v.box(-1.2, -3.1, cz - 1.25, 0.14, 2.2, 0.14, PAL.craneWhite);
    v.box(1.2, -3.1, cz - 1.25, 0.14, 2.2, 0.14, PAL.craneWhite);
    v.box(-1.2, -3.1, cz + 1.25, 0.14, 2.2, 0.14, PAL.craneWhite);
    v.box(1.2, -3.1, cz + 1.25, 0.14, 2.2, 0.14, PAL.craneWhite);
    v.box(0, -3.1, cz - 1.3, 2.4, 2.0, 0.1, PAL.craneWhite); // back wall
    v.box(0, -3.9, cz + 0.2, 0.7, 0.5, 0.7, 0x2a3035); // seat
    v.box(0, -3.25, cz - 0.1, 0.7, 0.9, 0.16, 0x2a3035);
    // tiny operator (hi-vis)
    v.box(0, -3.3, cz + 0.2, 0.5, 0.7, 0.4, PAL.vestOrange);
    v.box(0, -2.75, cz + 0.2, 0.36, 0.36, 0.36, 0xd8a47a);
    v.box(0, -2.52, cz + 0.2, 0.42, 0.16, 0.42, 0xe8b21e);
    // warm cab interior + glass
    g.box(0, -2.14, cz, 1.6, 0.06, 1.6, 0xffd89a, null, 0.75);
    g.box(-0.5, -3.75, cz + 0.95, 0.5, 0.08, 0.2, 0x7ee08a, null, 0.7);
    g.box(0.4, -3.75, cz + 0.95, 0.3, 0.08, 0.2, 0xff7a3c, null, 0.7);
    this.cabLocal = new THREE.Vector3(0, -3.0, cz);

    this.trolleyMesh = v.mesh(MAT.vox);
    this.trolley.add(this.trolleyMesh);
    const gm = g.mesh(MAT.glowSoft, { cast: false, receive: false });
    this.trolley.add(gm);
    this.extraDisposables.push(gm);
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(2.42, 2.0, 2.56),
      new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.1, depthWrite: false })
    );
    glass.position.set(0, -3.1, cz);
    this.trolley.add(glass);
    this.extraDisposables.push(glass);
    this.trolley.position.y = DIM.RAIL_Y;
  }

  // ---------------------------------------------------------------- spreader

  _buildSpreader(P) {
    const v = new Vox();
    const dark = 0x23292e;
    const hw = DIM.CONT_W / 2 - 0.05;
    const hl = DIM.CONT_L / 2 - 0.05;
    const hy = DIM.SPR_H / 2;
    // perimeter frame
    for (const sx of [-1, 1]) v.box(sx * (hw - 0.2), 0, 0, 0.4, DIM.SPR_H, hl * 2, P.main);
    for (const sz of [-1, 1]) v.box(0, 0, sz * (hl - 0.22), hw * 2, DIM.SPR_H, 0.44, dark);
    v.box(0, 0, 0, hw * 2 - 0.8, DIM.SPR_H * 0.7, 0.5, P.main);
    // headblock + sheaves
    v.box(0, hy + 0.3, 0, 1.5, 0.5, 5.4, dark);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) v.cyl(sx * ROPE.X, hy + 0.5, sz * ROPE.Z, 0.3, 0.22, 0x59646d, 8, 1, [0, 0, Math.PI / 2]);
    // twist-lock housings + flippers
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        v.box(sx * (hw - 0.14), -hy - 0.06, sz * (hl - 0.16), 0.3, 0.14, 0.34, 0x101315);
        v.box(sx * (hw + 0.1), -hy - 0.2, sz * (hl - 0.5), 0.1, 0.6, 0.5, P.trim, [0, 0, sx * 0.3]);
        v.box(sx * (hw - 0.5), -hy - 0.2, sz * (hl + 0.1), 0.5, 0.6, 0.1, P.trim, [-sz * 0.3, 0, 0]);
      }
    }
    // hazard stripes on the end beams
    for (const sz of [-1, 1]) for (let i = -2; i <= 2; i++) v.box(i * 0.42, hy + 0.01, sz * (hl - 0.22), 0.2, 0.03, 0.44, i % 2 ? dark : 0xe8b21e);
    this.spreaderMesh = v.mesh(MAT.vox);
    this.spreader.add(this.spreaderMesh);

    // status LEDs (corner lamps): red = free, amber = landed, green = locked
    const ledGeo = new THREE.BoxGeometry(0.22, 0.16, 0.22);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const m = new THREE.Mesh(ledGeo, new THREE.MeshBasicMaterial({ color: 0xff3b2e, fog: false }));
        m.position.set(sx * (hw - 0.14), hy + 0.1, sz * (hl - 0.16));
        this.spreader.add(m);
        this.leds.push(m);
        this.extraDisposables.push(m);
      }
    }
    this.ledGlow = glowSprite(0xff3b2e, 3.0, 0.55);
    this.ledGlow.position.set(0, hy + 0.2, 0);
    this.spreader.add(this.ledGlow);
    this.extraDisposables.push(this.ledGlow);
  }

  setLed(state) {
    if (state === this.ledState) return;
    this.ledState = state;
    const col = state === 'locked' ? 0x4dff88 : state === 'ready' ? 0xffb020 : state === 'error' ? 0xff2a1e : 0xff5a3c;
    const k = this.mobile ? 1.4 : 2.0;
    for (const l of this.leds) l.material.color.setHex(col).multiplyScalar(k);
    this.ledGlow.material.color.setHex(col);
    this.ledGlow.material.opacity = state === 'idle' ? 0.3 : 0.7;
  }

  // ---------------------------------------------------------------- cables

  _buildRopes() {
    const geo = new THREE.CylinderGeometry(0.045, 0.045, 1, 5, 1, true);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0x3c444b, fog: true });
    this.ropeSegs = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      this.scene.add(m);
      this.ropeSegs.push(m);
    }
  }

  _seg(mesh, a, b) {
    _dir.subVectors(b, a);
    const len = _dir.length();
    mesh.position.copy(a);
    mesh.scale.set(1, Math.max(len, 0.001), 1);
    mesh.quaternion.setFromUnitVectors(_up, _dir.multiplyScalar(1 / (len || 1)));
  }

  /**
   * @param trolleyPos world position of the trolley body
   * @param sprMatrix  world matrix of the spreader body
   * @param ropeLen    paid-out cable length (for slack sag)
   */
  updateRopes(trolleyPos, sprMatrix, ropeLen) {
    let k = 0;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        _a.set(trolleyPos.x + sx * ROPE.X, trolleyPos.y + ROPE.TOP_Y, trolleyPos.z + sz * ROPE.Z);
        _b.set(sx * ROPE.X, ROPE.SPR_Y, sz * ROPE.Z).applyMatrix4(sprMatrix);
        const d = _a.distanceTo(_b);
        const slack = Math.max(0, ropeLen - d);
        _mid.addVectors(_a, _b).multiplyScalar(0.5);
        if (slack > 0.02) {
          const sag = Math.min(2.2, Math.sqrt(slack * d) * 0.55);
          _mid.x += sx * sag * 0.55;
          _mid.z += sz * sag * 0.35;
          _mid.y -= sag * 0.4;
        }
        this._seg(this.ropeSegs[k++], _a, _mid);
        this._seg(this.ropeSegs[k++], _mid, _b);
      }
    }
  }

  // ---------------------------------------------------------------- lights

  _buildLights() {
    // The one real shadow-casting light: the trolley work light, always above the load.
    const spot = new THREE.SpotLight(PAL.sodiumHot, 165, 84, 0.66, 0.6, 1.0);
    spot.position.set(0, -0.6, 0);
    spot.target.position.set(0, -30, 0);
    spot.castShadow = true;
    spot.userData.wantShadow = true;
    spot.shadow.mapSize.set(2048, 2048);
    spot.shadow.camera.near = 2;
    spot.shadow.camera.far = 60;
    spot.shadow.bias = -0.0006;
    spot.shadow.normalBias = 0.04;
    this.trolley.add(spot);
    this.trolley.add(spot.target);
    this.workLight = spot;
    const cone = lightCone(PAL.sodiumHot, 15, 24, 0.07);
    cone.position.set(0, -0.6, 0);
    this.trolley.add(cone);
    this.workCone = cone;
    const halo = glowSprite(PAL.sodiumHot, 5, 0.9);
    halo.position.set(0, -0.7, 0);
    this.trolley.add(halo);

    // decorative floods along the boom (halo + cone only)
    for (let i = 0; i < this.floodPositions.length; i++) {
      const p = this.floodPositions[i];
      const h = glowSprite(PAL.sodiumHot, 3.6, 0.75);
      h.position.copy(p);
      this.gantry.add(h);
      if (i % 2 === 0 && !this.mobile) {
        const c = lightCone(PAL.sodium, 7.5, 21, 0.05);
        c.position.copy(p);
        this.gantry.add(c);
      }
    }
  }

  setPose(gantryZ, trolleyX) {
    this.gantry.position.z = gantryZ;
    this.trolley.position.x = trolleyX;
  }

  /** Cosmetic per-frame animation. `moving` 0..1 = gantry travel activity. */
  update(dt, t, gantryMoving) {
    for (const b of this.beacons) {
      const ph = (t * 0.7 + b.phase) % 1;
      b.s.material.opacity = ph < 0.16 ? 1 : 0.07;
    }
    const on = gantryMoving > 0.05;
    for (let i = 0; i < this.travelBeacons.length; i++) {
      const s = this.travelBeacons[i];
      const k = on ? (Math.sin(t * 14 + i * 1.7) > 0 ? 1 : 0.15) : 0;
      s.material.opacity = clamp(s.material.opacity + (k - s.material.opacity) * Math.min(1, dt * 20), 0, 1);
    }
  }

  dispose() {
    this.scene.remove(this.root);
    this.scene.remove(this.spreader);
    for (const r of this.ropeSegs) this.scene.remove(r);
  }
}
