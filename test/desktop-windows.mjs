import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeLogger, llm, voice } from '@livekit/agents';
import { createDesktopServer, createDesktopTools, desktopText } from '../desktop.mjs';

assert.equal(process.platform, 'win32', 'Run this smoke test on an unlocked Windows desktop.');
const browser = [
  process.env.DESKTOP_TEST_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((path) => path && existsSync(path));
assert(browser, 'Install Chrome or Edge or set DESKTOP_TEST_BROWSER.');

const root = resolve('.hcu');
await mkdir(root, { recursive: true });
const scratch = await mkdtemp(resolve(root, 'desktop-test-'));
const resultFile = resolve(scratch, 'input.txt');
const run = Date.now().toString(36);
const browserTitle = 'SCFH browser check ' + run;
const formTitle = 'SCFH native check ' + run;
const checkPublicSite = process.argv.includes('--public');
let clicked = false;
let visited = false;
let homeLoaded = false;
const site = createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/clicked') {
    clicked = true;
    response.writeHead(204).end();
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (request.url === '/handbook') {
    visited = true;
    response.end('<title>' + browserTitle + '</title><h1>Sample Handbook Section</h1>' +
      '<a href="https://example.com/">Open public example</a>');
    return;
  }
  if (request.url === '/') homeLoaded = true;
  response.end('<title>' + browserTitle + '</title><h1>SCFH test page</h1>' +
    '<button onclick="fetch(\'/clicked\', { method: \'POST\' })">Confirm browser check</button> ' +
    '<a href="/handbook">Open sample handbook</a>');
});

initializeLogger({ level: 'error' });
const mcp = createDesktopServer(({ result }) => result.content, {
  control: !process.argv.includes('--no-control'),
});
const apps = [];
let tools;

async function until(action, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await action();
    if (result) return result;
    await delay(350);
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for ' + label);
}

async function call(name, args = {}) {
  const tool = tools.find((tool) => tool.name === name);
  assert(tool, 'Missing Windows-MCP tool ' + name);
  const content = await tool.execute(args, {});
  return { output: desktopText(content), content };
}

async function withControl(action) {
  return until(async () => {
    try {
      return await action();
    } catch (error) {
      if (/"code"\s*:\s*"USER_CONTROL"/.test(error.message)) {
        await delay(2_000);
        return false;
      }
      if (!/CONTROL_(BUSY|PREEMPTED)/.test(error.message) ||
          !/"executed_steps"\s*:\s*0/.test(error.message)) throw error;
      return false;
    }
  }, 'Windows-MCP desktop control', 35_000);
}

async function waitForWindow(title) {
  await until(async () => {
    const { output } = await call('Snapshot');
    return output.includes(title);
  }, title);
}

function controlLocation(snapshot, name) {
  const line = snapshot.split('\n').find((line) =>
    line.toLowerCase().includes('"' + name.toLowerCase() + '"'));
  return line?.match(/\((-?\d+),\s*(-?\d+)\)/)?.slice(1).map(Number);
}

async function control(name) {
  return until(async () => controlLocation((await call('Snapshot')).output, name), name);
}

async function checkCursorTravel(name, loc, act, {
  start = [loc[0] + 125, loc[1] + 40],
  minimumMs = 260,
} = {}) {
  await withControl(() => call('Move', { loc: start }));
  const probe = spawn('powershell.exe', ['-NoProfile', '-File', resolve('test/cursor-probe.ps1')], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const samples = [];
  const lines = createInterface({ input: probe.stdout });
  lines.on('line', (line) => {
    if (/^\d+ -?\d+ -?\d+$/.test(line)) samples.push(line.split(' ').map(Number));
  });
  const at = ([, x, y], [targetX, targetY]) => x === targetX && y === targetY;
  try {
    await until(() => samples.some((sample) => at(sample, start)), 'the cursor sampler');
    await withControl(act);
    const arrival = await until(() => samples.find((sample) => at(sample, loc)), 'the cursor to reach its target');
    const intermediate = samples.filter((sample) => sample[0] < arrival[0] && !at(sample, start));
    const distinct = new Set(intermediate.map(([, x, y]) => x + ',' + y));
    assert(distinct.size >= 5, name + ' should pass through at least five visible intermediate positions.');
    const duration = arrival[0] - intermediate[0][0];
    assert(duration >= minimumMs, name + ' should travel visibly before acting.');
    const distance = Math.round(Math.hypot(loc[0] - start[0], loc[1] - start[1]));
    console.log('PASS ' + name + ' traveled ' + distance + ' px through ' + distinct.size +
      ' sampled positions over ' + duration + ' ms.');
  } finally {
    lines.close();
    probe.kill();
  }
}

function launch(executable, args) {
  const child = spawn(executable, args, { stdio: 'ignore' });
  apps.push(child);
  return new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
}

async function checkAgentCursorTravel() {
  const message = 'Click Confirm browser check.';
  const loc = await control('Confirm browser check');
  const { content } = await call('DisplayInventory');
  const displays = content.filter(({ type }) => type === 'text').flatMap(({ text }) => JSON.parse(text));
  const display = displays.find(({ bounds }) =>
    loc[0] >= bounds.left && loc[0] < bounds.right && loc[1] >= bounds.top && loc[1] < bounds.bottom);
  assert(display, 'The browser button must be on a visible display.');
  const { left, right } = display.bounds;
  const edge = loc[0] - left > right - loc[0] ? left + 24 : right - 24;
  const distance = Math.abs(edge - loc[0]);
  const minimumMs = Math.min(750, 260 + Math.floor(distance / 3));
  const session = new voice.AgentSession({
    llm: new voice.testing.FakeLLM(),
    vad: null,
    tools: [createDesktopTools({})],
  });
  try {
    await session.start({ agent: voice.Agent.create({
      instructions: 'Desktop smoke test.',
      async *llmNode(_ctx, chatCtx) {
        const previous = chatCtx.items.findLast((item) => item.type === 'function_call_output');
        if (previous && (previous.name !== 'Snapshot' || previous.isError)) return;
        const name = previous ? 'Click' : 'Snapshot';
        const args = previous ? { loc } : { use_vision: false };
        yield { id: name, delta: { role: 'assistant', toolCalls: [
          llm.FunctionCall.create({ callId: name, name, args: JSON.stringify(args) }),
        ] } };
      },
    }) });
    await checkCursorTravel('LiveKit AgentSession Click', loc, async () => {
      await call('ControlStatus', { release: true });
      const result = await session.run({ userInput: message }).wait();
      const tools = result.events.filter((event) => event.type === 'function_call');
      assert.deepEqual(tools.map((event) => event.item.name), ['Snapshot', 'Click']);
      const outputs = result.events.filter((event) => event.type === 'function_call_output');
      assert.equal(outputs.length, 2);
      for (const output of outputs) assert.equal(output.item.isError, false, output.item.output);
      assert(outputs[0].item.output.includes(browserTitle), 'The agent did not see the browser fixture.');
      await until(() => clicked, 'the browser button callback');
      return true;
    }, { start: [edge, loc[1]], minimumMs });
  } finally {
    await session.close();
  }
}

try {
  await mcp.initialize();
  tools = await mcp.listTools();
  assert(!tools.some(({ name }) => ['PowerShell', 'FileSystem', 'Registry'].includes(name)),
    'The voice worker should use desktop interaction tools.');

  await new Promise((resolve, reject) => {
    site.once('error', reject);
    site.listen(0, '127.0.0.1', resolve);
  });
  await launch('powershell.exe', [
    '-NoProfile', '-STA', '-File', resolve('test/desktop-form.ps1'),
    '-Title', formTitle, '-ResultFile', resultFile,
  ]);
  await waitForWindow(formTitle);
  await withControl(() => call('App', { mode: 'switch', name: formTitle }));
  const field = await control('Desktop check input');
  await checkCursorTravel('Type', field, () => call('Type', { loc: field, text: 'desktop check passed', clear: true }));
  const button = await control('Confirm desktop check');
  await checkCursorTravel('Click', button, () => call('Click', { loc: button }));
  await until(() => existsSync(resultFile), 'the native button callback');
  assert.equal(await readFile(resultFile, 'utf8'), 'desktop check passed');
  const { content } = await call('Screenshot');
  assert(content.some((item) => item.type === 'image' && item.data), 'Expected an actual desktop screenshot.');
  console.log('PASS Native Windows app: entered text, clicked a button, and captured the desktop.');
  await call('ControlStatus', { release: true });

  await launch(browser, [
    '--user-data-dir=' + resolve(scratch, 'browser'),
    '--no-first-run',
    '--no-default-browser-check',
    '--force-renderer-accessibility',
    '--disable-background-networking',
    '--lang=en-US',
    '--new-window',
    'http://127.0.0.1:' + site.address().port + '/',
  ]);
  await until(() => homeLoaded, 'the browser fixture request');
  await withControl(() => call('App', { mode: 'switch', name: browserTitle }));
  await checkAgentCursorTravel();
  console.log('PASS LiveKit AgentSession: clicked a real HTML button and verified its HTTP callback.');

  await withControl(async () => call('Click', { loc: await control('Open sample handbook') }));
  await until(() => visited, 'the handbook navigation request');
  await control('Open public example');
  console.log('PASS Browser: followed a link and verified the destination page was rendered.');
  if (checkPublicSite) {
    await withControl(async () => call('Click', { loc: await control('Open public example') }));
    await waitForWindow('Example Domain');
    console.log('PASS Browser: opened example.com and verified its title.');
  }

} catch (error) {
  console.error('FAIL ' + error.message);
  console.error('Fixture state: browser loaded=' + homeLoaded + ', button clicked=' + clicked +
    ', link followed=' + visited + ', browser exit=' + (apps[1]?.exitCode ?? 'running'));
  process.exitCode = 1;
} finally {
  if (tools) await call('ControlStatus', { release: true }).catch(() => {});
  for (const app of apps) {
    if (app.exitCode === null) app.kill();
  }
  await mcp.aclose();
  if (site.listening) await new Promise((resolve) => site.close(resolve));
  await rm(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 }).catch(() => {});
}
