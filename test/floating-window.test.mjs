import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';
import { loadOrbAssets } from '../orb-assets.mjs';
import { DESKTOP_CONTROL_RPC } from '../desktop-control-rpc.mjs';
import { DRAW_RPC } from '../packages/rough-canvas/contract.mjs';

async function withOrb(run, { sdk, callResponse } = {}) {
  const root = new URL('../', import.meta.url);
  const assets = await loadOrbAssets();
  if (sdk) assets.get('/livekit.js')[1] = sdk;
  const connect = Promise.withResolvers();
  const fixture = createServer((request, response) => {
    const asset = assets.get(request.url);
    if (asset) {
      response.writeHead(200, { 'Content-Type': asset[0] }).end(asset[1]);
    } else if (request.url === '/connect' && request.method === 'POST') {
      connect.resolve();
      if (callResponse) {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(callResponse));
      }
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  let app;
  try {
    const env = Object.fromEntries(Object.entries(process.env)
      .filter(([name]) => name.toUpperCase() !== 'ELECTRON_RUN_AS_NODE'));
    app = await _electron.launch({
      executablePath: createRequire(import.meta.url)('electron'),
      args: [
        '--use-fake-device-for-media-stream',
        fileURLToPath(new URL('floating-window.cjs', root)),
        'http://127.0.0.1:' + fixture.address().port,
      ],
      env,
      timeout: 15_000,
    });
    const page = await app.firstWindow();
    await run({ app, page, connect: connect.promise });
  } finally {
    await app?.close();
    fixture.closeAllConnections();
    await new Promise((resolve) => fixture.close(resolve));
  }
}

test('the desktop sidebar stays on top, cancels calls and collapses', async () => {
  let timer;
  try {
    await withOrb(async ({ app, page, connect }) => {
      const call = page.getByRole('button', { name: 'Start call', exact: true });
      const end = page.getByRole('button', { name: 'End call', exact: true });
      await call.waitFor({ timeout: 5_000 });
      assert.equal(await call.count(), 1);
      assert.deepEqual(await app.evaluate(({ BrowserWindow, screen }) => {
        const orb = BrowserWindow.getAllWindows()[0];
        const area = screen.getDisplayMatching(orb.getBounds()).workArea;
        const bounds = orb.getBounds();
        return [orb.isAlwaysOnTop(), bounds.width, bounds.height, Math.round(area.width * 0.3), area.height];
      }).then(([top, width, height, expectedWidth, expectedHeight]) => [top, Math.abs(width - expectedWidth) <= 1, Math.abs(height - expectedHeight) <= 1]), [true, true, true]);
      if (process.env.SCFH_CAPTURE_ORB === '1') {
        await page.screenshot({ path: 'docs/desktop-sidebar.png', scale: 'css' });
      }
      await call.click();
      await Promise.race([connect, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Microphone capture did not reach the call endpoint.')), 5_000);
      })]).catch(async (error) => {
        throw new Error(error.message + ' ' + await page.locator('#status').innerText(), { cause: error });
      });
      await end.click();
      await call.waitFor({ timeout: 5_000 });
      assert.equal(await page.locator('#status').textContent(), 'Disconnected.');
      assert.equal(await end.count(), 0);
      await page.getByRole('button', { name: 'Collapse sidebar' }).click();
      await page.getByRole('button', { name: 'Expand sidebar' }).waitFor();
      assert(Math.abs((await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())).width - 42) <= 1);
      await page.getByRole('button', { name: 'Expand sidebar' }).click();
      await call.waitFor();
    });
  } finally {
    clearTimeout(timer);
  }
});

const simulatedLiveKit = `
  function track(kind, owner) {
    let element;
    let stream;
    return {
      kind,
      attach(target = document.createElement(kind)) {
        element = target;
        element.dataset.owner = owner;
        if (kind === 'video') {
          const canvas = document.createElement('canvas');
          canvas.getContext('2d').fillRect(0, 0, 100, 100);
          stream = canvas.captureStream(1);
          element.srcObject = stream;
        }
        return element;
      },
      detach() {
        if (!element) return [];
        delete element.dataset.owner;
        element.srcObject = null;
        stream?.getTracks().forEach((track) => track.stop());
        return [element];
      },
    };
  }
  function participant(identity, attributes, kinds, kind = 4) {
    return {
      identity, attributes, kind,
      trackPublications: new Map(kinds.map((type) => [type, { track: track(type, identity) }])),
    };
  }
  window.LivekitClient = {
    createLocalAudioTrack: async () => ({ stop() {} }),
    ParticipantKind: { AGENT: 4 },
    RoomEvent: {
      ParticipantAttributesChanged: 'attributes', ParticipantConnected: 'join',
      ParticipantDisconnected: 'leave', TrackSubscribed: 'subscribed',
      TrackUnsubscribed: 'unsubscribed', Disconnected: 'disconnected',
    },
    Track: { Kind: { Audio: 'audio', Video: 'video' }, Source: { Microphone: 'mic' } },
    Room: class {
      constructor() {
        this.events = new Map();
        this.localParticipant = {
          publishTrack: async () => {},
          publishData: async (data, options) => { this.lastData = [new TextDecoder().decode(data), options.topic]; },
        };
        this.remoteParticipants = new Map([
          ['caller', participant('caller', {}, ['audio', 'video'], 0)],
          ['agent', participant('agent', { 'lk.agent.state': 'listening' }, ['audio'])],
          ['other', participant('other', { 'lk.publish_on_behalf': 'elsewhere' }, ['audio', 'video'])],
        ]);
        window.testRoom = this;
      }
      on(event, handler) { this.events.set(event, handler); }
      registerTextStreamHandler() {}
      rpc = new Map();
      registerRpcMethod(method, handler) { this.rpc.set(method, handler); }
      async connect() {}
      async startAudio() {}
      async disconnect() { this.events.get('disconnected')?.(); }
      publishAvatar() {
        this.remoteParticipants.set('avatar', participant('avatar', { 'lk.publish_on_behalf': 'agent' }, ['audio', 'video']));
        this.events.get('subscribed')?.();
      }
      unpublishAvatar() {
        const presenter = this.remoteParticipants.get('avatar');
        for (const [kind, publication] of presenter.trackPublications) {
          this.events.get('unsubscribed')?.(publication.track, publication, presenter);
          presenter.trackPublications.delete(kind);
        }
      }
      fallBackToVoice() {
        this.remoteParticipants.get('agent').attributes['scfh.avatar.mode'] = 'voice-fallback';
        this.events.get('attributes')?.();
      }
    },
  };
`;

test('the avatar and canvas stay side by side and yield the desktop during computer use', async () => {
  await withOrb(async ({ app, page }) => {
    await page.getByRole('button', { name: 'Start call' }).click();
    await page.evaluate(() => window.testRoom.publishAvatar());
    await page.locator('main[data-state="listening"]').waitFor();
    const avatar = page.locator('#avatar');
    assert(await avatar.isVisible());
    const begin = { type: 'begin', id: 'test-canvas', title: 'Onboarding', total: 1 };
    const send = (callerIdentity, message) => page.evaluate(({ method, callerIdentity, payload }) =>
      window.testRoom.rpc.get(method)({ callerIdentity, payload }),
    { method: DRAW_RPC, callerIdentity, payload: JSON.stringify(message) });
    const desktop = (message, callerIdentity = 'agent') => page.evaluate(({ method, callerIdentity, payload }) =>
      window.testRoom.rpc.get(method)({ callerIdentity, payload }),
    { method: DESKTOP_CONTROL_RPC, callerIdentity, payload: JSON.stringify(message) });
    const windowState = () => app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map(win => [win.getTitle(), win.isVisible(), win.isFocusable(), win.isFocused()]).sort());

    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await page.getByRole('button', { name: 'Expand sidebar' }).waitFor();
    assert.equal(await send('unrelated-participant', begin), 'invalid');
    const opened = app.waitForEvent('window');
    assert.equal(await send('agent', begin), 'ok');
    const canvas = await opened;
    assert(await avatar.isVisible());
    assert(await page.getByRole('log').isVisible());
    const scene = canvas.locator('svg');
    const initialView = await scene.getAttribute('viewBox');
    await canvas.getByRole('button', { name: 'Zoom in' }).click();
    assert.notEqual(await scene.getAttribute('viewBox'), initialView);
    await canvas.getByRole('button', { name: 'Zoom out' }).click();
    await canvas.getByRole('button', { name: 'Follow steps' }).click();
    const layout = await app.evaluate(({ BrowserWindow, screen }) => {
      const windows = BrowserWindow.getAllWindows();
      const sidebar = windows.find(win => win.getTitle() === 'Voice workspace').getBounds();
      const canvas = windows.find(win => win.getTitle() === 'Canvas').getBounds();
      return { sidebar, canvas, area: screen.getDisplayMatching(sidebar).workArea };
    });
    const { sidebar, canvas: drawing, area } = layout;
    assert.deepEqual(drawing, { x: area.x, y: area.y, width: area.width - sidebar.width, height: area.height });
    assert.equal(sidebar.width, Math.round(area.width * .3));
    assert.equal(sidebar.x + sidebar.width, area.x + area.width);
    assert.equal(drawing.x + drawing.width, sidebar.x);
    assert.equal(await send('agent', { type: 'step', id: begin.id, index: 0, narration: 'Check the source.', marks: [
      { kind: 'symbol', x: 130, y: 140, name: 'document', size: 36, group: 'source' },
      { kind: 'label', x: 180, y: 140, text: 'Source', group: 'source' },
    ] }), 'ok');
    const followedWidth = Number((await scene.getAttribute('viewBox')).split(' ')[2]);
    assert(followedWidth < 600, 'The camera frames the narrated step instead of showing the entire drawing area');
    assert.equal(await send('agent', { type: 'completed', id: begin.id }), 'ok');
    await canvas.getByRole('button', { name: 'Save as PNG' }).waitFor();
    await canvas.getByText('Check the source.').waitFor();
    assert.equal(await canvas.locator('[data-symbol="document"]').count(), 1);
    const fitted = await scene.getAttribute('viewBox');
    await canvas.getByRole('button', { name: 'Zoom in' }).click();
    const zoomed = await canvas.locator('svg').getAttribute('viewBox');
    assert.notEqual(zoomed, '0 0 1000 600');
    const map = await canvas.locator('svg').boundingBox();
    await canvas.mouse.move(map.x + map.width / 2, map.y + map.height / 2);
    await canvas.mouse.down();
    await canvas.mouse.move(map.x + map.width / 2 + 35, map.y + map.height / 2);
    await canvas.mouse.up();
    assert.notEqual(await canvas.locator('svg').getAttribute('viewBox'), zoomed);
    await canvas.getByRole('button', { name: 'Fit view' }).click();
    const fittedAgain = (await scene.getAttribute('viewBox')).split(' ').map(Number);
    assert(fitted.split(' ').map(Number).every((value, index) => Math.abs(value - fittedAgain[index]) < 0.1));
    const desktopStart = { type: 'start', id: '55a8d92a-9f8c-4c99-8097-c271b637ced1', request: 'Open the Facilities onboarding folder.' };
    assert.equal(await desktop(desktopStart, 'unrelated-participant'), 'invalid');
    assert.equal(await desktop(desktopStart), 'ok');
    assert.deepEqual(await windowState(), [
      ['Canvas', false, false, false], ['Voice workspace', false, false, false],
    ]);
    await app.evaluate(({ BrowserWindow }) => new BrowserWindow({ title: 'Desktop result', width: 300, height: 200 }).focus());
    assert.equal(await desktop({ type: 'stop' }), 'ok');
    assert.deepEqual(await windowState(), [
      ['Canvas', false, false, false], ['Desktop result', true, true, true], ['Voice workspace', true, true, false],
    ]);
    assert.equal(await desktop({ type: 'result', id: desktopStart.id, text: 'Opened the folder in File Explorer.' }), 'ok');
    assert.equal(await page.locator('#desktop-request').textContent(), desktopStart.request);
    assert.equal(await page.locator('#desktop-result').textContent(), 'Opened the folder in File Explorer.');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.getTitle() === 'Desktop result').close());
    assert(await avatar.isVisible());
    await page.getByRole('button', { name: 'Show canvas' }).click();
    await canvas.getByRole('button', { name: 'Close canvas' }).click();
    await page.waitForFunction(() => window.testRoom.lastData?.[0] === 'test-canvas');
    await page.locator('body[data-mode="sidebar"]').waitFor();
    assert.equal(app.windows().length, 1);
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await page.getByRole('button', { name: 'End call' }).click();
  }, { sdk: simulatedLiveKit, callResponse: { url: 'test', token: 'test', avatarEnabled: true } });
});

for (const avatarEnabled of [false, true]) {
  test(avatarEnabled ? 'the orb plays only the matching avatar media' : 'voice-only calls play only the agent audio', async () => {
    await withOrb(async ({ page }) => {
      await page.getByRole('button', { name: 'Start call', exact: true }).click();
      const video = page.locator('#avatar');
      if (avatarEnabled) {
        await page.waitForFunction(() => document.querySelector('#status').textContent === 'Waiting for the avatar…');
        assert.equal(await page.locator('audio').count(), 0);
        await page.evaluate(() => window.testRoom.publishAvatar());
        await page.waitForFunction(() => Boolean(document.querySelector('#avatar').srcObject));
        assert.equal(await video.getAttribute('data-owner'), 'avatar');
        assert.equal(await video.isVisible(), true);
      }
      await page.locator('main[data-state="listening"]').waitFor({ timeout: 5_000 });
      assert.deepEqual(await page.locator('audio').evaluateAll((nodes) => nodes.map((node) => node.dataset.owner)),
        [avatarEnabled ? 'avatar' : 'agent']);
      if (avatarEnabled) {
        await page.evaluate(() => window.testRoom.unpublishAvatar());
        await video.waitFor({ state: 'hidden', timeout: 5_000 });
        assert.equal(await page.locator('audio').count(), 0);
        await page.evaluate(() => window.testRoom.publishAvatar());
        await video.waitFor({ timeout: 5_000 });
      }
      await page.getByRole('button', { name: 'End call', exact: true }).click();
      await video.waitFor({ state: 'hidden', timeout: 5_000 });
      assert.equal(await page.locator('audio').count(), 0);
    }, { sdk: simulatedLiveKit, callResponse: { url: 'test', token: 'test', avatarEnabled } });
  });
}

test('an unavailable avatar keeps the call open and plays the assigned agent audio', async () => {
  await withOrb(async ({ page }) => {
    await page.getByRole('button', { name: 'Start call' }).click();
    await page.getByText('Waiting for the avatar…').waitFor({ state: 'attached', timeout: 5_000 });
    await page.evaluate(() => {
      window.testRoom.fallBackToVoice();
      window.testRoom.publishAvatar();
    });
    await page.locator('main[data-state="listening"]').waitFor({ timeout: 5_000 });
    assert.equal(await page.locator('#avatar').isHidden(), true);
    assert.deepEqual(await page.locator('audio').evaluateAll((nodes) => nodes.map((node) => node.dataset.owner)), ['agent']);
    assert.equal(await page.locator('#status').textContent(), 'Beyond Presence video unavailable. Listening. Say a command.');
    await page.getByRole('button', { name: 'End call' }).click();
  }, { sdk: simulatedLiveKit, callResponse: { url: 'test', token: 'test', avatarEnabled: true } });
});
