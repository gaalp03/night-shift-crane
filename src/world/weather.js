// Weather: wind (with telegraphed gusts), GPU rain streaks, ground splashes, fog targets, lightning.
import * as THREE from 'three';
import { DIM, PAL } from '../config.js';
import { damp, noise1, clamp, rand } from '../core/util.js';

export const CLEAR = { rain: 0, snow: 0, wind: 0, windDir: 0.4, gusts: 0, fog: 0.0105, storm: 0, sea: 0.12, clouds: 0.45 };

export class Weather {
  constructor(scene, { count = 2000, mobile = false } = {}) {
    this.scene = scene;
    this.cur = { ...CLEAR };
    this.target = { ...CLEAR };
    this.wind = { x: 0, z: 0 }; // acceleration on a standard container (m/s²)
    this.windSpeed = 0;
    this.windAngle = 0;
    this.gust = 0; // 0..1 current gust envelope
    this.gustWarn = 0; // seconds until the telegraphed gust hits (0 = none pending)
    this.gustT = rand(9, 16);
    this.flash = 0;
    this.flashSeq = [];
    this.lightningT = rand(5, 10);
    this.onThunder = null;
    this.onGustWarn = null;
    this.onGust = null;
    this.fogColor = new THREE.Color(PAL.fog);
    this.t = 0;
    this._buildRain(count);
    this._buildSplashes(mobile ? 140 : 260);
    this._buildSnow(mobile ? 1400 : 2600);
    this.cover = 0; // how much snow has settled on the quay (0..1), builds up slowly
    this._buildBolt();
  }

  /** A forked bolt far out over the water, re-shaped for every strike. */
  _buildBolt() {
    const max = 40;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 6 * 3), 3));
    const mat = new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    mat.color.multiplyScalar(3);
    this.bolt = new THREE.Mesh(geo, mat);
    this.bolt.frustumCulled = false;
    this.bolt.visible = false;
    this.boltMax = max;
    this.scene.add(this.bolt);
  }

  _strike() {
    // random bearing on the seaward half of the sky
    const a = -Math.PI * 0.75 + Math.random() * Math.PI * 1.1;
    const r = 330 + Math.random() * 120;
    const bx = Math.cos(a) * r + 30;
    const bz = Math.sin(a) * r - 40;
    // billboard direction (perpendicular to the view from the pier)
    const px = -Math.sin(a);
    const pz = Math.cos(a);
    const pos = this.bolt.geometry.attributes.position;
    let n = 0;
    const seg = (x0, y0, o0, x1, y1, o1, w) => {
      if (n >= this.boltMax) return;
      const ax = bx + px * o0;
      const az = bz + pz * o0;
      const cx = bx + px * o1;
      const cz = bz + pz * o1;
      const i = n * 6;
      pos.setXYZ(i, ax - px * w, y0, az - pz * w);
      pos.setXYZ(i + 1, ax + px * w, y0, az + pz * w);
      pos.setXYZ(i + 2, cx + px * w, y1, cz + pz * w);
      pos.setXYZ(i + 3, ax - px * w, y0, az - pz * w);
      pos.setXYZ(i + 4, cx + px * w, y1, cz + pz * w);
      pos.setXYZ(i + 5, cx - px * w, y1, cz - pz * w);
      n++;
    };
    const branch = (y, o, w, depth) => {
      while (y > 6 && n < this.boltMax) {
        const ny = y - rand(14, 30);
        const no = o + rand(-22, 22);
        seg(0, y, o, 0, ny, no, w);
        if (depth < 2 && Math.random() < 0.3) branch(ny, no, w * 0.5, depth + 1);
        y = ny;
        o = no;
        if (depth > 0 && Math.random() < 0.35) break;
      }
    };
    branch(240, rand(-30, 30), 1.7, 0);
    for (let i = n * 6; i < this.boltMax * 6; i++) pos.setXYZ(i, 0, -999, 0);
    pos.needsUpdate = true;
    this.bolt.visible = true;
  }

  _buildRain(count) {
    this.rainCount = count;
    const pos = new Float32Array(count * 2 * 3);
    const seed = new Float32Array(count * 2);
    const end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = Math.random();
      const y = Math.random();
      const z = Math.random();
      const s = Math.random();
      for (let k = 0; k < 2; k++) {
        pos.set([x, y, z], (i * 2 + k) * 3);
        seed[i * 2 + k] = s;
        end[i * 2 + k] = k;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.rainUniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector2() },
      uAmount: { value: 0 },
      uBox: { value: new THREE.Vector3(70, 46, 70) },
      uFlash: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.rainUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aSeed; attribute float aEnd;
        uniform float uTime; uniform vec3 uCenter; uniform vec2 uWind; uniform float uAmount; uniform vec3 uBox;
        varying float vA;
        void main() {
          vec3 fall = normalize(vec3(uWind.x * 0.085, -1.0, uWind.y * 0.085));
          float speed = 34.0 * (0.8 + aSeed * 0.45);
          vec3 p = position * uBox + fall * speed * uTime;
          p = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5 + uCenter;
          p -= fall * aEnd * (0.9 + aSeed * 0.9);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          // only a share of the streaks exist in light rain
          float on = step(aSeed, uAmount * 1.05);
          vA = on * smoothstep(70.0, 12.0, d) * smoothstep(1.0, 5.0, d) * (0.35 + 0.65 * aEnd);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uFlash;
        varying float vA;
        void main() {
          vec3 col = mix(vec3(0.55, 0.62, 0.7), vec3(1.0, 0.78, 0.5), 0.35) * (0.5 + uFlash * 1.5);
          gl_FragColor = vec4(col * vA * 0.55, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.rain = new THREE.LineSegments(geo, mat);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 8;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  _buildSplashes(count) {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos.set([Math.random(), 0, Math.random()], i * 3);
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.splashUniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uAmount: { value: 0 },
      uScale: { value: 600 },
      uY: { value: DIM.QUAY_Y + 0.06 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.splashUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime; uniform vec3 uCenter; uniform float uAmount; uniform float uScale; uniform float uY;
        varying float vLife; varying float vOn;
        void main() {
          float cyc = uTime * (1.6 + aSeed) + aSeed * 17.0;
          float life = fract(cyc);
          float gen = floor(cyc);
          // hop to a fresh spot every cycle
          vec2 r = fract(sin(vec2(gen * 12.9898 + aSeed * 78.233, gen * 39.346 + aSeed * 11.135)) * 43758.5453);
          vec2 box = vec2(46.0, 46.0);
          vec3 p = vec3((position.x + r.x) * box.x, uY, (position.z + r.y) * box.y);
          p.xz = mod(p.xz - uCenter.xz + box * 0.5, box) - box * 0.5 + uCenter.xz;
          vOn = step(p.x, -1.6) * step(aSeed, uAmount);
          vLife = life;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uScale * (0.25 + life * 0.75) * 0.36 / max(1.0, -mv.z);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vLife; varying float vOn;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          c.y *= 2.4; // squash: seen at a glancing angle
          float d = length(c);
          float ring = smoothstep(0.5, 0.42, d) * smoothstep(0.26, 0.36, d);
          float a = ring * (1.0 - vLife) * vOn;
          gl_FragColor = vec4(vec3(1.0, 0.82, 0.6) * a * 0.5, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.splashes = new THREE.Points(geo, mat);
    this.splashes.frustumCulled = false;
    this.splashes.renderOrder = 3;
    this.splashes.visible = false;
    this.scene.add(this.splashes);
  }

  /** Big soft flakes drifting on the wind, drawn as round points. */
  _buildSnow(count) {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos.set([Math.random(), Math.random(), Math.random()], i * 3);
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.snowUniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector2() },
      uAmount: { value: 0 },
      uBox: { value: new THREE.Vector3(60, 36, 60) },
      uScale: { value: 800 },
      uFlash: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.snowUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime; uniform vec3 uCenter; uniform vec2 uWind; uniform float uAmount; uniform vec3 uBox; uniform float uScale;
        varying float vA;
        void main() {
          float t = uTime;
          vec3 drift = vec3(uWind.x * 0.55, -(1.3 + aSeed * 1.1), uWind.y * 0.55);
          vec3 p = position * uBox + drift * t;
          // each flake tumbles on its own little spiral
          p.x += sin(t * (0.7 + aSeed * 1.3) + aSeed * 40.0) * 0.6;
          p.z += cos(t * (0.6 + aSeed) + aSeed * 23.0) * 0.6;
          p = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5 + uCenter;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          gl_PointSize = uScale * (0.085 + aSeed * 0.08) / max(1.0, d);
          float on = step(aSeed, uAmount * 1.02);
          vA = on * smoothstep(60.0, 10.0, d) * smoothstep(0.8, 3.0, d);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uFlash;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.15, d) * vA;
          vec3 col = vec3(0.86, 0.9, 1.0) * (0.55 + uFlash);
          gl_FragColor = vec4(col * a * 0.95, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.snow = new THREE.Points(geo, mat);
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 8;
    this.snow.visible = false;
    this.scene.add(this.snow);
  }

  /** Blend towards a weather profile (level defined). */
  set(profile, instant = false) {
    this.target = { ...CLEAR, ...profile };
    if (instant) {
      this.cur = { ...this.target };
      // a night that starts in snow starts with some already on the ground
      this.cover = this.target.snow > 0.15 ? 0.35 * this.target.snow : 0;
    }
  }

  /** Force a telegraphed gust now (scripted events). */
  triggerGust(delay = 1.6) {
    if (this.gustWarn > 0 || this.gust > 0.2) return;
    this.gustWarn = delay;
    if (this.onGustWarn) this.onGustWarn(delay);
  }

  update(dt, camera, focus, viewH) {
    this.t += dt;
    const c = this.cur;
    const tg = this.target;
    for (const k of ['rain', 'snow', 'wind', 'gusts', 'fog', 'storm', 'sea', 'clouds']) c[k] = damp(c[k], tg[k], 0.6, dt);
    // snow settles slowly and melts slowly
    this.cover = clamp(this.cover + (c.snow > 0.15 ? c.snow * dt / 90 : -dt / 40), 0, 0.85);
    c.windDir = tg.windDir;

    // ---- wind with telegraphed gusts
    if (c.gusts > 0.05 && c.wind > 0.1) {
      if (this.gustWarn > 0) {
        this.gustWarn -= dt;
        if (this.gustWarn <= 0) {
          this.gust = 1;
          this.gustHold = rand(1.6, 2.8);
          if (this.onGust) this.onGust();
        }
      } else if (this.gust <= 0.01) {
        this.gustT -= dt;
        if (this.gustT <= 0) {
          this.gustT = rand(11, 20) / (0.5 + c.gusts);
          this.triggerGust(1.7);
        }
      }
    }
    if (this.gust > 0) {
      this.gustHold -= dt;
      if (this.gustHold <= 0) this.gust = Math.max(0, this.gust - dt * 0.9);
    }
    const breathing = 0.62 + 0.38 * noise1(this.t * 0.21 + 3.1);
    this.windSpeed = c.wind * (breathing + this.gust * (0.9 + c.gusts * 0.8));
    this.windAngle = c.windDir + noise1(this.t * 0.07) * 0.35;
    this.wind.x = Math.cos(this.windAngle) * this.windSpeed;
    this.wind.z = Math.sin(this.windAngle) * this.windSpeed;

    // ---- rain
    const ru = this.rainUniforms;
    this.rain.visible = c.rain > 0.02;
    this.splashes.visible = c.rain > 0.05;
    if (this.rain.visible) {
      ru.uTime.value = this.t;
      ru.uAmount.value = clamp(c.rain, 0, 1);
      ru.uWind.value.set(this.wind.x * 3.2 + 0.6, this.wind.z * 3.2);
      camera.getWorldDirection(ru.uCenter.value).multiplyScalar(22).add(camera.position);
      ru.uFlash.value = this.flash;
      const su = this.splashUniforms;
      su.uTime.value = this.t;
      su.uAmount.value = clamp(c.rain * 1.1, 0, 1);
      su.uCenter.value.copy(focus);
      su.uScale.value = viewH || 800;
    }

    // ---- snow
    this.snow.visible = c.snow > 0.02;
    if (this.snow.visible) {
      const sn = this.snowUniforms;
      sn.uTime.value = this.t;
      sn.uAmount.value = clamp(c.snow, 0, 1);
      sn.uWind.value.set(this.wind.x * 2.2 + 0.3, this.wind.z * 2.2);
      camera.getWorldDirection(sn.uCenter.value).multiplyScalar(18).add(camera.position);
      sn.uScale.value = viewH || 800;
      sn.uFlash.value = this.flash;
    }

    // ---- lightning
    if (c.storm > 0.3) {
      this.lightningT -= dt;
      if (this.lightningT <= 0) {
        this.lightningT = rand(7, 17) / c.storm;
        this.flashSeq = [
          [0, 1],
          [0.07, 0.15],
          [0.13, 0.8],
          [0.22, 0.05],
          [0.3, 0.45],
          [0.5, 0],
        ];
        this.flashT = 0;
        this._strike();
        if (this.onThunder) this.onThunder(rand(0.5, 1.8));
      }
    }
    if (this.flashSeq.length) {
      this.flashT += dt;
      let v = 0;
      for (let i = 0; i < this.flashSeq.length - 1; i++) {
        const a = this.flashSeq[i];
        const b = this.flashSeq[i + 1];
        if (this.flashT >= a[0] && this.flashT < b[0]) v = a[1] + ((b[1] - a[1]) * (this.flashT - a[0])) / (b[0] - a[0]);
      }
      this.flash = v;
      this.bolt.material.opacity = Math.min(1, v * 1.4);
      if (this.flashT > 0.5) {
        this.flashSeq = [];
        this.flash = 0;
        this.bolt.visible = false;
      }
    }
  }
}
