import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { cli, defineAgent, inference, ServerOptions, voice } from '@livekit/agents';
import { AvatarSession } from '@livekit/agents-plugin-bey';
import { LLM, STT as GatewaySTT, TTS as GatewayTTS } from '@livekit/agents-plugin-openai';
import { createDesktopTools, openRouterURL } from './desktop.mjs';
import { createDesktopActionGuard, desktopInstructions } from './desktop-harness.mjs';

const workerName = process.env.LIVEKIT_AGENT_NAME?.trim() || 'handbook-windows';
const envFile = '.env';
const fileSettings = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
const model = fileSettings.OPENROUTER_MODEL?.trim() || process.env.OPENROUTER_MODEL?.trim() || 'google/gemma-4-26b-a4b-it';
const reasoningEffort = fileSettings.REASONING_EFFORT?.trim() || process.env.REASONING_EFFORT?.trim() || 'none';
if (!['none', 'minimal', 'low', 'medium', 'high'].includes(reasoningEffort)) {
  throw new Error('REASONING_EFFORT must be none, minimal, low, medium, or high.');
}
const language = process.env.AGENT_LANGUAGE || 'en';
const avatarEnabled = process.env.ENABLE_AVATAR === '1';
const localDemo = process.env.LIVEKIT_LOCAL_DEMO === '1';
const diagnosticSpeech = localDemo && process.env.DEMO_SPEECH === 'openrouter';
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
    const apiKey = required('OPENROUTER_API_KEY');
    const gateway = { apiKey, baseURL: openRouterURL };
    const desktopGuard = createDesktopActionGuard();
    const session = new voice.AgentSession({
      maxToolSteps: 24,
      stt: diagnosticSpeech ? new GatewaySTT({
        ...gateway,
        model: process.env.OPENROUTER_STT_MODEL || 'openai/whisper-large-v3',
        language,
        useRealtime: false,
      }) : new inference.STT({ model: 'deepgram/nova-3', language }),
      llm: new LLM({ ...gateway, model, reasoningEffort, parallelToolCalls: false }),
      tts: diagnosticSpeech ? new GatewayTTS({
        ...gateway,
        model: process.env.OPENROUTER_TTS_MODEL || 'google/gemini-3.1-flash-tts-preview',
        voice: process.env.OPENROUTER_TTS_VOICE || 'Kore',
      }) : new inference.TTS({ model: 'cartesia/' + cartesiaModel, voice: cartesiaVoice, language }),
      ...(diagnosticSpeech && { turnHandling: { turnDetection: 'vad' } }),
      tools: [createDesktopTools({ apiKey, model, reasoningEffort, guard: desktopGuard })],
    });
    const agent = voice.Agent.create({
      instructions: desktopInstructions(language),
      onUserTurnCompleted() {
        desktopGuard.beginTurn();
      },
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
        ...(process.env.BEY_AVATAR_ID && { avatarId: process.env.BEY_AVATAR_ID }),
      });
      ctx.addShutdownCallback(() => avatar.aclose());
      await avatar.start(session, ctx.room);
    }
    await session.start({
      agent,
      room: ctx.room,
      ...(avatarEnabled && { outputOptions: { audioEnabled: false } }),
    });
  },
});

cli.runApp(new ServerOptions({
  agent: fileURLToPath(import.meta.url),
  agentName: workerName,
  // A local desktop demo has no other worker to take over during a CPU spike.
  ...(localDemo && {
    loadFunc: async () => 0,
    host: '127.0.0.1',
    port: 0,
  }),
}));
