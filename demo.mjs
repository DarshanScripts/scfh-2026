import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { AccessToken, RoomAgentDispatch, RoomConfiguration, RoomServiceClient } from 'livekit-server-sdk';
import { anthropicSettings } from './anthropic.mjs';
import { answerPanelPolicy, proxyOnboarding, startOnboardingService } from './onboarding-service.mjs';

// Load workspace defaults first, then checkout settings. Shell overrides win.
const settings = {};
for (const path of ['../.env', './.env']) {
  try {
    Object.assign(settings, parseEnv(await readFile(new URL(path, import.meta.url), 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
for (const [name, value] of Object.entries(settings)) process.env[name] ??= value;

const host = '127.0.0.1';
const menuPort = Number(process.env.DEMO_PORT || 0);
if (!Number.isInteger(menuPort) || menuPort < 0 || menuPort > 65535) {
  throw new Error('DEMO_PORT must be an integer between 0 and 65535.');
}
let origin;
const electronPath = createRequire(import.meta.url)('electron');
const windowScript = fileURLToPath(new URL('./floating-window.cjs', import.meta.url));
const windowEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  /^(display|wayland_display|xdg_runtime_dir|xauthority|dbus_session_bus_address|path|pathext|windir|systemroot|systemdrive|userprofile|localappdata|appdata|programdata|temp|tmp)$/i.test(name)));
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
const workerEnv = {
  ...process.env,
  LIVEKIT_AGENT_NAME: agentName,
  ONBOARDING_SERVICE_URL: onboarding?.url || '',
};
const [html, script, sdk, answers] = await Promise.all([
  readFile(new URL('./demo/index.html', import.meta.url)),
  readFile(new URL('./demo/orb.js', import.meta.url)),
  readFile(new URL('./node_modules/livekit-client/dist/livekit-client.umd.js', import.meta.url)),
  readFile(new URL('./demo/answers.html', import.meta.url)),
]);

const sidebarAssets = new Map([
  ['/sidebar.css', './demo/sidebar.css'],
  ['/rough/rough.js', './node_modules/roughjs/bundled/rough.js'],
  ...['panel.mjs', 'canvas.mjs', 'contract.mjs', 'panel.css']
    .map((name) => ['/rough/' + name, './packages/rough-canvas/' + name]),
]);
for (const [route, path] of sidebarAssets) {
  const content = await readFile(new URL(path, import.meta.url));
  sidebarAssets.set(route, content);
}

const menu = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Permissions-Policy', 'microphone=(self), camera=()');
  response.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-eval'; worker-src 'self' blob:; img-src 'self' blob: data:; font-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; connect-src 'self' https: wss: ws://127.0.0.1:*");
  if (request.headers.host !== new URL(origin).host) return response.writeHead(403).end();
  if (request.method === 'GET') {
    if (request.url === '/') return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
    if (request.url === '/orb.js') return response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(script);
    if (request.url === '/livekit.js') return response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(sdk);
    if (sidebarAssets.has(request.url)) {
      const type = request.url.endsWith('.css') ? 'text/css' : 'text/javascript';
      return response.writeHead(200, { 'Content-Type': type }).end(sidebarAssets.get(request.url));
    }
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

menu.listen(menuPort, host, () => {
  origin = 'http://' + host + ':' + menu.address().port;
  // Local development mode also lets the SDK allocate its health port.
  launch(process.execPath, ['agent.mjs', 'dev', '--log-level', 'info'],
    { env: workerEnv, stdio: 'inherit' }, 'Desktop agent');
  const windowArgs = process.platform === 'linux' && process.env.WAYLAND_DISPLAY && process.env.DISPLAY
    ? ['--ozone-platform=x11', windowScript, origin]
    : [windowScript, origin];
  launch(electronPath, windowArgs, { env: windowEnv, stdio: 'inherit' }, 'Floating voice window', true);
  console.log('Starting Voice workspace on ' + origin + '.');
});
