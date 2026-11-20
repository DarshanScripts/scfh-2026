import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';

async function withOrb(run, { sdk, callResponse } = {}) {
  const root = new URL('../', import.meta.url);
  const assets = new Map(await Promise.all([
    ['/', 'text/html; charset=utf-8', 'demo/index.html'],
    ['/orb.js', 'text/javascript; charset=utf-8', 'demo/orb.js'],
    ['/livekit.js', 'text/javascript; charset=utf-8', 'node_modules/livekit-client/dist/livekit-client.umd.js'],
  ].map(async ([route, type, file]) => [route, [type, await readFile(new URL(file, root))]])));
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

test('the desktop orb stays on top and its single button cancels a pending call', async () => {
  let timer;
  try {
    await withOrb(async ({ app, page, connect }) => {
      const call = page.getByRole('button', { name: 'Call voice agent', exact: true });
      const end = page.getByRole('button', { name: 'End call', exact: true });
      await call.waitFor({ timeout: 5_000 });
      assert.equal(await page.getByRole('button').count(), 1);
      assert.deepEqual(await app.evaluate(({ BrowserWindow }) => {
        const orb = BrowserWindow.getAllWindows()[0];
        return [orb.isAlwaysOnTop(), ...orb.getContentSize()];
      }), [true, 160, 160]);
      await call.click();
      await Promise.race([connect, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Microphone capture did not reach the call endpoint.')), 5_000);
      })]).catch(async (error) => {
        throw new Error(error.message + ' ' + await page.getByRole('status').innerText(), { cause: error });
      });
      await end.click();
      await call.waitFor({ timeout: 5_000 });
      assert.equal(await page.getByRole('status').textContent(), 'Disconnected.');
      assert.equal(await end.count(), 0);
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
        this.localParticipant = { publishTrack: async () => {} };
        this.remoteParticipants = new Map([
          ['caller', participant('caller', {}, ['audio', 'video'], 0)],
          ['agent', participant('agent', { 'lk.agent.state': 'listening' }, ['audio'])],
          ['other', participant('other', { 'lk.publish_on_behalf': 'elsewhere' }, ['audio', 'video'])],
        ]);
        window.testRoom = this;
      }
      on(event, handler) { this.events.set(event, handler); }
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
    },
  };
`;

for (const avatarEnabled of [false, true]) {
  test(avatarEnabled ? 'the orb plays only the matching avatar media' : 'voice-only calls play only the agent audio', async () => {
    await withOrb(async ({ page }) => {
      await page.getByRole('button', { name: 'Call voice agent', exact: true }).click();
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
        assert.equal(await video.isHidden(), true);
        assert.equal(await page.locator('audio').count(), 0);
        await page.evaluate(() => window.testRoom.publishAvatar());
        await video.waitFor({ timeout: 5_000 });
      }
      await page.getByRole('button', { name: 'End call', exact: true }).click();
      assert.equal(await video.isHidden(), true);
      assert.equal(await page.locator('audio').count(), 0);
    }, { sdk: simulatedLiveKit, callResponse: { url: 'test', token: 'test', avatarEnabled } });
  });
}
