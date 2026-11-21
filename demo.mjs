import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createServer as createPortProbe } from 'node:net';
import { fileURLToPath } from 'node:url';
import { AccessToken, RoomAgentDispatch, RoomConfiguration, RoomServiceClient } from 'livekit-server-sdk';
import { anthropicSettings } from './anthropic.mjs';
import { answerPanelPolicy, proxyOnboarding, startOnboardingService } from './onboarding-service.mjs';

const host = '127.0.0.1';
const menuPort = Number(process.env.DEMO_PORT || 4321);
const origin = 'http://' + host + ':' + menuPort;
const electronPath = createRequire(import.meta.url)('electron');
const windowScript = fileURLToPath(new URL('./floating-window.cjs', import.meta.url));
const windowEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  /^(path|pathext|windir|systemroot|systemdrive|userprofile|localappdata|appdata|programdata|temp|tmp)$/i.test(name)));
const avatarEnabled = process.env.ENABLE_AVATAR === '1';
const { LIVEKIT_URL: livekitURL, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret } = process.env;
const agentName = `scfh-desktop-demo-${randomUUID()}`;

anthropicSettings();

if (avatarEnabled && !(process.env.BEYOND_PRESENCE_API_KEY?.trim() || process.env.BEY_API_KEY?.trim())) {
  throw new Error('Set BEYOND_PRESENCE_API_KEY in .env to enable the avatar.');
}

if (!livekitURL || !key || !secret) {
  throw new Error('Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in .env for LiveKit Inference.');
}
try {
  await new RoomServiceClient(livekitURL.replace(/^wss:/, 'https:'), key, secret).listRooms();
} catch (error) {
  const status = typeof error.status === 'number' ? ' (HTTP ' + error.status + ')' : '';
  throw new Error('Could not authenticate the LiveKit Cloud project' + status + '. Check the LiveKit settings in .env.');
}

const onboarding = await startOnboardingService().catch((error) => {
  console.warn('Onboarding unavailable. See the onboarding setup in README.md.', error.message);
});
const healthProbe = createPortProbe();
await new Promise((resolve, reject) => healthProbe.once('error', reject).listen(0, host, resolve));
const healthPort = healthProbe.address().port;
await new Promise((resolve, reject) => healthProbe.close(error => error ? reject(error) : resolve()));
const workerEnv = {
  ...process.env,
  LIVEKIT_AGENT_NAME: agentName,
  SCFH_WORKER_HEALTH_PORT: String(healthPort),
  ONBOARDING_SERVICE_URL: onboarding?.url || '',
};
const [html, script, sdk, answers] = await Promise.all([
  readFile(new URL('./demo/index.html', import.meta.url)),
  readFile(new URL('./demo/orb.js', import.meta.url)),
  readFile(new URL('./node_modules/livekit-client/dist/livekit-client.umd.js', import.meta.url)),
  readFile(new URL('./demo/answers.html', import.meta.url)),
]);

const menu = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Permissions-Policy', 'microphone=(self), camera=()');
  response.setHeader('Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; connect-src 'self' https: wss: ws://127.0.0.1:*");
  if (request.headers.host !== host + ':' + menuPort) return response.writeHead(403).end();
  if (request.method === 'GET') {
    if (request.url === '/') return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
    if (request.url === '/orb.js') return response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(script);
    if (request.url === '/livekit.js') return response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(sdk);
    if (request.url === '/answers') {
      response.setHeader('Content-Security-Policy', answerPanelPolicy);
      return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(answers);
    }
  }
  if (await proxyOnboarding(request, response, onboarding?.url, origin)) return;
  if (request.method === 'POST' && request.url === '/connect' && request.headers.origin === origin) {
    try {
      const name = 'desktop-demo-' + randomUUID();
      const token = new AccessToken(key, secret, { identity: 'operator-' + randomUUID(), ttl: '10m' });
      token.addGrant({ roomJoin: true, room: name, canPublish: true, canPublishData: true, canSubscribe: true });
      token.roomConfig = new RoomConfiguration({ agents: [new RoomAgentDispatch({ agentName })] });
      const jwt = await token.toJwt();
      return response.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ url: livekitURL, token: jwt, avatarEnabled }));
    } catch {
      return response.writeHead(500).end('Could not open a demo room.');
    }
  }
  return response.writeHead(404).end();
});

const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  menu.close();
  onboarding?.close();
  for (const child of children) if (child.exitCode === null) child.kill();
}

function launch(command, args, options, label, allowCleanExit = false) {
  const child = spawn(command, args, { windowsHide: true, ...options });
  children.push(child);
  child.once('error', (error) => {
    console.error(label + ': ' + error.message);
    stop(1);
  });
  child.once('exit', (code) => {
    if (!stopping) {
      if (code === 0 && allowCleanExit) stop();
      else {
        console.error(label + ' exited (' + code + ').');
        stop(code || 1);
      }
    }
  });
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
menu.once('error', (error) => {
  console.error('Demo menu: ' + error.message);
  stop(1);
});

launch(process.execPath, ['agent.mjs', 'start'], { env: workerEnv, stdio: 'inherit' }, 'Desktop agent');
menu.listen(menuPort, host, () => {
  launch(electronPath, [windowScript, origin], { env: windowEnv, stdio: 'inherit' }, 'Floating voice window', true);
  console.log('Starting the floating voice window.');
});
