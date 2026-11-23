// A tiny static server for docs/ on localhost (WebCrypto only works on https or localhost).
// Run:  npm run serve   then open the link it prints (it includes the card's key).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.ttf': 'font/ttf', '.bin': 'application/octet-stream', '.json': 'application/json'
};

export function startServer(port = 0, dir = docs) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(dir, urlPath.endsWith('/') ? `${urlPath}index.html` : urlPath);
    if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
    if (process.env.SERVE_LOG) console.log(`  [serve] ${req.method} ${req.url}`);
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    });
  });
  // Some Windows setups block IPv4 loopback from time to time; IPv6 loopback is the fallback.
  const listen = (host) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(server); });
  });
  return listen('127.0.0.1').catch(() => listen('::1'));
}

// The base URL for a server from startServer().
export function baseUrl(server) {
  const { address, port } = server.address();
  return address.includes(':') ? `http://[${address}]:${port}/` : `http://${address}:${port}/`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startServer(Number(process.env.PORT) || 8123);
  const base = baseUrl(server);
  let hash = '';
  try { hash = '#k=' + fs.readFileSync(path.join(root, 'secret.key'), 'utf8').trim(); } catch { /* not built yet */ }
  console.log(`Serving docs/ at ${base}`);
  console.log(`Unlocked:  ${base}${hash}`);
  console.log(`Preview a special day:  ${base}?date=2026-12-05${hash}`);
  console.log('Press Ctrl+C to stop.');
}
