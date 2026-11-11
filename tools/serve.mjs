// Tiny static file server for local play-testing:  node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 8080);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm',
};
createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) throw new Error('forbidden');
    const st = await stat(file);
    const data = await readFile(file);
    const range = req.headers.range;
    const head = { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Number(m[2]) : st.size - 1;
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      res.end(data.subarray(start, end + 1));
    } else {
      res.writeHead(200, { ...head, 'Content-Length': st.size });
      res.end(data);
    }
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}).listen(port, () => console.log(`Night Shift Crane → http://localhost:${port}`));
