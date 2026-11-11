// Static harbour set: quay, rails, lamp masts, container yard, terminal office, skyline, sky dome.
import * as THREE from 'three';
import { Vox, MAT, makeCanvas, canvasTexture, glowSprite, lightCone } from './vox.js';
import { DIM, PAL, ZONES } from '../config.js';
import { makeRng, noise1 } from '../core/util.js';

const QUAY_MIN_X = -92;
const QUAY_Z = 170;

function concreteTextures(aniso) {
  const S = 256;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const rng = makeRng(77);
  g.fillStyle = '#7b8185';
  g.fillRect(0, 0, S, S);
  // aggregate speckle
  for (let i = 0; i < 5200; i++) {
    const v = 105 + Math.floor(rng() * 60);
    g.fillStyle = `rgba(${v},${v + 3},${v + 6},${0.25 + rng() * 0.4})`;
    g.fillRect(rng() * S, rng() * S, 1 + rng() * 2, 1 + rng() * 2);
  }
  // slab joints
  g.fillStyle = 'rgba(30,34,38,0.75)';
  g.fillRect(0, 0, S, 3);
  g.fillRect(0, 0, 3, S);
  g.fillStyle = 'rgba(210,214,218,0.12)';
  g.fillRect(0, 3, S, 2);
  g.fillRect(3, 0, 2, S);
  // oil stains, tyre scuffs, hairline cracks
  for (let i = 0; i < 9; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 8 + rng() * 26;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(22,26,30,${0.18 + rng() * 0.22})`);
    grd.addColorStop(1, 'rgba(22,26,30,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.strokeStyle = 'rgba(25,28,32,0.5)';
  g.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    let x = rng() * S;
    let y = rng() * S;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (rng() - 0.5) * 40;
      y += (rng() - 0.5) * 40;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const map = canvasTexture(c, { repeat: true, aniso });

  // roughness: large soft puddles (dark = glossy)
  const r = makeCanvas(S, S);
  const rg = r.getContext('2d');
  rg.fillStyle = '#b8b8b8';
  rg.fillRect(0, 0, S, S);
  for (let i = 0; i < 16; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const rad = 14 + rng() * 42;
    for (const [ox, oy] of [
      [0, 0],
      [S, 0],
      [-S, 0],
      [0, S],
      [0, -S],
    ]) {
      const grd = rg.createRadialGradient(x + ox, y + oy, rad * 0.35, x + ox, y + oy, rad);
      grd.addColorStop(0, 'rgba(26,26,26,0.95)');
      grd.addColorStop(1, 'rgba(26,26,26,0)');
      rg.fillStyle = grd;
      rg.beginPath();
      rg.ellipse(x + ox, y + oy, rad, rad * (0.5 + rng() * 0.5), rng() * 3, 0, Math.PI * 2);
      rg.fill();
    }
  }
  const rough = canvasTexture(r, { repeat: true, aniso, srgb: false });
  return { map, rough };
}

function windowTexture(seed, cols, rows, litChance, warm = 0.75) {
  const cw = 8;
  const ch = 10;
  const c = makeCanvas(cols * cw, rows * ch);
  const g = c.getContext('2d');
  const rng = makeRng(seed);
  g.fillStyle = '#0b1118';
  g.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < rows; y++) {
    const floorLit = rng() < 0.2;
    for (let x = 0; x < cols; x++) {
      const lit = rng() < (floorLit ? litChance * 1.9 : litChance);
      if (!lit) {
        g.fillStyle = '#101a24';
        g.fillRect(x * cw + 2, y * ch + 3, cw - 3, ch - 5);
        continue;
      }
      const w = rng() < warm;
      const b = 0.55 + rng() * 0.45;
      g.fillStyle = w ? `rgba(255,${190 + Math.floor(rng() * 40)},${110 + Math.floor(rng() * 50)},${b})` : `rgba(${170 + Math.floor(rng() * 40)},220,255,${b})`;
      g.fillRect(x * cw + 2, y * ch + 3, cw - 3, ch - 5);
    }
  }
  const t = canvasTexture(c, { nearest: true, aniso: 2 });
  t.magFilter = THREE.NearestFilter;
  return t;
}

function signTexture(lines, w = 512, hgt = 128, fg = '#ffcf7a', bg = '#10161b') {
  const c = makeCanvas(w, hgt);
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, hgt);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = fg;
  g.font = `${Math.round(hgt * 0.56)}px "Saira Stencil One", "Arial Black", sans-serif`;
  g.fillText(lines[0], w / 2, lines[1] ? hgt * 0.4 : hgt * 0.54);
  if (lines[1]) {
    g.font = `700 ${Math.round(hgt * 0.2)}px "Barlow Condensed", Arial, sans-serif`;
    g.fillText(lines[1], w / 2, hgt * 0.82);
  }
  return canvasTexture(c, { aniso: 8 });
}

function groundText(text, size = 256, col = '#e3ac2f') {
  const c = makeCanvas(size * 2, size / 2);
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.font = `${Math.round(size * 0.42)}px "Saira Stencil One", "Arial Black", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = col;
  g.fillText(text, size, size / 4 + 4);
  // worn paint
  g.globalCompositeOperation = 'destination-out';
  const rng = makeRng(text.length * 13 + 5);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(0,0,0,${0.3 + rng() * 0.5})`;
    g.fillRect(rng() * c.width, rng() * c.height, 2 + rng() * 10, 1 + rng() * 3);
  }
  return canvasTexture(c, { aniso: 8 });
}

export class Harbor {
  constructor(scene, { mobile = false, aniso = 4 } = {}) {
    this.scene = scene;
    this.mobile = mobile;
    this.group = new THREE.Group();
    this.group.name = 'harbor';
    scene.add(this.group);
    this.lampLights = [];
    this.flickers = [];
    this.blinkers = [];
    this.lampHeads = []; // world positions, used for water glints
    this.aniso = aniso;
    this._sky();
    this._quay();
    this._lamps();
    this._yard();
    this._office();
    this._props();
    this._skyline();
    this._farPort();
    this._lights();
  }

  // ---------------------------------------------------------------- sky

  _sky() {
    const geo = new THREE.SphereGeometry(900, 24, 14);
    this.skyUniforms = {
      uTop: { value: new THREE.Color(PAL.skyTop) },
      uMid: { value: new THREE.Color(PAL.skyMid) },
      uGlow: { value: new THREE.Color(PAL.skyGlow) },
      uFlash: { value: 0 },
      uTime: { value: 0 },
      uClouds: { value: 0.6 },
    };
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: this.skyUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uGlow;
        uniform float uFlash; uniform float uTime; uniform float uClouds;
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) { float a = 0.5; float s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.1, 1.0);
          vec3 col = mix(uMid, uTop, smoothstep(0.0, 0.55, h));
          // city glow hugging the horizon, strongest towards the far shore (-Z / +X)
          float az = 0.5 + 0.5 * dot(normalize(d.xz + 1e-4), normalize(vec2(0.55, -0.83)));
          float glow = exp(-max(h, 0.0) * 9.0) * (0.35 + 0.65 * az);
          col += uGlow * glow * 0.9;
          // slow overcast with moonlit breaks
          vec2 cp = d.xz / (0.25 + max(h, 0.0)) * 1.3 + vec2(uTime * 0.006, uTime * 0.003);
          float c = fbm(cp);
          float cover = smoothstep(1.0 - uClouds, 1.2 - uClouds * 0.6, c + 0.25);
          vec3 cloudCol = mix(uMid * 1.6, uGlow * 0.55, exp(-max(h, 0.0) * 5.0));
          col = mix(col, cloudCol, cover * smoothstep(0.02, 0.3, h) * 0.75);
          // stars in the gaps
          vec2 sp = d.xz / (0.4 + d.y) * 90.0;
          float st = step(0.9975, hash(floor(sp))) * smoothstep(0.15, 0.5, h) * (1.0 - cover);
          col += vec3(0.75, 0.82, 1.0) * st * (0.5 + 0.5 * sin(uTime * 2.0 + hash(floor(sp)) * 40.0));
          // moon
          vec3 md = normalize(vec3(0.42, 0.5, -0.76));
          float m = dot(d, md);
          col += vec3(0.85, 0.9, 1.0) * smoothstep(0.9993, 0.9996, m) * (1.0 - cover * 0.8);
          col += vec3(0.25, 0.32, 0.45) * pow(max(m, 0.0), 180.0) * 0.6;
          col += vec3(0.6, 0.7, 1.0) * uFlash * (0.25 + 0.75 * smoothstep(0.6, 0.0, h));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.sky = sky;
    this.scene.add(sky);
  }

  // ---------------------------------------------------------------- quay

  _quay() {
    const q = DIM.QUAY_Y;
    const { map, rough } = concreteTextures(this.aniso);
    const lenX = -QUAY_MIN_X;
    const lenZ = QUAY_Z * 2;
    map.repeat.set(lenX / 6, lenZ / 6);
    rough.repeat.set(lenX / 23, lenZ / 23);
    const gmat = this.mobile
      ? new THREE.MeshPhongMaterial({ map, color: 0x9da2a6, shininess: 42, specular: 0x3a3f44 })
      : new THREE.MeshStandardMaterial({ map, roughnessMap: rough, roughness: 1.0, metalness: 0.0, color: 0xa5aaad });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(lenX, lenZ), gmat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(QUAY_MIN_X / 2, q, 0);
    ground.receiveShadow = true;
    this.group.add(ground);
    this.ground = ground;

    const v = new Vox();
    // quay wall + cope edge
    v.boxMin(-1.2, -6, -QUAY_Z, 1.2, q + 6, QUAY_Z * 2, 0x3f4549);
    v.boxMin(-1.4, q - 0.02, -QUAY_Z, 1.45, 0.14, QUAY_Z * 2, 0x595f63);
    // yellow/black edge kerb
    for (let z = -60; z < 60; z += 2) v.box(-0.25, q + 0.16, z + 0.5, 0.5, 0.2, 1.0, (z / 2) % 2 ? 0x16181a : PAL.lineYellow);
    // rubber fenders + ladders
    for (let z = -54; z <= 54; z += 9) {
      v.box(0.42, q - 1.5, z, 0.8, 2.0, 1.5, 0x121416);
      v.box(0.42, q - 1.5, z, 0.9, 0.5, 1.6, 0x1c1f22);
    }
    for (const z of [-22.5, 22.5]) {
      for (let y = -1; y < q; y += 0.5) v.box(0.12, y + 0.2, z, 0.1, 0.08, 0.7, 0xb8862a);
      v.box(0.12, q / 2 - 0.4, z - 0.38, 0.1, q + 1.2, 0.08, 0xb8862a);
      v.box(0.12, q / 2 - 0.4, z + 0.38, 0.1, q + 1.2, 0.08, 0xb8862a);
    }
    // bollards
    this.bollards = [];
    for (let z = -50; z <= 50; z += 12.5) {
      v.cyl(-1.0, q + 0.38, z, 0.36, 0.76, 0x16181a, 8);
      v.cyl(-1.0, q + 0.82, z, 0.5, 0.16, 0x16181a, 8);
      v.cyl(-1.0, q + 0.94, z, 0.3, 0.1, PAL.lineYellow, 8);
      this.bollards.push(new THREE.Vector3(-1.0, q + 0.7, z));
    }
    // crane rails (recessed steel) with end buffers
    for (const x of [DIM.LEG_WATER_X, DIM.LEG_LAND_X]) {
      v.box(x, q + 0.03, 0, 0.5, 0.06, 86, 0x30363b);
      v.box(x, q + 0.09, 0, 0.14, 0.08, 86, 0x8a949b);
      for (const sz of [-1, 1]) {
        v.box(x, q + 0.5, sz * 43.4, 0.9, 1.0, 0.8, PAL.craneRed);
        v.box(x, q + 0.5, sz * 42.9, 0.5, 0.5, 0.3, 0x16181a);
      }
    }
    // truck lanes: edge lines, dashes, stop box
    const lane = (x) => {
      for (const side of [-1, 1]) v.box(x + side * 2.05, q + 0.012, 0, 0.16, 0.02, 110, PAL.lineWhite);
    };
    lane(DIM.LANE_X);
    lane(DIM.LANE_X - 4.6);
    for (let z = -54; z < 54; z += 6) v.box(DIM.LANE_X - 2.3, q + 0.014, z + 1.5, 0.14, 0.02, 2.6, PAL.lineWhite);
    // hatched keep-clear zone along the water edge
    for (let z = -44; z < 44; z += 2.4) v.box(-3.9, q + 0.012, z + 0.6, 1.6, 0.02, 0.22, PAL.lineYellow, [0, 0.7, 0]);
    v.box(-4.9, q + 0.012, 0, 0.14, 0.02, 90, PAL.lineYellow);
    // pedestrian walkway (green) by the land-side rail
    v.box(DIM.LEG_LAND_X - 2.6, q + 0.011, 0, 1.6, 0.02, 90, 0x2f6b4d);
    for (let z = -44; z < 44; z += 5) v.box(DIM.LEG_LAND_X - 2.6, q + 0.016, z, 1.0, 0.02, 0.3, PAL.lineWhite);

    this.quayMesh = v.mesh(MAT.vox, { cast: false });
    this.group.add(this.quayMesh);

    // painted ground stencils
    const stamp = (text, x, z, w, rotY = 0, col) => {
      const tex = groundText(text, 256, col);
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, w / 4),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: true, opacity: 0.85 })
      );
      m.material.color.setScalar(0.7);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = rotY;
      m.position.set(x, q + 0.03, z);
      m.renderOrder = 1;
      this.group.add(m);
      return m;
    };
    stamp('LANE 1', DIM.LANE_X, 13.5, 5.2, Math.PI / 2, '#d8d4c8');
    stamp('LANE 2', DIM.LANE_X - 4.6, 13.5, 5.2, Math.PI / 2, '#d8d4c8');
    stamp('PIER 7', -11.5, 30, 12, 0);
    stamp('KEEP CLEAR', -3.9, -30, 7, Math.PI / 2);
    stamp('BERTH 7A', -3.9, 30, 6, Math.PI / 2);

    // pickup bay: a thick hatched box the trucks stop inside
    this.pickupMarks = new THREE.Group();
    this.group.add(this.pickupMarks);
  }

  /** Paint the stop box for a lane at z (called by the session for each active lane). */
  markPickup(x, z) {
    const q = DIM.QUAY_Y;
    const v = new Vox();
    const w = 3.5;
    const l = 8.6;
    v.box(x - w / 2, q + 0.02, z, 0.2, 0.02, l, PAL.lineYellow);
    v.box(x + w / 2, q + 0.02, z, 0.2, 0.02, l, PAL.lineYellow);
    v.box(x, q + 0.02, z - l / 2, w + 0.2, 0.02, 0.2, PAL.lineYellow);
    v.box(x, q + 0.02, z + l / 2, w + 0.2, 0.02, 0.2, PAL.lineYellow);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) v.box(x + sx * (w / 2 - 0.5), q + 0.02, z + sz * (l / 2 - 0.5), 0.9, 0.02, 0.2, PAL.lineYellow, [0, sx * sz * 0.78, 0]);
    const m = v.mesh(MAT.vox, { cast: false });
    this.pickupMarks.add(m);
  }

  clearPickupMarks() {
    for (const m of [...this.pickupMarks.children]) {
      m.geometry.dispose();
      this.pickupMarks.remove(m);
    }
  }

  // ---------------------------------------------------------------- lamp masts

  _lamps() {
    const q = DIM.QUAY_Y;
    const v = new Vox();
    const g = new Vox();
    g.shade = false;
    const mast = (x, z, hgt, headDx, kind) => {
      v.cyl(x, q + 0.3, z, 0.5, 0.6, 0x3a4046, 8);
      v.cyl(x, q + hgt / 2, z, 0.16, hgt, 0x4a5258, 6, 0.6);
      v.box(x + headDx * 0.5, q + hgt, z, Math.abs(headDx) + 0.3, 0.14, 0.14, 0x4a5258);
      const hx = x + headDx;
      v.box(hx, q + hgt - 0.1, z, 0.9, 0.22, 0.55, 0x23292e);
      g.box(hx, q + hgt - 0.24, z, 0.74, 0.08, 0.42, kind === 'cool' ? 0xd6ecff : 0xffd9a0);
      const pos = new THREE.Vector3(hx, q + hgt - 0.3, z);
      const col = kind === 'cool' ? PAL.coolLamp : PAL.sodium;
      const halo = glowSprite(col, 5.2, 0.95);
      halo.position.copy(pos);
      this.group.add(halo);
      const cone = lightCone(col, hgt * 0.62, hgt * 1.02, this.mobile ? 0.09 : 0.075);
      cone.position.copy(pos);
      this.group.add(cone);
      // light pool on the ground (cheap stand-in for a real light)
      const pool = new THREE.Mesh(
        new THREE.PlaneGeometry(hgt * 1.7, hgt * 1.7),
        new THREE.MeshBasicMaterial({
          map: halo.material.map,
          color: col,
          transparent: true,
          opacity: 0.2,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: true,
        })
      );
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(hx, q + 0.04, z);
      pool.renderOrder = 2;
      this.group.add(pool);
      const lamp = { pos, color: new THREE.Color(col), halo, cone, pool, base: 1, hgt };
      this.lampHeads.push(lamp);
      return lamp;
    };
    // main row behind the truck lanes
    this.mainLamps = [];
    for (const z of [-42, -21, 0, 21, 42]) this.mainLamps.push(mast(-23.5, z, 17, 2.4, 'warm'));
    // edge lamps between berths (short, cooler: gives the palette its teal counterpoint)
    for (const z of [-58, 58]) mast(-3.2, z, 9, 1.4, 'cool');
    // yard lamps
    for (const [x, z] of [
      [-48, -30],
      [-48, 14],
      [-66, -8],
      [-70, 40],
    ])
      mast(x, z, 15, 2.0, 'warm');
    // one tired lamp that flickers: small imperfections sell the place
    this.flickers.push(this.mainLamps[4]);
    this.lampMesh = v.mesh(MAT.vox);
    this.group.add(this.lampMesh);
    this.group.add(g.mesh(MAT.glow, { cast: false, receive: false }));
  }

  _lights() {
    // Moon/sky fill
    this.hemi = new THREE.HemisphereLight(0x5f7fa8, 0x1a1410, 0.5);
    this.scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(PAL.moon, 0.42);
    this.moon.position.set(42, 50, -76);
    this.scene.add(this.moon);
    // Real point lights only where the action is.
    const mk = (lamp, intensity, dist) => {
      const l = new THREE.PointLight(lamp.color, intensity, dist, 1.7);
      l.position.copy(lamp.pos).y -= 0.6;
      this.scene.add(l);
      lamp.light = l;
      lamp.baseIntensity = intensity;
      this.lampLights.push(l);
    };
    const ids = this.mobile ? [2] : [1, 2, 3];
    for (const i of ids) mk(this.mainLamps[i], this.mobile ? 2400 : 1900, 64);
    if (!this.mobile) mk(this.mainLamps[4], 1500, 60);
  }

  // ---------------------------------------------------------------- container yard

  _yard() {
    const q = DIM.QUAY_Y;
    const rng = makeRng(4242);
    const zones = [ZONES.ROT.color, ZONES.SIN.color, ZONES.NYC.color, ZONES.OSL.color, 0xd9d6cb, 0x5d7f3a, 0x7a4466, 0x59646d, 0x8c4a2a];
    // generic corrugated texture, tinted per instance
    const c = makeCanvas(128, 64);
    const g = c.getContext('2d');
    g.fillStyle = '#c8c8c8';
    g.fillRect(0, 0, 128, 64);
    for (let x = 0; x < 128; x += 6) {
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(x + 3, 0, 2, 64);
      g.fillStyle = 'rgba(255,255,255,0.14)';
      g.fillRect(x, 0, 2, 64);
    }
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fillRect(0, 0, 128, 4);
    g.fillRect(0, 60, 128, 4);
    g.fillRect(0, 0, 4, 64);
    g.fillRect(124, 0, 4, 64);
    for (let i = 0; i < 20; i++) {
      g.fillStyle = `rgba(70,40,20,${0.1 + rng() * 0.25})`;
      g.fillRect(rng() * 128, 4, 1 + rng() * 3, 10 + rng() * 40);
    }
    const tex = canvasTexture(c, { aniso: 4 });
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    const geo = new THREE.BoxGeometry(DIM.CONT_W, DIM.CONT_H, DIM.CONT_L);
    const spots = [];
    // blocks of stacks, long axis along Z, with driving aisles
    for (let bx = 0; bx < 3; bx++) {
      for (let bz = 0; bz < 5; bz++) {
        const ox = -34 - bx * 16;
        const oz = -62 + bz * 27;
        for (let r = 0; r < 4; r++) {
          for (let b = 0; b < 3; b++) {
            const hgt = Math.max(0, Math.floor(rng() * 5.2) - (bx === 0 ? 1 : 0));
            for (let t = 0; t < hgt; t++) {
              spots.push({
                x: ox - r * 2.75 + (rng() - 0.5) * 0.12,
                y: q + DIM.CONT_H / 2 + t * DIM.CONT_H,
                z: oz + b * 6.6 + (rng() - 0.5) * 0.16,
                c: zones[Math.floor(rng() * zones.length)],
                ry: (rng() - 0.5) * 0.015,
              });
            }
          }
        }
      }
    }
    const inst = new THREE.InstancedMesh(geo, mat, spots.length);
    const m = new THREE.Matrix4();
    const qq = new THREE.Quaternion();
    const e = new THREE.Euler();
    const col = new THREE.Color();
    spots.forEach((s, i) => {
      qq.setFromEuler(e.set(0, s.ry, 0));
      m.compose(new THREE.Vector3(s.x, s.y, s.z), qq, new THREE.Vector3(1, 1, 1));
      inst.setMatrixAt(i, m);
      col.setHex(s.c).multiplyScalar(0.85 + rng() * 0.3);
      inst.setColorAt(i, col);
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.castShadow = false;
    inst.receiveShadow = false;
    this.group.add(inst);
    this.yard = inst;
  }

  // ---------------------------------------------------------------- terminal office

  _office() {
    const q = DIM.QUAY_Y;
    const v = new Vox();
    const g = new Vox();
    g.shade = false;
    const x = -30.5;
    const z = -47;
    // two-storey portacabin block on stilts with an outside stair
    v.box(x, q + 2.1, z, 7.0, 3.0, 12.0, 0x8f9aa0);
    v.box(x, q + 5.2, z, 7.0, 3.0, 12.0, 0x9aa5ab);
    v.box(x, q + 6.85, z, 7.6, 0.3, 12.6, 0x23292e);
    v.box(x, q + 0.4, z, 6.6, 0.5, 11.6, 0x2a3035);
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      v.box(x + sx * 3.2, q + 0.3, z + sz * 5.6, 0.4, 0.6, 0.4, 0x16181a);
    // stair
    for (let i = 0; i < 8; i++) v.box(x + 3.9, q + 0.8 + i * 0.37, z + 5.2 - i * 0.6, 0.9, 0.12, 0.55, 0x4a5258);
    v.box(x + 3.9, q + 3.7, z + 0.2, 0.9, 0.12, 1.6, 0x4a5258);
    // windows facing the quay (+X side)
    for (let fl = 0; fl < 2; fl++) {
      for (let i = 0; i < 6; i++) {
        const lit = !(fl === 0 && (i === 1 || i === 4));
        (lit ? g : v).box(x + 3.52, q + 2.5 + fl * 3.1, z - 4.6 + i * 1.85, 0.06, 1.1, 1.3, lit ? (fl ? 0xffe2b0 : 0xbfe3ff) : 0x1c2a33, null, lit ? 0.8 : 1);
      }
    }
    // door + lamp
    v.box(x + 3.52, q + 4.9, z + 5.2, 0.06, 2.0, 0.9, 0x34609f);
    g.box(x + 3.7, q + 6.2, z + 5.2, 0.2, 0.14, 0.3, 0xffe2b0);
    // roof clutter: AC units, antenna
    v.box(x - 1.5, q + 7.3, z - 3, 1.4, 0.7, 1.0, 0x59646d);
    v.box(x + 1.2, q + 7.25, z + 2, 1.0, 0.6, 1.0, 0x59646d);
    v.box(x - 2.2, q + 9.0, z + 4.6, 0.1, 4.0, 0.1, 0xc9c4b6);
    this.group.add(v.mesh(MAT.vox));
    this.group.add(g.mesh(MAT.glowSoft, { cast: false, receive: false }));
    const s = glowSprite(0xffd9a0, 9, 0.35);
    s.position.set(x + 4.2, q + 4.2, z);
    this.group.add(s);
    // sign
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(9.5, 1.5),
      new THREE.MeshBasicMaterial({ map: signTexture(['PIER SEVEN', null], 640, 100), fog: true })
    );
    sign.material.color.setScalar(1.25);
    sign.position.set(x + 3.56, q + 7.75, z);
    sign.rotation.y = Math.PI / 2;
    this.group.add(sign);
    const back = new Vox();
    back.box(x + 3.45, q + 7.75, z, 0.14, 1.8, 9.9, 0x16181a);
    this.group.add(back.mesh(MAT.vox, { cast: false }));
    this.officeDoor = new THREE.Vector3(x + 4.4, q, z + 6.5);
  }

  // ---------------------------------------------------------------- hand-placed props

  _props() {
    const q = DIM.QUAY_Y;
    const v = new Vox();
    const g = new Vox();
    g.shade = false;
    const rng = makeRng(909);
    const drum = (x, z, col) => {
      v.cyl(x, q + 0.45, z, 0.3, 0.9, col, 8);
      v.cyl(x, q + 0.92, z, 0.31, 0.04, 0x23292e, 8);
    };
    const cone = (x, z) => {
      v.box(x, q + 0.04, z, 0.36, 0.06, 0.36, 0x16181a);
      v.cyl(x, q + 0.36, z, 0.15, 0.58, 0xff6a1a, 6, 0.25);
      v.cyl(x, q + 0.42, z, 0.11, 0.1, 0xf1ecdd, 6, 0.8);
    };
    const pallet = (x, z, n, ry) => {
      for (let i = 0; i < n; i++) v.box(x, q + 0.08 + i * 0.16, z, 1.2, 0.14, 1.0, 0x9c7a4a, [0, ry + i * 0.04, 0]);
    };
    const crate = (x, z, s, col, ry = 0) => v.box(x, q + s / 2, z, s, s, s, col, [0, ry, 0]);
    // cluster by the land-side leg
    drum(-21.2, 6.4, 0x34609f);
    drum(-21.9, 6.9, 0x34609f);
    drum(-21.4, 7.5, 0xc23d2b);
    pallet(-21.5, 10.5, 4, 0.2);
    crate(-21.3, 12.4, 1.1, 0x9c7a4a, 0.3);
    crate(-22.2, 12.9, 0.8, 0x8a6a3e, -0.2);
    // cones marking the keep-clear strip
    for (const z of [-11, -7, 7, 11]) cone(-5.3, z);
    cone(-14.6, -15.5);
    cone(-14.9, -16.9);
    // cable reel and tarp bundle near the office
    v.cyl(-27, q + 0.9, -36, 0.9, 0.22, 0x9c7a4a, 10, 1, [0, 0, Math.PI / 2]);
    v.cyl(-27.6, q + 0.9, -36, 0.9, 0.22, 0x9c7a4a, 10, 1, [0, 0, Math.PI / 2]);
    v.cyl(-27.3, q + 0.9, -36, 0.5, 0.5, 0x23292e, 8, 1, [0, 0, Math.PI / 2]);
    v.box(-26.5, q + 0.5, -32, 2.2, 1.0, 1.4, 0x2f6b4d, [0, 0.4, 0]);
    // jersey barriers along the yard edge
    for (let z = -52; z <= 52; z += 4.3) {
      if (Math.abs(z - 2) < 9) continue; // gate gap
      v.box(-26.6, q + 0.4, z, 0.6, 0.8, 3.9, (Math.round(z) & 1) ? 0xc9c4b6 : 0xb9b3a5);
      v.box(-26.6, q + 0.84, z, 0.34, 0.1, 3.9, 0xc23d2b);
    }
    // parked reach-stacker silhouette in the yard aisle (lights on)
    const rx = -29.5;
    const rz = 20;
    v.box(rx, q + 1.5, rz, 3.0, 1.6, 6.0, 0xe8a61c);
    v.box(rx, q + 2.9, rz + 1.8, 2.2, 1.5, 2.0, 0x23292e);
    v.beam(rx, q + 2.6, rz - 1.5, rx, q + 7.5, rz - 8.5, 0.7, 0xe8a61c);
    v.box(rx, q + 7.4, rz - 8.8, 2.6, 0.5, 1.2, 0x23292e);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) v.cyl(rx + sx * 1.5, q + 0.8, rz + sz * 2.0, 0.8, 0.7, 0x101315, 10, 1, [0, 0, Math.PI / 2]);
    g.box(rx - 0.8, q + 2.0, rz - 3.02, 0.4, 0.25, 0.06, 0xfff2d0);
    g.box(rx + 0.8, q + 2.0, rz - 3.02, 0.4, 0.25, 0.06, 0xfff2d0);
    this._blink(new THREE.Vector3(rx, q + 3.9, rz + 1.8), 0xffa020, 1.6, 3.2, 0.3);
    // mooring bits of chain / coiled rope near bollards
    for (const z of [-25, 0, 25]) v.cyl(-2.1, q + 0.12, z + 1.3, 0.55, 0.2, 0x8a6a3e, 8);
    // puddle-side clutter
    for (let i = 0; i < 6; i++) crate(-33 - rng() * 3, -12 + rng() * 26, 0.7 + rng() * 0.5, 0x8a6a3e, rng() * 3);
    this.group.add(v.mesh(MAT.vox));
    this.group.add(g.mesh(MAT.glow, { cast: false, receive: false }));
  }

  _blink(pos, color, size, rate, duty) {
    const s = glowSprite(color, size, 1);
    s.position.copy(pos);
    this.group.add(s);
    this.blinkers.push({ s, rate, duty, phase: Math.random() });
    return s;
  }

  // ---------------------------------------------------------------- distant scenery

  _skyline() {
    const rng = makeRng(31337);
    const texA = windowTexture(11, 12, 24, 0.22);
    const texB = windowTexture(23, 10, 30, 0.34, 0.5);
    const texC = windowTexture(37, 16, 12, 0.14, 0.9);
    const mats = [texA, texB, texC].map((t) => {
      const m = new THREE.MeshBasicMaterial({ map: t, fog: false });
      m.color.setScalar(1.15);
      return m;
    });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const groups = [[], [], []];
    // an arc of city on the far shore: from behind the ship (-Z) round to seaward (+X)
    for (let i = 0; i < 150; i++) {
      const a = -Math.PI * 0.62 + rng() * Math.PI * 1.08; // angle around Y, 0 = +X
      const r = 300 + rng() * 150;
      const x = Math.cos(a) * r + 30;
      const z = Math.sin(a) * r * 1.05 - 40;
      const core = Math.exp(-Math.pow((a + 0.95) / 0.5, 2)); // downtown cluster
      const hgt = 14 + rng() * 26 + core * (30 + rng() * 80);
      const w = 12 + rng() * 22;
      groups[Math.floor(rng() * 3)].push({ x, z, w, d: 12 + rng() * 18, hgt, ry: rng() * Math.PI });
    }
    this.skylineMeshes = [];
    const m4 = new THREE.Matrix4();
    const qq = new THREE.Quaternion();
    const e = new THREE.Euler();
    groups.forEach((list, gi) => {
      const inst = new THREE.InstancedMesh(geo, mats[gi], list.length);
      list.forEach((b, i) => {
        qq.setFromEuler(e.set(0, b.ry, 0));
        m4.compose(new THREE.Vector3(b.x, -2, b.z), qq, new THREE.Vector3(b.w, b.hgt, b.d));
        inst.setMatrixAt(i, m4);
        if (b.hgt > 70) this._blink(new THREE.Vector3(b.x, b.hgt - 1, b.z), 0xff3b2e, 9, 0.6, 0.2).material.fog = false;
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = false;
      this.group.add(inst);
      this.skylineMeshes.push(inst);
    });
    this.skylineMats = mats;

    // suspension bridge far across the basin, strung with lights
    const v = new Vox();
    const g = new Vox();
    g.shade = false;
    const bz = -330;
    const span = 420;
    const bx0 = 40;
    for (const tx of [bx0 + span * 0.28, bx0 + span * 0.72]) {
      v.box(tx, 28, bz, 5, 70, 4, 0x0e151b);
      v.box(tx, 58, bz, 7, 3, 5, 0x0e151b);
      g.box(tx, 64.5, bz, 1.2, 1.2, 1.2, 0xff3b2e);
    }
    v.box(bx0 + span / 2, 14, bz, span, 2.2, 5, 0x0e151b);
    const t0 = bx0 + span * 0.28;
    const t1 = bx0 + span * 0.72;
    const cable = (xa, xb, sagDepth) => {
      const n = 22;
      for (let i = 0; i < n; i++) {
        const u0 = i / n;
        const u1 = (i + 1) / n;
        const y = (u) => 62 - sagDepth * 4 * u * (1 - u);
        v.beam(xa + (xb - xa) * u0, y(u0), bz, xa + (xb - xa) * u1, y(u1), bz, 0.7, 0x0e151b);
        if (i % 2 === 0) g.box(xa + (xb - xa) * u0, y(u0) + 0.8, bz, 0.9, 0.9, 0.9, 0xffd9a0, null, 0.55);
      }
    };
    cable(t0, t1, 40);
    cable(bx0, t0, 14);
    cable(t1, bx0 + span, 14);
    for (let x = bx0; x < bx0 + span; x += 12) g.box(x, 15.8, bz, 0.8, 0.8, 0.8, 0xffb060, null, 0.5);
    const bm = v.mesh(new THREE.MeshBasicMaterial({ color: 0x0b1219, fog: false }), { cast: false, receive: false });
    this.group.add(bm);
    const gm = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
    gm.color.setScalar(1.6);
    this.group.add(g.mesh(gm, { cast: false, receive: false }));

    // lighthouse on a breakwater to seaward, with a sweeping beam
    const lv = new Vox();
    const lx = 150;
    const lz = 110;
    lv.box(lx, 1, lz, 60, 4, 8, 0x12181d);
    lv.cyl(lx + 22, 10, lz, 2.4, 16, 0xd9d5c8, 8, 0.7);
    lv.cyl(lx + 22, 14, lz, 2.1, 3, 0xc23d2b, 8, 0.92);
    lv.cyl(lx + 22, 19.2, lz, 1.9, 2.4, 0x16181a, 8);
    const lm = lv.mesh(new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }), { cast: false, receive: false });
    this.group.add(lm);
    this.lighthouse = new THREE.Group();
    this.lighthouse.position.set(lx + 22, 19.4, lz);
    const beam = lightCone(0xfff2d0, 9, 150, 0.16);
    beam.rotation.z = Math.PI / 2;
    beam.material.fog = false;
    this.lighthouse.add(beam);
    const beam2 = lightCone(0xfff2d0, 9, 150, 0.16);
    beam2.rotation.z = -Math.PI / 2;
    this.lighthouse.add(beam2);
    this.group.add(this.lighthouse);
    const lh = glowSprite(0xfff2d0, 16, 1);
    lh.material.fog = false;
    lh.position.set(lx + 22, 19.4, lz);
    this.group.add(lh);
    this.lighthouseGlow = lh;
  }

  _farPort() {
    // Neighbouring berths: silhouetted cranes, a moored ship and stacks, so the pier feels like
    // part of a working port rather than a diorama.
    const q = DIM.QUAY_Y;
    const v = new Vox();
    const g = new Vox();
    g.shade = false;
    const crane = (z, boomUp) => {
      const xw = DIM.LEG_WATER_X;
      const xl = DIM.LEG_LAND_X;
      for (const x of [xw, xl]) for (const sz of [-1, 1]) v.box(x, q + 14, z + sz * 8, 1.0, 28, 1.0, 0x1a2229);
      v.box((xw + xl) / 2, q + 27, z - 8, xw - xl, 1.2, 0.9, 0x1a2229);
      v.box((xw + xl) / 2, q + 27, z + 8, xw - xl, 1.2, 0.9, 0x1a2229);
      v.box(-14, q + 25, z, 26, 1.6, 6, 0x1a2229);
      if (boomUp) v.beam(-2, q + 25.5, z, 4, q + 54, z, 2.0, 0x1a2229, 5);
      else v.box(10, q + 25, z, 24, 1.6, 6, 0x1a2229);
      v.beam(xw, q + 28, z, xw + 1, q + 40, z, 0.9, 0x1a2229);
      g.box(xw + 1, q + 41, z, 0.6, 0.6, 0.6, 0xff3b2e);
      for (const x of [-12, -4, 6]) if (!boomUp || x < 0) g.box(x, q + 24, z + 3.4, 0.7, 0.2, 0.5, 0xffd9a0);
    };
    crane(-84, true);
    crane(-118, false);
    crane(96, true);
    // moored neighbour ship (simple blocks)
    v.box(9, 2.2, -112, 15, 6.4, 62, 0x121a22);
    v.box(9, 9.5, -136, 11, 9, 10, 0x2a3138);
    for (let i = 0; i < 26; i++) {
      const cx = 4 + (i % 4) * 2.9;
      const cz = -128 + Math.floor(i / 4) * 6.8 + 6;
      const hgt = 1 + ((i * 7) % 3);
      v.box(cx, 5.4 + hgt * 1.3, cz, 2.5, hgt * 2.6, 6.2, [0x3c2a26, 0x23363a, 0x3d3423, 0x232c3c][i % 4]);
    }
    for (let i = 0; i < 5; i++) g.box(4 + i * 2.2, 11.5, -130.9, 0.9, 0.7, 0.1, i % 2 ? 0xffd9a0 : 0xbfe3ff, null, 0.7);
    g.box(9, 16, -136, 0.4, 0.4, 0.4, 0xfff2d0);
    // far sheds
    v.box(-58, q + 5, -120, 40, 10, 26, 0x161d23);
    v.box(-58, q + 5, 122, 44, 10, 30, 0x161d23);
    for (let i = 0; i < 6; i++) g.box(-40 + i * -6, q + 7, -106.9, 2.2, 1.2, 0.1, 0xffd9a0, null, 0.4);
    const m = v.mesh(new THREE.MeshLambertMaterial({ vertexColors: true }), { cast: false, receive: false });
    this.group.add(m);
    this.group.add(g.mesh(MAT.glow, { cast: false, receive: false }));
  }

  /** Lamp positions (and colours) nearest to the play area, for water glints. */
  glintLights() {
    const out = [];
    for (const l of this.lampHeads) out.push({ pos: l.pos, color: l.color, power: l.hgt > 12 ? 1 : 0.7 });
    return out;
  }

  /** 0..1 visibility of the far shore (fog shifts lower this). */
  setVisibility(v) {
    for (const m of this.skylineMats) m.color.setScalar(1.15 * v);
    this.lighthouseGlow.material.opacity = v;
  }

  update(dt, t, flash = 0) {
    this.skyUniforms.uTime.value = t;
    this.skyUniforms.uFlash.value = flash;
    this.lighthouse.rotation.y = t * 0.55;
    for (const b of this.blinkers) {
      const ph = (t * b.rate + b.phase) % 1;
      b.s.material.opacity = ph < b.duty ? 1 : 0.05;
    }
    for (const f of this.flickers) {
      const n = noise1(t * 9.0) * 0.5 + 0.5;
      const dip = n > 0.72 ? 0.25 + 0.5 * (noise1(t * 43.0) * 0.5 + 0.5) : 1;
      f.halo.material.opacity = 0.95 * dip;
      f.cone.material.uniforms.uOpacity.value = 0.075 * dip;
      f.pool.material.opacity = 0.2 * dip;
      if (f.light) f.light.intensity = f.baseIntensity * dip;
      f.flick = dip;
    }
  }
}
