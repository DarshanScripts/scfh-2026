import { avatarModeAttribute, voiceFallback } from '../avatar-mode.mjs';

export function mountCall(avatar, show) {
  const { createLocalAudioTrack, ParticipantKind, Room, RoomEvent, Track } = LivekitClient;
  let activeCall;
  let answerWindow;
  let currentAnswer;
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

  const events = new AbortController();
  window.addEventListener('message', ({ origin, source, data }) => {
    if (origin === location.origin && source === answerWindow && data?.type === 'onboarding-panel-ready' && currentAnswer) {
      answerWindow.postMessage(currentAnswer, location.origin);
    }
  }, { signal: events.signal });

  function receiveOnboarding(attempt, message, participant) {
    if (attempt !== activeCall || !attempt.agentIdentity ||
        participant?.identity !== attempt.agentIdentity || message.length > 14000) return;
    let event;
    try { event = JSON.parse(message); } catch { return; }
    if (event?.schemaVersion !== 1 || typeof event.turnId !== 'string' || !uuid.test(event.turnId)) return;
    if (event.type === 'turn') { attempt.turn = event.turnId; attempt.request = undefined; return; }
    if (event.turnId !== attempt.turn || attempt.request || typeof event.requestId !== 'string' || !uuid.test(event.requestId)) return;
    if (event.type !== 'answer' && event.type !== 'error') return;
    if (event.type === 'answer' && (event.answer?.requestId !== event.requestId || event.answer?.turnId !== event.turnId)) return;
    attempt.request = event.requestId;
    currentAnswer = event;
    if (!answerWindow || answerWindow.closed) answerWindow = window.open('/answers', 'facilities-onboarding');
    else answerWindow.postMessage(event, location.origin);
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
    }
  }

  function publishedTrack(participant, kind) {
    if (!participant) return;
    for (const publication of participant.trackPublications.values()) {
      if (publication.track?.kind === kind) return publication.track;
    }
  }

  function setStatus(state, message) {
    show({
      state, message, inCall: Boolean(activeCall), hasVideo: Boolean(activeCall?.video),
      voiceOnly: Boolean(activeCall?.voiceFallback),
    });
  }

  function finish(attempt, message, state = 'idle') {
    if (activeCall !== attempt) return;
    activeCall = undefined;
    clearTimeout(attempt.agentTimer);
    attempt.abort.abort();
    attempt.microphone?.stop();
    switchMedia(attempt);
    answerWindow?.close();
    answerWindow = undefined;
    currentAnswer = undefined;
    void attempt.room.disconnect().catch(() => {});
    setStatus(state, message);
  }

  async function toggle() {
    if (activeCall) {
      finish(activeCall, 'Disconnected.');
      return;
    }
    const session = new Room();
    const attempt = { room: session, abort: new AbortController() };
    activeCall = attempt;
    setStatus('connecting', 'Opening microphone…');
    void session.startAudio().catch(() => {});

    const updateStatus = () => {
      if (activeCall !== attempt || !attempt.ready) return;
      const participants = [...session.remoteParticipants.values()];
      const agent = participants.find((participant) =>
        participant.kind === ParticipantKind.AGENT && !participant.attributes['lk.publish_on_behalf']);
      attempt.agentIdentity = agent?.identity;
      attempt.voiceFallback = attempt.avatarEnabled && agent?.attributes[avatarModeAttribute] === voiceFallback;
      const usingAvatar = attempt.avatarEnabled && !attempt.voiceFallback;
      const presenter = usingAvatar && agent
        ? participants.find((participant) => participant.kind === ParticipantKind.AGENT &&
          participant.attributes['lk.publish_on_behalf'] === agent.identity)
        : agent;
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
      const status = message || waiting;
      setStatus(message ? agentState : 'connecting', attempt.voiceFallback ? 'Avatar unavailable. ' + status : status);
    };

    session.on(RoomEvent.ParticipantAttributesChanged, updateStatus);
    session.on(RoomEvent.ParticipantConnected, updateStatus);
    session.on(RoomEvent.ParticipantDisconnected, updateStatus);
    session.on(RoomEvent.TrackSubscribed, updateStatus);
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
  }

  return {
    toggle,
    close() {
      events.abort();
      if (activeCall) finish(activeCall, 'Disconnected.');
    },
  };
}
