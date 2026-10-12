/* Optional dependency-free preview server. Run: node serve.cjs */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.md': 'text/plain' };
const server = http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end('Bad request'); return; }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep) || pathname.split('/').some((part) => part.startsWith('.'))) {
    response.writeHead(403).end('Forbidden'); return;
  }
  fs.readFile(file, (error, content) => {
    if (error) { response.writeHead(404).end('Not found'); return; }
    response.writeHead(200, { 'Content-Type': (mime[path.extname(file)] || 'application/octet-stream') + ';charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(content);
  });
});
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') server.listen(0, '127.0.0.1');
  else { console.error(error.message); process.exitCode = 1; }
});
server.listen(Number(process.env.PORT) || 4173, '127.0.0.1', () => {
  console.log(`Clawlinder: http://127.0.0.1:${server.address().port}`);
  console.log('Press Ctrl+C to stop.');
});
