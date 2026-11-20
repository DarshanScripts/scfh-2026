import { EventEmitter, addAbortListener } from 'node:events';
import { AudioStream, RoomEvent, TrackKind } from '@livekit/rtc-node';

export function listenForAvatarAudio(room, identity) {
  const signal = new EventEmitter();
  let reader;
  const attach = (track, _publication, participant) => {
    if (track.kind !== TrackKind.KIND_AUDIO || participant.identity !== identity) return;
    void reader?.cancel().catch(() => {});
    const current = reader = new AudioStream(track).getReader();
    void (async () => {
      try {
        while (reader === current) {
          const { done, value } = await current.read();
          if (done || reader !== current) break;
          if (signal.listenerCount('voice') && value.data.some((sample) => Math.abs(sample) > 400)) {
            signal.emit('voice');
          }
        }
      } catch {
        // Unsubscribe and room disconnect end the stream. The walkthrough has its own deadline.
      } finally {
        current.releaseLock();
        if (reader === current) reader = undefined;
      }
    })();
  };
  room.on(RoomEvent.TrackSubscribed, attach);
  for (const participant of room.remoteParticipants.values()) {
    for (const publication of participant.trackPublications.values()) {
      if (publication.track) attach(publication.track, publication, participant);
    }
  }
  return {
    signal,
    close() {
      room.off(RoomEvent.TrackSubscribed, attach);
      const current = reader;
      reader = undefined;
      void current?.cancel().catch(() => {});
    },
  };
}

export async function playWorkflowStep({ session, avatarAudio, text, signal, reveal }) {
  signal.throwIfAborted();
  const output = session.output.audio;
  if (!output || !session.output.audioEnabled) throw new Error('Audio output is unavailable.');

  const started = Promise.withResolvers();
  const timeout = AbortSignal.timeout(45_000);
  const deadline = AbortSignal.any([signal, timeout]);
  const aborted = Promise.withResolvers();
  const abort = addAbortListener(deadline, () => aborted.reject(deadline.reason));
  let speech;
  const onVoice = () => {
    if (!deadline.aborted && !speech?.interrupted) started.resolve();
  };
  const onOutput = () => {
    if (deadline.aborted || speech?.interrupted) return;
    // The avatar output's start event marks sending the first frame to the avatar.
    // Wait for audible samples returning from that participant before revealing.
    if (avatarAudio) avatarAudio.once('voice', onVoice);
    else onVoice();
  };
  output.once('playbackStarted', onOutput);
  try {
    speech = session.say(text, { allowInterruptions: true });
    const finished = speech.waitForPlayout();
    const heard = await Promise.race([started.promise.then(() => true), finished.then(() => false), aborted.promise]);
    if (speech.interrupted || signal.aborted) return false;
    if (!heard) throw new Error('No playback start was detected for the narration.');
    reveal();
    await Promise.race([finished, aborted.promise]);
    if (speech.exception?.()) throw new Error('Narration playback failed.');
    return !speech.interrupted && !signal.aborted;
  } finally {
    abort[Symbol.dispose]();
    output.off('playbackStarted', onOutput);
    avatarAudio?.off('voice', onVoice);
    if (speech && !speech.done() && !speech.interrupted) speech.interrupt();
  }
}
