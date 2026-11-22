// Renderer, post-processing and adaptive quality.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
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

// Menu backdrop: while a card covers the scene it is drawn at a third of the resolution and
// blurred here, which costs far less than a full frame plus a CSS backdrop blur on top of it.
const SOFT_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const SOFT_TAPS = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uDir;
  varying vec2 vUv;
  vec3 taps() {
    vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227027;
    c += (texture2D(tDiffuse, vUv + uDir * 1.384615).rgb + texture2D(tDiffuse, vUv - uDir * 1.384615).rgb) * 0.316216;
    c += (texture2D(tDiffuse, vUv + uDir * 3.230769).rgb + texture2D(tDiffuse, vUv - uDir * 3.230769).rgb) * 0.070270;
    return c;
  }
`;
const SOFT_SCALE = 3.5;

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
    this.soft = 0; // 0 = sharp scene, 1 = blurred menu backdrop
    this.softTarget = 0;
  }

  /** Blur the scene behind a full-screen card (true) or show it sharp again (false). */
  setBackdrop(on) {
    this.softTarget = on ? 1 : 0;
  }

  _renderSoft() {
    const r = this.renderer;
    const w = Math.max(64, Math.round((this.size.x * Math.min(this.pixelRatio, 1.5)) / SOFT_SCALE));
    const h = Math.max(36, Math.round((this.size.y * Math.min(this.pixelRatio, 1.5)) / SOFT_SCALE));
    if (!this._softA || this._softA.width !== w || this._softA.height !== h) {
      if (this._softA) {
        this._softA.dispose();
        this._softB.dispose();
      }
      const opt = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
      this._softA = new THREE.WebGLRenderTarget(w, h, { ...opt, depthBuffer: true });
      this._softB = new THREE.WebGLRenderTarget(w, h, { ...opt, depthBuffer: false });
    }
    if (!this._softQuad) {
      const uniforms = () => ({ tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } });
      this._softH = new THREE.ShaderMaterial({
        uniforms: uniforms(),
        vertexShader: SOFT_VERT,
        fragmentShader: SOFT_TAPS + 'void main() { gl_FragColor = vec4(taps(), 1.0); }',
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      this._softV = new THREE.ShaderMaterial({
        uniforms: uniforms(),
        vertexShader: SOFT_VERT,
        fragmentShader:
          SOFT_TAPS +
          /* glsl */ `
          void main() {
            vec3 col = taps();
            float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
            col = mix(vec3(l), col, 0.86);
            vec2 c = vUv - 0.5;
            col *= mix(0.6, 1.0, smoothstep(0.95, 0.25, length(c * vec2(1.0, 1.15))));
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        depthTest: false,
        depthWrite: false,
      });
      this._softQuad = new FullScreenQuad(this._softH);
    }
    // two blur rounds (tight, then wide): smooth even though the source is only a third of the size
    const k = this.soft;
    const A = this._softA;
    const B = this._softB;
    const H = this._softH;
    const V = this._softV;
    const pass = (mat, src, dst, dx, dy) => {
      mat.uniforms.tDiffuse.value = src.texture;
      mat.uniforms.uDir.value.set(dx, dy);
      this._softQuad.material = mat;
      r.setRenderTarget(dst);
      this._softQuad.render(r);
    };
    r.setRenderTarget(A);
    r.render(this.scene, this.camera);
    pass(H, A, B, k / w, 0);
    pass(H, B, A, 0, k / h);
    pass(H, A, B, (2.2 * k) / w, 0);
    pass(V, B, null, 0, (2.2 * k) / h);
  }

  /**
   * @param opts.quality  the saved quality setting ('auto' | 'low' | 'medium' | 'high')
   */
  init(canvas, opts = {}) {
    let renderer;
    // modest machines (Chromebooks, <= 4 GB, <= 4 threads) start the automatic mode at 'low'
    const ua = navigator.userAgent || '';
    this.lowEnd = /CrOS/.test(ua) || (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
    this.lowEnd = !!this.lowEnd;
    const q = opts.quality || 'auto';
    // MSAA is wasted on dense screens and too dear on low settings (fixed for the context's life)
    const dpr = window.devicePixelRatio || 1;
    this.antialias = !(q === 'low' || (q === 'auto' && this.lowEnd) || dpr > 1.5);
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: this.antialias,
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
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.info.autoReset = true;
    this.maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      if (this.onContextLost) this.onContextLost();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this._restore();
      if (this.onContextRestored) this.onContextRestored();
    });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize());
    return true;
  }

  /** After a context loss: fresh render targets / post chain, every texture and shadow map uploaded again. */
  _restore() {
    try {
      this._softA = this._softB = null;
      if (this.scene) {
        const seen = new Set();
        const touch = (t) => {
          if (t && t.isTexture && !t.isRenderTargetTexture && !seen.has(t)) {
            seen.add(t);
            if (t.image) t.needsUpdate = true;
          }
        };
        this.scene.traverse((o) => {
          if (o.isLight && o.shadow && o.shadow.map) {
            o.shadow.map.dispose();
            o.shadow.map = null;
          }
          const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
          for (const m of ms) {
            for (const k in m) touch(m[k]);
            if (m.uniforms) for (const k in m.uniforms) touch(m.uniforms[k] && m.uniforms[k].value);
            m.needsUpdate = true;
          }
        });
        touch(this.scene.background);
        touch(this.scene.environment);
      }
      this._configure();
    } catch (e) {}
  }

  /** scene/camera are needed to build the post chain. */
  setup(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.applyQuality(this.quality);
  }

  /** quality: 'low' | 'medium' | 'high' | 'auto' */
  /**
   * @param startLevel  how far the automatic mode had already stepped down on this machine
   *                    (remembered between visits so a slow device does not stutter at every start)
   */
  applyQuality(q, startLevel = 0) {
    this.auto = q === 'auto';
    // auto: a capable machine starts high and steps down; a modest one starts low and earns its way up
    this._climb = this.auto && this.lowEnd;
    this._climbTop = this.mobile ? 'medium' : 'high';
    if (this.auto) q = this._climb ? this._startQ || 'low' : this.mobile ? 'medium' : 'high';
    this.quality = q;
    this._climbStep = 0;
    this._adaptLevel = this.auto ? clamp(startLevel | 0, 0, 6) : 0;
    this._goodWindows = 0;
    this._recovered = false;
    this._configure();
  }

  _calcPR() {
    const q = this.quality;
    const dpr = window.devicePixelRatio || 1;
    const lvl = this._adaptLevel;
    // Mobile keeps a crisp native-ish resolution; we would rather drop effects than sharpness.
    let cap = q === 'high' ? 2 : q === 'medium' ? (this.mobile ? 2 : 1.5) : this.mobile ? 1.5 : 1;
    cap -= Math.min(lvl, 3) * 0.2;
    const minPR = this.mobile ? Math.min(dpr, 1.35) : 1;
    let pr = clamp(Math.min(dpr, cap), minPR, 2);
    if (!this.mobile) {
      // desktop pixel budget: a 4K / hi-dpi window must not quadruple the shading work
      const budget = (q === 'high' ? 3.4e6 : q === 'medium' ? 2.4e6 : 1.6e6) * (1 - Math.min(lvl, 4) * 0.1);
      const px = Math.max(1, window.innerWidth * window.innerHeight);
      pr = Math.max(0.6, Math.min(pr, Math.sqrt(budget / px)));
    }
    return pr;
  }

  _configure() {
    const q = this.quality;
    const lvl = this._adaptLevel;
    this.pixelRatio = this._calcPR();
    this.usePost = q === 'high' && lvl < 4 && !this.mobile;
    // the mirrored sea costs a second (half-size) scene pass: first thing to go when frames run long
    this.reflections = q === 'high' && lvl < 1 && !this.mobile;
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
      samples: this._adaptLevel >= 2 || w * h > 2.6e6 ? 2 : 4,
      depthBuffer: true,
    });
    const composer = new EffectComposer(r, rt);
    composer.setPixelRatio(this.pixelRatio);
    composer.setSize(window.innerWidth, window.innerHeight);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.46, 0.55, 0.92);
    composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  resize() {
    if (!this.renderer) return;
    this.pixelRatio = this._calcPR();
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
    this.soft += (this.softTarget - this.soft) * Math.min(1, dt * (this.softTarget ? 9 : 16));
    if (this.softTarget || this.soft > 0.04) {
      this._renderSoft();
      // (menus are not a fair sample for the adaptive quality: they render far fewer pixels)
      return;
    }
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
    this._adaptT += dt;
    if (this._adaptT < 0) return;
    this._ft.push(dt);
    if (this._adaptT < 2.5) return;
    // judged on the slower frames, not the mean: an uneven frame rate is what reads as lag
    const ft = this._ft.sort((a, b) => a - b);
    const avg = ft[Math.floor(ft.length * 0.7)];
    this._ft = [];
    this._adaptT = 0;
    // modest machines: step the preset up only after a long stretch of clean frames (~25 s), and if the
    // step proves too much, go back and stay there
    if (this._climb && !this._climbDone) {
      if (avg < 1 / 57 && this._adaptLevel === 0) {
        if (++this._goodWindows >= 10 && this.quality !== this._climbTop) {
          this._goodWindows = 0;
          this._climbFrom = this.quality;
          this.quality = this.quality === 'low' ? 'medium' : 'high';
          this._climbProbe = 4; // the next few windows decide whether it holds
          this._configure();
          this._adaptT = -1.5;
          if (this.onClimb) this.onClimb(this.quality);
        }
        if (this._climbProbe) this._climbProbe--;
        return;
      }
      if (avg > 1 / 45 && this._climbProbe && this._climbFrom) {
        this.quality = this._climbFrom;
        this._climbDone = true;
        this._climbProbe = 0;
        this._configure();
        this._adaptT = -1.5;
        if (this.onClimb) this.onClimb(this.quality);
        return;
      }
      if (avg >= 1 / 57) this._goodWindows = 0;
    }
    if (avg > 1 / 45 && this._adaptLevel < 6) {
      this._adaptLevel++;
      this._goodWindows = 0;
      this._configure();
      this._adaptT = -1.5; // let the change settle before judging again
      if (this.onAdapt) this.onAdapt(this._adaptLevel);
    } else if (avg < 1 / 57 && this._adaptLevel > 0 && !this._recovered) {
      // a long clean run: try one step back up, once (a single bad moment should not cost quality for good)
      if (++this._goodWindows >= 12) {
        this._recovered = true;
        this._adaptLevel--;
        this._configure();
        this._adaptT = -1.5;
        if (this.onAdapt) this.onAdapt(this._adaptLevel);
      }
    } else this._goodWindows = 0;
  }
}

export const gfx = new Gfx();
