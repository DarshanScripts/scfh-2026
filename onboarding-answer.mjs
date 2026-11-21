import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { llm } from '@livekit/agents';

const require = createRequire(new URL('./packages/onboarding/package.json', import.meta.url));
const encoder = new TextEncoder();
const topic = 'scfh.onboarding.v1';
const validators = new Map();

async function validateResult(base, kind) {
  if (!validators.has(kind)) {
    const response = await fetch(new URL('/schema/' + kind, base), { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('Could not load the onboarding schema.');
    const Ajv = require('ajv');
    const ajv = new Ajv({ allowUnionTypes: true });
    require('ajv-formats')(ajv);
    ajv.addKeyword('discriminator');
    validators.set(kind, ajv.compile(await response.json()));
  }
  return validators.get(kind);
}

async function fetchResult(base, kind, route, query, turnId, requestId, signal, context) {
  if (!base) throw new Error('The onboarding service is unavailable.');
  const validate = await validateResult(base, kind);
  const response = await fetch(new URL(route, base), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schemaVersion: 1, query: query.trim(), turnId, requestId, ...(context && { context }) }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(context ? 95_000 : 45_000)]),
  });
  if (!response.ok) throw new Error('The onboarding service could not complete the request.');
  const result = await response.json();
  if (!validate(result) || result.turnId !== turnId || result.requestId !== requestId) throw new Error('Invalid onboarding response.');
  return result;
}

export function createOnboardingAnswers(room, base, { harbour = false } = {}) {
  let turnId;
  let pending;
  let workflowStepId;
  let previousQuery;

  const context = () => harbour ? { workflowStepId, previousQuery } : undefined;
  function onWorkflowStep(stepId, workflowId) {
    if (!harbour) return;
    if (workflowId === 'hildesheim-harbour-funding') workflowStepId = 'financial-feasibility';
    else if (workflowId === 'hildesheim-harbour') workflowStepId = stepId;
  }

  async function publish(event) {
    const message = JSON.stringify({ schemaVersion: 1, ...event });
    if (encoder.encode(message).length > 14_000) throw new Error('The answer exceeds the room message limit.');
    await room.localParticipant.sendText(message, { topic });
  }

  async function beginTurn() {
    pending = undefined;
    turnId = randomUUID();
    if (base) await publish({ type: 'turn', turnId }).catch(() => {});
  }

  const tool = llm.tool({
    name: 'answer_onboarding_question',
    description: harbour
      ? 'Answer Hildesheim Harbour questions and contextual follow-ups from the original budget and council records with citations. Pass the current user question verbatim; the service receives workflow context.'
      : 'Answer Facilities Service Desk onboarding questions from the approved demo documents and queue. The answer is spoken and shown with clickable citations. Use the current user question in their own words.',
    parameters: { type: 'object', additionalProperties: false, required: ['query'],
      properties: { query: { type: 'string', maxLength: 600 } } },
    async execute({ query }, { ctx, abortSignal }) {
      if (typeof query !== 'string' || !query.trim() || query.length > 600) throw new llm.ToolError('Use a question of 1–600 characters.');
      const id = turnId;
      const requestId = pending = randomUUID();
      const current = () => pending === requestId && turnId === id && !abortSignal.aborted && !ctx.speechHandle.interrupted;
      if (!id || !current()) return;
      let text;
      try {
        const answer = await fetchResult(base, 'answer', '/api/question', query, id, requestId, abortSignal, context());
        if (!current()) return;
        await publish({ type: 'answer', turnId: id, requestId, answer });
        if (harbour && answer.outcome !== 'insufficient') previousQuery = query.trim();
        text = answer.text;
      } catch {
        if (!current()) return;
        text = 'The onboarding service could not complete this request.';
        if (base) await publish({ type: 'error', turnId: id, requestId }).catch(() => {});
      }
      if (current()) ctx.session.say(text, { allowInterruptions: true });
      // Undefined suppresses the automatic model reply after this speech.
    },
  });
  async function getWalkthrough(query, signal) {
    const id = turnId;
    if (!id || signal.aborted) return;
    const requestId = randomUUID();
    const result = await fetchResult(base, 'walkthrough', '/api/walkthrough', query, id, requestId, signal, context());
    if (turnId !== id || signal.aborted) return;
    if (harbour && result.outcome === 'ready') {
      const claims = result.steps.map(step => ({
        claimId: step.stepId, text: step.narration, passageIds: step.passageIds,
      }));
      const answer = { schemaVersion: 1, requestId, turnId: id, outcome: 'answered',
        text: claims.map(claim => claim.text).join(' '), claims, citations: result.citations };
      // The original walkthrough stays cached by this request ID for citation resolution.
      await publish({ type: 'answer', turnId: id, requestId, answer }).catch(() => {});
      if (turnId !== id || signal.aborted) return;
      previousQuery = query.trim();
    }
    return result;
  }
  return { beginTurn, tool, getWalkthrough, onWorkflowStep };
}
