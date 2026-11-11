// Shipping containers: hand-drawn canvas textures (liveries, stencils, weathering) + entity state.
import * as THREE from 'three';
import { makeCanvas, canvasTexture } from './vox.js';
import { DIM, ZONES, CARGO_TYPES } from '../config.js';
import { makeRng } from '../core/util.js';

const BRANDS = [
  { name: 'ORCA', mark: 'wave' },
  { name: 'HALCYON', mark: 'sun' },
  { name: 'TIDEWAY', mark: 'bars' },
  { name: 'BOREAL', mark: 'peak' },
  { name: 'KITE&CO', mark: 'kite' },
  { name: 'NORDSEE', mark: 'ring' },
];

const GENERIC = [0x5d7f3a, 0x7a4466, 0x4f6f86, 0xb9b09a, 0x8c5a36, 0x3f6b62];

const AT = 512;
// atlas regions in pixels: [x, y, w, h]
const REG = {
  side: [0, 0, 512, 208],
  top: [0, 208, 512, 176],
  door: [0, 384, 128, 128],
  front: [128, 384, 128, 128],
  bottom: [256, 384, 64, 64],
};

const matCache = new Map();
let geoCache = null;

function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}
function mix(hexA, hexB, t) {
  const c = new THREE.Color(hexA).lerp(new THREE.Color(hexB), t);
  return '#' + c.getHexString();
}

function drawMark(g, mark, x, y, s, col) {
  g.save();
  g.translate(x, y);
  g.fillStyle = col;
  g.strokeStyle = col;
  g.lineWidth = s * 0.16;
  switch (mark) {
    case 'wave':
      for (let i = 0; i < 2; i++) {
        g.beginPath();
        g.arc(-s * 0.25 + i * s * 0.5, i * s * 0.06, s * 0.3, Math.PI * 1.05, Math.PI * 1.95);
        g.stroke();
      }
      g.fillRect(-s * 0.55, s * 0.18, s * 1.1, s * 0.14);
      break;
    case 'sun':
      g.beginPath();
      g.arc(0, 0, s * 0.3, 0, Math.PI * 2);
      g.fill();
      for (let i = 0; i < 8; i++) {
        g.save();
        g.rotate((i / 8) * Math.PI * 2);
        g.fillRect(s * 0.4, -s * 0.05, s * 0.18, s * 0.1);
        g.restore();
      }
      break;
    case 'bars':
      for (let i = 0; i < 3; i++) g.fillRect(-s * 0.5, -s * 0.36 + i * s * 0.28, s * (1 - i * 0.22), s * 0.16);
      break;
    case 'peak':
      g.beginPath();
      g.moveTo(-s * 0.55, s * 0.38);
      g.lineTo(-s * 0.1, -s * 0.42);
      g.lineTo(s * 0.12, -s * 0.02);
      g.lineTo(s * 0.3, -s * 0.24);
      g.lineTo(s * 0.58, s * 0.38);
      g.closePath();
      g.fill();
      break;
    case 'kite':
      g.beginPath();
      g.moveTo(0, -s * 0.48);
      g.lineTo(s * 0.34, -s * 0.04);
      g.lineTo(0, s * 0.5);
      g.lineTo(-s * 0.34, -s * 0.04);
      g.closePath();
      g.fill();
      break;
    default:
      g.beginPath();
      g.arc(0, 0, s * 0.36, 0, Math.PI * 2);
      g.stroke();
      g.fillRect(-s * 0.5, -s * 0.07, s, s * 0.14);
  }
  g.restore();
}

/** Vertical corrugation with a soft light/dark rhythm. */
function corrugate(g, x, y, w, h, base, pitch = 14) {
  g.fillStyle = base;
  g.fillRect(x, y, w, h);
  for (let px = x; px < x + w; px += pitch) {
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(px, y, pitch * 0.28, h);
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(px + pitch * 0.5, y, pitch * 0.3, h);
    g.fillStyle = 'rgba(0,0,0,0.07)';
    g.fillRect(px + pitch * 0.8, y, pitch * 0.2, h);
  }
}

function frame(g, x, y, w, h, col, t = 9) {
  g.fillStyle = col;
  g.fillRect(x, y, w, t);
  g.fillRect(x, y + h - t, w, t);
  g.fillRect(x, y, t + 3, h);
  g.fillRect(x + w - t - 3, y, t + 3, h);
  // corner castings
  g.fillStyle = 'rgba(0,0,0,0.45)';
  const cs = t + 7;
  for (const [cx, cy] of [
    [x, y],
    [x + w - cs, y],
    [x, y + h - cs],
    [x + w - cs, y + h - cs],
  ]) {
    g.fillRect(cx, cy, cs, cs);
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(cx + 3, cy + 3, cs - 6, 3);
    g.fillStyle = 'rgba(0,0,0,0.45)';
  }
}

function weather(g, x, y, w, h, rng, amount = 1) {
  // rust streaks bleeding down from the top rail, scuffs and grime towards the floor
  for (let i = 0; i < 9 * amount; i++) {
    const sx = x + rng() * w;
    const len = 20 + rng() * h * 0.5;
    const grd = g.createLinearGradient(0, y + 8, 0, y + 8 + len);
    grd.addColorStop(0, 'rgba(96,48,24,0.42)');
    grd.addColorStop(1, 'rgba(96,48,24,0)');
    g.fillStyle = grd;
    g.fillRect(sx, y + 8, 2 + rng() * 5, len);
  }
  for (let i = 0; i < 14 * amount; i++) {
    g.fillStyle = `rgba(${rng() < 0.5 ? '255,255,255' : '20,16,12'},${0.05 + rng() * 0.1})`;
    g.fillRect(x + rng() * w, y + rng() * h, 6 + rng() * 34, 2 + rng() * 3);
  }
  const grd = g.createLinearGradient(0, y + h * 0.62, 0, y + h);
  grd.addColorStop(0, 'rgba(10,10,10,0)');
  grd.addColorStop(1, 'rgba(10,10,10,0.38)');
  g.fillStyle = grd;
  g.fillRect(x, y + h * 0.62, w, h * 0.38);
}

function stencil(g, text, x, y, size, col, align = 'left') {
  g.font = `${size}px "Saira Stencil One", "Arial Black", sans-serif`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillStyle = col;
  g.fillText(text, x, y);
}

function small(g, text, x, y, size, col, align = 'left') {
  g.font = `700 ${size}px "Barlow Condensed", Arial, sans-serif`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillStyle = col;
  g.fillText(text, x, y);
}

function hazardBand(g, x, y, w, h) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = '#e8b21e';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#16181a';
  for (let px = x - h; px < x + w + h; px += h * 1.4) {
    g.beginPath();
    g.moveTo(px, y + h);
    g.lineTo(px + h * 0.7, y + h);
    g.lineTo(px + h * 1.7, y);
    g.lineTo(px + h, y);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function diamond(g, cx, cy, s, fill, icon) {
  g.save();
  g.translate(cx, cy);
  g.rotate(Math.PI / 4);
  g.fillStyle = '#f3efe2';
  g.fillRect(-s / 2 - 3, -s / 2 - 3, s + 6, s + 6);
  g.fillStyle = fill;
  g.fillRect(-s / 2, -s / 2, s, s);
  g.restore();
  g.fillStyle = '#16181a';
  if (icon === 'flame') {
    g.beginPath();
    g.moveTo(cx, cy - s * 0.34);
    g.bezierCurveTo(cx + s * 0.3, cy - s * 0.05, cx + s * 0.22, cy + s * 0.3, cx, cy + s * 0.3);
    g.bezierCurveTo(cx - s * 0.24, cy + s * 0.3, cx - s * 0.26, cy, cx - s * 0.08, cy - s * 0.1);
    g.bezierCurveTo(cx - s * 0.04, cy + s * 0.02, cx + s * 0.02, cy - s * 0.1, cx, cy - s * 0.34);
    g.fill();
  }
}

function glassIcon(g, cx, cy, s, col) {
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(cx - s * 0.3, cy - s * 0.5);
  g.lineTo(cx + s * 0.3, cy - s * 0.5);
  g.lineTo(cx + s * 0.2, cy - s * 0.05);
  g.lineTo(cx + s * 0.04, cy + s * 0.05);
  g.lineTo(cx + s * 0.04, cy + s * 0.38);
  g.lineTo(cx + s * 0.24, cy + s * 0.44);
  g.lineTo(cx + s * 0.24, cy + s * 0.5);
  g.lineTo(cx - s * 0.24, cy + s * 0.5);
  g.lineTo(cx - s * 0.24, cy + s * 0.44);
  g.lineTo(cx - s * 0.04, cy + s * 0.38);
  g.lineTo(cx - s * 0.04, cy + s * 0.05);
  g.lineTo(cx - s * 0.2, cy - s * 0.05);
  g.closePath();
  g.fill();
}

function snowflake(g, cx, cy, s, col) {
  g.strokeStyle = col;
  g.lineWidth = s * 0.12;
  g.lineCap = 'square';
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    g.beginPath();
    g.moveTo(cx - Math.cos(a) * s * 0.5, cy - Math.sin(a) * s * 0.5);
    g.lineTo(cx + Math.cos(a) * s * 0.5, cy + Math.sin(a) * s * 0.5);
    g.stroke();
  }
}

function buildAtlas(zoneId, type, brandIdx, seed) {
  const zone = ZONES[zoneId] || ZONES.ANY;
  const brand = BRANDS[brandIdx % BRANDS.length];
  const rng = makeRng(seed * 977 + brandIdx * 31 + 5);
  const c = makeCanvas(AT, AT);
  const g = c.getContext('2d');
  // un-zoned boxes get liveries that never clash with the four destination colours
  const paint = zoneId === 'ANY' ? GENERIC[brandIdx % GENERIC.length] : zone.color;
  const isReefer = type === 'reefer';
  const body = isReefer ? '#d9d6cb' : '#' + new THREE.Color(paint).getHexString();
  const bodyDark = shade(isReefer ? 0xd9d6cb : paint, 0.62);
  const ink = isReefer ? '#' + new THREE.Color(paint).getHexString() : '#f1ecdd';
  const zoneCss = '#' + new THREE.Color(paint).getHexString();

  // ---- long side
  {
    const [x, y, w, h] = REG.side;
    corrugate(g, x, y, w, h, body, 13);
    if (isReefer) {
      g.fillStyle = zoneCss;
      g.fillRect(x, y + h * 0.62, w, h * 0.2);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let px = x; px < x + w; px += 13) g.fillRect(px + 6, y + h * 0.62, 4, h * 0.2);
    }
    // logo panel
    drawMark(g, brand.mark, x + 86, y + h * 0.42, 62, ink);
    stencil(g, brand.name, x + 132, y + h * 0.43, 54, ink);
    small(g, `${brand.name.slice(0, 3)}U ${100000 + Math.floor(rng() * 899999)} ${Math.floor(rng() * 9)}`, x + w - 26, y + 34, 22, ink, 'right');
    small(g, type === 'heavy' ? '45G1' : isReefer ? '22R1' : '22G1', x + w - 26, y + 58, 20, ink, 'right');
    // port code tag: always readable so the player can match bays
    if (zoneId !== 'ANY') {
      g.fillStyle = 'rgba(12,16,20,0.78)';
      g.fillRect(x + w - 122, y + h - 76, 96, 44);
      stencil(g, zone.id, x + w - 74, y + h - 52, 34, isReefer ? '#f1ecdd' : zone.css, 'center');
    }
    if (type === 'heavy') {
      hazardBand(g, x, y + h - 30, w, 20);
      stencil(g, 'HEAVY 30T', x + 34, y + h - 58, 30, '#f1ecdd');
    } else if (type === 'fragile') {
      g.fillStyle = '#f1ecdd';
      g.fillRect(x + 300, y + 30, 92, h - 78);
      glassIcon(g, x + 346, y + 30 + (h - 78) * 0.42, 62, '#c8372b');
      small(g, 'FRAGILE', x + 346, y + h - 60, 22, '#c8372b', 'center');
    } else if (type === 'hazmat') {
      diamond(g, x + 340, y + h * 0.46, 58, '#e8731e', 'flame');
      hazardBand(g, x, y + 9, w, 12);
    } else if (isReefer) {
      snowflake(g, x + 350, y + h * 0.36, 46, zoneCss);
      small(g, 'KEEP COLD', x + 350, y + h * 0.36 + 40, 18, zoneCss, 'center');
    }
    weather(g, x, y, w, h, rng, type === 'heavy' ? 1.6 : 1);
    frame(g, x, y, w, h, bodyDark, 9);
  }

  // ---- roof
  {
    const [x, y, w, h] = REG.top;
    g.fillStyle = shade(isReefer ? 0xd9d6cb : paint, 0.9);
    g.fillRect(x, y, w, h);
    for (let px = x; px < x + w; px += 22) {
      g.fillStyle = 'rgba(0,0,0,0.16)';
      g.fillRect(px + 14, y, 6, h);
      g.fillStyle = 'rgba(255,255,255,0.07)';
      g.fillRect(px + 2, y, 5, h);
    }
    // big roof code so the cab (top-down) view can read destinations
    if (zoneId !== 'ANY') {
      // (rotated so it reads upright from the default camera and from the cab)
      g.save();
      g.translate(x + w / 2, y + h / 2);
      g.rotate(-Math.PI / 2);
      g.fillStyle = 'rgba(12,16,20,0.55)';
      g.fillRect(-78, -40, 156, 80);
      stencil(g, zone.id, 0, 3, 62, isReefer ? zone.css : '#f1ecdd', 'center');
      g.restore();
    }
    if (type === 'heavy') {
      hazardBand(g, x, y + 10, w, 16);
      hazardBand(g, x, y + h - 26, w, 16);
    }
    if (type === 'hazmat') diamond(g, x + 120, y + h / 2, 50, '#e8731e', 'flame');
    if (type === 'fragile') glassIcon(g, x + 110, y + h / 2, 70, '#f1ecdd');
    if (isReefer) snowflake(g, x + 110, y + h / 2, 56, zoneCss);
    // puddles / grime
    for (let i = 0; i < 10; i++) {
      g.fillStyle = `rgba(8,12,16,${0.08 + rng() * 0.12})`;
      g.beginPath();
      g.ellipse(x + rng() * w, y + rng() * h, 12 + rng() * 40, 6 + rng() * 14, 0, 0, Math.PI * 2);
      g.fill();
    }
    frame(g, x, y, w, h, bodyDark, 8);
  }

  // ---- door end
  {
    const [x, y, w, h] = REG.door;
    corrugate(g, x, y, w, h, isReefer ? '#d9d6cb' : body, 16);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(x + w / 2 - 2, y, 4, h);
    // lock rods + handles
    for (const rx of [0.2, 0.38, 0.62, 0.8]) {
      g.fillStyle = '#c9c4b6';
      g.fillRect(x + w * rx - 2, y + 8, 4, h - 16);
      g.fillStyle = '#23282c';
      g.fillRect(x + w * rx - 7, y + h * 0.56, 14, 6);
    }
    small(g, zone.id === 'ANY' ? 'GEN' : zone.id, x + w * 0.72, y + 26, 18, ink, 'center');
    small(g, 'MAX 30480', x + w * 0.29, y + 26, 11, ink, 'center');
    if (type === 'hazmat') diamond(g, x + w * 0.29, y + h * 0.36, 26, '#e8731e', 'flame');
    weather(g, x, y, w, h, rng, 0.5);
    frame(g, x, y, w, h, bodyDark, 7);
  }

  // ---- front end
  {
    const [x, y, w, h] = REG.front;
    corrugate(g, x, y, w, h, body, 12);
    if (isReefer) {
      // refrigeration unit face
      g.fillStyle = '#c9c7bd';
      g.fillRect(x + 8, y + 8, w - 16, h - 16);
      g.fillStyle = '#2a3035';
      g.fillRect(x + 16, y + 18, w - 32, 40);
      g.fillStyle = '#15191c';
      g.beginPath();
      g.arc(x + w / 2, y + 38, 15, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = zoneCss;
      g.fillRect(x + 16, y + 70, w - 32, 10);
      g.fillStyle = '#7ee08a';
      g.fillRect(x + 22, y + 92, 8, 8);
    } else {
      drawMark(g, brand.mark, x + w / 2, y + h * 0.42, 44, ink);
    }
    weather(g, x, y, w, h, rng, 0.5);
    frame(g, x, y, w, h, bodyDark, 7);
  }

  // ---- underside
  {
    const [x, y, w, h] = REG.bottom;
    g.fillStyle = '#15181a';
    g.fillRect(x, y, w, h);
  }
  return canvasTexture(c, { aniso: 8 });
}

function setFaceUV(uv, face, reg, rotate = false) {
  const [x, y, w, h] = reg;
  const u0 = x / AT;
  const u1 = (x + w) / AT;
  const v1 = 1 - y / AT;
  const v0 = 1 - (y + h) / AT;
  const i = face * 4;
  // BoxGeometry face vertex order: (0,1) (1,1) (0,0) (1,0)
  if (!rotate) {
    uv.setXY(i, u0, v1);
    uv.setXY(i + 1, u1, v1);
    uv.setXY(i + 2, u0, v0);
    uv.setXY(i + 3, u1, v0);
  } else {
    uv.setXY(i, u0, v0);
    uv.setXY(i + 1, u0, v1);
    uv.setXY(i + 2, u1, v0);
    uv.setXY(i + 3, u1, v1);
  }
}

function containerGeometry() {
  if (geoCache) return geoCache;
  const g = new THREE.BoxGeometry(DIM.CONT_W, DIM.CONT_H, DIM.CONT_L);
  const uv = g.attributes.uv;
  setFaceUV(uv, 0, REG.side); // +X
  setFaceUV(uv, 1, REG.side); // -X
  setFaceUV(uv, 2, REG.top, true); // +Y
  setFaceUV(uv, 3, REG.bottom); // -Y
  setFaceUV(uv, 4, REG.door); // +Z (faces the default camera)
  setFaceUV(uv, 5, REG.front); // -Z
  uv.needsUpdate = true;
  geoCache = g;
  return g;
}

function materialFor(zoneId, type, brandIdx, mobile) {
  const key = `${zoneId}:${type}:${brandIdx}`;
  if (!matCache.has(key)) {
    const map = buildAtlas(zoneId, type, brandIdx, matCache.size + 3);
    const mat = mobile
      ? new THREE.MeshPhongMaterial({ map, shininess: 26, specular: 0x24282c })
      : new THREE.MeshStandardMaterial({ map, roughness: 0.58, metalness: 0.12 });
    matCache.set(key, mat);
  }
  return matCache.get(key);
}

let nextId = 1;

export class Cargo {
  constructor({ zone = 'ANY', type = 'std', brand = 0, mobile = false }) {
    this.id = nextId++;
    this.zone = zone;
    this.type = type;
    this.brand = brand;
    this.typeDef = CARGO_TYPES[type] || CARGO_TYPES.std;
    this.mass = this.typeDef.mass;
    this.hx = DIM.CONT_W / 2;
    this.hy = DIM.CONT_H / 2;
    this.hz = DIM.CONT_L / 2;
    this.state = 'new'; // truck | carried | loose | locked | sunk | gone
    this.body = null;
    this.collider = null;
    this.cell = null;
    this.truck = null;
    this.hp = type === 'fragile' ? 1 : 3;
    this.grade = null;
    this.scored = false;
    this.counted = false;
    this.restT = 0;
    this.sideT = 0;
    this.waterT = 0;
    this.pickedAt = 0;
    this.lastImpactT = -9;
    this.maxImpact = 0;
    this.discharge = false; // marked for unloading
    this.broken = false;
    this.temp = 1; // reefer freshness 1..0

    this.mesh = new THREE.Group();
    const box = new THREE.Mesh(containerGeometry(), materialFor(zone, type, brand, mobile));
    box.castShadow = true;
    box.receiveShadow = true;
    this.mesh.add(box);
    this.box = box;
    this.mesh.userData.cargo = this;
  }

  /** Top-centre in world space. */
  topWorld(out) {
    return out.set(0, this.hy, 0).applyMatrix4(this.mesh.matrixWorld);
  }

  dispose(scene) {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}

export function disposeCargoCaches() {
  for (const m of matCache.values()) {
    if (m.map) m.map.dispose();
    m.dispose();
  }
  matCache.clear();
}

export const BRAND_COUNT = BRANDS.length;
