import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('./', import.meta.url);
const files = new Map([
  ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ['/styles.css', ['styles.css', 'text/css']], ['/app.js', ['app.js', 'text/javascript']],
  ['/core.js', ['core.js', 'text/javascript']], ['/bluetooth.js', ['bluetooth.js', 'text/javascript']],
]);
const port = Number(process.env.PORT || 5173);
const server = createServer(async (req, res) => {
  const file = files.get(new URL(req.url, 'http://localhost').pathname);
  if (!file || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404).end('Not found'); return; }
  try {
    const data = await readFile(fileURLToPath(new URL(file[0], root)));
    res.writeHead(200, {
      'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'Permissions-Policy': 'bluetooth=(self)',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(500).end('Could not read app file'); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Watt a Breeze: http://127.0.0.1:${port}`));
