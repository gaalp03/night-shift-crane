// Renderer, post-processing and adaptive quality.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { isMobile, clamp } from './util.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uDesat: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uFlash;
    uniform float uDesat;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      // gentle chromatic fringe towards the corners, like an old security lens
      float r2 = dot(c, c);
      vec2 off = c * r2 * 0.006;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;
      // split-tone grade: teal shadows, warm highlights
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowTint = vec3(0.86, 1.0, 1.08);
      vec3 hiTint = vec3(1.07, 1.0, 0.9);
      col *= mix(shadowTint, hiTint, smoothstep(0.0, 0.9, l));
      col = mix(col, vec3(l), uDesat);
      // filmic vignette
      float v = smoothstep(0.95, 0.25, length(c * vec2(1.0, 1.15)));
      col *= mix(0.55, 1.0, v);
      // fine grain
      float g = hash(uv * vec2(1920.0, 1080.0) + fract(uTime) * 37.0) - 0.5;
      col += g * 0.018 * (0.4 + l);
      col += uFlash * vec3(0.75, 0.82, 1.0);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

class Gfx {
  constructor() {
    this.renderer = null;
    this.composer = null;
    this.quality = 'high';
    this.pixelRatio = 1;
    this.mobile = isMobile();
    this.size = new THREE.Vector2(1, 1);
    this.usePost = false;
    this.flash = 0;
    this.desat = 0;
    this._ft = [];
    this._adaptT = 0;
    this._adaptLevel = 0;
    this.auto = true;
    this.onResize = new Set();
    this.failed = false;
  }

  init(canvas) {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        stencil: false,
      });
    } catch (e) {
      this.failed = true;
      return false;
    }
    this.renderer = renderer;
    renderer.setClearColor(0x04080f, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.info.autoReset = true;
    this.maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
    });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize());
    return true;
  }

  /** scene/camera are needed to build the post chain. */
  setup(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.applyQuality(this.quality);
  }

  /** quality: 'low' | 'medium' | 'high' | 'auto' */
  applyQuality(q) {
    this.auto = q === 'auto';
    if (this.auto) q = this.mobile ? 'medium' : 'high';
    this.quality = q;
    this._adaptLevel = 0;
    this._configure();
  }

  _configure() {
    const q = this.quality;
    const dpr = window.devicePixelRatio || 1;
    const lvl = this._adaptLevel;
    // Mobile keeps a crisp native-ish resolution; we would rather drop effects than sharpness.
    let cap = q === 'high' ? 2 : q === 'medium' ? (this.mobile ? 2 : 1.5) : this.mobile ? 1.5 : 1;
    cap -= Math.min(lvl, 3) * 0.2;
    const minPR = this.mobile ? Math.min(dpr, 1.35) : 1;
    this.pixelRatio = clamp(Math.min(dpr, cap), minPR, 2);
    this.usePost = q === 'high' && lvl < 4 && !this.mobile;
    this.shadows = q !== 'low' && lvl < 5;
    this.renderer.shadowMap.enabled = this.shadows;
    this.shadowSize = q === 'high' ? 2048 : 1024;
    this.rainCount = q === 'high' ? 2600 : q === 'medium' ? 1500 : 800;
    this.particleBudget = q === 'low' ? 0.6 : 1;
    this.renderer.setPixelRatio(this.pixelRatio);
    this._buildComposer();
    this.resize();
    for (const fn of this.onResize) fn(this);
    if (this.scene) {
      this.scene.traverse((o) => {
        if (o.isLight && o.shadow && o.userData.wantShadow) {
          o.castShadow = this.shadows;
          if (o.shadow.mapSize.x !== this.shadowSize) {
            o.shadow.mapSize.set(this.shadowSize, this.shadowSize);
            if (o.shadow.map) {
              o.shadow.map.dispose();
              o.shadow.map = null;
            }
          }
        }
        if (o.material && o.receiveShadow) o.material.needsUpdate = true;
      });
    }
  }

  _buildComposer() {
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    if (!this.usePost || !this.scene) return;
    const r = this.renderer;
    const w = Math.max(2, Math.floor(window.innerWidth * this.pixelRatio));
    const h = Math.max(2, Math.floor(window.innerHeight * this.pixelRatio));
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthBuffer: true,
    });
    const composer = new EffectComposer(r, rt);
    composer.setPixelRatio(this.pixelRatio);
    composer.setSize(window.innerWidth, window.innerHeight);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.62, 0.72, 0.82);
    composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  resize() {
    if (!this.renderer) return;
    const w = Math.max(2, window.innerWidth);
    const h = Math.max(2, window.innerHeight);
    this.size.set(w, h);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(w, h);
    }
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    for (const fn of this.onResize) fn(this);
  }

  render(dt, time) {
    if (!this.renderer || this.contextLost) return;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3.2);
    if (this.composer && this.usePost) {
      this.grade.uniforms.uTime.value = time;
      this.grade.uniforms.uFlash.value = this.flash * 0.35;
      this.grade.uniforms.uDesat.value = this.desat;
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this._adapt(dt);
  }

  /** Steps quality down if the device cannot hold a playable frame rate. */
  _adapt(dt) {
    if (!this.auto || dt <= 0 || document.hidden) return;
    this._ft.push(dt);
    this._adaptT += dt;
    if (this._adaptT < 4) return;
    const avg = this._ft.reduce((a, b) => a + b, 0) / this._ft.length;
    this._ft.length = 0;
    this._adaptT = 0;
    if (avg > 1 / 38 && this._adaptLevel < 6) {
      this._adaptLevel++;
      this._configure();
    }
  }
}

export const gfx = new Gfx();
