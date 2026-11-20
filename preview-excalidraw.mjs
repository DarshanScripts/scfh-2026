import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { loadPreview } from './check-excalidraw.mjs';

export async function startPreview({ elements, title = 'Workflow Canvas', narrated = false } = {}) {
  const { html, scenes } = await loadPreview(elements);
  const viewers = new Set();
  let latestUpdate;
  const [host, script] = await Promise.all([
    readFile(new URL('./demo/canvas.html', import.meta.url)),
    readFile(new URL('./demo/canvas.js', import.meta.url)),
  ]);
  const assets = new Map([
    ['/', ['text/html; charset=utf-8', host]],
    ['/canvas.js', ['text/javascript; charset=utf-8', script]],
    ['/view', ['text/html; charset=utf-8', html]],
    ['/scenes', ['application/json', JSON.stringify(narrated ? [] : scenes)]],
    ['/config', ['application/json', JSON.stringify({ title, narrated })]],
  ]);
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.headers.host !== '127.0.0.1:' + server.address().port) {
      return response.writeHead(404).end();
    }
    if (narrated && request.url === '/updates' && request.headers['sec-fetch-site'] === 'same-origin') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      response.write(latestUpdate ?? ': ready\n\n');
      viewers.add(response);
      response.once('close', () => viewers.delete(response));
      return;
    }
    const asset = assets.get(request.url);
    if (!asset) return response.writeHead(404).end();
    response.setHeader('Content-Type', asset[0]);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', request.url === '/view'
      ? "default-src 'none'; script-src 'unsafe-inline' https://esm.sh; style-src 'unsafe-inline' https://esm.sh; img-src data: blob:; font-src data: https://esm.sh; connect-src https://esm.sh"
      : "default-src 'self'; style-src 'self' 'unsafe-inline'");
    response.end(asset[1]);
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  function publish(update) {
    latestUpdate = 'data: ' + JSON.stringify(update) + '\n\n';
    for (const viewer of viewers) viewer.write(latestUpdate);
  }
  return {
    server, url: 'http://127.0.0.1:' + server.address().port,
    isReady: () => viewers.size > 0,
    reveal: (elements, step, total) => publish({ elements, status: `Step ${step} of ${total}` }),
    finish: () => publish({ ...scenes[0], status: 'Walkthrough complete' }),
    setStatus: (status, elements) => publish({ status, elements }),
  };
}

export const windowScript = fileURLToPath(new URL('./excalidraw-window.cjs', import.meta.url));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { server, url } = await startPreview();
  const electron = createRequire(import.meta.url)('electron');
  const child = spawn(electron, [windowScript, url], { env: getDefaultEnvironment(), stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill());
  child.once('exit', (code) => { server.close(); process.exitCode = code ?? 1; });
  child.once('error', (error) => { console.error(error.message); server.close(); process.exitCode = 1; });
}
