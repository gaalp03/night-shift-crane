// Night-time polish: wet-quay reflection streaks, anamorphic lamp flares and neon tubes.
// Everything here is a cheap stand-in for something expensive (screen-space reflections,
// lens simulation, emissive area lights) — a handful of textured quads, one draw call each.
import * as THREE from 'three';
import { makeCanvas, canvasTexture, FX_LAYER } from './vox.js';
import { clamp } from '../core/util.js';

let _streak = null;
let _puddle = null;
let _flare = null;

/** A light smeared down a wet road: bright core, long tail, broken by ripples. */
function streakTexture() {
  if (_streak) return _streak;
  const w = 64;
  const hgt = 256;
  const c = makeCanvas(w, hgt);
  const g = c.getContext('2d');
  const img = g.createImageData(w, hgt);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let shift = 0;
  let gain = 1;
  for (let y = 0; y < hgt; y++) {
    const v = y / (hgt - 1);
    // peak a little off-centre, slower fall-off towards the viewer
    const d = v - 0.4;
    const along = Math.exp(-Math.pow(d / (d < 0 ? 0.2 : 0.34), 2));
    // every few rows the reflection jumps sideways and dims: ripples in the standing water
    if (y % 3 === 0) {
      shift = (rnd() - 0.5) * 9;
      gain = 0.45 + rnd() * 0.75;
      if (rnd() < 0.12) gain *= 0.25;
    }
    for (let x = 0; x < w; x++) {
      const u = (x - w / 2 + shift) / (w / 2);
      const across = Math.exp(-Math.pow(u / 0.34, 2)) + 0.25 * Math.exp(-Math.pow(u / 0.75, 2));
      const a = clamp(along * across * gain, 0, 1);
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(a * 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  _streak = canvasTexture(c, { aniso: 4, srgb: false });
  return _streak;
}

/** Where the water actually stands: large soft blotches, tiled over the quay. */
export function blotchTexture() {
  return puddleTexture();
}

function puddleTexture() {
  if (_puddle) return _puddle;
  const n = 64;
  const c = makeCanvas(n, n);
  const g = c.getContext('2d');
  const img = g.createImageData(n, n);
  const P = 8;
  const lat = [];
  let seed = 99;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < P * P; i++) lat.push(rnd());
  const at = (x, y) => lat[(((y % P) + P) % P) * P + (((x % P) + P) % P)];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * P;
      const fy = (y / n) * P;
      const xi = Math.floor(fx);
      const yi = Math.floor(fy);
      let tx = fx - xi;
      let ty = fy - yi;
      tx = tx * tx * (3 - 2 * tx);
      ty = ty * ty * (3 - 2 * ty);
      const v = (at(xi, yi) * (1 - tx) + at(xi + 1, yi) * tx) * (1 - ty) + (at(xi, yi + 1) * (1 - tx) + at(xi + 1, yi + 1) * tx) * ty;
      const i = (y * n + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(v * 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  _puddle = canvasTexture(c, { repeat: true, aniso: 1, srgb: false });
  return _puddle;
}

/** Wide, thin lens streak (the "anamorphic" look of a cine lens pointed at a lamp). */
export function flareTexture() {
  if (_flare) return _flare;
  const w = 256;
  const hgt = 32;
  const c = makeCanvas(w, hgt);
  const g = c.getContext('2d');
  const img = g.createImageData(w, hgt);
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x - w / 2) / (w / 2);
      const v = (y - hgt / 2) / (hgt / 2);
      const a = Math.pow(Math.max(0, 1 - Math.abs(u)), 2.2) * Math.exp(-Math.pow(v / (0.16 + 0.5 * (1 - Math.abs(u)) * 0.3), 2));
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  _flare = canvasTexture(c, { aniso: 1 });
  return _flare;
}

export function flareSprite(color, width, height = width * 0.11, opacity = 0.5) {
  const mat = new THREE.SpriteMaterial({ map: flareTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  const s = new THREE.Sprite(mat);
  s.scale.set(width, height, 1);
  s.layers.set(FX_LAYER);
  return s;
}

/**
 * Neon lettering: a soft halo, a saturated tube and a hot white core, drawn into a texture.
 * @returns { texture, aspect }
 */
export function neonTexture(text, { color = '#3df2e2', font = '"Bungee", "Arial Black", sans-serif', size = 150, underline = null, spacing = 0.06, pad = 56 } = {}) {
  const probe = makeCanvas(8, 8).getContext('2d');
  probe.font = `${size}px ${font}`;
  if ('letterSpacing' in probe) probe.letterSpacing = `${Math.round(size * spacing)}px`;
  const tw = Math.ceil(probe.measureText(text).width);
  const w = tw + pad * 2;
  const hgt = Math.round(size * 1.15) + pad * 2 + (underline ? Math.round(size * 0.22) : 0);
  const c = makeCanvas(w, hgt);
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, hgt);
  g.font = `${size}px ${font}`;
  if ('letterSpacing' in g) g.letterSpacing = `${Math.round(size * spacing)}px`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const x = pad;
  const y = pad + size * 0.58;
  const pass = (blur, alpha, lw, stroke) => {
    g.save();
    g.shadowColor = color;
    g.shadowBlur = blur;
    g.globalAlpha = alpha;
    g.strokeStyle = stroke;
    g.lineWidth = lw;
    g.strokeText(text, x, y);
    if (underline) {
      g.strokeStyle = stroke === '#ffffff' ? '#ffffff' : underline;
      g.shadowColor = underline;
      g.beginPath();
      g.moveTo(x + 4, y + size * 0.72);
      g.lineTo(x + tw - 4, y + size * 0.72);
      g.stroke();
    }
    g.restore();
  };
  // tubes are outlines, not filled letters — that is what makes it read as neon
  pass(46, 0.55, size * 0.1, color);
  pass(22, 0.9, size * 0.075, color);
  pass(6, 1, size * 0.028, '#ffffff');
  return { texture: canvasTexture(c, { aniso: 8 }), aspect: w / hgt };
}

/** A neon sign as a glowing quad (additive, so the dark between the tubes stays dark). */
export function neonSign(text, height, opts = {}) {
  const { texture, aspect } = neonTexture(text, opts);
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true, side: THREE.DoubleSide });
  mat.color.setScalar(opts.gain || 1.5);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(height * aspect, height), mat);
  m.userData.gain = opts.gain || 1.5;
  return m;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Wet-ground reflections: every lamp over the quay drags a streak of its own colour across the
 * concrete towards the camera, exactly where a mirror would put it, broken up by the puddles.
 */
export class WetShine {
  /**
   * @param y       height of the wet surface
   * @param bounds  { minX, maxX, halfZ } area the streaks may cover (the quay slab)
   */
  constructor(scene, { y, bounds, count = 22 }) {
    this.y = y;
    this.bounds = bounds;
    this.count = count;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.uniforms = {
      uStreak: { value: streakTexture() },
      uPuddle: { value: puddleTexture() },
      uFog: { value: 0.0105 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec2 vW;
        varying float vDepth;
        varying vec3 vCol;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vW = wp.xz;
          vec4 mv = viewMatrix * wp;
          vDepth = -mv.z;
          vCol = instanceColor;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uStreak;
        uniform sampler2D uPuddle;
        uniform float uFog;
        varying vec2 vUv;
        varying vec2 vW;
        varying float vDepth;
        varying vec3 vCol;
        void main() {
          float s = texture2D(uStreak, vUv).r;
          // standing water mirrors, damp concrete only sheens
          float p = texture2D(uPuddle, vW * 0.043).r;
          float wet = mix(0.22, 1.0, smoothstep(0.4, 0.6, p));
          float fog = exp(-uFog * uFog * vDepth * vDepth);
          gl_FragColor = vec4(vCol * s * wet * fog, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _c.setRGB(0, 0, 0));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /**
   * @param lights  [{ pos: Vector3 (world), color: Color, power }]
   * @param wetness 0..1 (how much rain is standing on the quay)
   */
  update(lights, camera, wetness, fogDensity, boost = 1) {
    this.uniforms.uFog.value = fogDensity;
    const B = this.bounds;
    const cx = camera.position.x;
    const cz = camera.position.z;
    const H = camera.position.y - this.y;
    let n = 0;
    if (H > 0.4 && wetness > 0.02) {
      for (let i = 0; i < lights.length && n < this.count; i++) {
        const L = lights[i];
        const h = L.pos.y - this.y;
        if (h < 0.6 || L.power <= 0.02) continue;
        let dx = cx - L.pos.x;
        let dz = cz - L.pos.z;
        const D = Math.hypot(dx, dz);
        if (D < 0.01) continue;
        dx /= D;
        dz /= D;
        // mirror point: where a flat wet floor would show this lamp to the camera
        const m = (D * h) / (h + H);
        // (low lamps — headlights — still drag a long streak: the road is rough, not a mirror)
        const len = clamp(Math.max(m * 0.95 + h * 0.7, L.len || 0), 2.5, 46);
        const mx = L.pos.x + dx * m;
        const mz = L.pos.z + dz * m;
        // the streak texture peaks at 40% of its length: slide the quad so the peak sits on the mirror point
        const px = mx + dx * len * 0.1;
        const pz = mz + dz * len * 0.1;
        // keep it on the slab: fade as the far end runs off the edge into thin air
        const ex = px + Math.abs(dx) * len * 0.5 * Math.sign(dx);
        const edge = clamp((B.maxX - Math.max(px, ex, mx)) / 2.5, 0, 1) * clamp((Math.min(px, mx) - B.minX) / 6, 0, 1) * clamp((B.halfZ - Math.abs(mz)) / 6, 0, 1);
        if (edge <= 0.01) continue;
        // grazing views mirror far more than looking straight down
        const cosv = H / Math.hypot(D - m, H);
        const fres = 0.1 + 0.9 * Math.pow(1 - clamp(cosv, 0, 1), 2.2);
        const k = L.power * wetness * fres * edge * (L.gain || 1) * boost;
        if (k < 0.012) continue;
        const width = (L.width || 1.1 + h * 0.1) * (1 + 0.5 * (1 - cosv));
        // (the long tail of the texture runs along local +Z: point it at the camera)
        _q.setFromAxisAngle(UP, Math.atan2(dx, dz));
        _m.compose(_p.set(px, this.y + 0.035, pz), _q, _s.set(width, 1, len));
        this.mesh.setMatrixAt(n, _m);
        this.mesh.setColorAt(n, _c.copy(L.color).multiplyScalar(k));
        n++;
      }
    }
    this.mesh.count = n;
    if (n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }
}
