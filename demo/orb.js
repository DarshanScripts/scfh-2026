const { createLocalAudioTrack, ParticipantKind, Room, RoomEvent, Track } = LivekitClient;
const orb = document.querySelector('main');
const status = document.querySelector('#status');
const toggle = document.querySelector('#voice-toggle');
const avatar = document.querySelector('#avatar');
let activeCall;

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
  const action = activeCall ? 'End call' : 'Call voice agent';
  toggle.setAttribute('aria-label', action);
  toggle.title = message + ' ' + action;
}

function finish(attempt, message, state = 'idle') {
  if (activeCall !== attempt) return;
  activeCall = undefined;
  clearTimeout(attempt.agentTimer);
  attempt.abort.abort();
  attempt.microphone?.stop();
  switchMedia(attempt);
  void attempt.room.disconnect().catch(() => {});
  setStatus(state, message);
}

toggle.onclick = async () => {
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
    const presenter = attempt.avatarEnabled && agent
      ? participants.find((participant) => participant.kind === ParticipantKind.AGENT &&
        participant.attributes['lk.publish_on_behalf'] === agent.identity)
      : agent;
    const video = attempt.avatarEnabled ? publishedTrack(presenter, Track.Kind.Video) : undefined;
    switchMedia(attempt, publishedTrack(presenter, Track.Kind.Audio), video);
    const agentState = agent?.attributes['lk.agent.state'];
    const ready = agentState && (!attempt.avatarEnabled || video);
    if (ready) {
      clearTimeout(attempt.agentTimer);
      attempt.agentTimer = undefined;
    } else if (!attempt.agentTimer) {
      attempt.agentTimer = setTimeout(() => {
        const who = attempt.avatarEnabled ? 'avatar' : 'agent';
        finish(attempt, 'The ' + who + ' is unavailable. Try calling again.', 'error');
      }, attempt.avatarEnabled ? 45_000 : 20_000);
    }
    const message = {
      listening: 'Listening. Say a command.',
      thinking: 'Working…',
      speaking: 'Speaking…',
    }[ready ? agentState : ''];
    const waiting = attempt.avatarEnabled ? 'Waiting for the avatar…' : 'Waiting for the agent…';
    setStatus(message ? agentState : 'connecting', message || waiting);
  };

  session.on(RoomEvent.ParticipantAttributesChanged, updateStatus);
  session.on(RoomEvent.ParticipantConnected, updateStatus);
  session.on(RoomEvent.ParticipantDisconnected, updateStatus);
  session.on(RoomEvent.TrackSubscribed, updateStatus);
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
