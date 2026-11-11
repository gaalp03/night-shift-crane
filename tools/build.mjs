// Bundles src/main.js (three.js + rapier included, no CDN) into build/game.js
import { build, context } from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
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

const opts = {
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
