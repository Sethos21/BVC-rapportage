import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const port = Number(readArg('--port', process.env.PORT || 4173));
const host = readArg('--host', '0.0.0.0');
const root = process.cwd();
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const publicRelative = relative.startsWith('assets/') ? join('public', relative) : relative;
  let target = normalize(join(root, publicRelative));
  if (!target.startsWith(root) || !existsSync(target) || statSync(target).isDirectory()) {
    target = join(root, 'index.html');
  }
  response.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream' });
  createReadStream(target).pipe(response);
}).listen(port, host, () => {
  process.stdout.write(`Prototype ready on ${host}:${port}\n`);
});
