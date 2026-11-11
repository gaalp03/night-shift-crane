// The cargo ship: procedural low-poly model, wave-driven motion, slot grid and its physics body.
import * as THREE from 'three';
import { Vox, MAT, makeCanvas, canvasTexture, glowSprite } from './vox.js';
import { DIM, PAL, ZONES } from '../config.js';
import { GROUPS } from '../game/physics.js';
import { clamp, damp, makeRng } from '../core/util.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();

export const SHIP_NAMES = [
  'MV KESTREL',
  'MV NORDLYS',
  'MV HALCYON',
  'MV TIDEWATER',
  'MV MARIGOLD',
  'MV OSPREY',
  'MV LANTERN',
  'MV BOREALIS',
  'MV SALT WIND',
  'MV PELICAN',
  'MV IRON LILY',
  'MV LOW TIDE',
];

const HULLS = [
  { hull: 0x1b2a3a, boot: 0x8c2f27, deck: 0x2d5a4d, band: 0xd59b22 },
  { hull: 0x23282c, boot: 0x7c2b25, deck: 0x6b3a30, band: 0xc23d2b },
  { hull: 0x2c4a3e, boot: 0x8c2f27, deck: 0x55504a, band: 0xe2ddd0 },
  { hull: 0x5a2a26, boot: 0x1f2529, deck: 0x2f4f63, band: 0x2c8f85 },
  { hull: 0x2a3f66, boot: 0x8c2f27, deck: 0x3c4a44, band: 0xe2742b },
];

function wall(v, ax, az, bx, bz, y0, y1, thick, color) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.sqrt(dx * dx + dz * dz);
  v.box((ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2, len, y1 - y0, thick, color, [0, Math.atan2(-dz, dx), 0]);
}

export class Ship {
  /**
   * @param {object} def { rows, bays, tiers, name, style, zones: [[zoneId per bay] | per-cell fn] }
   */
  constructor(def, phys) {
    this.def = def;
    this.phys = phys;
    this.rows = def.rows;
    this.bays = def.bays;
    this.maxTiers = def.tiers || 3;
    this.name = def.name || SHIP_NAMES[0];
    this.style = HULLS[(def.style || 0) % HULLS.length];
    this.halfBeam = (this.rows * DIM.CELL_X) / 2 + 0.95;
    this.cargoLen = this.bays * DIM.CELL_Z;
    this.zStern = -(this.cargoLen / 2 + 10.5);
    this.zBow = this.cargoLen / 2 + 11.5;
    this.zShoulder = this.cargoLen / 2 + 3.2;
    this.origin = new THREE.Vector3(DIM.HULL_X0 + this.halfBeam, 0, def.z || 0);
    this.grid = [];
    for (let r = 0; r < this.rows; r++) {
      this.grid.push([]);
      for (let b = 0; b < this.bays; b++) this.grid[r].push([]);
    }
    this.zoneOf = def.zoneOf || (() => 'ANY');

    // motion state
    this.sea = { roll: 0.012, heave: 0.06, pitch: 0.003, sway: 0.03 };
    this.seaScale = 1;
    this.kick = { roll: 0, rollV: 0, heave: 0, heaveV: 0 };
    this.list = 0;
    this.draft = 0;
    this.offsetX = 0; // used for arrival / departure animation
    this.offsetZ = 0;
    this.pose = { x: 0, y: 0, z: 0, roll: 0, pitch: 0 };
    this.phase = (def.seed || 1) * 1.37;

    this.group = new THREE.Group();
    this.group.name = 'ship';
    this._build();
    this._buildBody();
    this._applyPose(0);
    this.syncVisual();
  }

  // ------------------------------------------------------------------ geometry

  outline(scaleX = 1, bowPull = 0, grow = 0) {
    const hb = this.halfBeam * scaleX + grow;
    const zs = this.zStern - grow;
    const zb = this.zBow - bowPull + grow;
    const zsh = this.zShoulder - bowPull * 0.4;
    return [
      [hb, zs],
      [hb, zsh],
      [hb * 0.6, zb - 3.4],
      [0, zb],
      [-hb * 0.6, zb - 3.4],
      [-hb, zsh],
      [-hb, zs],
    ];
  }

  _build() {
    const st = this.style;
    const v = new Vox();
    const glow = new Vox();
    glow.shade = false;
    const dy = DIM.DECK_Y;
    const hb = this.halfBeam;
    const rng = makeRng(101 + (this.def.style || 0) * 7);

    // hull: anti-fouling red below the waterline, flared painted topsides
    v.loft(this.outline(0.84, 1.6), -2.2, this.outline(0.93, 0.7), 0.55, st.boot, false, true);
    v.loft(this.outline(0.93, 0.7), 0.55, this.outline(1, 0), dy + 0.95, st.hull, false, false);
    // white draft stripe
    v.loft(this.outline(0.931, 0.69, 0.02), 0.55, this.outline(0.938, 0.62, 0.02), 0.78, 0xd9d5c8, false, false);
    // deck plate
    v.loft(this.outline(1, 0, -0.22), dy - 0.3, this.outline(1, 0, -0.22), dy, st.deck, true, false);
    // bulwark inner faces + cap rail
    const out = this.outline(1, 0, -0.16);
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      const b = out[(i + 1) % out.length];
      wall(v, a[0], a[1], b[0], b[1], dy, dy + 0.95, 0.2, st.hull);
      wall(v, a[0], a[1], b[0], b[1], dy + 0.95, dy + 1.06, 0.34, 0xc9c4b6);
    }

    // hatch covers: one raised slab per bay, with seams
    const hc = 0x4a5258;
    for (let b = 0; b < this.bays; b++) {
      const z = this.bayZ(b);
      v.box(0, dy + 0.06, z, this.rows * DIM.CELL_X + 0.3, 0.12, DIM.CELL_Z - 0.25, hc);
      for (let r = 0; r <= this.rows; r++) {
        const x = (r - this.rows / 2) * DIM.CELL_X;
        v.box(x, dy + 0.13, z, 0.1, 0.04, DIM.CELL_Z - 0.4, 0x363d42);
      }
    }
    // cell guide stubs between bays (purely visual, low so they never block cargo)
    for (let b = 0; b <= this.bays; b++) {
      const z = (b - this.bays / 2) * DIM.CELL_Z;
      for (const sx of [-1, 1]) {
        v.box(sx * (hb - 0.75), dy + 0.3, z, 0.3, 0.6, 0.3, PAL.lineYellow);
      }
    }

    // forecastle
    const zf = this.zShoulder + 0.4;
    v.loft(
      [
        [hb * 0.98, zf],
        [hb * 0.6, this.zBow - 3.5],
        [0, this.zBow - 0.4],
        [-hb * 0.6, this.zBow - 3.5],
        [-hb * 0.98, zf],
      ],
      dy,
      [
        [hb * 0.98, zf],
        [hb * 0.6, this.zBow - 3.5],
        [0, this.zBow - 0.4],
        [-hb * 0.6, this.zBow - 3.5],
        [-hb * 0.98, zf],
      ],
      dy + 1.5,
      st.hull,
      true,
      false,
      st.deck
    );
    // windlass, bitts, foremast
    v.box(0, dy + 1.85, zf + 2.2, 2.2, 0.7, 1.1, 0x3a4248);
    v.cyl(-0.8, dy + 2.0, zf + 2.2, 0.42, 0.9, 0x2a3035, 8, 1, [0, 0, Math.PI / 2]);
    v.cyl(0.8, dy + 2.0, zf + 2.2, 0.42, 0.9, 0x2a3035, 8, 1, [0, 0, Math.PI / 2]);
    for (const sx of [-1, 1]) {
      v.cyl(sx * (hb * 0.55), dy + 1.75, zf + 0.9, 0.2, 0.5, 0x1f2529, 6);
      v.cyl(sx * (hb * 0.55) + 0.5, dy + 1.75, zf + 0.9, 0.2, 0.5, 0x1f2529, 6);
    }
    v.box(0, dy + 4.2, zf + 4.2, 0.22, 5.4, 0.22, 0xc9c4b6);
    v.box(0, dy + 5.8, zf + 4.2, 1.8, 0.14, 0.14, 0xc9c4b6);
    glow.box(0, dy + 7.0, zf + 4.2, 0.26, 0.26, 0.26, 0xfff2d0);
    this.foreLight = new THREE.Vector3(0, dy + 7.0, zf + 4.2);

    // superstructure at the stern (far from the camera so it never hides the cargo)
    const zb0 = this.zStern + 1.2;
    const zb1 = -this.cargoLen / 2 - 1.9;
    const bz = (zb0 + zb1) / 2;
    const bl = zb1 - zb0;
    const bw = hb * 2 - 1.6;
    v.box(0, dy + 1.3, bz, bw, 2.6, bl, 0x8f9aa0);
    v.box(0, dy + 3.9, bz, bw - 1.0, 2.6, bl - 0.8, PAL.shipWhite);
    v.box(0, dy + 6.5, bz, bw - 1.0, 2.6, bl - 1.4, PAL.shipWhite);
    v.box(0, dy + 9.0, bz + 0.2, bw + 2.2, 2.4, bl - 2.4, PAL.shipWhite); // bridge with wings
    v.box(0, dy + 10.3, bz + 0.2, bw + 2.6, 0.2, bl - 2.0, 0x8f9aa0);
    // windows (self-lit)
    const winY = [dy + 4.1, dy + 6.7];
    const frontZ = zb1 - 0.38;
    for (const wy of winY) {
      const n = Math.floor((bw - 2) / 1.3);
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * 1.3;
        const lit = rng() < 0.62;
        const col = lit ? (rng() < 0.75 ? 0xffd89a : 0xbfe3ff) : 0x1c2a33;
        (lit ? glow : v).box(x, wy, wy > dy + 5 ? frontZ - 0.3 : frontZ, 0.72, 0.6, 0.08, col);
      }
    }
    // bridge windows: a continuous band, cool light
    const nb = Math.floor((bw + 1.6) / 1.05);
    for (let i = 0; i < nb; i++) {
      const x = (i - (nb - 1) / 2) * 1.05;
      glow.box(x, dy + 9.25, zb1 - 1.02 + 0.2, 0.86, 0.72, 0.08, 0xcfeaff, null, 0.8);
    }
    // side portholes
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const lit = rng() < 0.6;
        (lit ? glow : v).box(sx * (bw / 2 - 0.48), dy + 4.1, zb0 + 1.6 + i * 1.7, 0.08, 0.5, 0.7, lit ? 0xffd89a : 0x1c2a33);
      }
    }
    // funnel with company band
    const fz = zb0 + 1.9;
    v.box(0, dy + 9.2, fz, 2.3, 5.4, 2.4, st.hull);
    v.box(0, dy + 10.6, fz, 2.36, 1.1, 2.46, st.band);
    v.box(0, dy + 12.05, fz, 1.9, 0.3, 2.0, 0x15191c);
    this.funnelTop = new THREE.Vector3(0, dy + 12.3, fz);
    // radar mast + nav lights
    v.box(0, dy + 11.9, bz + 0.6, 0.2, 3.0, 0.2, 0xc9c4b6);
    v.box(0, dy + 12.6, bz + 0.6, 2.0, 0.14, 0.14, 0xc9c4b6);
    glow.box(0, dy + 13.5, bz + 0.6, 0.24, 0.24, 0.24, 0xfff2d0);
    glow.box(bw / 2 + 1.2, dy + 9.6, bz + 0.2, 0.2, 0.2, 0.2, 0x48ff7a); // starboard (far side from quay is +X)
    glow.box(-bw / 2 - 1.2, dy + 9.6, bz + 0.2, 0.2, 0.2, 0.2, 0xff4a3a);
    this.mastTop = new THREE.Vector3(0, dy + 13.5, bz + 0.6);
    // lifeboat on the seaward side
    v.box(bw / 2 - 0.2, dy + 4.3, bz - 1.0, 1.1, 1.0, 3.2, 0xe2742b);
    v.box(bw / 2 - 0.2, dy + 5.0, bz - 1.0, 0.9, 0.4, 2.4, 0xb85a1e);
    // stern deck clutter
    v.box(-hb * 0.5, dy + 0.5, this.zStern + 0.9, 1.4, 1.0, 0.9, 0x3a4248);
    v.cyl(hb * 0.4, dy + 0.45, this.zStern + 0.9, 0.5, 0.9, 0x6f3b28, 8);

    // deck floodlight masts between bridge and cargo (lights aimed forward over the hatches)
    this.deckLamps = [];
    for (const sx of [-1, 1]) {
      const lx = sx * (bw / 2 + 0.6);
      glow.box(lx, dy + 10.05, zb1 - 1.3, 0.6, 0.22, 0.3, 0xffe2b0);
      this.deckLamps.push(new THREE.Vector3(lx, dy + 10.0, zb1 - 1.4));
    }

    this.mesh = v.mesh(MAT.vox);
    this.group.add(this.mesh);
    this.glowMesh = glow.mesh(MAT.glow, { cast: false, receive: false });
    this.group.add(this.glowMesh);

    // rotating radar bar
    const rv = new Vox();
    rv.box(0, 0, 0, 2.6, 0.18, 0.3, 0xe2ddd0);
    this.radar = rv.mesh(MAT.vox, { cast: false });
    this.radar.position.set(0, dy + 11.0, bz + 1.4);
    this.group.add(this.radar);

    // name plates on both bow sides + stern
    const nameTex = this._nameTexture(this.name);
    const plateGeo = new THREE.PlaneGeometry(7.2, 1.2);
    const plateMat = new THREE.MeshBasicMaterial({ map: nameTex, transparent: true, fog: true, toneMapped: true });
    plateMat.color.setScalar(0.75);
    const p1 = new THREE.Mesh(plateGeo, plateMat);
    p1.position.set(-hb * 0.985 - 0.02, dy - 0.25, this.zShoulder - 4.4);
    p1.rotation.y = -Math.PI / 2;
    this.group.add(p1);
    const p2 = new THREE.Mesh(plateGeo, plateMat);
    p2.position.set(hb * 0.985 + 0.02, dy - 0.25, this.zShoulder - 4.4);
    p2.rotation.y = Math.PI / 2;
    this.group.add(p2);

    // warm pools of light on the aft deck + nav halos
    const halo1 = glowSprite(0xfff0c8, 2.6, 0.9);
    halo1.position.copy(this.mastTop);
    this.group.add(halo1);
    const halo2 = glowSprite(0xfff0c8, 2.0, 0.8);
    halo2.position.copy(this.foreLight);
    this.group.add(halo2);
    for (const p of this.deckLamps) {
      const hsp = glowSprite(PAL.sodiumHot, 4.2, 0.7);
      hsp.position.copy(p);
      this.group.add(hsp);
    }

    this.zoneGroup = new THREE.Group();
    this.group.add(this.zoneGroup);
    this.cargoGroup = new THREE.Group();
    this.group.add(this.cargoGroup);
  }

  _nameTexture(name) {
    const c = makeCanvas(512, 96);
    const g = c.getContext('2d');
    g.clearRect(0, 0, 512, 96);
    g.font = '64px "Saira Stencil One", "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#e9e3d2';
    g.fillText(name, 256, 52);
    return canvasTexture(c, { aniso: 8 });
  }

  /** Paints bay markings for the level's zone layout. */
  paintZones() {
    const zg = this.zoneGroup;
    while (zg.children.length) {
      const ch = zg.children.pop();
      ch.geometry.dispose();
      if (ch.material.map) ch.material.map.dispose();
      ch.material.dispose();
    }
    const dy = DIM.DECK_Y + 0.135;
    for (let b = 0; b < this.bays; b++) {
      // group consecutive rows that share a zone into one painted panel
      let r0 = 0;
      while (r0 < this.rows) {
        const zid = this.zoneOf(r0, b);
        let r1 = r0;
        while (r1 + 1 < this.rows && this.zoneOf(r1 + 1, b) === zid) r1++;
        const zone = ZONES[zid] || ZONES.ANY;
        const w = (r1 - r0 + 1) * DIM.CELL_X - 0.3;
        const l = DIM.CELL_Z - 0.6;
        const S = 44; // pixels per metre
        const cw = Math.round(w * S);
        const ch = Math.round(l * S);
        const c = makeCanvas(cw, ch);
        const g = c.getContext('2d');
        g.clearRect(0, 0, cw, ch);
        const col = '#' + new THREE.Color(zone.color).getHexString();
        g.strokeStyle = col;
        g.lineWidth = 9;
        g.setLineDash([30, 12]);
        g.strokeRect(8, 8, cw - 16, ch - 16);
        g.setLineDash([]);
        g.globalAlpha = 0.14;
        g.fillStyle = col;
        g.fillRect(14, 14, cw - 28, ch - 28);
        g.globalAlpha = 0.9;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = col;
        if (zid !== 'ANY') {
          g.save();
          g.translate(cw / 2, ch / 2);
          const along = cw < ch * 0.8; // narrow panel: run the code along the bay
          if (along) g.rotate(-Math.PI / 2);
          const span = along ? ch : cw;
          g.font = `${Math.round(Math.min(span * 0.34, (along ? cw : ch) * 0.62))}px "Saira Stencil One", "Arial Black", sans-serif`;
          g.fillText(zone.id, 0, 4);
          g.restore();
        }
        const tex = canvasTexture(c, { aniso: 8 });
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: true });
        mat.color.setScalar(zid === 'ANY' ? 0.45 : 0.9);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), mat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(((r0 + r1) / 2 - (this.rows - 1) / 2) * DIM.CELL_X, dy, this.bayZ(b));
        m.renderOrder = 1;
        zg.add(m);
        r0 = r1 + 1;
      }
    }
  }

  _buildBody() {
    const p = this.phys;
    const dy = DIM.DECK_Y;
    this.body = p.kinematicBody(this.origin.x, 0, this.origin.z);
    const tag = { kind: 'ship', ship: this };
    const hb = this.halfBeam;
    const len = this.zShoulder - this.zStern;
    // main hull + deck slab
    p.box(hb - 0.1, (dy + 2.2) / 2, len / 2, { body: this.body, y: (dy - 2.2) / 2, z: (this.zShoulder + this.zStern) / 2, friction: 0.85, tag });
    // bow wedge (two rotated slabs approximating the taper)
    p.box(hb * 0.62, (dy + 3.7) / 2, 4.2, { body: this.body, y: (dy + 1.5 - 2.2) / 2, z: this.zShoulder + 3.6, tag });
    // bulwarks: quay side, sea side, stern
    const bh = 0.5;
    p.box(0.12, bh, len / 2, { body: this.body, x: -hb + 0.14, y: dy + bh, z: (this.zShoulder + this.zStern) / 2, tag });
    p.box(0.12, bh, len / 2, { body: this.body, x: hb - 0.14, y: dy + bh, z: (this.zShoulder + this.zStern) / 2, tag });
    p.box(hb, bh, 0.12, { body: this.body, y: dy + bh, z: this.zStern + 0.14, tag });
    // superstructure block
    const zb0 = this.zStern + 1.2;
    const zb1 = -this.cargoLen / 2 - 1.9;
    p.box(hb - 0.3, 5.2, (zb1 - zb0) / 2, { body: this.body, y: dy + 5.2, z: (zb0 + zb1) / 2, tag: { kind: 'bridge', ship: this } });
    // forecastle
    p.box(hb * 0.9, 0.75, 1.6, { body: this.body, y: dy + 0.75, z: this.zShoulder + 2.0, tag });
  }

  // ------------------------------------------------------------------ slots

  rowX(r) {
    return (r - (this.rows - 1) / 2) * DIM.CELL_X;
  }
  bayZ(b) {
    return (b - (this.bays - 1) / 2) * DIM.CELL_Z;
  }
  tierY(t) {
    return DIM.DECK_Y + 0.12 + DIM.CONT_H / 2 + t * DIM.CONT_H;
  }
  cellLocal(r, b, t, out = new THREE.Vector3()) {
    return out.set(this.rowX(r), this.tierY(t), this.bayZ(b));
  }
  height(r, b) {
    return this.grid[r][b].length;
  }
  top(r, b) {
    const s = this.grid[r][b];
    return s.length ? s[s.length - 1] : null;
  }
  count() {
    let n = 0;
    for (const row of this.grid) for (const s of row) n += s.length;
    return n;
  }
  forEachCargo(fn) {
    for (let r = 0; r < this.rows; r++) for (let b = 0; b < this.bays; b++) for (const c of this.grid[r][b]) fn(c, r, b);
  }

  /** Nearest column for a ship-local position. Returns null when outside the cargo area. */
  columnAt(lx, lz, margin = 0.2) {
    const fr = lx / DIM.CELL_X + (this.rows - 1) / 2;
    const fb = lz / DIM.CELL_Z + (this.bays - 1) / 2;
    const r = Math.round(fr);
    const b = Math.round(fb);
    if (r < 0 || r >= this.rows || b < 0 || b >= this.bays) return null;
    if (Math.abs(fr - r) > 0.5 + margin || Math.abs(fb - b) > 0.5 + margin) return null;
    return { r, b, dx: lx - this.rowX(r), dz: lz - this.bayZ(b) };
  }

  // ------------------------------------------------------------------ motion

  setSea(level) {
    // level 0 (mirror calm) .. 1 (storm)
    const l = clamp(level, 0, 1.3);
    this.sea.roll = 0.006 + l * 0.058;
    this.sea.heave = 0.03 + l * 0.42;
    this.sea.pitch = 0.002 + l * 0.016;
    this.sea.sway = 0.02 + l * 0.2;
  }

  /** Kick the ship (e.g. heavy touchdown): impulse in "roll" and "heave" velocity. */
  bump(rollV, heaveV) {
    this.kick.rollV += rollV;
    this.kick.heaveV += heaveV;
  }

  _recomputeLoad() {
    let moment = 0;
    let mass = 0;
    this.forEachCargo((c, r) => {
      moment += c.mass * this.rowX(r);
      mass += c.mass;
    });
    this.targetList = clamp(-moment * 0.0022, -0.05, 0.05);
    this.targetDraft = Math.min(0.7, mass * 0.012);
  }

  _applyPose(t) {
    const s = this.sea;
    const k = this.seaScale;
    const ph = this.phase;
    const roll = k * s.roll * (Math.sin(0.62 * t + ph) * 0.68 + Math.sin(0.97 * t + ph * 2.1) * 0.32) + this.kick.roll + this.list;
    const heave = k * s.heave * (Math.sin(0.51 * t + ph * 0.7) * 0.7 + Math.sin(0.93 * t + 1.1) * 0.3) + this.kick.heave - this.draft;
    const pitch = k * s.pitch * Math.sin(0.44 * t + ph * 1.6);
    const sway = k * s.sway * Math.sin(0.33 * t + ph * 0.4);
    const P = this.pose;
    P.x = this.origin.x + sway * 0.5 + this.offsetX;
    P.y = heave;
    P.z = this.origin.z + sway + this.offsetZ;
    P.roll = roll;
    P.pitch = pitch;
  }

  fixedUpdate(t, h) {
    // damped spring for bumps
    const kk = this.kick;
    kk.rollV += (-kk.roll * 9 - kk.rollV * 2.2) * h;
    kk.roll += kk.rollV * h;
    kk.heaveV += (-kk.heave * 14 - kk.heaveV * 3.0) * h;
    kk.heave += kk.heaveV * h;
    this.list = damp(this.list, this.targetList || 0, 0.9, h);
    this.draft = damp(this.draft, this.targetDraft || 0, 0.9, h);
    this._applyPose(t);
    const P = this.pose;
    _q.setFromEuler(_e.set(P.pitch, 0, P.roll, 'YXZ'));
    this.body.setNextKinematicTranslation({ x: P.x, y: P.y, z: P.z });
    this.body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
  }

  /** Copy the physics pose to the visual group (called every rendered frame). */
  syncVisual(t) {
    const tr = this.body.translation();
    const ro = this.body.rotation();
    this.group.position.set(tr.x, tr.y, tr.z);
    this.group.quaternion.set(ro.x, ro.y, ro.z, ro.w);
    this.group.updateMatrixWorld(true);
    if (t !== undefined && this.radar) this.radar.rotation.y = t * 1.6;
  }

  /** Teleport body (used while the ship sails in/out and at setup). */
  snapBody() {
    const P = this.pose;
    _q.setFromEuler(_e.set(P.pitch, 0, P.roll, 'YXZ'));
    this.body.setTranslation({ x: P.x, y: P.y, z: P.z }, true);
    this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
  }

  worldToLocal(v, out = new THREE.Vector3()) {
    return out.copy(v).applyMatrix4(_m.copy(this.group.matrixWorld).invert());
  }
  localToWorld(v, out = new THREE.Vector3()) {
    return out.copy(v).applyMatrix4(this.group.matrixWorld);
  }
  /** World-space up vector of the deck. */
  up(out = new THREE.Vector3()) {
    return out.set(0, 1, 0).applyQuaternion(this.group.quaternion);
  }

  // ------------------------------------------------------------------ cargo locking

  /** Attach a container to the grid (becomes part of the ship's kinematic body). */
  lock(cargo, r, b) {
    const t = this.grid[r][b].length;
    this.grid[r][b].push(cargo);
    const lp = this.cellLocal(r, b, t);
    cargo.cell = { r, b, t };
    cargo.collider = this.phys.box(cargo.hx, cargo.hy, cargo.hz, {
      body: this.body,
      x: lp.x,
      y: lp.y,
      z: lp.z,
      friction: 0.8,
      events: true,
      eventThreshold: 60,
      tag: { kind: 'cargo', cargo },
    });
    this.cargoGroup.add(cargo.mesh);
    cargo.mesh.position.copy(lp);
    cargo.mesh.quaternion.identity();
    this._recomputeLoad();
    return lp;
  }

  /** Detach (for re-grabbing or when knocked loose). Leaves the mesh in world space. */
  unlock(cargo, scene) {
    const { r, b } = cargo.cell;
    const stack = this.grid[r][b];
    const i = stack.indexOf(cargo);
    if (i >= 0) stack.splice(i, 1);
    this.phys.removeCollider(cargo.collider);
    cargo.collider = null;
    cargo.cell = null;
    scene.attach(cargo.mesh);
    this._recomputeLoad();
  }

  dispose() {
    this.phys.removeBody(this.body);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material.map && o.material !== MAT.vox) o.material.map.dispose();
    });
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
