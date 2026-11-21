import { randomUUID } from 'node:crypto';
import { RoomEvent } from '@livekit/rtc-node';
import { validateLesson } from './packages/rough-canvas/canvas.mjs';
import { CLOSE_TOPIC, DRAW_RPC, MAX_PAYLOAD, lessonSchema } from './packages/rough-canvas/contract.mjs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { llm } from '@livekit/agents';
import { getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { startPreview, windowScript } from './preview-excalidraw.mjs';
import { playWorkflowStep } from './workflow-playback.mjs';

export function buildWorkflow({ title, steps, connections }) {
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
  const position = (i) => ({ x: (i % 3) * 300, y: Math.floor(i / 3) * 200 + 80 });
  const elements = [{ type: 'cameraUpdate', x: -30, y: -30, width: Math.min(steps.length, 3) * 300, height: Math.ceil(steps.length / 3) * 200 + 130 },
    { type: 'text', id: 'title', x: 0, y: 0, text: title, fontSize: 28 }];
  steps.forEach((step, i) => elements.push({
    type: 'rectangle', id: 'step-' + i, ...position(i), width: 220, height: 100,
    backgroundColor: '#d0ebff', strokeColor: '#1971c2',
    label: { text: step, fontSize: 18 },
  }));
  connections.forEach((c, i) => {
    const a = position(c.from), b = position(c.to);
    elements.push({ type: 'arrow', id: 'edge-' + i, x: a.x + 110, y: a.y + 100,
      width: b.x - a.x, height: b.y - a.y - 100,
      points: [[0, 0], [b.x - a.x, b.y - a.y - 100]],
      startBinding: { elementId: 'step-' + c.from, fixedPoint: [0.5, 1] },
      endBinding: { elementId: 'step-' + c.to, fixedPoint: [0.5, 0] },
      endArrowhead: 'arrow', ...(c.label ? { label: { text: c.label } } : {}),
    });
  });
  return elements;
}

function roughWorkflow({ title, steps, narration, connections }) {
  const positions = steps.map((_, i) => ({
    x: 44 + (i % 4) * 238, y: 40 + Math.floor(i / 4) * 140, group: 'step-' + i,
  }));
  return {
    title: title.slice(0, 72),
    steps: steps.map((label, index) => {
      const node = positions[index];
      const marks = [
        { kind: 'rectangle', ...node, width: 192, height: 76, color: 'teal' },
        { kind: 'label', group: node.group, x: node.x + 96, y: node.y + 38,
          text: label.length <= 15 ? label : label.slice(0, 14) + '…' },
      ];
      for (const edge of connections) {
        if (Math.max(edge.from, edge.to) !== index) continue;
        const a = positions[edge.from], b = positions[edge.to];
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.min(96 / Math.abs(dx), 38 / Math.abs(dy));
        const x1 = Math.round(a.x + 96 + dx * t), y1 = Math.round(a.y + 38 + dy * t);
        const x2 = Math.round(b.x + 96 - dx * t), y2 = Math.round(b.y + 38 - dy * t);
        marks.push({ kind: 'arrow', from: a.group, to: b.group, x1, y1, x2, y2 });
        if (edge.label) marks.push({ kind: 'label', x: Math.round((x1 + x2) / 2),
          y: Math.round((y1 + y2) / 2) - 13, text: edge.label.slice(0, 52) });
      }
      return { narration: narration[index], marks };
    }),
  };
}

export function createWorkflowTools({ getAvatarAudio = () => undefined, room } = {}) {
  let active;
  const onData = (bytes, participant, _kind, topic) => {
    if (topic === CLOSE_TOPIC && bytes.byteLength <= 80 && active?.send &&
        participant?.identity === active.destination && new TextDecoder().decode(bytes) === active.id) close();
  };
  room?.on(RoomEvent.DataReceived, onData);

  function close() {
    const current = active;
    active = undefined;
    if (!current) return;
    current.controller.abort();
    current.child?.kill();
    current.preview?.server.closeAllConnections();
    current.preview?.server.close();
  }

  function interrupt() {
    if (!active || active.complete || active.controller.signal.aborted) return;
    if (active.send) {
      active.controller.abort();
      void active.send({ type: 'paused' }).catch(() => {});
      return;
    }
    if (!active.preview?.isReady()) {
      close();
      return;
    }
    active.controller.abort();
    active.preview.setStatus('Walkthrough interrupted', active.visibleElements);
  }

  async function narrate(run, args, elements, session) {
    const { signal } = run.controller;
    try {
      if (signal.aborted) return;
      const preview = await startPreview({ elements, title: args.title, narrated: true });
      if (signal.aborted) {
        preview.server.close();
        return;
      }
      run.preview = preview;
      const child = run.child = spawn(createRequire(import.meta.url)('electron'), [windowScript, preview.url], {
        env: getDefaultEnvironment(), stdio: 'ignore',
      });
      child.on('error', (error) => { run.windowError = error; });
      child.once('exit', () => { if (active === run) close(); });

      const readyDeadline = Date.now() + 20_000;
      while (!preview.isReady()) {
        if (run.windowError || Date.now() >= readyDeadline) throw new Error('The canvas did not initialize.');
        await delay(50, undefined, { signal });
      }

      const [camera, title] = elements;
      const nodes = elements.slice(2, 2 + args.steps.length);
      const arrows = elements.slice(2 + args.steps.length);
      for (const [index, line] of args.narration.entries()) {
        const played = await playWorkflowStep({
          session, avatarAudio: getAvatarAudio(), text: line, signal,
          reveal() {
            const visibleArrows = arrows.filter((_, i) => {
              const { from, to } = args.connections[i];
              return from <= index && to <= index;
            });
            run.visibleElements = [camera, title, ...nodes.slice(0, index + 1), ...visibleArrows];
            preview.reveal(run.visibleElements, index + 1, nodes.length);
          },
        });
        if (!played || signal.aborted) {
          if (active === run) interrupt();
          return;
        }
      }
      run.complete = true;
      preview.finish();
    } catch (error) {
      if (signal.aborted) return;
      const message = run.preview?.isReady()
        ? 'The walkthrough stopped because I couldn’t confirm narration playback.'
        : 'The workflow canvas couldn’t open.';
      run.complete = true;
      if (run.preview?.isReady()) run.preview.setStatus(message, run.visibleElements);
      else if (active === run) close();
      console.warn('Workflow walkthrough stopped:', error.message);
      try {
        session.say(message, { allowInterruptions: true });
      } catch (speechError) {
        console.warn('Could not announce the walkthrough error:', speechError.message);
      }
    }
  }
  async function narrateInSidebar(run, lesson, session) {
    const { signal } = run.controller;
    try {
      signal.throwIfAborted();
      await run.send({ type: 'begin', title: lesson.title, total: lesson.steps.length });
      for (const [index, step] of lesson.steps.entries()) {
        signal.throwIfAborted();
        let rendered;
        const played = await playWorkflowStep({
          session, avatarAudio: getAvatarAudio(), text: step.narration, signal,
          reveal() {
            rendered = run.send({ type: 'step', index, ...step });
            void rendered.catch(() => {});
          },
        });
        if (!played || signal.aborted) {
          if (active === run) interrupt();
          return;
        }
        await rendered;
      }
      signal.throwIfAborted();
      await run.send({ type: 'completed' });
      run.complete = true;
    } catch (error) {
      if (signal.aborted) return;
      run.complete = true;
      void run.send({ type: 'failed' }).catch(() => {});
      console.warn('Rough.js walkthrough stopped:', error.message);
      session.say('The canvas walkthrough could not finish.', { allowInterruptions: true });
    }
  }

  async function openSidebar(lesson, ctx, abortSignal) {
    if (!validateLesson(lesson)) throw new llm.ToolError('Use readable labels, valid canvas coordinates, and narration up to 230 characters per step.');
    await ctx.waitForPlayout();
    if (abortSignal.aborted || ctx.speechHandle.interrupted) return;
    const operators = [...room.remoteParticipants.values()].filter(({ identity }) => identity.startsWith('operator-'));
    if (operators.length !== 1 || !room.localParticipant) throw new llm.ToolError('The desktop canvas is unavailable.');
    if (active?.send) void active.send({ type: 'paused' }).catch(() => {});
    close();
    const id = randomUUID();
    const destination = operators[0].identity;
    const run = active = {
      id, destination, controller: new AbortController(),
      async send(message) {
        const payload = JSON.stringify({ ...message, id });
        if (Buffer.byteLength(payload) > MAX_PAYLOAD) throw new Error('Canvas message is too large.');
        const reply = await room.localParticipant.performRpc({
          method: DRAW_RPC, destinationIdentity: destination, payload, responseTimeout: 8000,
        });
        if (reply !== 'ok') throw new Error('Canvas response: ' + reply);
      },
    };
    setImmediate(() => { void narrateInSidebar(run, lesson, ctx.session); });
  }

  const draw = llm.tool({
    name: 'draw_workflow',
    description: 'Open the diagram canvas and present a narrated visual walkthrough. Supply short step labels, one spoken explanation per step, and directed connections (zero-based indices, with Yes/No labels for branches). Each step appears as its explanation starts. This tool handles the speech itself.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['title', 'steps', 'narration', 'connections'],
      properties: {
        title: { type: 'string', maxLength: 120 },
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
      if (room) return openSidebar(roughWorkflow(args), ctx, abortSignal);
      await ctx.waitForPlayout();
      if (abortSignal.aborted || ctx.speechHandle.interrupted) return;
      close();
      const run = active = { controller: new AbortController() };
      // Return no tool reply. This separate task owns the individual speech handles.
      setImmediate(() => { void narrate(run, args, elements, ctx.session); });
    },
  });
  const tools = [draw];
  if (room) tools.push(llm.tool({
    name: 'draw_lesson',
    description: 'Draw and narrate a diagram or chart with Rough.js. Use 1000×600 local coordinates. Give related marks a group ID, and attach arrows with from and to. Later steps can focus or move a prior group, then fit. Include marks or actions in every step. The tool handles narration.',
    parameters: lessonSchema,
    execute: (lesson, { ctx, abortSignal }) => openSidebar(lesson, ctx, abortSignal),
  }));
  tools.push(llm.tool({
    name: 'close_workflow_canvas', description: 'Close the canvas and return to the transcript.',
    async execute() {
      const run = active;
      close();
      await run?.send?.({ type: 'dismiss' }).catch(() => {});
      return 'Workflow canvas closed.';
    },
  }));
  return { tools, interrupt, close() { close(); room?.off(RoomEvent.DataReceived, onData); } };
}
