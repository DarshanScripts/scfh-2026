import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { cli, defineAgent, inference, ServerOptions, voice } from '@livekit/agents';
import { AvatarSession } from '@livekit/agents-plugin-bey';
import { LLM } from '@livekit/agents-plugin-anthropic';
import { anthropicSettings, createAnthropicClient } from './anthropic.mjs';
import { createDesktopTools } from './desktop.mjs';
import { createDesktopActionGuard, desktopInstructions } from './desktop-harness.mjs';
import { createWorkflowTools } from './workflow-tools.mjs';
import { listenForAvatarAudio } from './workflow-playback.mjs';
import { createOnboardingAnswers } from './onboarding-answer.mjs';
import { avatarModeAttribute, voiceFallback } from './avatar-mode.mjs';
import { DESKTOP_CONTROL_RPC } from './desktop-control-rpc.mjs';

const workerName = process.env.LIVEKIT_AGENT_NAME?.trim() || 'handbook-windows';
const language = process.env.AGENT_LANGUAGE || 'en';
const avatarEnabled = process.env.ENABLE_AVATAR === '1';
const cartesiaModel = process.env.CARTESIA_TTS_MODEL?.trim() || 'sonic-3.6';
const cartesiaVoice = process.env.CARTESIA_VOICE_ID?.trim() || '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc';

export default defineAgent({
  entry: async (ctx) => {
    const settings = anthropicSettings();
    const { model } = settings;
    const client = await createAnthropicClient(settings);
    let desktopTurn;
    async function sendDesktopState(message) {
      const operator = [...ctx.room.remoteParticipants.values()].find(({ identity }) => identity.startsWith('operator-'));
      if (!operator) return;
      const reply = await ctx.room.localParticipant.performRpc({
        method: DESKTOP_CONTROL_RPC,
        destinationIdentity: operator.identity,
        payload: JSON.stringify(message),
        responseTimeout: 3000,
      });
      if (reply !== 'ok') throw new Error('The voice workspace rejected the desktop state change.');
    }
    const desktopGuard = createDesktopActionGuard({
      async setDesktopActive(active) {
        if (!active) return sendDesktopState({ type: 'stop' });
        const turn = desktopTurn;
        await sendDesktopState({ type: 'start', id: turn?.id, request: turn?.request ?? '' });
        if (turn) turn.usedDesktop = true;
      },
    });
    const onboarding = createOnboardingAnswers(ctx.room, process.env.ONBOARDING_SERVICE_URL);
    let avatarAudio;
    const workflows = createWorkflowTools({ room: ctx.room, getAvatarAudio: () => avatarAudio?.signal, getWalkthrough: onboarding.getWalkthrough });
    ctx.addShutdownCallback(() => workflows.close());
    ctx.addShutdownCallback(() => desktopGuard.finish());
    const session = new voice.AgentSession({
      maxToolSteps: 24,
      stt: new inference.STT({ model: 'deepgram/nova-3', language }),
      llm: new LLM({ client, model, parallelToolCalls: false }),
      tts: new inference.TTS({ model: 'cartesia/' + cartesiaModel, voice: cartesiaVoice, language }),
      tools: [createDesktopTools({ client, model, guard: desktopGuard }), onboarding.tool, ...workflows.tools],
    });
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, ({ newState }) => {
      if (newState === 'listening' || newState === 'speaking') void desktopGuard.finish();
    });
    async function beginUserTurn(request) {
      workflows.interrupt();
      desktopGuard.beginTurn();
      desktopTurn = { id: randomUUID(), request: request?.trim().slice(0, 1000) || '' };
      await onboarding.beginTurn();
    }
    const agent = voice.Agent.create({
      instructions: desktopInstructions(language, {
        onboardingFolder: fileURLToPath(new URL('./packages/onboarding/src/onboarding/fixtures/', import.meta.url)),
      }),
      onUserTurnCompleted: (_chat, message) => beginUserTurn(message.textContent),
      async *llmNode(ctx, chatCtx, toolCtx, settings) {
        const current = desktopTurn;
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
        if (!usedTools) {
          await desktopGuard.finish();
          if (current === desktopTurn && current?.usedDesktop && reply.trim()) {
            void sendDesktopState({ type: 'result', id: current.id, text: reply.trim().slice(0, 1000) }).catch(() => {});
          }
          if (reply.trim()) yield reply;
        }
      },
    });

    await ctx.connect();
    if (avatarEnabled) {
      // A future Anam adapter belongs here and can publish to the same room.
      const apiKey = process.env.BEYOND_PRESENCE_API_KEY?.trim() || process.env.BEY_API_KEY?.trim();
      let avatar;
      try {
        if (!apiKey) throw new Error('Beyond Presence key is missing.');
        avatar = new AvatarSession({
          apiKey,
          avatarId: process.env.BEY_AVATAR_ID || process.env.BEYOND_PRESENCE_AVATAR_ID,
          connOptions: { maxRetry: 2, retryIntervalMs: 1_000, timeoutMs: 6_000 },
        });
        await avatar.start(session, ctx.room);
      } catch {
        await avatar?.aclose().catch(() => {});
        avatar = undefined;
        console.warn('Beyond Presence did not start. Continuing with voice only.');
        await ctx.room.localParticipant.setAttributes({ [avatarModeAttribute]: voiceFallback });
      }
      if (avatar) {
        avatarAudio = listenForAvatarAudio(ctx.room, avatar.avatarIdentity);
        ctx.addShutdownCallback(() => avatarAudio.close());
      }
    }
    await session.start({
      agent,
      room: ctx.room,
      inputOptions: {
        async textInputCallback(activeSession, event) {
          activeSession.interrupt();
          await beginUserTurn(event.text);
          activeSession.generateReply({ userInput: event.text });
        },
      },
      ...(avatarAudio && { outputOptions: { audioEnabled: false } }),
    });
  },
});

cli.runApp(new ServerOptions({
  agent: fileURLToPath(import.meta.url),
  agentName: workerName,
  ...(process.env.SCFH_WORKER_HEALTH_PORT && { host: '127.0.0.1', port: Number(process.env.SCFH_WORKER_HEALTH_PORT) }),
}));
