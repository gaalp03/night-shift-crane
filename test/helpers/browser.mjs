// Browser harness for the gameplay tests: a dev build (with the window.__nsc test hooks), a static
// server on a free port, and headless Chromium with software WebGL. Uses Playwright if it can be
// found (a project install or a global one); otherwise the tests are skipped with a hint.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function findPlaywright() {
  const req = createRequire(join(root, 'package.json'));
  for (const id of [process.env.PLAYWRIGHT_MODULE, 'playwright', 'playwright-core'].filter(Boolean)) {
    try {
      return req(id);
    } catch (e) {}
  }
  return null;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json' };

function serve() {
  return new Promise((ok) => {
    const srv = createServer(async (req, res) => {
      try {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p.endsWith('/')) p += 'index.html';
        const file = normalize(join(root, p));
        if (!file.startsWith(root)) throw new Error('forbidden');
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
      } catch (e) {
        res.writeHead(404);
        res.end();
      }
    });
    srv.listen(0, '127.0.0.1', () => ok(srv));
  });
}

/**
 * Start everything. Returns { open(page opts) -> page, close() } or null when no Playwright exists.
 */
export async function startGame() {
  const pw = findPlaywright();
  if (!pw) return null;
  execFileSync(process.execPath, [join(root, 'tools', 'build.mjs'), '--dev'], { stdio: 'ignore' });
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio', '--autoplay-policy=no-user-gesture-required'];
  let browser;
  try {
    browser = await pw.chromium.launch({ args });
  } catch (e) {
    browser = await pw.chromium.launch({ args, executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  }
  const pages = [];
  return {
    pw,
    /** A fresh context with the dev build in place of the shipped bundle; the platform SDK blocked. */
    /**
     * @param device  a Playwright device name ('Pixel 5', 'iPhone 13'), or 'ipad' (Safari on iPadOS,
     *                which reports itself as a Mac with touch points)
     * @param until   'play' (default) or 'frame' (just the first frame: e.g. the control picker is up)
     */
    async open({ width = 800, height = 450, mobile = false, device = null, init, until = 'play' } = {}) {
      const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
      const opts =
        device === 'ipad'
          ? { viewport: { width, height }, userAgent: IPAD, hasTouch: true }
          : device
            ? { ...pw.devices[device] }
            : mobile
              ? { ...pw.devices['Pixel 5'] }
              : { viewport: { width, height } };
      const ctx = await browser.newContext(opts);
      const page = await ctx.newPage();
      page.errors = [];
      page.on('pageerror', (e) => page.errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) page.errors.push(m.text());
      });
      await page.route('**/build/game.js', (r) => r.continue({ url: base + 'build/game.dev.js' }));
      await page.route('**/sdk.crazygames.com/**', (r) => r.abort());
      if (device === 'ipad') await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5 }));
      // init: a function, or [function, argument] (closures do not reach the page)
      if (init) await (Array.isArray(init) ? page.addInitScript(init[0], init[1]) : page.addInitScript(init));
      await page.goto(base + 'index.html');
      await page.waitForFunction((until) => window.__nsc && window.__nscFirstFrame && (until === 'frame' || window.__nsc.app.mode === 'play'), until, { timeout: 120000, polling: 100 });
      pages.push(ctx);
      page.reopen = async () => {
        await page.reload();
        await page.waitForFunction(() => window.__nsc && window.__nscFirstFrame, null, { timeout: 120000, polling: 100 });
      };
      return page;
    },
    async close() {
      for (const c of pages) await c.close().catch(() => {});
      await browser.close().catch(() => {});
      srv.close();
    },
  };
}

/** In-page driving helpers (window.Q): drive, hoist, lower, press — all on the game's sim clock. */
export const injectDriver = (page) =>
  page.evaluate(() => {
    const N = window.__nsc;
    const inp = N.input;
    const Q = (window.Q = {});
    Q.clear = () => inp.keys.clear();
    Q.press = (code) => {
      inp.pressed.add(code);
      N.sim(1 / 60);
    };
    Q.s = () => N.app.session;
    Q.goto = (x, z, tol = 0.12, maxT = 30) => {
      const r = Q.s().rig;
      let t = 0;
      let calm = 0;
      const axis = (err, v, acc, pos, neg) => {
        const stop = (v * v) / (2 * acc) + 0.05;
        if (Math.abs(err) < 0.05 && Math.abs(v) < 0.3) return;
        if (err > 0 && (v <= 0 || err > stop)) inp.keys.add(pos);
        else if (err < 0 && (v >= 0 || -err > stop)) inp.keys.add(neg);
      };
      while (t < maxT) {
        Q.clear();
        const ex = x - r.x;
        const ez = z - r.z;
        axis(ex, r.vx, 6.2, 'KeyD', 'KeyA');
        axis(ez, r.vz, 3.6, 'KeyS', 'KeyW');
        N.sim(1 / 60, 1 / 60);
        t += 1 / 60;
        const there = Math.abs(ex) < tol && Math.abs(ez) < tol && Math.abs(r.vx) < 0.15 && Math.abs(r.vz) < 0.15;
        calm = there && Math.hypot(r.sprVel.x, r.sprVel.z) < 0.6 ? calm + 1 / 60 : 0;
        if (calm > 0.4) break;
      }
      Q.clear();
      return t;
    };
    Q.hoistTo = (rope, maxT = 20) => {
      const s = Q.s();
      let t = 0;
      while (t < maxT && Math.abs(s.rig.rope - rope) > 0.15) {
        Q.clear();
        inp.keys.add(s.rig.rope > rope ? 'KeyE' : 'KeyQ');
        N.sim(1 / 30);
        t += 1 / 30;
      }
      Q.clear();
      N.sim(0.3);
    };
    Q.lowerUntil = (fn, maxT = 20) => {
      let t = 0;
      while (t < maxT && !fn(Q.s())) {
        Q.clear();
        inp.keys.add('KeyQ');
        N.sim(1 / 30);
        t += 1 / 30;
      }
      Q.clear();
      N.sim(0.25);
    };
    Q.cellWorld = (r, b) => {
      const sh = Q.s().ship;
      const p = sh.localToWorld(sh.cellLocal(r, b, sh.height(r, b)));
      return [p.x, p.y, p.z];
    };
  });

/** A clean, keys-only endless run with a fixed seed (no coaching automation, no rookie assist). */
export const freshRun = (page, seed) =>
  page.evaluate(async (seed) => {
    const N = window.__nsc;
    Object.assign(N.save.data.flags, { coach: 4, played: true, hud: 3, rookie: 5 });
    N.app.setMouseMode(false);
    N.app.setTouchMode(false, true);
    if (N.app.session) N.app.session.phase = 'over';
    await N.app.startEndless(true, true, seed);
  }, seed);
