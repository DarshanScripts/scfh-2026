import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

export const windowScript = fileURLToPath(new URL('./excalidraw-window.cjs', import.meta.url));
const assetPaths = new Map([
  ['/', ['./demo/rough-canvas.html', 'text/html']],
  ['/rough-host.mjs', ['./demo/rough-host.mjs', 'text/javascript']],
  ['/rough/panel.mjs', ['./packages/rough-canvas/panel.mjs', 'text/javascript']],
  ['/rough/canvas.mjs', ['./packages/rough-canvas/canvas.mjs', 'text/javascript']],
  ['/rough/contract.mjs', ['./packages/rough-canvas/contract.mjs', 'text/javascript']],
  ['/rough/panel.css', ['./packages/rough-canvas/panel.css', 'text/css']],
  ['/rough.js', ['./node_modules/roughjs/bundled/rough.js', 'text/javascript']],
]);

export async function startRoughPreview({ id, onClose, fallbackSteps }) {
  const nonce = randomUUID();
  const assets = new Map(await Promise.all([...assetPaths].map(async ([path, [file, type]]) =>
    [path, [await readFile(new URL(file, import.meta.url)), type + '; charset=utf-8']])));
  let peer;
  let ready = false;
  let connectedOnce = false;
  let closed = false;
  const pending = new Map();
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.headers.host !== new URL(url).host) return response.writeHead(404).end();

    if (request.method === 'GET' && request.url === '/updates' &&
        request.headers['sec-fetch-site'] === 'same-origin') {
      if (connectedOnce) return response.writeHead(409).end();
      connectedOnce = true;
      peer = response;
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(': connected\n\n');
      response.on('close', () => {
        ready = false;
        peer = undefined;
        rejectPending('The canvas window disconnected.');
        if (!closed) onClose();
      });
      return;
    }

    if (request.method === 'POST' && request.url === '/control') {
      if (request.headers.origin !== url || request.headers['content-type'] !== 'application/json') return response.writeHead(403).end();
      let message;
      try {
        const declaredSize = Number(request.headers['content-length']);
        if (!Number.isInteger(declaredSize) || declaredSize < 1 || declaredSize > 2048) return response.writeHead(413).end();
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 2048) return response.writeHead(413).end();
          chunks.push(chunk);
        }
        message = JSON.parse(Buffer.concat(chunks));
      } catch { return response.writeHead(400).end(); }
      if (!message || message.id !== id || message.nonce !== nonce || !peer) return response.writeHead(403).end();
      if (message.type === 'ready') ready = true;
      else if (message.type === 'ack') {
        const settle = pending.get(message.messageId);
        if (!settle) return response.writeHead(409).end();
        settle(message.result === 'ok' ? undefined : new Error('The canvas rejected a drawing update.'));
      } else if (message.type === 'close') {
        response.writeHead(204).end(() => onClose());
        return;
      } else return response.writeHead(400).end();
      return response.writeHead(204).end();
    }

    const asset = request.method === 'GET' && assets.get(request.url);
    if (request.method === 'GET' && request.url === '/config') {
      return response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id, nonce, fallbackSteps }));
    }
    if (!asset) return response.writeHead(404).end();
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src blob:; base-uri 'none'; frame-ancestors 'none'");
    response.writeHead(200, { 'Content-Type': asset[1] }).end(asset[0]);
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;

  function rejectPending(message) {
    for (const settle of pending.values()) settle(new Error(message));
  }

  return {
    url,
    isReady: () => ready,
    send(message, signal) {
      if (!ready || !peer || signal?.aborted) return Promise.reject(signal?.reason ?? new Error('The canvas is unavailable.'));
      const messageId = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error('The canvas did not acknowledge a drawing update.')), 7000);
        const abort = () => finish(signal.reason);
        function finish(error) {
          pending.delete(messageId);
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          if (error) reject(error);
          else resolve();
        }
        pending.set(messageId, finish);
        signal?.addEventListener('abort', abort, { once: true });
        try { peer.write(`data: ${JSON.stringify({ message: { ...message, id }, messageId })}\n\n`); }
        catch (error) { finish(error); }
      });
    },
    close() {
      if (closed) return;
      closed = true;
      ready = false;
      rejectPending('The canvas closed.');
      server.closeAllConnections();
      server.close();
    },
  };
}
