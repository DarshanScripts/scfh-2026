import { fileURLToPath } from 'node:url';
import { cli, defineAgent, inference, ServerOptions, voice } from '@livekit/agents';
import { AvatarSession } from '@livekit/agents-plugin-bey';
import { LLM } from '@livekit/agents-plugin-anthropic';
import { anthropicSettings, createAnthropicClient } from './anthropic.mjs';
import { createDesktopTools } from './desktop.mjs';
import { createDesktopActionGuard, desktopInstructions } from './desktop-harness.mjs';
import { createWorkflowTools } from './workflow-tools.mjs';
import { listenForAvatarAudio } from './workflow-playback.mjs';
import { createOnboardingAnswers } from './onboarding-answer.mjs';

const workerName = process.env.LIVEKIT_AGENT_NAME?.trim() || 'handbook-windows';
const language = process.env.AGENT_LANGUAGE || 'en';
const avatarEnabled = process.env.ENABLE_AVATAR === '1';
const cartesiaModel = process.env.CARTESIA_TTS_MODEL?.trim() || 'sonic-3.6';
const cartesiaVoice = process.env.CARTESIA_VOICE_ID?.trim() || '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc';

function required(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error('Set ' + names.join(' or ') + ' in .env before starting the worker.');
}

export default defineAgent({
  entry: async (ctx) => {
    const settings = anthropicSettings();
    const { model } = settings;
    const client = await createAnthropicClient(settings);
    const desktopGuard = createDesktopActionGuard();
    const onboarding = createOnboardingAnswers(ctx.room, process.env.ONBOARDING_SERVICE_URL);
    let avatarAudio;
    const workflows = createWorkflowTools({ getAvatarAudio: () => avatarAudio?.signal });
    ctx.addShutdownCallback(() => workflows.close());
    const session = new voice.AgentSession({
      maxToolSteps: 24,
      stt: new inference.STT({ model: 'deepgram/nova-3', language }),
      llm: new LLM({ client, model, parallelToolCalls: false }),
      tts: new inference.TTS({ model: 'cartesia/' + cartesiaModel, voice: cartesiaVoice, language }),
      tools: [createDesktopTools({ client, model, guard: desktopGuard }), onboarding.tool, ...workflows.tools],
    });
    async function beginUserTurn() {
      workflows.interrupt();
      desktopGuard.beginTurn();
      await onboarding.beginTurn();
    }
    const agent = voice.Agent.create({
      instructions: desktopInstructions(language, {
        onboardingFolder: fileURLToPath(new URL('./packages/onboarding/src/onboarding/fixtures/', import.meta.url)),
      }),
      onUserTurnCompleted: beginUserTurn,
      async *llmNode(ctx, chatCtx, toolCtx, settings) {
        const stream = await voice.Agent.default.llmNode(ctx.agent, chatCtx, toolCtx, settings);
        if (!stream) return;

        // Hold speech until we know whether this model turn is issuing tools.
        let reply = '';
        let usedTools = false;
        for await (const chunk of stream) {
          if (typeof chunk === 'string') {
            if (!usedTools) reply += chunk;
            continue;
          }
          if (chunk.delta?.toolCalls?.length) {
            usedTools = true;
            reply = '';
          }
          if (chunk.delta?.content) {
            const { content, ...delta } = chunk.delta;
            if (!usedTools) reply += content;
            yield { ...chunk, delta };
          } else {
            yield chunk;
          }
        }
        if (!usedTools && reply.trim()) yield reply;
      },
    });

    await ctx.connect();
    if (avatarEnabled) {
      const avatar = new AvatarSession({
        apiKey: required('BEYOND_PRESENCE_API_KEY', 'BEY_API_KEY'),
        avatarId: process.env.BEY_AVATAR_ID || process.env.BEYOND_PRESENCE_AVATAR_ID,
      });
      ctx.addShutdownCallback(() => avatar.aclose());
      avatarAudio = listenForAvatarAudio(ctx.room, avatar.avatarIdentity);
      ctx.addShutdownCallback(() => avatarAudio.close());
      await avatar.start(session, ctx.room);
    }
    await session.start({
      agent,
      room: ctx.room,
      inputOptions: {
        async textInputCallback(activeSession, event) {
          activeSession.interrupt();
          await beginUserTurn();
          activeSession.generateReply({ userInput: event.text });
        },
      },
      ...(avatarEnabled && { outputOptions: { audioEnabled: false } }),
    });
  },
});

cli.runApp(new ServerOptions({
  agent: fileURLToPath(import.meta.url),
  agentName: workerName,
}));
