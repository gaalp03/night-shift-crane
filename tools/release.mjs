// CrazyGames upload package:  node tools/release.mjs
// Production build, then release/night-shift-crane-crazygames.zip with index.html at the zip root,
// relative paths only, and nothing the game does not load (no sources, docs or dev bundle).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'release', 'night-shift-crane-crazygames.zip');
const LIMIT = 20 * 1024 * 1024;

execFileSync(process.execPath, [join(root, 'tools', 'build.mjs')], { stdio: 'inherit' });

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const files = ['index.html', 'privacy.html', 'styles.css', 'build/game.js', 'build/rapier.wasm', ...walk(join(root, 'assets')).map((f) => relative(root, f).split(sep).join('/'))].filter((f) => !/(^|\/)\.DS_Store$/.test(f));

// sanity: every local URL the page references must be in the package, and none may be absolute
const html = readFileSync(join(root, 'index.html'), 'utf8');
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const u = m[1];
  if (/^https:\/\/sdk\.crazygames\.com\//.test(u)) continue;
  if (/^(https?:)?\/\//.test(u) || u.startsWith('/')) throw new Error('absolute URL in index.html: ' + u);
  if (!files.includes(u)) throw new Error('index.html references a file missing from the package: ' + u);
}

// a small, dependency-free zip writer (deflate; already-compressed media is stored)
const STORE = /\.(mp3|ogg|woff2|png|jpg|jpeg|webp)$/i;
const chunks = [];
const central = [];
let offset = 0;
const dosTime = (() => {
  const d = new Date();
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
})();
for (const name of files) {
  const data = readFileSync(join(root, name));
  const store = STORE.test(name);
  const body = store ? data : deflateRawSync(data, { level: 9 });
  const crc = crc32(data) >>> 0;
  const fname = Buffer.from(name, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // utf-8 names
  local.writeUInt16LE(store ? 0 : 8, 8);
  local.writeUInt16LE(dosTime.time, 10);
  local.writeUInt16LE(dosTime.date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(fname.length, 26);
  local.writeUInt16LE(0, 28);
  chunks.push(local, fname, body);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(20, 4);
  cen.writeUInt16LE(20, 6);
  cen.writeUInt16LE(0x0800, 8);
  cen.writeUInt16LE(store ? 0 : 8, 10);
  cen.writeUInt16LE(dosTime.time, 12);
  cen.writeUInt16LE(dosTime.date, 14);
  cen.writeUInt32LE(crc, 16);
  cen.writeUInt32LE(body.length, 20);
  cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(fname.length, 28);
  cen.writeUInt32LE(offset, 42);
  central.push(cen, fname);
  offset += local.length + fname.length + body.length;
}
const cenSize = central.reduce((a, b) => a + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cenSize, 12);
end.writeUInt32LE(offset, 16);
mkdirSync(dirname(out), { recursive: true });
const zip = Buffer.concat([...chunks, ...central, end]);
writeFileSync(out, zip);

const raw = files.reduce((a, f) => a + statSync(join(root, f)).size, 0);
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
console.log(`${relative(root, out)}: ${files.length} files · ${mb(zip.length)} zipped · ${mb(raw)} unpacked`);
if (zip.length > LIMIT || raw > LIMIT) {
  console.error('over the 20 MB CrazyGames limit');
  process.exit(1);
}
