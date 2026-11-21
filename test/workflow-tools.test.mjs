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
import { createOnboardingAnswers } from '../onboarding-answer.mjs';
import { startOnboardingService } from '../onboarding-service.mjs';
import { workflowToLesson } from '../workflow-rough-scene.mjs';

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

test('a return arrow uses the gutter and swimlane steps use their assigned columns', () => {
  const scene = buildWorkflow({ ...workflow, layout: 'swimlane', lanes: ['Service desk', 'Maintenance'],
    stepLanes: [0, 0, 0, 1], connections: [...workflow.connections, { from: 2, to: 1, label: 'Details received' }] });
  const cards = scene.filter(({ id }) => id?.startsWith('step-'));
  assert.equal(cards[0].x, cards[1].x);
  assert(cards[3].x > cards[0].x);
  assert(scene.some(element => element.id === 'lane-1' && element.text === 'Maintenance'));
  for (const arrow of scene.filter(element => element.type === 'arrow')) {
    const points = arrow.points.map(([dx, dy]) => [arrow.x + dx, arrow.y + dy]);
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i - 1];
      const [x2, y2] = points[i];
      assert(x1 === x2 || y1 === y2, 'Connectors travel horizontally or vertically');
      for (const card of cards) {
        const insideX = Math.max(x1, x2) > card.x && Math.min(x1, x2) < card.x + card.width;
        const insideY = Math.max(y1, y2) > card.y && Math.min(y1, y2) < card.y + card.height;
        assert(!(insideX && insideY), `${arrow.id} enters ${card.id}`);
      }
    }
  }
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

test('the documented tool speaks all seven approved steps in order', async () => {
  const service = await startOnboardingService();
  const onboarding = createOnboardingAnswers({ localParticipant: { sendText: async () => {} } }, service.url);
  const tools = createWorkflowTools({ getWalkthrough: onboarding.getWalkthrough });
  const session = fakeSession();
  const query = 'Walk me through a maintenance request from intake to handoff.';
  const signal = new AbortController().signal;
  try {
    await onboarding.beginTurn();
    const workflow = await onboarding.getWalkthrough(query, signal);
    assert.equal(workflow.outcome, 'ready');
    assert.equal(workflow.steps.length, 7);
    const { workflowScene } = await import('../packages/onboarding/dist/diagram.js');
    const elements = workflowScene(workflow, workflow.steps.length);
    const links = workflow.steps.flatMap(step => step.edges.map(edge => ({ from: step.stepId, to: edge.toStepId,
      arrow: elements.find(element => element.id === `${step.stepId}-to-${edge.toStepId}`) })));
    const lesson = workflowToLesson({ title: workflow.title, narration: workflow.steps.map(step => step.narration),
      elements, nodes: workflow.steps.map(step => step.stepId), links });
    for (const [i, step] of lesson.steps.entries()) {
      const label = step.marks.filter(mark => mark.kind === 'label' && mark.group === `step-${i}`).map(mark => mark.text).join(' ');
      assert.equal(label, workflow.steps[i].label);
    }
    const tool = tools.tools.find(({ name }) => name === 'get_onboarding_walkthrough');
    await tool.execute({ query }, {
      ctx: { session, speechHandle: { interrupted: false }, waitForPlayout: async () => {} }, abortSignal: signal,
    });
    for (const [index, step] of workflow.steps.entries()) {
      await until(() => session.calls.length > index);
      const call = session.calls[index];
      assert.equal(call.text, step.narration);
      call.start();
      await delay(30);
      assert.equal(session.calls.length, index + 1);
      call.finish();
    }
  } finally {
    tools.close();
    service.close();
  }
});
