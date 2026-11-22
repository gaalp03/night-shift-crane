// Bundles src/main.js (three.js + rapier included, no CDN) into build/game.js
import { build, context } from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const dev = process.argv.includes('--dev') || watch;

const fonts = [
  ['@fontsource/bungee/files/bungee-latin-400-normal.woff2', 'bungee.woff2'],
  ['@fontsource/barlow-condensed/files/barlow-condensed-latin-500-normal.woff2', 'barlow-condensed-500.woff2'],
  ['@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2', 'barlow-condensed-700.woff2'],
  ['@fontsource/saira-stencil-one/files/saira-stencil-one-latin-400-normal.woff2', 'saira-stencil.woff2'],
];
mkdirSync(resolve(root, 'assets/fonts'), { recursive: true });
for (const [src, dst] of fonts) {
  const from = resolve(root, 'node_modules', src);
  if (existsSync(from)) copyFileSync(from, resolve(root, 'assets/fonts', dst));
}

// Rapier ships its WASM inlined as base64 (two thirds of the bundle). Pull it out into a plain
// binary next to the script: the JS shrinks to a third, and the browser compiles the WASM while
// it streams instead of decoding a 2 MB string first.
const rapierWasm = {
  name: 'rapier-wasm-file',
  setup(b) {
    b.onLoad({ filter: /rapier3d-compat[\\/]rapier\.es\.js$/ }, (args) => {
      let src = readFileSync(args.path, 'utf8');
      const m = src.match(/(\w+)\.toByteArray\("([A-Za-z0-9+/=]{10000,})"\)(\.buffer)?/);
      if (!m) return { contents: src, loader: 'js' };
      mkdirSync(resolve(root, 'build'), { recursive: true });
      writeFileSync(resolve(root, 'build/rapier.wasm'), Buffer.from(m[2], 'base64'));
      src = src.replace(m[0], 'new URL("build/rapier.wasm", document.baseURI)');
      return { contents: src, loader: 'js' };
    });
  },
};

const opts = {
  plugins: [rapierWasm],
  entryPoints: [resolve(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2019'],
  outfile: resolve(root, dev ? 'build/game.dev.js' : 'build/game.js'),
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  legalComments: 'none',
  define: { __DEV__: dev ? 'true' : 'false' },
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log('watching…');
} else {
  await build(opts);
}
