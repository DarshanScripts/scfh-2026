import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function startOnboardingService() {
  const cwd = fileURLToPath(new URL('./packages/onboarding/', import.meta.url));
  const knowledge = process.env.ONBOARDING_KNOWLEDGE || 'fixtures';
  if (!['fixtures', 'qdrant'].includes(knowledge)) throw new Error('ONBOARDING_KNOWLEDGE must be fixtures or qdrant.');
  const ragVariables = new Set(['QDRANT_URL', 'QDRANT_API_KEY', 'OPENROUTER_API_KEY',
    'EMBEDDING_MODEL', 'ANTHROPIC_API_KEY', 'LLM_MODEL', 'REASONING_EFFORT']);
  const child = spawn('uv', ['run', '--locked', '--no-sync', '--no-env-file', 'python', '-m', 'onboarding.server', '--port', '0', '--knowledge', knowledge], {
    cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'],
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      /^(path|pathext|windir|systemroot|systemdrive|userprofile|localappdata|appdata|programdata|temp|tmp)$/i.test(name) || (knowledge === 'qdrant' && ragVariables.has(name)))),
  });
  function close() {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill();
  }
  try {
    const url = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('Onboarding service timed out.')), 8000);
      const done = (fn) => (value) => { clearTimeout(timeout); fn(value); };
      const fail = done(reject);
      child.once('error', fail);
      child.once('exit', (code) => fail(new Error('Onboarding service exited (' + code + ').')));
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = /Facilities onboarding harness at http:\/\/127\.0\.0\.1:(\d+)\r?\n/.exec(output);
        if (match) done(resolve)('http://127.0.0.1:' + match[1]);
        output = output.slice(-4096);
      });
    });
    const health = await fetch(url + '/health', { signal: AbortSignal.timeout(2000) });
    if (!health.ok) throw new Error('Onboarding service health check failed.');
    return { url, close };
  } catch (error) { close(); throw error; }
}

const assets = new Set(['/answers.js', '/style.css', '/pdfjs/pdf.mjs', '/pdfjs/pdf.worker.mjs', '/pdfjs/pdf_viewer.css']);

// The browser compiles local shared schemas with Ajv.
export const answerPanelPolicy = "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; img-src data: blob:; font-src 'self' data: blob:";

export async function proxyOnboarding(request, response, base, origin) {
  const path = request.url;
  const citation = request.method === 'POST' && path === '/api/citation';
  const source = /^\/sources\/[a-z0-9-]+\?revision=[a-f0-9]{64}$/;
  if (!citation && !(request.method === 'GET' && (assets.has(path) || source.test(path)))) return false;
  if (!base) { response.writeHead(503).end(); return true; }
  if (citation && (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json')) {
    response.writeHead(403).end();
    return true;
  }
  try {
    const chunks = [];
    let size = 0;
    if (citation) for await (const chunk of request) {
      size += chunk.length;
      if (size > 4096) { response.writeHead(413).end(); return true; }
      chunks.push(chunk);
    }
    const upstream = await fetch(base + path, {
      signal: AbortSignal.timeout(8000), redirect: 'error',
      ...(citation && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: Buffer.concat(chunks) }),
    });
    if (!upstream.ok) { response.writeHead(upstream.status).end(); return true; }
    const content = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(200, { 'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' }).end(content);
  } catch { response.writeHead(502).end(); }
  return true;
}
