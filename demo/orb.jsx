import { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Mic, Square } from 'lucide-react';
import { mountCall } from './orb.js';

const labels = {
  idle: 'Ready',
  connecting: 'Connecting',
  listening: 'Listening',
  thinking: 'Working',
  speaking: 'Speaking',
  error: 'Try again',
};

function VoiceOrb() {
  const viewport = useRef(null);
  const toggle = useRef(null);
  const [{ state, message, inCall, hasVideo, voiceOnly }, setCallState] = useState({
    state: 'idle', message: 'Ready to call.', inCall: false, hasVideo: false, voiceOnly: false,
  });

  useLayoutEffect(() => {
    const call = mountCall(viewport.current, setCallState);
    toggle.current = call.toggle;
    return call.close;
  }, []);

  const action = inCall ? 'End call' : 'Call voice agent';
  const Icon = inCall ? Square : Mic;
  return (
    <main className="voice-orb" data-state={state} data-avatar={hasVideo || undefined}>
      <video id="avatar" ref={viewport} autoPlay muted playsInline hidden={!hasVideo} aria-label="Voice agent avatar" />
      <button id="voice-toggle" type="button" aria-label={action} title={message + ' ' + action}
        onClick={() => void toggle.current()}>
        <Icon size={22} aria-hidden="true" fill={inCall ? 'currentColor' : 'none'} />
      </button>
      <div className="orb-label" aria-hidden="true">
        <span className="orb-dot" />{voiceOnly && state === 'listening' ? 'Voice only' : labels[state]}
      </div>
      <p id="status" role="status" aria-atomic="true">{message}</p>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<VoiceOrb />);
