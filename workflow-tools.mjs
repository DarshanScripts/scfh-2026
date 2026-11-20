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

export function createWorkflowTools({ getAvatarAudio = () => undefined } = {}) {
  let active;
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
  const draw = llm.tool({
    name: 'draw_workflow',
    description: 'Open Excalidraw and present a narrated visual walkthrough. Supply short step labels, one spoken explanation per step, and directed connections (zero-based indices, with Yes/No labels for branches). Each step appears as its explanation starts. This tool handles the speech itself.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['title', 'steps', 'narration', 'connections'],
      properties: {
        title: { type: 'string', maxLength: 120 },
        steps: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'string', maxLength: 120 } },
        narration: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'string', maxLength: 280 },
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
          args.narration.some((line) => typeof line !== 'string' || !line.trim() || line.length > 280)) {
        throw new llm.ToolError('Provide one short spoken explanation for every step.');
      }
      await ctx.waitForPlayout();
      if (abortSignal.aborted || ctx.speechHandle.interrupted) return;
      close();
      const run = active = { controller: new AbortController() };
      // Return no tool reply. This separate task owns the individual speech handles.
      setImmediate(() => { void narrate(run, args, elements, ctx.session); });
    },
  });
  return { tools: [draw, llm.tool({ name: 'close_workflow_canvas', description: 'Close the voice-created Excalidraw canvas when requested.',
    execute: async () => { close(); return 'Workflow canvas closed.'; } })], close, interrupt };
}
