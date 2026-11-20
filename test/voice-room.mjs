import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  AudioFrame, AudioSource, AudioStream, LocalAudioTrack,
  Room, RoomEvent, TrackKind, TrackSource, dispose,
} from '@livekit/rtc-node';

assert.equal(process.platform, 'win32', 'Run the native voice smoke test on Windows.');
const base = 'http://127.0.0.1:' + Number(process.env.DEMO_PORT || 4321);
const key = process.env.OPENROUTER_API_KEY;
assert(key, 'Set OPENROUTER_API_KEY before running the voice smoke test.');
const root = resolve('.hcu');
await mkdir(root, { recursive: true });
const scratch = await mkdtemp(resolve(root, 'voice-test-'));
const resultPath = resolve(scratch, 'clicked.txt');
const marker = 'voice action verified';
const title = 'SCFH Voice Check';
const language = process.env.AGENT_LANGUAGE || 'en';
const text = language === 'de'
  ? 'Klicke im Fenster SCFH Voice Check auf die Schaltfläche.'
  : 'Click the button in the SCFH Voice Check window.';
const rate = 24000;
const room = new Room();
const source = new AudioSource(rate, 1);
let form;
let outgoingAudio = false;
let incomingTranscript = '';
let replyTranscript = '';

room.registerTextStreamHandler('lk.transcription', async (reader, from) => {
  const part = await reader.readAll();
  if (from.identity === room.localParticipant?.identity) {
    if (reader.info.attributes?.['lk.transcription_final'] !== 'false') incomingTranscript += part + ' ';
  } else {
    replyTranscript += part + ' ';
  }
});
room.registerByteStreamHandler('lk.agent.session', (reader) => { void reader.readAll().catch(() => {}); });
room.on(RoomEvent.TrackSubscribed, async (track) => {
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
  const request = await fetch('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENROUTER_TTS_MODEL || 'google/gemini-3.1-flash-tts-preview',
      voice: process.env.OPENROUTER_TTS_VOICE || 'Kore',
      response_format: 'pcm',
      input: text,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  assert(request.ok, 'Fixture speech generation failed with HTTP ' + request.status);
  const raw = await request.arrayBuffer();
  const pcm = new Int16Array(raw);
  assert(pcm.length > rate, 'Fixture speech response did not contain enough samples.');
  form = spawn('powershell.exe', [
    '-NoProfile', '-STA', '-File', resolve('test/desktop-form.ps1'),
    '-Title', title, '-ResultFile', resultPath, '-InitialText', marker,
  ], { stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    form.once('spawn', resolve);
    form.once('error', reject);
  });

  const ticket = await fetch(base + '/connect', { method: 'POST', headers: { origin: base } });
  assert(ticket.ok, 'Run start.cmd before running the voice smoke test.');
  const { url, token } = await ticket.json();
  await room.connect(url, token);
  const track = LocalAudioTrack.createAudioTrack('test-microphone', source);
  await room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_MICROPHONE });
  await waitFor(() => [...room.remoteParticipants.values()].some((p) => p.attributes['lk.agent.state'] === 'listening'),
    'the LiveKit agent to start listening', 20_000);
  console.log('PASS The menu created a LiveKit room, routed the worker, and accepted a microphone track.');

  const size = rate / 50;
  // Start and end with silence so the agent's VAD sees a complete speech turn.
  const input = new Int16Array(rate / 2 + pcm.length + rate * 2);
  input.set(pcm, rate / 2);
  for (let start = 0; start < input.length; start += size) {
    const frame = new Int16Array(size);
    frame.set(input.subarray(start, start + size));
    await source.captureFrame(new AudioFrame(frame, rate, 1, size));
    await delay(20);
  }
  await waitFor(() => incomingTranscript.trim(), 'transcription of the spoken command', 15_000);
  assert.match(incomingTranscript, /voice\s*check/i);
  console.log('PASS LiveKit transcribed the spoken command: ' + incomingTranscript.trim());

  await waitFor(() => existsSync(resultPath), 'the native button click', 35_000);
  assert.equal(await readFile(resultPath, 'utf8'), marker);
  console.log('PASS The agent clicked the requested native Windows button and its callback ran.');
  await waitFor(() => outgoingAudio && replyTranscript.trim(), 'spoken confirmation audio', 45_000);
  console.log('PASS The agent returned audible speech through the LiveKit room: ' + replyTranscript.trim());
} finally {
  await room.disconnect().catch(() => {});
  await source.close();
  await dispose();
  if (form && form.exitCode === null) form.kill();
  await rm(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(() => {});
}
