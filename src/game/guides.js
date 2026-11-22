// In-world placement aids: drop reticle + plumb beam, target-cell ghosts, pick markers, warning tags.
import * as THREE from 'three';
import { DIM, ZONES } from '../config.js';
import { makeCanvas, canvasTexture } from '../world/vox.js';
import { clamp, damp } from '../core/util.js';

const COL = {
  idle: new THREE.Color(0x9fd8ff),
  near: new THREE.Color(0xffc24a),
  good: new THREE.Color(0x5dff9a),
  bad: new THREE.Color(0xff4d3d),
};

function tagTexture(kind) {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  const col = kind === 'warn' || kind === 'check' ? '#ffb020' : kind === 'bad' ? '#ff4d3d' : kind === 'out' ? '#49d1c4' : kind === 'customs' ? '#4d9bff' : kind === 'black' ? '#8dffe2' : '#5dff9a';
  g.fillStyle = 'rgba(8,12,16,0.82)';
  g.beginPath();
  g.arc(64, 60, 46, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = col;
  g.stroke();
  g.beginPath();
  g.moveTo(50, 100);
  g.lineTo(64, 124);
  g.lineTo(78, 100);
  g.closePath();
  g.fillStyle = col;
  g.fill();
  g.fillStyle = col;
  g.font = '700 70px "Barlow Condensed", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(kind === 'warn' ? '!' : kind === 'bad' ? '×' : kind === 'out' || kind === 'customs' ? '↧' : kind === 'check' || kind === 'black' ? '?' : '↓', 64, kind === 'out' || kind === 'customs' ? 60 : 64);
  return canvasTexture(c, { aniso: 4 });
}

export class Guides {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.color = COL.idle.clone();
    this.t = 0;

    // --- reticle: four corner brackets + soft fill
    this.reticle = new THREE.Group();
    this.reticleMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.95, depthWrite: false, fog: false });
    this.fillMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.1, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const hw = DIM.CONT_W / 2;
    const hl = DIM.CONT_L / 2;
    this.corners = [];
    const bar = new THREE.BoxGeometry(1, 0.05, 1);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const cg = new THREE.Group();
        const a = new THREE.Mesh(bar, this.reticleMat);
        a.scale.set(0.9, 1, 0.14);
        a.position.set(-sx * 0.45, 0, 0);
        const b = new THREE.Mesh(bar, this.reticleMat);
        b.scale.set(0.14, 1, 1.5);
        b.position.set(0, 0, -sz * 0.75);
        cg.add(a, b);
        cg.userData.base = new THREE.Vector3(sx * hw, 0, sz * hl);
        this.reticle.add(cg);
        this.corners.push(cg);
      }
    }
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(DIM.CONT_W, DIM.CONT_L), this.fillMat);
    fill.rotation.x = -Math.PI / 2;
    this.reticle.add(fill);
    this.reticleFill = fill;
    // centre cross
    const cx = new THREE.Mesh(bar, this.reticleMat);
    cx.scale.set(0.7, 1, 0.08);
    const cz = new THREE.Mesh(bar, this.reticleMat);
    cz.scale.set(0.08, 1, 0.7);
    this.reticle.add(cx, cz);
    this.cross = [cx, cz];
    // a bad spot is a different SHAPE, not just a different colour: a big X instead of the plus
    const xa = new THREE.Mesh(bar, this.reticleMat);
    xa.scale.set(1.9, 1, 0.16);
    xa.rotation.y = Math.PI / 4;
    const xb = new THREE.Mesh(bar, this.reticleMat);
    xb.scale.set(1.9, 1, 0.16);
    xb.rotation.y = -Math.PI / 4;
    this.xMark = new THREE.Group();
    this.xMark.add(xa, xb);
    this.xMark.visible = false;
    this.reticle.add(this.xMark);
    // high-contrast drop shadow: a dark footprint under the load, readable on any deck or quay
    this.shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false, fog: false });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(DIM.CONT_W + 0.5, DIM.CONT_L + 0.5), this.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.02;
    shadow.renderOrder = 5;
    this.reticle.add(shadow);
    this.reticleShadow = shadow;
    this.reticle.renderOrder = 6;
    this.reticle.visible = false;
    this.group.add(this.reticle);

    // --- plumb beam
    const beamGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 5, 1, true);
    beamGeo.translate(0, -0.5, 0);
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.5, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    this.beams = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(beamGeo, this.beamMat);
      m.visible = false;
      m.frustumCulled = false;
      this.group.add(m);
      this.beams.push(m);
    }

    // --- target ghosts (parented to the ship by the session)
    this.ghostGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(DIM.CONT_W - 0.06, DIM.CONT_H - 0.06, DIM.CONT_L - 0.06));
    this.ghostFillGeo = new THREE.BoxGeometry(DIM.CONT_W - 0.1, DIM.CONT_H - 0.1, DIM.CONT_L - 0.1);
    this.ghosts = [];
    this.ghostParent = null;

    // --- floating tags
    this.tagTex = {};
    for (const k of ['pick', 'warn', 'bad', 'out', 'check', 'black', 'customs']) this.tagTex[k] = tagTexture(k);
    this.tags = [];
  }

  _ghost(i) {
    while (this.ghosts.length <= i) {
      const line = new THREE.LineSegments(this.ghostGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, fog: false }));
      const fill = new THREE.Mesh(this.ghostFillGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false, fog: false }));
      line.add(fill);
      line.userData.fill = fill;
      const xg = new THREE.LineSegments(this._xGeo || (this._xGeo = xGeometry()), line.material);
      xg.position.y = DIM.CONT_H / 2 - 0.03;
      xg.visible = false;
      line.add(xg);
      line.userData.x = xg;
      line.renderOrder = 4;
      line.visible = false;
      this.ghosts.push(line);
    }
    return this.ghosts[i];
  }

  /**
   * @param parent  THREE.Object3D the ghosts live in (ship group) or null to hide
   * @param cells   [{ pos: Vector3 (parent-local), color: hex, best: bool, ok: bool }]
   */
  setGhosts(parent, cells) {
    if (this.ghostParent !== parent) {
      for (const g of this.ghosts) if (g.parent) g.parent.remove(g);
      this.ghostParent = parent;
    }
    const n = parent ? cells.length : 0;
    for (let i = 0; i < Math.max(n, this.ghosts.length); i++) {
      const g = this._ghost(i);
      if (i >= n) {
        g.visible = false;
        continue;
      }
      const c = cells[i];
      if (g.parent !== parent) parent.add(g);
      g.visible = true;
      g.position.copy(c.pos);
      g.scale.z = c.long ? DIM.L40 / DIM.CONT_L : 1;
      g.material.color.setHex(c.ok ? c.color : 0xff4d3d);
      g.userData.x.visible = !c.ok;
      g.userData.fill.material.color.copy(g.material.color);
      g.userData.best = c.best;
      g.userData.phase = i * 0.7;
    }
  }

  _tag(i) {
    while (this.tags.length <= i) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tagTex.pick, transparent: true, depthTest: false, depthWrite: false, fog: false }));
      s.renderOrder = 20;
      s.visible = false;
      this.group.add(s);
      this.tags.push(s);
    }
    return this.tags[i];
  }

  /** @param list [{ pos: Vector3 (world), kind: 'pick'|'warn'|'bad'|'out', size }] */
  setTags(list) {
    for (let i = 0; i < Math.max(list.length, this.tags.length); i++) {
      const s = this._tag(i);
      if (i >= list.length) {
        s.visible = false;
        continue;
      }
      const t = list[i];
      s.visible = true;
      s.material.map = this.tagTex[t.kind] || this.tagTex.pick;
      const bob = t.kind !== 'warn' && t.kind !== 'bad' ? Math.abs(Math.sin(this.t * 3.2 + i)) * 0.5 : 0;
      s.position.copy(t.pos);
      s.position.y += 1.5 + bob;
      const sz = t.size || 1.9;
      s.scale.set(sz, sz, 1);
      s.material.opacity = t.alpha == null ? 0.95 : t.alpha;
    }
  }

  /**
   * @param o { visible, pos (world hit point), quat, height (m above the surface), state: idle|near|good|bad,
   *            from (world bottom-centre of the load), fromQuat }
   */
  setReticle(o, dt) {
    this.t += dt;
    if (!o || !o.visible) {
      this.reticle.visible = false;
      for (const b of this.beams) b.visible = false;
      return;
    }
    this.reticle.visible = true;
    this.reticle.position.copy(o.pos);
    this.reticle.position.y += 0.07;
    this.reticle.quaternion.copy(o.quat);
    const target = COL[o.state] || COL.idle;
    this.color.lerp(target, clamp(dt * 12, 0, 1));
    this.reticleMat.color.copy(this.color);
    this.fillMat.color.copy(this.color);
    this.beamMat.color.copy(this.color);
    const spread = 1 + clamp(o.height / 9, 0, 1) * 0.55;
    const pulse = o.state === 'good' ? 1 + Math.sin(this.t * 9) * 0.03 : 1;
    const lz = o.long ? DIM.L40 / DIM.CONT_L : 1;
    for (const c of this.corners) {
      c.position.copy(c.userData.base).multiplyScalar(spread * pulse);
      c.position.z *= lz;
    }
    this.reticleFill.scale.y = lz;
    this.reticleShadow.scale.y = lz;
    const bad = o.state === 'bad';
    this.xMark.visible = bad;
    this.xMark.scale.z = lz;
    for (const m of this.cross) m.visible = !bad;
    // the shadow tightens and darkens as the load comes down
    this.shadowMat.opacity = clamp(0.62 - o.height * 0.03, 0.3, 0.62);
    this.fillMat.opacity = o.state === 'good' ? 0.32 + Math.sin(this.t * 9) * 0.08 : bad ? 0.16 : 0.08;
    this.reticleMat.opacity = clamp(0.55 + o.height * 0.05, 0.55, 0.95);
    // four plumb lines from the load's lower corners
    let k = 0;
    const hw = DIM.CONT_W / 2;
    const hl = (o.long ? DIM.L40 : DIM.CONT_L) / 2;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const b = this.beams[k++];
        b.visible = o.height > 0.25;
        b.position.set(sx * hw, 0, sz * hl).applyQuaternion(o.fromQuat).add(o.from);
        b.scale.set(1, Math.max(0.01, o.height), 1);
        b.quaternion.identity();
      }
    }
    this.beamMat.opacity = 0.22 + 0.25 * clamp(1 - o.height / 14, 0, 1);
  }

  update(dt) {
    // after a wrong drop the valid cells pulse hard for a few seconds (alert counts down)
    if (this.alert > 0) this.alert -= dt;
    const loud = this.alert > 0;
    for (const g of this.ghosts) {
      if (!g.visible) continue;
      const best = g.userData.best;
      const p = 0.5 + 0.5 * Math.sin(this.t * (loud ? 11 : 4.2) + g.userData.phase);
      g.material.opacity = best || loud ? 0.75 + p * 0.25 : 0.2 + p * 0.12;
      g.userData.fill.material.opacity = best ? 0.1 + p * 0.1 : loud ? 0.06 + p * 0.12 : 0.025;
    }
  }

  hideAll() {
    this.setGhosts(null, []);
    this.setTags([]);
    this.setReticle(null, 0);
  }

  dispose() {
    this.hideAll();
    for (const g of this.ghosts) {
      if (g.parent) g.parent.remove(g);
      g.material.dispose();
      g.userData.fill.material.dispose();
    }
    this.ghostGeo.dispose();
    this.ghostFillGeo.dispose();
    if (this._xGeo) this._xGeo.dispose();
    const seen = new Set();
    this.group.traverse((o) => {
      if (o.geometry && !seen.has(o.geometry)) {
        seen.add(o.geometry);
        o.geometry.dispose();
      }
      if (o.material && !seen.has(o.material)) {
        seen.add(o.material);
        o.material.dispose();
      }
    });
    for (const k in this.tagTex) this.tagTex[k].dispose();
    this.scene.remove(this.group);
  }
}

/** Two diagonals across a container's top face (marks a cell that will not take this box). */
function xGeometry() {
  const hw = DIM.CONT_W / 2 - 0.1;
  const hl = DIM.CONT_L / 2 - 0.1;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-hw, 0, -hl, hw, 0, hl, hw, 0, -hl, -hw, 0, hl], 3));
  return g;
}

export const zoneColor = (id) => (ZONES[id] || ZONES.ANY).color;
export { damp as _damp };
