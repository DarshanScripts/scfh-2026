import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';
import { getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { createOnboardingAnswers } from '../onboarding-answer.mjs';
import { answerPanelPolicy, proxyOnboarding, startOnboardingService } from '../onboarding-service.mjs';
import { loadOrbAssets } from '../orb-assets.mjs';

const sdk = `window.LivekitClient = {
  createLocalAudioTrack: async () => ({ stop() {} }),
  ParticipantKind: { AGENT: 4 },
  RoomEvent: {},
  Track: { Kind: { Audio: 'audio' }, Source: { Microphone: 'mic' } },
  Room: class {
    localParticipant = { async publishTrack() {} };
    remoteParticipants = new Map([['test-worker', {
      identity: 'test-worker', kind: 4, attributes: { 'lk.agent.state': 'listening' }, trackPublications: new Map(),
    }]]);
    on() {}
    async connect() {}
    async startAudio() {}
    async disconnect() {}
    registerTextStreamHandler(_topic, handler) {
      window.deliverAnswerEvent = message => handler({ readAll: async () => message }, { identity: 'test-worker' });
    }
  },
};`;

test('the onboarding tool speaks the displayed answer and opens exact PDF and Word citations', async () => {
  const service = await startOnboardingService();
  let app;
  let server;
  try {
    const assets = await loadOrbAssets();
    assets.set('/livekit.js', ['text/javascript', sdk]);
    assets.set('/answers', ['text/html', await readFile(new URL('../demo/answers.html', import.meta.url))]);
    let origin;
    server = createServer(async (req, res) => {
      const asset = assets.get(req.url);
      if (asset) {
        if (req.url === '/answers') res.setHeader('Content-Security-Policy', answerPanelPolicy);
        return res.writeHead(200, { 'Content-Type': asset[0] }).end(asset[1]);
      }
      if (req.url === '/connect' && req.method === 'POST') {
        return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"url":"test","token":"test"}');
      }
      if (!await proxyOnboarding(req, res, service.url, origin)) res.writeHead(404).end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), env: getDefaultEnvironment(),
      args: [fileURLToPath(new URL('../floating-window.cjs', import.meta.url)), origin] });
    const orb = await app.firstWindow();
    await orb.getByRole('button', { name: 'Call voice agent' }).click();
    await orb.locator('[data-state="listening"]').waitFor();
    const messages = [];
    const room = { localParticipant: { async sendText(message, { topic }) {
      assert.equal(topic, 'scfh.onboarding.v1');
      const event = JSON.parse(message);
      messages.push(event);
      await orb.evaluate(message => window.deliverAnswerEvent(message), message);
    } } };
    const onboarding = createOnboardingAnswers(room, service.url);
    const spoken = [];
    const opts = { ctx: { session: { say: (text) => spoken.push(text) }, speechHandle: { interrupted: false } }, abortSignal: new AbortController().signal };
    async function ask(query) {
      await onboarding.beginTurn();
      await onboarding.tool.execute({ query }, opts);
      const event = messages.at(-1);
      assert.equal(event.type, 'answer');
      assert.equal(spoken.at(-1), event.answer.text);
      return event.answer;
    }
    const open = app.waitForEvent('window');
    await ask('Where’s the guide for logging a maintenance request, and what do I need before I open a ticket?');
    const panel = await open;
    await panel.getByRole('button', { name: /Intake checklist/ }).click();
    await panel.locator('.pdf-page[data-page="2"] .source-highlight').first().waitFor();
    await ask('A maintenance ticket still has no owner. When should I follow up, and who do I tell?');
    await panel.locator('button[data-passage="unassigned-reminder"]').click();
    const reminder = panel.locator('.word-page mark.source-highlight');
    await reminder.waitFor();
    assert.match(await reminder.textContent(), /Send the ticket ID and latest status to the Desk Lead/);
    if (process.env.SCFH_CAPTURE_ORB === '1') {
      await panel.evaluate(() => window.scrollTo(0, 0));
      await panel.screenshot({ path: 'docs/onboarding-citation.png', scale: 'css' });
    }
    const deadline = await ask('I’m taking over the queue. Which open item is due first, and who owns it?');
    assert.match(deadline.text, /FM-104/);
    await panel.locator('#answer').filter({ hasText: 'FM-104' }).waitFor();
    assert.equal((await ask('What budget do we have for repairs?')).outcome, 'insufficient');
    await panel.locator('#answer[data-outcome="insufficient"]').waitFor();
    assert.equal((await ask('Which open ticket is due first, and what budget do we have for repairs?')).outcome, 'partial');
    await panel.locator('#answer[data-outcome="partial"]').waitFor();
  } finally {
    await app?.close();
    server?.closeAllConnections();
    server?.close();
    service.close();
  }
});
