import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright-core';
import { getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { buildWorkflow, createWorkflowTools } from '../workflow-tools.mjs';
import { startPreview, windowScript } from '../preview-excalidraw.mjs';
import { playWorkflowStep } from '../workflow-playback.mjs';

const workflow = { title: 'Maintenance example', steps: ['Receive request', 'Details complete?', 'Ask for details', 'Assign ticket'],
  narration: ['First, receive the maintenance request.', 'Check whether the details are complete.', 'Ask for any missing information.', 'If the details are complete, assign the ticket.'],
  connections: [{ from: 0, to: 1, label: '' }, { from: 1, to: 2, label: 'No' }, { from: 1, to: 3, label: 'Yes' }] };

function fakeSession() {
  const output = new EventEmitter();
  const calls = [];
  return {
    calls, output: { audio: output, audioEnabled: true },
    say(text) {
      const playout = Promise.withResolvers();
      let done = false;
      const speech = {
        interrupted: false,
        done: () => done,
        waitForPlayout: () => playout.promise,
        interrupt() { speech.interrupted = true; finish(); },
      };
      function finish() { done = true; playout.resolve(); }
      calls.push({ text, speech, start: () => output.emit('playbackStarted'), finish });
      return speech;
    },
  };
}

async function until(condition) {
  const deadline = Date.now() + 20_000;
  while (!condition()) {
    assert(Date.now() < deadline, 'Timed out waiting for the walkthrough');
    await delay(25);
  }
}

test('rejects invalid connections before starting a canvas', () => {
  assert.throws(() => buildWorkflow({ ...workflow, connections: [{ from: 0, to: 99, label: '' }] }), /indices/);
});

test('native window reveals only the stage played by the avatar', async () => {
  const elements = buildWorkflow(workflow);
  const preview = await startPreview({ elements, title: workflow.title, narrated: true });
  const session = fakeSession();
  const avatarAudio = new EventEmitter();
  const controller = new AbortController();
  let app;
  try {
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [windowScript, preview.url], env: getDefaultEnvironment() });
    const page = await app.firstWindow();
    const frame = page.frameLocator('iframe');
    await until(preview.isReady);
    const first = frame.getByText('Receive request', { exact: true }).first();
    const last = frame.getByText('Assign ticket', { exact: true }).first();
    const playback = playWorkflowStep({ session, avatarAudio, text: workflow.narration[0], signal: controller.signal,
      reveal: () => preview.reveal(elements.slice(0, 3), 1, 4) });
    playback.catch(() => {});
    const speech = session.calls[0];
    avatarAudio.emit('voice');
    speech.start();
    assert.equal(await first.count(), 0);
    avatarAudio.emit('voice');
    await first.waitFor({ timeout: 10_000 });
    assert.equal(await last.count(), 0);
    speech.finish();
    assert(await playback);
    preview.finish();
    await last.waitFor();
    await frame.getByText('Yes', { exact: true }).first().waitFor();
    await frame.getByText('No', { exact: true }).first().waitFor();
    assert.equal(await page.locator('#advance').isVisible(), false);
  } finally {
    controller.abort();
    await app?.close();
    preview.server.closeAllConnections();
    preview.server.close();
  }
});

test('voice tool speaks each line only after prior playout and stops on interruption', async () => {
  const workflowTools = createWorkflowTools();
  const session = fakeSession();
  try {
    const result = await workflowTools.tools[0].execute(workflow, {
      ctx: { session, speechHandle: { interrupted: false }, waitForPlayout: async () => {} },
      abortSignal: new AbortController().signal,
    });
    assert.equal(result, undefined, 'The tool handles narration without an extra model reply');
    await until(() => session.calls.length === 1);
    const first = session.calls[0];
    assert.equal(first.text, workflow.narration[0]);
    first.start();
    await delay(50);
    assert.equal(session.calls.length, 1);
    first.finish();
    await until(() => session.calls.length === 2);
    const second = session.calls[1];
    assert.equal(second.text, workflow.narration[1]);
    second.start();
    workflowTools.interrupt();
    await until(() => second.speech.interrupted);
    assert.equal(session.calls.length, 2);
    assert.match(await workflowTools.tools[1].execute({}, {}), /closed/);
  } finally { await workflowTools.close(); }
});
