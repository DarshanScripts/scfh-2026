import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { inference, initializeLogger } from '@livekit/agents';
import {
  AudioFrame, AudioSource, AudioStream, LocalAudioTrack,
  Room, RoomEvent, TrackKind, TrackSource, dispose,
} from '@livekit/rtc-node';
import { avatarModeAttribute, voiceFallback } from '../avatar-mode.mjs';
import { DESKTOP_CONTROL_RPC } from '../desktop-control-rpc.mjs';
import { DRAW_RPC } from '../packages/rough-canvas/contract.mjs';
import { validateStep } from '../packages/rough-canvas/canvas.mjs';

assert.equal(process.platform, 'win32', 'Run the native voice smoke test on Windows.');
const base = 'http://127.0.0.1:' + Number(process.env.DEMO_PORT || 4321);
initializeLogger({ level: 'error' });
const root = resolve('.hcu');
await mkdir(root, { recursive: true });
const scratch = await mkdtemp(resolve(root, 'voice-test-'));
const resultPath = resolve(scratch, 'clicked.txt');
const marker = 'voice action verified';
const title = 'SCFH Voice Check';
const language = process.env.AGENT_LANGUAGE || 'en';
const walkthrough = process.argv.includes('--walkthrough');
const harbourWalkthrough = walkthrough && process.env.ONBOARDING_KNOWLEDGE === 'harbour';
const qa = process.argv.includes('--qa');
const requireAvatar = process.argv.includes('--require-avatar');
const text = harbourWalkthrough ? 'Walk me through the funding stage of the Hildesheim harbour project.'
  : walkthrough ? 'Walk me through a maintenance request from intake to handoff.'
  : qa ? 'A maintenance ticket has no owner. When do I follow up, and who do I tell?'
    : language === 'de' ? 'Klicke im Fenster SCFH Voice Check auf die Schaltfläche.'
      : 'In the SCFH Voice Check window, click the button labeled Confirm desktop check.';
const rate = 24000;
const fixtureTTS = new inference.TTS({
  model: 'cartesia/' + (process.env.CARTESIA_TTS_MODEL?.trim() || 'sonic-3.6'),
  voice: process.env.CARTESIA_VOICE_ID?.trim() || '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc',
  language,
  sampleRate: rate,
});
const room = new Room();
const source = new AudioSource(rate, 1);
let form;
let outgoingAudio = false;
let avatarEnabled = false;
let avatarVideo = false;
let citedAnswer;
let incomingTranscript = '';
let replyTranscript = '';
let canvasRun;
let canvasStep = 0;
let canvasComplete = false;
async function handleCanvas({ payload, callerIdentity }) {
  const agent = room.remoteParticipants.get(callerIdentity);
  if (!agent?.attributes['lk.agent.state']) return 'invalid';
  const message = JSON.parse(payload);
  if (message.type === 'begin') { canvasRun = message.id; canvasStep = 0; canvasComplete = false; return 'ok'; }
  if (message.id !== canvasRun) return 'closed';
  if (message.type === 'step' && message.index === canvasStep && validateStep(message)) { canvasStep++; return 'ok'; }
  if (message.type === 'completed') { canvasComplete = true; return 'ok'; }
  return ['paused', 'failed', 'dismiss'].includes(message.type) ? 'ok' : 'invalid';
}

const avatarFellBack = () => [...room.remoteParticipants.values()].some((participant) =>
  participant.attributes[avatarModeAttribute] === voiceFallback);

room.registerTextStreamHandler('lk.transcription', async (reader, from) => {
  const part = await reader.readAll();
  if (from.identity === room.localParticipant?.identity) {
    if (reader.info.attributes?.['lk.transcription_final'] !== 'false') incomingTranscript += part + ' ';
  } else {
    replyTranscript += part + ' ';
  }
});
room.registerByteStreamHandler('lk.agent.session', (reader) => { void reader.readAll().catch(() => {}); });
room.registerTextStreamHandler('scfh.onboarding.v1', async (reader) => {
  const event = JSON.parse(await reader.readAll());
  if (event.type === 'answer') citedAnswer = event.answer;
});
room.on(RoomEvent.TrackSubscribed, async (track, _publication, participant) => {
  const avatarTrack = Boolean(participant.attributes['lk.publish_on_behalf']);
  if ((avatarEnabled && !avatarFellBack()) !== avatarTrack) return;
  if (avatarTrack && track.kind === TrackKind.KIND_VIDEO && participant.identity === 'bey-avatar-agent') avatarVideo = true;
  if (track.kind !== TrackKind.KIND_AUDIO) return;
  try {
    for await (const frame of new AudioStream(track)) {
      if (frame.data.some((sample) => Math.abs(sample) > 400)) {
        outgoingAudio = true;
        break;
      }
    }
  } catch {}
});

async function waitFor(test, label, milliseconds) {
  const deadline = Date.now() + milliseconds;
  while (!test()) {
    assert(Date.now() < deadline, 'Timed out waiting for ' + label);
    await delay(100);
  }
}

try {
  const speech = fixtureTTS.stream();
  const frames = [];
  try {
    speech.pushText(text);
    speech.endInput();
    for await (const { frame } of speech) {
      if (frame) frames.push(Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength));
    }
  } finally {
    speech.close();
    await fixtureTTS.close();
  }
  const raw = Buffer.concat(frames);
  const pcm = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  assert(pcm.length > rate, 'Fixture speech response did not contain enough samples.');
  if (!walkthrough && !qa) {
    form = spawn('powershell.exe', [
      '-NoProfile', '-STA', '-File', resolve('test/desktop-form.ps1'),
      '-Title', title, '-ResultFile', resultPath, '-InitialText', marker,
    ], { stdio: 'ignore' });
    await new Promise((resolve, reject) => {
      form.once('spawn', resolve);
      form.once('error', reject);
    });
  }

  const ticket = await fetch(base + '/connect', { method: 'POST', headers: { origin: base } });
  assert(ticket.ok, 'Run start.cmd before running the voice smoke test.');
  const { url, token, avatarEnabled: withAvatar } = await ticket.json();
  avatarEnabled = withAvatar === true;
  await room.connect(url, token);
  room.localParticipant.registerRpcMethod(DRAW_RPC, handleCanvas);
  room.localParticipant.registerRpcMethod(DESKTOP_CONTROL_RPC, async ({ payload }) =>
    ['start', 'stop', 'result'].includes(JSON.parse(payload).type) ? 'ok' : 'invalid');
  const track = LocalAudioTrack.createAudioTrack('test-microphone', source);
  await room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_MICROPHONE });
  const size = rate / 50;
  await source.captureFrame(new AudioFrame(new Int16Array(size), rate, 1, size));
  await waitFor(() => [...room.remoteParticipants.values()].some((p) => p.attributes['lk.agent.state'] === 'listening'),
    'the LiveKit agent to start listening', avatarEnabled ? 50_000 : 25_000);
  console.log('PASS The menu created a LiveKit room, routed the worker, and accepted a microphone track.');
  if (requireAvatar) assert(avatarEnabled && !avatarFellBack(), 'The live Beyond Presence avatar was required.');

  // Let the Windows input gate settle before requesting real desktop input.
  if (!walkthrough && !qa) await delay(11_500);

  // Start and end with silence so the agent's VAD sees a complete speech turn.
  const input = new Int16Array(rate / 2 + pcm.length + rate * 2);
  input.set(pcm, rate / 2);
  async function sendFixture() {
    for (let start = 0; start < input.length; start += size) {
      const frame = new Int16Array(size);
      frame.set(input.subarray(start, start + size));
      await source.captureFrame(new AudioFrame(frame, rate, 1, size));
      await delay(20);
    }
  }
  await sendFixture();
  await waitFor(() => incomingTranscript.trim(), 'transcription of the spoken command', 15_000);
  assert.match(incomingTranscript, harbourWalkthrough ? /funding/i : walkthrough || qa ? /maintenance/i : /voice\s*check/i);
  console.log('PASS LiveKit transcribed the spoken command: ' + incomingTranscript.trim());

  if (walkthrough) {
    await waitFor(() => canvasComplete, 'the narrated and acknowledged sidebar canvas', 90_000);
    if (harbourWalkthrough) {
      await waitFor(() => /search for grants/i.test(replyTranscript), 'the final Harbour funding step', 15_000);
      assert.equal(canvasStep, 4);
      assert.match(replyTranscript, /own contribution/i);
      assert(citedAnswer?.citations.some(source => source.locator.page === 752));
      assert(citedAnswer?.citations.some(source => source.locator.page === 753));
    } else {
      await waitFor(() => /confirm the timing with the desk lead/i.test(replyTranscript), 'the final maintenance step', 15_000);
      assert.equal(canvasStep, 7);
      assert.match(replyTranscript, /callback channel/i);
      assert.match(replyTranscript, /maintenance queue/i);
    }
    console.log('PASS The Rough.js walkthrough narrated the approved steps through the final note.');
  } else if (qa) {
    await waitFor(() => citedAnswer && /desk lead/i.test(replyTranscript), 'the cited and spoken answer', 45_000);
    assert(citedAnswer.citations.some(({ passageId }) => passageId === 'unassigned-reminder'));
    console.log('PASS The approved spoken answer included the Word citation.');
  } else {
    const controlHeld = () => /\b(control|in use|busy|mouse|keyboard)\b/i.test(replyTranscript);
    const systemPrompt = () => /\b(firewall|security (?:prompt|dialog))\b/i.test(replyTranscript);
    await waitFor(() => existsSync(resultPath) || controlHeld() || systemPrompt(),
      'the native button click or a control handoff', 45_000);
    assert(!systemPrompt() || existsSync(resultPath), 'A Windows security prompt blocked the desktop check.');
    if (!existsSync(resultPath) && controlHeld()) {
      // Retry only the temporary fixture button, in a new turn after the user gate settles.
      console.log('Windows-MCP reported a control handoff. Waiting before retrying the fixture.');
      await delay(13_000);
      if (!existsSync(resultPath)) await sendFixture();
      await waitFor(() => existsSync(resultPath), 'the native button click after the control handoff', 35_000);
    }
    assert.equal(await readFile(resultPath, 'utf8'), marker);
    console.log('PASS The agent clicked the requested native Windows button and its callback ran.');
  }
  await waitFor(() => outgoingAudio && replyTranscript.trim(), 'spoken confirmation audio', 45_000);
  const usingAvatar = avatarEnabled && !avatarFellBack();
  if (requireAvatar) assert(usingAvatar, 'Beyond Presence switched to voice only.');
  if (usingAvatar) await waitFor(() => avatarVideo, 'Beyond Presence video', 10_000);
  if (avatarEnabled && !usingAvatar) console.log('PASS The room continued with the configured voice-only fallback.');
  console.log('PASS The agent returned audible speech' + (usingAvatar ? ' and Beyond Presence video.' : '.'));
} finally {
  await room.disconnect().catch(() => {});
  await source.close();
  await dispose();
  if (form && form.exitCode === null) form.kill();
  await rm(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(() => {});
}
