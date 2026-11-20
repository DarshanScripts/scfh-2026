import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { llm } from '@livekit/agents';

const require = createRequire(new URL('./packages/onboarding/package.json', import.meta.url));
const encoder = new TextEncoder();
const topic = 'scfh.onboarding.v1';
let validate;

async function answerValidator(base) {
  if (!validate) {
    const response = await fetch(new URL('/schema/answer', base), { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('Could not load the answer schema.');
    const Ajv = require('ajv');
    const ajv = new Ajv({ allowUnionTypes: true });
    require('ajv-formats')(ajv);
    ajv.addKeyword('discriminator');
    validate = ajv.compile(await response.json());
  }
  return validate;
}

export function createOnboardingAnswers(room, base) {
  let turnId;
  let pending;

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
    description: 'Answer Facilities Service Desk onboarding questions from the approved demo documents and queue. The answer is spoken and shown with clickable citations. Use the current user question in their own words.',
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
        if (!base) throw new Error('The onboarding service is unavailable.');
        const isAnswer = await answerValidator(base);
        const response = await fetch(new URL('/api/question', base), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schemaVersion: 1, query: query.trim(), turnId: id, requestId }),
          signal: AbortSignal.any([abortSignal, AbortSignal.timeout(8000)]),
        });
        if (!response.ok) throw new Error('The onboarding service could not answer.');
        const answer = await response.json();
        if (!isAnswer(answer) || answer.turnId !== id || answer.requestId !== requestId) throw new Error('Invalid answer.');
        if (!current()) return;
        await publish({ type: 'answer', turnId: id, requestId, answer });
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
  return { beginTurn, tool };
}
