import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { AccessToken, RoomAgentDispatch, RoomConfiguration, RoomServiceClient } from 'livekit-server-sdk';

const host = '127.0.0.1';
const menuPort = Number(process.env.DEMO_PORT || 4321);
const origin = 'http://' + host + ':' + menuPort;
const electronPath = createRequire(import.meta.url)('electron');
const windowScript = fileURLToPath(new URL('./floating-window.cjs', import.meta.url));
const windowEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  /^(path|pathext|windir|systemroot|systemdrive|userprofile|localappdata|appdata|programdata|temp|tmp)$/i.test(name)));
const livekitPort = Number(process.env.DEMO_LIVEKIT_PORT || 7880);
const diagnosticSpeech = process.env.DEMO_SPEECH === 'openrouter';
const avatarEnabled = process.env.ENABLE_AVATAR === '1';
const livekitURL = diagnosticSpeech ? 'ws://' + host + ':' + livekitPort : process.env.LIVEKIT_URL;
const agentName = 'scfh-desktop-demo';
const serverName = process.platform === 'win32' ? 'livekit-server.exe' : 'livekit-server';
const bundled = resolve('.hcu', 'livekit', serverName);
const binary = process.env.LIVEKIT_SERVER_COMMAND || (existsSync(bundled) ? bundled : serverName);

if (!process.env.OPENROUTER_API_KEY?.trim()) {
  throw new Error('Set OPENROUTER_API_KEY in .env before starting the demo.');
}

if (avatarEnabled && diagnosticSpeech) {
  throw new Error('Beyond Presence needs a LiveKit room reachable from the cloud. Clear DEMO_SPEECH to use the avatar.');
}
if (avatarEnabled && !(process.env.BEYOND_PRESENCE_API_KEY?.trim() || process.env.BEY_API_KEY?.trim())) {
  throw new Error('Set BEYOND_PRESENCE_API_KEY in .env to enable the avatar.');
}

if (!diagnosticSpeech) {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    throw new Error('Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in .env for LiveKit Inference.');
  }
  try {
    await new RoomServiceClient(LIVEKIT_URL.replace(/^wss:/, 'https:'), LIVEKIT_API_KEY, LIVEKIT_API_SECRET).listRooms();
  } catch (error) {
    const status = typeof error.status === 'number' ? ' (HTTP ' + error.status + ')' : '';
    throw new Error('Could not authenticate the LiveKit Cloud project' + status + '. Check the LiveKit settings in .env.');
  }
}

const key = diagnosticSpeech ? 'scfh-' + randomUUID() : process.env.LIVEKIT_API_KEY;
const secret = diagnosticSpeech ? randomUUID() + randomUUID() : process.env.LIVEKIT_API_SECRET;
const workerEnv = {
  ...process.env,
  LIVEKIT_URL: livekitURL,
  LIVEKIT_API_KEY: key,
  LIVEKIT_API_SECRET: secret,
  LIVEKIT_AGENT_NAME: agentName,
  LIVEKIT_LOCAL_DEMO: diagnosticSpeech ? '1' : '0',
  ENABLE_AVATAR: avatarEnabled ? '1' : '0',
};
const [html, script, sdk] = await Promise.all([
  readFile(new URL('./demo/index.html', import.meta.url)),
  readFile(new URL('./demo/orb.js', import.meta.url)),
  readFile(new URL('./node_modules/livekit-client/dist/livekit-client.umd.js', import.meta.url)),
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
  }
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

function startMenu() {
  launch(process.execPath, ['agent.mjs', 'start'], { env: workerEnv, stdio: 'inherit' }, 'Desktop agent');
  menu.listen(menuPort, host, () => {
    launch(electronPath, [windowScript, origin], { env: windowEnv, stdio: 'inherit' }, 'Floating voice window', true);
    console.log('Starting the floating voice window.');
  });
}

if (!diagnosticSpeech) {
  startMenu();
} else {
  await startLocalDemo();
}

async function startLocalDemo() {
  // Use loopback and fresh room credentials for each diagnostic process.
  const localConfig = [
    'port: ' + livekitPort,
    'bind_addresses: [' + host + ']',
    'rtc:',
    '  tcp_port: ' + (livekitPort + 1),
    '  udp_port: ' + (livekitPort + 2),
    '  enable_loopback_candidate: true',
  ].join('\n');
  launch(binary, ['--config-body', localConfig, '--node-ip', host], {
    env: { ...process.env, LIVEKIT_KEYS: key + ': ' + secret },
    stdio: 'inherit',
  }, 'LiveKit server');

  for (let attempt = 0; attempt < 40 && !stopping; attempt++) {
    const ready = await fetch('http://' + host + ':' + livekitPort, {
      signal: AbortSignal.timeout(500),
    }).then((response) => response.ok).catch(() => false);
    if (ready) {
      startMenu();
      break;
    }
    if (attempt === 39) {
      console.error('The local LiveKit server did not become ready.');
      stop(1);
    } else {
      await delay(250);
    }
  }
}
