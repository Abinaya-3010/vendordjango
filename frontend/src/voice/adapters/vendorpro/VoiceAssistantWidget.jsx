import React, { useEffect, useState } from 'react';
import { createBrowserVoiceAssistant } from '../../index.js';
import { useVendorProActions } from './useVendorProActions.js';

const STATE_LABEL = {
  idle: 'Ready',
  listening: 'Listening…',
  processing: 'Working…',
  speaking: 'Speaking…',
};

function MicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}

/**
 * Floating push-to-talk widget. Must be rendered inside <Router>.
 * Click the mic, speak one command; clicking again cancels.
 */
export default function VoiceAssistantWidget() {
  const [assistant, setAssistant] = useState(null);
  const [state, setState] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [message, setMessage] = useState(null); // { kind: 'success' | 'error', text }
  const [caps, setCaps] = useState({ recognition: true, synthesis: true });
  const [showTyping, setShowTyping] = useState(false);
  const [typed, setTyped] = useState('');

  // Create once on mount; destroy on unmount so stale callbacks can never act.
  useEffect(() => {
    const instance = createBrowserVoiceAssistant({
      unknownCommandHint: "You can say, open vendors, or add vendor.",
    });
    const c = instance.capabilities();
    setCaps(c);
    if (!c.recognition) setShowTyping(true);
    setAssistant(instance);
    return () => instance.destroy();
  }, []);

  useVendorProActions(assistant);

  useEffect(() => {
    if (!assistant) return undefined;
    const offs = [
      assistant.on('statechange', ({ state: s }) => {
        setState(s);
        if (s === 'listening') { setTranscript(''); setMessage(null); }
      }),
      assistant.on('transcript', ({ text }) => setTranscript(text)),
      assistant.on('result', ({ ok, message: text }) =>
        setMessage({ kind: ok ? 'success' : 'error', text })),
      assistant.on('error', ({ message: text }) => setMessage({ kind: 'error', text })),
    ];
    return () => offs.forEach((off) => off());
  }, [assistant]);

  const onMicClick = () => {
    if (!assistant) return;
    if (assistant.state === 'idle') {
      setMessage(null);
      assistant.startListening();
    } else {
      assistant.cancel();
    }
  };

  const onTypedSubmit = (e) => {
    e.preventDefault();
    const text = typed.trim();
    if (!assistant || !text) return;
    setMessage(null);
    setTranscript('');
    if (assistant.submitText(text)) setTyped('');
  };

  const busy = state !== 'idle';
  const micDisabled = !assistant || (!caps.recognition && !busy);
  const showPanel = busy || transcript || message || showTyping;

  return (
    <div style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 60, display: 'flex',
      flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
      {showPanel && (
        <div role="region" aria-label="Voice assistant"
          style={{ width: 290, maxWidth: 'calc(100vw - 48px)', padding: 12, borderRadius: 12,
            background: '#12121a', border: '1px solid rgba(99,102,241,0.25)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.5)', color: '#e2e8f0', fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: 11 }}>
            <span>Voice assistant · {STATE_LABEL[state]}</span>
            {!caps.recognition && <span>Voice unavailable</span>}
          </div>
          {transcript && (
            <div style={{ marginTop: 8 }}>
              <span style={{ color: '#94a3b8' }}>You said: </span>“{transcript}”
            </div>
          )}
          <div aria-live="polite" style={{ marginTop: message ? 8 : 0,
            color: message && message.kind === 'success' ? '#4ade80' : '#f87171' }}>
            {message && message.text}
          </div>
          {!caps.recognition && (
            <div style={{ marginTop: 8, color: '#94a3b8' }}>
              This browser doesn&apos;t support voice recognition. Type a command instead.
            </div>
          )}
          {!caps.synthesis && caps.recognition && (
            <div style={{ marginTop: 8, color: '#94a3b8' }}>
              Spoken replies aren&apos;t supported here; replies are shown as text.
            </div>
          )}
          {showTyping && (
            <form onSubmit={onTypedSubmit} style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} disabled={busy}
                aria-label="Type a command" placeholder="e.g. add vendor"
                style={{ flex: 1, padding: '6px 10px', borderRadius: 8, color: 'white', fontSize: 13,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }} />
              <button type="submit" disabled={busy || !typed.trim()}
                style={{ padding: '6px 12px', borderRadius: 8, color: 'white', fontSize: 13,
                  background: '#4f46e5', opacity: busy || !typed.trim() ? 0.5 : 1 }}>Go</button>
            </form>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" onClick={() => setShowTyping((v) => !v)}
          aria-label={showTyping ? 'Hide typed command box' : 'Show typed command box'}
          title="Type a command"
          style={{ width: 36, height: 36, borderRadius: 18, color: '#94a3b8', fontSize: 15,
            background: '#12121a', border: '1px solid rgba(255,255,255,0.1)' }}>⌨</button>
        <button type="button" onClick={onMicClick} disabled={micDisabled}
          aria-label={busy ? 'Cancel voice command' : 'Start voice command'}
          aria-pressed={state === 'listening'}
          title={caps.recognition
            ? 'Click, then speak. Your browser may send audio to its speech service.'
            : 'Voice recognition is not supported in this browser'}
          className={state === 'listening' ? 'animate-pulse' : ''}
          style={{ width: 56, height: 56, borderRadius: 28, color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: state === 'listening'
              ? 'linear-gradient(135deg, #ef4444, #f97316)'
              : 'linear-gradient(135deg, #6366f1, #c084fc)',
            boxShadow: '0 0 20px rgba(99,102,241,0.35)', opacity: micDisabled ? 0.4 : 1,
            cursor: micDisabled ? 'not-allowed' : 'pointer' }}>
          <MicIcon />
        </button>
      </div>
    </div>
  );
}
