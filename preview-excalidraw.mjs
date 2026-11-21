import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { loadPreview } from './check-excalidraw.mjs';

export async function startPreview({ elements, title = 'Workflow Canvas', narrated = false, fallbackSteps } = {}) {
  const { html, scenes } = await loadPreview(elements).catch((error) => {
    if (!fallbackSteps) throw error;
    return { scenes: [] };
  });
  const viewers = new Set();
  let latestUpdate;
  const [host, script, exporter] = await Promise.all([
    readFile(new URL('./demo/canvas.html', import.meta.url)),
    readFile(new URL('./demo/canvas.js', import.meta.url)),
    readFile(new URL('./packages/onboarding/dist/canvas-export.js', import.meta.url)).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    }),
  ]);
  const assets = new Map([
    ['/', ['text/html; charset=utf-8', host]],
    ['/canvas.js', ['text/javascript; charset=utf-8', script]],
    ['/scenes', ['application/json', JSON.stringify(narrated ? [] : scenes)]],
    ['/config', ['application/json', JSON.stringify({ title, narrated, canExport: Boolean(exporter), canvasAvailable: Boolean(html), fallbackSteps })]],
  ]);
  if (html) {
    const style = `<style>
      .svg-wrapper { height: calc(100vh - 24px) !important; max-height: calc(100vh - 24px); }
      .svg-wrapper > svg { width: 100%; height: 100%; }
      .svg-wrapper text { font-family: Arial, Helvetica, sans-serif !important; }
    </style>`;
    assets.set('/view', ['text/html; charset=utf-8', html.replace(/<\/head>/i, `${style}</head>`)]);
  }
  if (exporter) assets.set('/canvas-export.js', ['text/javascript; charset=utf-8', exporter]);
  const fonts = new URL('./packages/onboarding/node_modules/@excalidraw/excalidraw/dist/prod/fonts/', import.meta.url);
  const server = createServer(async (request, response) => {
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
    const font = exporter && /^\/excalidraw-assets\/fonts\/([A-Za-z]+\/[A-Za-z0-9_.-]+\.woff2)$/.exec(request.url);
    if (font) {
      try {
        const content = await readFile(new URL(font[1], fonts));
        return response.writeHead(200, { 'Content-Type': 'font/woff2' }).end(content);
      } catch { return response.writeHead(404).end(); }
    }
    const asset = assets.get(request.url);
    if (!asset) return response.writeHead(404).end();
    response.setHeader('Content-Type', asset[0]);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', request.url === '/view'
      ? "default-src 'none'; script-src 'unsafe-inline' https://esm.sh; style-src 'unsafe-inline' https://esm.sh; img-src data: blob:; font-src data: https://esm.sh; connect-src https://esm.sh"
      : "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:");
    response.end(asset[1]);
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  function publish(update) {
    latestUpdate = 'data: ' + JSON.stringify(update) + '\n\n';
    for (const viewer of viewers) viewer.write(latestUpdate);
  }
  return {
    server, url: 'http://127.0.0.1:' + server.address().port,
    canvasAvailable: Boolean(html),
    isReady: () => viewers.size > 0,
    reveal: (elements, step, total, description) => publish({ elements, description, status: `Step ${step} of ${total}` }),
    finish: (details) => publish({ ...scenes[0], description: '', details, status: 'Walkthrough complete' }),
    setStatus: (status, elements, showFallback = false) => publish({ status, elements, showFallback }),
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
