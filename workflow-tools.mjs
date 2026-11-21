import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { RoomEvent } from '@livekit/rtc-node';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { llm } from '@livekit/agents';
import { getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { startRoughPreview, windowScript } from './preview-roughjs.mjs';
import { playWorkflowStep } from './workflow-playback.mjs';
import { diagramKinds, diagramLayouts, layoutScene } from './packages/onboarding/browser/scene-layout.mjs';
import { CLOSE_TOPIC, DRAW_RPC, MAX_PAYLOAD, lessonSchema } from './packages/rough-canvas/contract.mjs';
import { validateLesson } from './packages/rough-canvas/canvas.mjs';
import { workflowToLesson } from './workflow-rough-scene.mjs';

export function buildWorkflow({ title, steps, connections, layout = 'flowchart', kinds, lanes = [], stepLanes }) {
  if (typeof title !== 'string' || !title.trim() || title.length > 120 ||
      !Array.isArray(steps) || steps.length < 1 || steps.length > 16 ||
      steps.some((s) => typeof s !== 'string' || !s.trim() || s.length > 120)) {
    throw new llm.ToolError('Provide a title and 1–16 short workflow step labels, each at most 120 characters.');
  }
  if (!Array.isArray(connections) || connections.length > 32 || connections.some((c) =>
    !c || !Number.isInteger(c.from) || !Number.isInteger(c.to) || c.from < 0 || c.to < 0 ||
    c.from >= steps.length || c.to >= steps.length || c.from === c.to ||
    typeof c.label !== 'string' || c.label.length > 60)) {
    throw new llm.ToolError('Connections need distinct zero-based from/to step indices and a short label.');
  }
  if (!diagramLayouts.includes(layout) || (kinds && (!Array.isArray(kinds) || kinds.length !== steps.length ||
      kinds.some(kind => !diagramKinds.includes(kind))))) throw new llm.ToolError('Use a supported layout and one valid kind for each step.');
  if (layout === 'swimlane' && (!Array.isArray(lanes) || lanes.length < 2 || lanes.length > 4 ||
      lanes.some(lane => typeof lane !== 'string' || !lane.trim() || lane.length > 40) ||
      !Array.isArray(stepLanes) || stepLanes.length !== steps.length ||
      stepLanes.some(lane => !Number.isInteger(lane) || lane < 0 || lane >= lanes.length))) {
    throw new llm.ToolError('Provide two to four lane names and one valid lane index per step.');
  }
  const nodes = steps.map((label, i) => {
    const outgoing = connections.filter(edge => edge.from === i);
    const incoming = connections.filter(edge => edge.to === i);
    const isException = !outgoing.length && incoming.some(edge => /^(no|missing|match|stop)$/i.test(edge.label));
    const kind = kinds?.[i] ?? (outgoing.length > 1 ? 'decision' : isException ? 'exception' : layout === 'timeline' ? 'milestone' : 'action');
    return { id: 'step-' + i, label, kind, lane: stepLanes?.[i] };
  });
  const links = connections.map((edge, i) => ({ ...edge, id: 'edge-' + i, from: nodes[edge.from].id, to: nodes[edge.to].id }));
  const { cards, arrows, headers } = layoutScene(nodes, links, { layout, lanes: layout === 'swimlane' ? lanes : [] });
  const heading = { type: 'text', id: 'title', x: 64, y: 0, text: title, fontFamily: 2, fontSize: 27, strokeColor: '#233c50' };
  return [cameraFor([heading, ...cards, ...arrows, ...headers]), heading, ...cards, ...arrows, ...headers];
}

function cameraFor(scene) {
  const right = Math.max(450, ...scene.map(element => element.points
    ? element.x + Math.max(...element.points.map(point => point[0]))
    : element.x + (element.width ?? (element.type === 'text' ? element.text.length * element.fontSize * 0.55 : 0))));
  const bottom = Math.max(250, ...scene.map(element => element.points
    ? element.y + Math.max(...element.points.map(point => point[1])) : element.y + (element.height ?? 0)));
  const width = Math.max(right + 50, (bottom + 65) * 4 / 3);
  return { type: 'cameraUpdate', x: (right + 64 - width) / 2, y: -25, width, height: width * 3 / 4 };
}

export function createWorkflowTools({ room, getAvatarAudio = () => undefined, getWalkthrough, onWorkflowStep, harbour = false } = {}) {
  let active;
  const onData = (bytes, participant, _kind, topic) => {
    if (topic === CLOSE_TOPIC && bytes.byteLength <= 80 && active?.destination === participant?.identity &&
        new TextDecoder().decode(bytes) === active.id) close();
  };
  room?.on(RoomEvent.DataReceived, onData);
  function close() {
    const current = active;
    active = undefined;
    if (!current) return;
    current.controller.abort();
    current.child?.kill();
    current.preview?.close();
  }

  function interrupt() {
    if (!active || active.complete || active.controller.signal.aborted) return;
    if (!active.begun || !active.preview?.isReady()) {
      close();
      return;
    }
    active.controller.abort();
    if (active.playback) active.playback.accept(active.playback.event('cancelled'));
    void active.preview.send({ type: 'paused' }).catch(() => {});
  }

  function sidebarPreview(run) {
    const operators = [...room.remoteParticipants.values()].filter(({ identity }) => identity.startsWith('operator-'));
    if (operators.length !== 1 || !room.localParticipant) throw new Error('The desktop sidebar is unavailable.');
    run.destination = operators[0].identity;
    let closed = false;
    async function send(message, signal) {
      signal?.throwIfAborted();
      const payload = JSON.stringify({ ...message, id: run.id });
      if (Buffer.byteLength(payload) > MAX_PAYLOAD) throw new Error('Canvas message is too large.');
      const result = await room.localParticipant.performRpc({
        method: DRAW_RPC, destinationIdentity: run.destination, payload, responseTimeout: 8000,
      });
      if (result !== 'ok') throw new Error('The sidebar rejected the canvas update.');
    }
    return {
      isReady: () => !closed,
      send,
      close() {
        if (closed) return;
        closed = true;
        void send({ type: 'dismiss' }).catch(() => {});
      },
    };
  }

  async function narrate(run, lesson, session) {
    const { signal } = run.controller;
    try {
      if (signal.aborted) return;
      const fallbackSteps = run.playback ? lesson.steps.map(step => step.narration) : undefined;
      const preview = room ? sidebarPreview(run) : await startRoughPreview({ id: run.id, fallbackSteps,
        onClose: () => { if (active === run) close(); } });
      if (signal.aborted) {
        preview.close();
        return;
      }
      run.preview = preview;
      if (!room) {
        const child = run.child = spawn(createRequire(import.meta.url)('electron'), [windowScript, preview.url], {
          env: getDefaultEnvironment(), stdio: 'ignore',
        });
        child.on('error', (error) => { run.windowError = error; });
        child.once('exit', () => { if (active === run) close(); });
      }

      const readyDeadline = Date.now() + 20_000;
      while (!preview.isReady()) {
        if (run.windowError || Date.now() >= readyDeadline) throw new Error('The canvas did not initialize.');
        await delay(50, undefined, { signal });
      }
      await preview.send({ type: 'begin', title: lesson.title, total: lesson.steps.length }, signal);
      run.begun = true;
      if (run.playback && !run.playback.accept(run.playback.event('ready'))) return;

      for (const [index, step] of lesson.steps.entries()) {
        let drawing;
        const played = await playWorkflowStep({
          session, avatarAudio: getAvatarAudio(), text: step.narration, signal,
          reveal() {
            if (run.playback && !run.playback.accept(run.playback.event('stepStarted', index))) throw new Error('Unexpected walkthrough step.');
            if (run.playback) onWorkflowStep?.(run.playback.workflow.steps[index].stepId, run.playback.workflow.workflowId);
            drawing = preview.send({ type: 'step', index, narration: step.narration, marks: step.marks, actions: step.actions }, signal);
            void drawing.catch(() => {});
          },
        });
        if (!played || signal.aborted) {
          if (active === run) interrupt();
          return;
        }
        await drawing;
        if (run.playback && !run.playback.accept(run.playback.event('stepFinished', index))) return;
      }
      if (run.playback && !run.playback.accept(run.playback.event('completed'))) return;
      await preview.send({ type: 'completed' }, signal);
      run.complete = true;
    } catch (error) {
      if (signal.aborted) return;
      const message = run.begun
        ? 'The walkthrough stopped because the next step couldn’t be played.'
        : 'The workflow canvas couldn’t open.';
      run.complete = true;
      if (run.playback) run.playback.accept(run.playback.event('failed'));
      if (run.begun && run.preview?.isReady()) void run.preview.send({ type: 'failed' }).catch(() => {});
      else if (active === run) close();
      console.warn('Workflow walkthrough stopped:', error.message);
      try {
        session.say(message, { allowInterruptions: true });
      } catch (speechError) {
        console.warn('Could not announce the walkthrough error:', speechError.message);
      }
    }
  }

  async function start(lesson, ctx, abortSignal, playback) {
    if (!validateLesson(lesson)) throw new llm.ToolError('The diagram plan is invalid. Use short narration, in-bounds marks, and actions on previously drawn groups.');
    await ctx.waitForPlayout();
    if (abortSignal.aborted || ctx.speechHandle.interrupted) return;
    close();
    const run = active = { id: playback?.runId ?? randomUUID(), controller: new AbortController(), playback };
    // The separate task owns the individual speech handles. Returning no tool output suppresses a second reply.
    setImmediate(() => { void narrate(run, lesson, ctx.session); });
  }
  const draw = llm.tool({
    name: 'draw_workflow',
    description: 'Open the Rough.js Workflow Canvas for a narrated flowchart, timeline, swimlane, or hierarchy. Supply short labels, one explanation per step, and directed zero-based connections. This tool handles speech and drawing.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['title', 'steps', 'narration', 'connections'],
      properties: {
        title: { type: 'string', maxLength: 120 },
        layout: { type: 'string', enum: diagramLayouts },
        kinds: { type: 'array', maxItems: 16, items: { type: 'string', enum: diagramKinds } },
        lanes: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 40 } },
        stepLanes: { type: 'array', maxItems: 16, items: { type: 'integer', minimum: 0, maximum: 3 } },
        steps: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'string', maxLength: 120 } },
        narration: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'string', maxLength: 230 },
          description: 'One short spoken explanation per step, in the same order as steps.' },
        connections: { type: 'array', maxItems: 32, items: {
          type: 'object', additionalProperties: false, required: ['from', 'to', 'label'],
          properties: { from: { type: 'integer' }, to: { type: 'integer' }, label: { type: 'string', maxLength: 60 } },
        } },
      },
    },
    execute: async (args, { ctx, abortSignal }) => {
      const elements = buildWorkflow(args);
      if (!Array.isArray(args.narration) || args.narration.length !== args.steps.length ||
          args.narration.some((line) => typeof line !== 'string' || !line.trim() || line.length > 230)) {
        throw new llm.ToolError('Provide one short spoken explanation for every step.');
      }
      const nodes = args.steps.map((_, i) => `step-${i}`);
      const links = args.connections.map(({ from, to }, i) => ({ from: nodes[from], to: nodes[to],
        arrow: elements.find(element => element.id === `edge-${i}`) }));
      let lesson;
      try { lesson = workflowToLesson({ ...args, elements, nodes, links }); }
      catch (error) { throw new llm.ToolError(error.message); }
      await start(lesson, ctx, abortSignal);
    },
  });
  const documented = llm.tool({
    name: 'get_onboarding_walkthrough',
    description: harbour
      ? 'Narrate the sourced Hildesheim Harbour workflow, or one named stage such as funding, on the Rough.js canvas. Pass the user wording.'
      : 'Narrate the approved Facilities maintenance intake workflow on the Rough.js canvas. Use the user’s wording. This tool follows the documented steps and branches.',
    parameters: { type: 'object', additionalProperties: false, required: ['query'],
      properties: { query: { type: 'string', maxLength: 600 } } },
    execute: async ({ query }, { ctx, abortSignal }) => {
      if (typeof query !== 'string' || !query.trim() || query.length > 600) throw new llm.ToolError('Use a question of 1–600 characters.');
      try {
        const workflow = await getWalkthrough(query, abortSignal);
        if (!workflow || abortSignal.aborted || ctx.speechHandle.interrupted) return;
        if (workflow.outcome === 'insufficient') {
          ctx.session.say(workflow.text, { allowInterruptions: true });
          return;
        }
        const { workflowScene, PlaybackRun } = await import('./packages/onboarding/dist/diagram.js');
        if (abortSignal.aborted || ctx.speechHandle.interrupted) return;
        const elements = workflowScene(workflow, workflow.steps.length);
        const nodes = workflow.steps.map(step => step.stepId);
        const links = workflow.steps.flatMap(step => step.edges.map(edge => ({ from: step.stepId, to: edge.toStepId,
          arrow: elements.find(element => element.id === `${step.stepId}-to-${edge.toStepId}`) })));
        const lesson = workflowToLesson({ title: workflow.title, narration: workflow.steps.map(step => step.narration), elements, nodes, links });
        if (lesson.steps.length !== workflow.steps.length) throw new Error('The approved walkthrough does not fit the canvas.');
        await start(lesson, ctx, abortSignal, new PlaybackRun(workflow));
      } catch {
        if (!abortSignal.aborted && !ctx.speechHandle.interrupted) {
          ctx.session.say('The documented walkthrough is unavailable.', { allowInterruptions: true });
        }
      }
    },
  });
  const sketch = llm.tool({
    name: 'draw_canvas',
    description: 'Draw a narrated chart or free-form illustration on the Rough.js canvas, including positionable shapes, curves, and connected objects. Use focus, move, or fit for camera and object animation. Layout is 1000 by 600. Give objects stable groups and connect only visible groups using from/to.',
    parameters: lessonSchema,
    execute: async (lesson, { ctx, abortSignal }) => start(lesson, ctx, abortSignal),
  });
  return { tools: [draw, llm.tool({ name: 'close_workflow_canvas', description: 'Close the voice-created workflow canvas when requested.',
    execute: async () => { close(); return 'Workflow canvas closed.'; } }), sketch, ...(getWalkthrough ? [documented] : [])],
    close() { close(); room?.off(RoomEvent.DataReceived, onData); }, interrupt };
}
