import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { publicFiles } from './site-files.mjs';

const base = '/hkid-web/';

const appFiles = new Set(publicFiles);
const redirects = new Map([
  ['/', base],
  [base.slice(0, -1), base],
  [base + 'zh-hk', base + 'zh-hk/'],
]);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
};

async function serveFile(directory, request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const path = request.url.split('?')[0];
  const redirect = redirects.get(path);
  if (redirect) {
    const query = request.url.slice(path.length);
    response.writeHead(302, { Location: redirect + query }).end();
    return;
  }
  const relativePath = path.slice(base.length);
  const asset = path.endsWith('/') ? relativePath + 'index.html' : relativePath;
  if (!path.startsWith(base) || !appFiles.has(asset)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const bytes = await readFile(join(directory, asset));
    response.writeHead(200, {
      'Content-Type': types[extname(asset)],
      'Content-Length': bytes.length,
      'Cache-Control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
  }
}

export function createPreviewServer(directory) {
  return createServer((request, response) => serveFile(directory, request, response));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number(process.argv[2] ?? 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Choose a port between 1 and 65535.');
  }
  const server = createPreviewServer(fileURLToPath(new URL('../', import.meta.url)));
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Try npm start -- ${port + 1}` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`HKID local preview: http://127.0.0.1:${port}${base}`);
  });
}
