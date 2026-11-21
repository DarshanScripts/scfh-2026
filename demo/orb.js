import { CLOSE_TOPIC, DRAW_RPC, MAX_PAYLOAD } from '/rough/contract.mjs';
import { DESKTOP_CONTROL_RPC } from '/desktop-control-rpc.mjs';
const avatarModeAttribute = 'scfh.avatar.mode';

const { createLocalAudioTrack, ParticipantKind, Room, RoomEvent, Track } = LivekitClient;
const orb = document.querySelector('main');
const status = document.querySelector('#status');
const toggle = document.querySelector('#voice-toggle');
const avatar = document.querySelector('#avatar');
let activeCall;
const workspace = window.voiceWorkspace;
const answerTemplate = document.querySelector('#answer-template');
const transcript = document.querySelector('#transcript');
const expand = document.querySelector('#expand');
const collapse = document.querySelector('#collapse');
const recap = document.querySelector('#desktop-recap');
const desktopRequest = document.querySelector('#desktop-request');
const desktopResult = document.querySelector('#desktop-result');
const showCanvas = document.querySelector('#show-canvas');
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
let answerModule;
let mode = 'sidebar';
let modeSequence = 0;
let canvasRun;
document.body.dataset.mode = mode;

async function setMode(next, { manual = false } = {}) {
  const sequence = ++modeSequence;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (next !== 'sidebar' && document.fullscreenElement) await document.exitFullscreen();
  if (mode === 'sidebar' && next !== 'sidebar') {
    if (!reducedMotion) {
      const transition = orb.animate(
        [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(44px)', opacity: 0 }],
        { duration: 180, easing: 'ease-in', fill: 'forwards' },
      );
      await transition.finished;
      transition.cancel();
    }
  }
  if (sequence !== modeSequence) return;
  mode = next;
  document.body.dataset.mode = mode;
  expand.hidden = mode !== 'collapsed';
  await workspace?.setMode(mode);
  if (sequence !== modeSequence) return;
  if (mode === 'sidebar') {
    if (!reducedMotion) orb.animate(
      [{ transform: 'translateX(36px)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }],
      { duration: 230, easing: 'ease-out' },
    );
    if (manual) collapse.focus({ preventScroll: true });
  }
  if (mode === 'collapsed') expand.focus({ preventScroll: true });
}
collapse.onclick = () => void setMode('collapsed', { manual: true });
expand.onclick = () => void setMode('sidebar', { manual: true });

function setCanvasRun(id) {
  canvasRun = id;
  showCanvas.hidden = true;
  document.body.toggleAttribute('data-canvas-open', Boolean(id));
}
showCanvas.onclick = async () => {
  if (await workspace?.showCanvas()) showCanvas.hidden = true;
};

workspace?.onCanvasClosed((id) => {
  const attempt = activeCall;
  if (canvasRun !== id) return;
  setCanvasRun(undefined);
  if (!attempt?.agentIdentity) return;
  void attempt.room.localParticipant.publishData(new TextEncoder().encode(id), {
    reliable: true, topic: CLOSE_TOPIC, destinationIdentities: [attempt.agentIdentity],
  }).catch(() => {});
});

async function showAnswer(attempt, event) {
  try {
    answerModule ??= import('/answers.js');
    const { mountAnswerPanel } = await answerModule;
    if (attempt !== activeCall || attempt.turn !== event.turnId) return;
    const root = answerTemplate.content.firstElementChild.cloneNode(true);
    if (!mountAnswerPanel(root).receive(event)) return;
    const follow = followTranscript();
    const entry = addTranscript('Assistant');
    entry.article.classList.add('grounded-entry');
    entry.content.replaceWith(root);
    if (event.type === 'answer') {
      attempt.groundedText = normalizeSpeech(event.answer.text);
      for (const segment of attempt.transcripts.values()) {
        if (segment.turn === event.turnId && segment.entry?.article.dataset.speaker === 'Assistant') {
          segment.entry.article.hidden = matchesGroundedSpeech(attempt, segment.entry.content.textContent);
        }
      }
    }
    if (follow) transcript.scrollTop = transcript.scrollHeight;
  } catch {
    answerModule = undefined;
  }
}

const normalizeSpeech = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function matchesGroundedSpeech(attempt, text) {
  const spoken = normalizeSpeech(text);
  return Boolean(spoken && attempt.groundedText?.includes(spoken));
}

function followTranscript() {
  return transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 52;
}

const speechGapMs = 3000;

function updateUserSpeech(attempt, segment, text) {
  const now = performance.now();
  if (!segment.group) {
    let group = attempt.userSpeech;
    if (!group || group.entry.article !== [...transcript.children].findLast((entry) => !entry.hidden) || now - group.updatedAt > speechGapMs) {
      group = attempt.userSpeech = { entry: addTranscript('You'), fragments: [] };
    }
    const fragment = document.createElement('span');
    fragment.className = 'speech-fragment';
    group.fragments.push(fragment);
    group.entry.content.append(fragment);
    segment.group = group;
    segment.fragment = fragment;
  }
  segment.group.updatedAt = now;
  segment.fragment.textContent = (segment.fragment === segment.group.fragments[0] ? '' : ' ') + text.trim();
}

function addTranscript(speaker) {
  const article = document.createElement('article');
  article.className = 'transcript-entry';
  article.dataset.speaker = speaker;
  const label = document.createElement('strong');
  label.textContent = speaker;
  const content = document.createElement('p');
  article.append(label, content);
  transcript.querySelector('#empty-transcript')?.remove();
  transcript.append(article);
  return { article, content };
}

async function readTranscript(attempt, reader, sender) {
  const identity = sender.identity;
  const own = identity === attempt.room.localParticipant.identity;
  if (!own && identity !== attempt.agentIdentity && identity !== attempt.presenterIdentity) return;
  const attributes = reader.info.attributes;
  const id = attributes?.['lk.segment_id'] || reader.info.id;
  const key = identity + ':' + id;
  const previous = attempt.transcripts.get(key);
  if (previous?.final) return;
  const segment = previous ?? { final: false, turn: attempt.turn };
  attempt.transcripts.set(key, segment);
  const final = attributes?.['lk.transcription_final'] === 'true';
  const version = (segment.version ?? 0) + 1;
  segment.version = version;
  let text = '';
  try {
    for await (const chunk of reader) {
      if (attempt !== activeCall || segment.version !== version) return;
      text += chunk;
      if (!text.trim() || text.length > 16000) continue;
      const follow = followTranscript();
      if (own) {
        updateUserSpeech(attempt, segment, text);
      } else {
        segment.entry ??= addTranscript('Assistant');
        segment.entry.content.textContent = text;
        if (segment.turn === attempt.turn) segment.entry.article.hidden = matchesGroundedSpeech(attempt, text);
      }
      if (follow) transcript.scrollTop = transcript.scrollHeight;
    }
    if (segment.version === version) segment.final = final || reader.info.attributes?.['lk.transcription_final'] === 'true';
  } catch {
    // The sender can end a stream when the call disconnects.
  }
}

function receiveOnboarding(attempt, message, participant) {
  if (attempt !== activeCall || !attempt.agentIdentity ||
      participant?.identity !== attempt.agentIdentity || message.length > 14000) return;
  let event;
  try { event = JSON.parse(message); } catch { return; }
  if (event?.schemaVersion !== 1 || typeof event.turnId !== 'string' || !uuid.test(event.turnId)) return;
  if (event.type === 'turn') { attempt.turn = event.turnId; attempt.request = undefined; attempt.groundedText = undefined; return; }
  if (event.turnId !== attempt.turn || attempt.request || typeof event.requestId !== 'string' || !uuid.test(event.requestId)) return;
  if (event.type !== 'answer' && event.type !== 'error') return;
  if (event.type === 'answer' && (event.answer?.requestId !== event.requestId || event.answer?.turnId !== event.turnId)) return;
  attempt.request = event.requestId;
  void showAnswer(attempt, event);
}

function switchMedia(attempt, audio, video) {
  if (attempt.audio !== audio) {
    if (attempt.audioElement) {
      attempt.audio.detach(attempt.audioElement);
      attempt.audioElement.remove();
    }
    attempt.audio = audio;
    attempt.audioElement = audio?.attach();
    if (attempt.audioElement) document.body.append(attempt.audioElement);
  }
  if (attempt.video !== video) {
    attempt.video?.detach(avatar);
    attempt.video = video;
    if (video) video.attach(avatar);
    else avatar.srcObject = null;
    avatar.hidden = !video;
    orb.toggleAttribute('data-avatar', Boolean(video));
  }
}

function publishedTrack(participant, kind) {
  if (!participant) return;
  for (const publication of participant.trackPublications.values()) {
    if (publication.track?.kind === kind) return publication.track;
  }
}

function setStatus(state, message) {
  orb.dataset.state = state;
  status.textContent = message;
  status.hidden = state === 'idle' || !message;
  const action = activeCall ? 'End call' : 'Start call';
  toggle.setAttribute('aria-label', action);
  toggle.title = action;
  toggle.toggleAttribute('data-in-call', Boolean(activeCall));
}

function finish(attempt, message, state = 'idle') {
  if (activeCall !== attempt) return;
  activeCall = undefined;
  clearTimeout(attempt.agentTimer);
  attempt.abort.abort();
  attempt.microphone?.stop();
  switchMedia(attempt);
  if (canvasRun) {
    void workspace.updateCanvas({ type: 'dismiss', id: canvasRun });
    setCanvasRun(undefined);
  }
  void workspace?.setDesktopActive(false);
  if (attempt.desktopActive) desktopResult.textContent = 'Call ended.';
  void attempt.room.disconnect().catch(() => {});
  setStatus(state, message);
}

toggle.onclick = async () => {
  if (activeCall) {
    finish(activeCall, 'Disconnected.');
    return;
  }
  const session = new Room();
  const attempt = { room: session, abort: new AbortController(), transcripts: new Map() };
  activeCall = attempt;
  setStatus('connecting', 'Opening microphone…');
  void session.startAudio().catch(() => {});

  const updateStatus = () => {
    if (activeCall !== attempt || !attempt.ready) return;
    const participants = [...session.remoteParticipants.values()];
    const agent = participants.find((participant) =>
      participant.kind === ParticipantKind.AGENT && !participant.attributes['lk.publish_on_behalf']);
    attempt.agentIdentity = agent?.identity;
    attempt.voiceFallback = attempt.avatarEnabled && agent?.attributes[avatarModeAttribute] === 'voice-fallback';
    const usingAvatar = attempt.avatarEnabled && !attempt.voiceFallback;
    const presenter = usingAvatar && agent
      ? participants.find((participant) => participant.kind === ParticipantKind.AGENT &&
        participant.attributes['lk.publish_on_behalf'] === agent.identity)
      : agent;
    attempt.presenterIdentity = presenter?.identity;
    const video = usingAvatar ? publishedTrack(presenter, Track.Kind.Video) : undefined;
    switchMedia(attempt, publishedTrack(presenter, Track.Kind.Audio), video);
    const agentState = agent?.attributes['lk.agent.state'];
    const ready = agentState && (!usingAvatar || video);
    if (ready) {
      clearTimeout(attempt.agentTimer);
      attempt.agentTimer = undefined;
    } else if (!attempt.agentTimer) {
      attempt.agentTimer = setTimeout(() => {
        const who = attempt.avatarEnabled && !attempt.voiceFallback ? 'avatar' : 'agent';
        finish(attempt, 'The ' + who + ' is unavailable. Try calling again.', 'error');
      }, attempt.avatarEnabled ? 45_000 : 20_000);
    }
    const message = {
      listening: 'Listening. Say a command.',
      thinking: 'Working…',
      speaking: 'Speaking…',
    }[ready ? agentState : ''];
    const waiting = usingAvatar ? 'Waiting for the avatar…' : 'Waiting for the agent…';
    const description = message || waiting;
    setStatus(message ? agentState : 'connecting', attempt.voiceFallback ? 'Avatar unavailable. ' + description : description);
  };

  session.on(RoomEvent.ParticipantAttributesChanged, updateStatus);
  session.on(RoomEvent.ParticipantConnected, updateStatus);
  session.on(RoomEvent.ParticipantDisconnected, updateStatus);
  session.on(RoomEvent.TrackSubscribed, updateStatus);
  session.registerTextStreamHandler('lk.transcription', (reader, participant) => {
    void readTranscript(attempt, reader, participant);
  });
  session.registerRpcMethod(DESKTOP_CONTROL_RPC, async ({ callerIdentity, payload }) => {
    if (activeCall !== attempt || callerIdentity !== attempt.agentIdentity || payload.length > 7000 || !workspace) return 'invalid';
    let message;
    try { message = JSON.parse(payload); } catch { return 'invalid'; }
    if (message?.type === 'result') {
      if (!attempt.desktopId || message.id !== attempt.desktopId ||
          typeof message.text !== 'string' || !message.text.trim() || message.text.length > 1000) return 'invalid';
      desktopResult.textContent = message.text;
      return 'ok';
    }
    if (message?.type === 'start') {
      if ((message.id !== undefined && !uuid.test(message.id)) ||
          typeof message.request !== 'string' || message.request.length > 1000) return 'invalid';
      if (document.fullscreenElement) await document.exitFullscreen();
      if (activeCall !== attempt) return 'closed';
      if (!await workspace.setDesktopActive(true)) return 'invalid';
      attempt.desktopId = message.id;
      attempt.desktopActive = true;
      desktopRequest.textContent = message.request || attempt.userSpeech?.entry.content.textContent || '';
      desktopResult.textContent = 'Using the desktop…';
      recap.hidden = false;
      return 'ok';
    }
    if (message?.type !== 'stop') return 'invalid';
    if (!attempt.desktopActive) return 'ok';
    if (mode === 'collapsed') await setMode('sidebar');
    if (activeCall !== attempt) return 'closed';
    if (!await workspace.setDesktopActive(false)) return 'invalid';
    attempt.desktopActive = false;
    if (desktopResult.textContent === 'Using the desktop…') desktopResult.textContent = 'Desktop control ended.';
    showCanvas.hidden = !canvasRun;
    return 'ok';
  });
  session.registerRpcMethod(DRAW_RPC, async ({ callerIdentity, payload }) => {
    if (activeCall !== attempt || callerIdentity !== attempt.agentIdentity || payload.length > MAX_PAYLOAD || !workspace) return 'invalid';
    let message;
    try { message = JSON.parse(payload); } catch { return 'invalid'; }
    if (!message || typeof message.id !== 'string') return 'invalid';
    if (message.type === 'begin') {
      if (document.fullscreenElement) await document.exitFullscreen();
      if (mode === 'collapsed') await setMode('sidebar');
    }
    if (attempt !== activeCall) return 'closed';
    const result = await workspace.updateCanvas(message);
    if (result === 'ok' && message.type === 'begin') {
      if (attempt !== activeCall) {
        await workspace.updateCanvas({ type: 'dismiss', id: message.id });
        return 'closed';
      }
      setCanvasRun(message.id);
    }
    if (result === 'ok' && message.type === 'dismiss' && message.id === canvasRun) setCanvasRun(undefined);
    return result;
  });
  let onboardingReads = Promise.resolve();
  session.registerTextStreamHandler?.('scfh.onboarding.v1', (reader, participant) => {
    if (participant.identity !== attempt.agentIdentity) return;
    const message = reader.readAll().catch(() => '');
    onboardingReads = onboardingReads.then(async () => receiveOnboarding(attempt, await message, participant));
  });
  // LiveKit emits this before clearing the publication's old track.
  session.on(RoomEvent.TrackUnsubscribed, () => queueMicrotask(updateStatus));
  session.on(RoomEvent.Disconnected, () => finish(attempt, 'Disconnected.'));

  try {
    const microphone = await createLocalAudioTrack();
    if (activeCall !== attempt) {
      microphone.stop();
      return;
    }
    attempt.microphone = microphone;
    setStatus('connecting', 'Connecting…');
    const response = await fetch('/connect', { method: 'POST', signal: attempt.abort.signal });
    if (!response.ok) throw new Error('Could not start a call.');
    const { url, token, avatarEnabled } = await response.json();
    attempt.avatarEnabled = avatarEnabled === true;
    if (activeCall !== attempt) return;
    await session.connect(url, token);
    if (activeCall !== attempt) {
      await session.disconnect();
      return;
    }
    await session.localParticipant.publishTrack(microphone, { source: Track.Source.Microphone });
    attempt.ready = true;
    updateStatus();
  } catch (error) {
    const message = {
      NotAllowedError: 'Microphone access is blocked.',
      NotFoundError: 'No microphone found.',
    }[error.name] || error.message || 'Could not start a call.';
    finish(attempt, message, 'error');
  }
};
