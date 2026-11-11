// Stylised faceted sea: vertex-displaced waves, per-facet glints from the harbour lights,
// horizon-glow reflection, hull foam and rain ripples. `heightAt` mirrors the shader on the CPU.
import * as THREE from 'three';
import { PAL } from '../config.js';

const MAX_LIGHTS = 16;

// direction (x, z), wavelength, speed, amplitude share
const WAVES = [
  [0.86, 0.5, 23.0, 2.3, 0.42],
  [-0.38, 0.92, 13.0, 3.1, 0.27],
  [0.62, -0.78, 7.5, 3.8, 0.19],
  [-0.9, -0.42, 4.2, 4.6, 0.12],
];

export class Water {
  constructor(scene, { mobile = false } = {}) {
    const seg = mobile ? 110 : 170;
    const R = 520;
    const geo = new THREE.PlaneGeometry(2, 2, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i);
      const w = pos.getZ(i);
      const f = (t) => R * (0.2 * t + 0.8 * t * Math.pow(Math.abs(t), 1.7));
      pos.setXYZ(i, f(u), 0, f(w));
    }
    pos.needsUpdate = true;
    geo.computeBoundingSphere();

    this.uniforms = {
      uTime: { value: 0 },
      uAmp: { value: 0.25 },
      uDeep: { value: new THREE.Color(PAL.waterDeep) },
      uMid: { value: new THREE.Color(PAL.waterMid) },
      uSkyTop: { value: new THREE.Color(PAL.skyMid) },
      uSkyGlow: { value: new THREE.Color(PAL.skyGlow) },
      uFogColor: { value: new THREE.Color(PAL.fog) },
      uFogDensity: { value: 0.012 },
      uLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3(0, -1000, 0)) },
      uLightCol: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Color(0, 0, 0)) },
      uHull: { value: new THREE.Vector4(8, 0, 6, 24) }, // centre x, z, half x, half z
      uHullOn: { value: 1 },
      uRain: { value: 0 },
      uFlash: { value: 0 },
      uOrigin: { value: new THREE.Vector2(34, 0) },
    };
    const waveDefs = WAVES.map((w, i) => `#define W${i} vec4(${w[0].toFixed(3)}, ${w[1].toFixed(3)}, ${(6.28318 / w[2]).toFixed(4)}, ${w[3].toFixed(3)})\n#define A${i} ${w[4].toFixed(3)}`).join('\n');

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        ${waveDefs}
        uniform float uTime;
        uniform float uAmp;
        uniform vec2 uOrigin;
        varying vec3 vWorld;
        varying float vCrest;
        float wave(vec4 w, float a, vec2 p) {
          float ph = dot(w.xy, p) * w.z + uTime * w.w * w.z * 2.2;
          return a * (sin(ph) + 0.35 * sin(ph * 2.0 + 1.3));
        }
        void main() {
          vec3 p = position;
          p.xz += uOrigin;
          float h = wave(W0, A0, p.xz) + wave(W1, A1, p.xz) + wave(W2, A2, p.xz) + wave(W3, A3, p.xz);
          // calmer right against the quay wall
          float lee = smoothstep(0.0, 14.0, p.x);
          p.y = h * uAmp * (0.45 + 0.55 * lee);
          vCrest = h;
          vWorld = p;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uAmp;
        uniform vec3 uDeep; uniform vec3 uMid; uniform vec3 uSkyTop; uniform vec3 uSkyGlow;
        uniform vec3 uFogColor; uniform float uFogDensity;
        uniform vec3 uLightPos[${MAX_LIGHTS}];
        uniform vec3 uLightCol[${MAX_LIGHTS}];
        uniform vec4 uHull; uniform float uHullOn;
        uniform float uRain; uniform float uFlash;
        varying vec3 vWorld;
        varying float vCrest;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }

        void main() {
          // facet normal from screen-space derivatives: the low-poly look
          vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
          if (n.y < 0.0) n = -n;
          // fine chop so facets shimmer instead of reading as flat tiles
          vec2 q = vWorld.xz * 0.9;
          float t = uTime * 0.7;
          vec2 rip = vec2(noise(q + vec2(t, 0.0)) - noise(q - vec2(t, 0.3)), noise(q.yx * 1.1 + vec2(0.0, t)) - noise(q.yx * 1.1 - vec2(0.4, t)));
          rip += uRain * (vec2(noise(vWorld.xz * 5.0 + t * 6.0), noise(vWorld.zx * 5.0 - t * 6.0)) - 0.5) * 0.9;
          n = normalize(n + vec3(rip.x, 0.0, rip.y) * (0.14 + 0.1 * uAmp));

          vec3 toCam = cameraPosition - vWorld;
          float dist = length(toCam);
          vec3 v = toCam / dist;
          float ndv = clamp(dot(n, v), 0.0, 1.0);
          float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);

          vec3 r = reflect(-v, n);
          float ry = clamp(r.y, 0.0, 1.0);
          vec3 sky = mix(uSkyGlow * 0.85, uSkyTop, smoothstep(0.0, 0.35, ry));
          sky += uFlash * vec3(0.5, 0.6, 0.9);

          vec3 col = mix(uDeep, uMid, clamp(0.35 + vCrest * 0.6, 0.0, 1.0));
          col = mix(col, sky, fres * 0.85);

          // harbour lights: a broad smear plus a tight sparkle per facet
          vec3 glint = vec3(0.0);
          for (int i = 0; i < ${MAX_LIGHTS}; i++) {
            vec3 lv = uLightPos[i] - vWorld;
            float d2 = dot(lv, lv);
            vec3 l = lv * inversesqrt(d2);
            float rl = max(dot(r, l), 0.0);
            float att = 1.0 / (1.0 + d2 * 0.0009);
            glint += uLightCol[i] * (pow(rl, 26.0) * 0.5 + pow(rl, 240.0) * 3.2) * att;
          }
          col += glint;

          // foam + contact shadow around the hull and along the quay wall
          float dh = sdBox(vWorld.xz - uHull.xy, uHull.zw);
          float lap = sin(dh * 5.0 - uTime * 1.8 + noise(vWorld.xz * 0.9) * 5.0);
          float foam = smoothstep(1.3, 0.0, dh) * smoothstep(0.1, 0.75, lap * 0.5 + 0.5 + noise(vWorld.xz * 2.4 + t) * 0.5 - 0.35);
          foam *= uHullOn;
          float dq = vWorld.x;
          float quayFoam = smoothstep(1.1, 0.0, dq) * step(0.0, dq) * smoothstep(0.2, 0.8, sin(vWorld.z * 1.7 + uTime * 1.3 + noise(vWorld.zz * 0.7) * 4.0) * 0.5 + 0.5);
          foam = max(foam, quayFoam * 0.7);
          foam = max(foam, smoothstep(0.78, 1.05, vCrest * (0.5 + uAmp)) * 0.6 * uAmp);
          float ao = mix(1.0, 0.55, smoothstep(3.0, 0.0, dh) * uHullOn);
          col *= ao;
          col = mix(col, vec3(0.62, 0.72, 0.74) * (0.35 + 0.65 * length(glint + 0.25)), clamp(foam, 0.0, 1.0) * 0.55);

          float fog = 1.0 - exp(-dist * dist * uFogDensity * uFogDensity);
          col = mix(col, uFogColor + uFlash * vec3(0.18, 0.22, 0.3), clamp(fog, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    mat.extensions = { derivatives: true };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5;
    scene.add(this.mesh);
    this.lights = [];
    this.amp = 0.25;
    this.time = 0;
  }

  /** CPU mirror of the vertex shader (world y of the surface at x, z). */
  heightAt(x, z) {
    let h = 0;
    for (const w of WAVES) {
      const k = (Math.PI * 2) / w[2];
      const ph = (w[0] * x + w[1] * z) * k + this.time * w[3] * k * 2.2;
      h += w[4] * (Math.sin(ph) + 0.35 * Math.sin(ph * 2 + 1.3));
    }
    const lee = Math.min(1, Math.max(0, x / 14));
    const s = lee * lee * (3 - 2 * lee);
    return h * this.amp * (0.45 + 0.55 * s);
  }

  /**
   * @param list [{ pos: Vector3, color: Color, power }] — the brightest/nearest are kept.
   */
  setLights(list) {
    const P = this.uniforms.uLightPos.value;
    const C = this.uniforms.uLightCol.value;
    const n = Math.min(MAX_LIGHTS, list.length);
    for (let i = 0; i < MAX_LIGHTS; i++) {
      if (i < n) {
        P[i].copy(list[i].pos);
        C[i].copy(list[i].color).multiplyScalar(list[i].power == null ? 1 : list[i].power);
      } else {
        C[i].setRGB(0, 0, 0);
      }
    }
  }

  setHull(cx, cz, hx, hz, on = 1) {
    this.uniforms.uHull.value.set(cx, cz, hx, hz);
    this.uniforms.uHullOn.value = on;
  }

  update(dt, { amp, fogColor, fogDensity, rain, flash }) {
    this.time += dt;
    this.amp = amp;
    const u = this.uniforms;
    u.uTime.value = this.time;
    u.uAmp.value = amp;
    if (fogColor) u.uFogColor.value.copy(fogColor);
    if (fogDensity != null) u.uFogDensity.value = fogDensity;
    u.uRain.value = rain || 0;
    u.uFlash.value = flash || 0;
  }
}
