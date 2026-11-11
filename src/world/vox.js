// "Vox" builder: accumulates boxes / low-poly solids with vertex colours into a single
// flat-shaded BufferGeometry so a whole prop (crane, ship, quay…) is one draw call.
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();

const BOX = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
const cylCache = new Map();
function cylGeo(seg, rTopRatio) {
  const key = seg + ':' + rTopRatio;
  if (!cylCache.has(key)) {
    const g = new THREE.CylinderGeometry(rTopRatio, 1, 1, seg, 1, false).toNonIndexed();
    g.computeVertexNormals(); // non-indexed => faceted normals
    cylCache.set(key, g);
  }
  return cylCache.get(key);
}

export class Vox {
  constructor() {
    this.p = [];
    this.n = [];
    this.c = [];
    this.shade = true;
  }

  /** Append an arbitrary geometry transformed by `matrix`, painted with `color` (hex). */
  geo(geometry, matrix, color, bright = 1) {
    const pos = geometry.attributes.position;
    const nor = geometry.attributes.normal;
    const idx = geometry.index;
    _nm.getNormalMatrix(matrix);
    _c.set(color);
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i++) {
      const k = idx ? idx.getX(i) : i;
      _v.fromBufferAttribute(pos, k).applyMatrix4(matrix);
      _n.fromBufferAttribute(nor, k).applyMatrix3(_nm).normalize();
      this.p.push(_v.x, _v.y, _v.z);
      this.n.push(_n.x, _n.y, _n.z);
      // baked directional tint: tops read lighter, undersides darker (hand-painted voxel feel)
      const f = (this.shade ? 0.84 + 0.16 * _n.y + 0.035 * _n.x + 0.02 * _n.z : 1) * bright;
      this.c.push(_c.r * f, _c.g * f, _c.b * f);
    }
    return this;
  }

  _mat(x, y, z, sx, sy, sz, rot) {
    if (rot) _q.setFromEuler(_e.set(rot[0] || 0, rot[1] || 0, rot[2] || 0));
    else _q.identity();
    return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  }

  /** Box by centre + size. rot = [rx, ry, rz] (optional). */
  box(x, y, z, sx, sy, sz, color, rot, bright) {
    return this.geo(BOX, this._mat(x, y, z, sx, sy, sz, rot), color, bright);
  }

  /** Box by min corner + size (handy for architecture). */
  boxMin(x, y, z, sx, sy, sz, color, bright) {
    return this.box(x + sx / 2, y + sy / 2, z + sz / 2, sx, sy, sz, color, null, bright);
  }

  /** Beam between two points with a square section. */
  beam(ax, ay, az, bx, by, bz, thick, color, thickZ) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    _q.setFromUnitVectors(_v.set(0, 1, 0), _n.set(dx / len, dy / len, dz / len));
    _m.compose(_p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, _s.set(thick, len, thickZ || thick));
    return this.geo(BOX, _m, color);
  }

  /** Vertical (or rotated) cylinder: radius r, height h, `seg` sides, rTop ratio for cones. */
  cyl(x, y, z, r, hgt, color, seg = 8, rTopRatio = 1, rot, bright) {
    return this.geo(cylGeo(seg, rTopRatio), this._mat(x, y, z, r, hgt, r, rot), color, bright);
  }

  /**
   * Loft between two convex outlines (arrays of [x, z]) at heights y0 / y1.
   * Used for hulls and other tapered solids. Caps optional.
   */
  loft(lower, y0, upper, y1, color, capTop = true, capBottom = false, colorTop) {
    const n = lower.length;
    _c.set(color);
    const pushTri = (a, b, c, col) => {
      const ab = _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const ac = _n.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
      const nn = ab.cross(ac).normalize();
      const f = this.shade ? 0.84 + 0.16 * nn.y + 0.035 * nn.x + 0.02 * nn.z : 1;
      for (const q of [a, b, c]) {
        this.p.push(q[0], q[1], q[2]);
        this.n.push(nn.x, nn.y, nn.z);
        this.c.push(col.r * f, col.g * f, col.b * f);
      }
    };
    const col = _c.clone();
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = [lower[i][0], y0, lower[i][1]];
      const b = [lower[j][0], y0, lower[j][1]];
      const c = [upper[j][0], y1, upper[j][1]];
      const d = [upper[i][0], y1, upper[i][1]];
      pushTri(a, c, b, col);
      pushTri(a, d, c, col);
    }
    if (capTop) {
      const ct = colorTop != null ? new THREE.Color(colorTop) : col;
      for (let i = 1; i < n - 1; i++) {
        pushTri([upper[0][0], y1, upper[0][1]], [upper[i + 1][0], y1, upper[i + 1][1]], [upper[i][0], y1, upper[i][1]], ct);
      }
    }
    if (capBottom) {
      for (let i = 1; i < n - 1; i++) {
        pushTri([lower[0][0], y0, lower[0][1]], [lower[i][0], y0, lower[i][1]], [lower[i + 1][0], y0, lower[i + 1][1]], col);
      }
    }
    return this;
  }

  get vertexCount() {
    return this.p.length / 3;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  mesh(material, { cast = true, receive = true } = {}) {
    const m = new THREE.Mesh(this.build(), material);
    m.castShadow = cast;
    m.receiveShadow = receive;
    return m;
  }
}

// ---------------------------------------------------------------- shared materials

export const MAT = {};

export function initMaterials({ mobile }) {
  // Painted steel / general props: matte, cheap, vertex coloured.
  MAT.vox = new THREE.MeshLambertMaterial({ vertexColors: true });
  // Wet surfaces pick up sodium highlights.
  MAT.wet = mobile
    ? new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 38, specular: 0x30343a })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.08 });
  // Self-lit pieces (lamps, windows, beacons). Colour is pushed past 1.0 so bloom catches it.
  MAT.glow = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: true });
  MAT.glow.color.setScalar(mobile ? 1.3 : 1.7);
  MAT.glowSoft = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  MAT.glowSoft.color.setScalar(1.25);
  MAT.dark = new THREE.MeshBasicMaterial({ color: 0x05090d, fog: true });
  return MAT;
}

// ---------------------------------------------------------------- canvas helpers

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function canvasTexture(canvas, { repeat = false, nearest = false, aniso = 4, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (nearest) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  }
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

let _glowTex = null;
/** Soft radial falloff used for lamp halos and light pools. */
export function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.16)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  _glowTex = canvasTexture(c, { srgb: false });
  return _glowTex;
}

/** Additive halo sprite. */
export function glowSprite(color, size, opacity = 1) {
  const mat = new THREE.SpriteMaterial({
    map: glowTexture(),
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: true,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(size, size, 1);
  return s;
}

/**
 * Fake volumetric light cone: open cone, additive, fading along its length and at grazing angles.
 */
export function lightCone(color, radius, length, opacity = 0.2) {
  const geo = new THREE.CylinderGeometry(0.12, radius, length, 20, 1, true);
  geo.translate(0, -length / 2, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uLen: { value: length },
    },
    vertexShader: /* glsl */ `
      varying float vT;
      varying vec3 vN;
      varying vec3 vV;
      uniform float uLen;
      void main() {
        vT = clamp(-position.y / uLen, 0.0, 1.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vT;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float rim = abs(dot(normalize(vN), normalize(vV)));
        float a = pow(rim, 1.6) * (1.0 - vT) * (1.0 - vT) * smoothstep(0.0, 0.06, vT);
        gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
      }
    `,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 5;
  m.frustumCulled = false;
  return m;
}
