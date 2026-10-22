import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from './build.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
if (!process.argv.includes('--no-build')) await buildSite();
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf', '.txt': 'text/plain', '.xml': 'application/xml' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    const target = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (target !== root && !target.startsWith(root + path.sep)) { response.writeHead(403); response.end('Forbidden'); return; }
    const info = await stat(target);
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(await readFile(target));
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(await readFile(path.join(root, '404.html')).catch(() => 'Not found'));
  }
});
server.listen(Number(process.env.PORT) || 4173, '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + server.address().port));
server.on('error', error => { console.error('Preview failed: ' + error.message); process.exitCode = 1; });
