import { Emitter } from './events.js';
import { ActionRegistry } from './ActionRegistry.js';
import { CommandMatcher } from './CommandMatcher.js';
import { ErrorCodes, VoiceError } from './errors.js';

/**
 * Framework-independent push-to-talk voice assistant core.
 *
 * Providers (injected, replaceable):
 *   recognizer: { isSupported(): boolean,
 *                 start({ lang, onResult(text, confidence), onError(code) }): void,
 *                 abort(): void }
 *   synthesizer: { isSupported(): boolean, speak(text): Promise<void>, cancel(): void }
 *
 * States: 'idle' | 'listening' | 'processing' | 'speaking'
 * Events: 'statechange' {state} | 'transcript' {text, source}
 *         | 'result' {actionId, ok, message, transcript} | 'error' {code, message, transcript?}
 *
 * SAFE CANCELLATION: every listen/typed run owns a session token. cancel() and
 * destroy() invalidate the token, abort its AbortSignal and abort the recognizer.
 * Every async continuation re-checks the token, so a late recognition callback,
 * a late action result, or a callback after destroy() can never execute an
 * action, speak, or change state.
 */
export class VoiceAssistant {
  constructor({
    recognizer,
    synthesizer,
    registry = new ActionRegistry(),
    matcher,
    lang = 'en-US',
    listenTimeoutMs = 12000,
    unknownCommandHint = '',
  } = {}) {
    this.recognizer = recognizer || null;
    this.synthesizer = synthesizer || null;
    this.registry = registry;
    this.matcher = matcher || new CommandMatcher(registry);
    this.lang = lang;
    this.listenTimeoutMs = listenTimeoutMs;
    this.unknownCommandHint = unknownCommandHint;

    this._events = new Emitter();
    this._state = 'idle';
    this._sessionId = 0;
    this._abort = null;
    this._timer = null;
    this._destroyed = false;
  }

  get state() {
    return this._state;
  }

  get isDestroyed() {
    return this._destroyed;
  }

  capabilities() {
    return {
      recognition: !!(this.recognizer && this.recognizer.isSupported()),
      synthesis: !!(this.synthesizer && this.synthesizer.isSupported()),
    };
  }

  on(event, fn) {
    return this._events.on(event, fn);
  }

  registerAction(def) {
    return this.registry.register(def);
  }

  // ---- public controls ---------------------------------------------------

  /** Push-to-talk start. Returns false if busy or destroyed. */
  startListening() {
    if (this._destroyed || this._state !== 'idle') return false;
    const token = this._beginSession();

    if (!this.recognizer || !this.recognizer.isSupported()) {
      this._fail(token, ErrorCodes.UNSUPPORTED);
      return false;
    }

    // Don't let the assistant hear its own voice.
    this._safe(() => this.synthesizer && this.synthesizer.cancel());
    this._setState('listening');

    this._timer = setTimeout(() => {
      if (!this._isCurrent(token)) return;
      this._safe(() => this.recognizer.abort());
      this._fail(token, ErrorCodes.NO_SPEECH);
    }, this.listenTimeoutMs);

    try {
      this.recognizer.start({
        lang: this.lang,
        onResult: (text, confidence) => {
          if (!this._isCurrent(token)) return; // stale/cancelled/destroyed
          this._clearTimer();
          this._handleTranscript(token, text, 'voice', confidence);
        },
        onError: (code) => {
          if (!this._isCurrent(token)) return;
          this._clearTimer();
          this._fail(token, code);
        },
      });
    } catch (_) {
      if (this._isCurrent(token)) {
        this._clearTimer();
        this._fail(token, ErrorCodes.RECOGNITION_FAILED);
      }
    }
    return true;
  }

  /** Typed-command fallback. Same pipeline as voice from the matching step on. */
  submitText(text) {
    if (this._destroyed || this._state !== 'idle') return false;
    const token = this._beginSession();
    this._handleTranscript(token, String(text || ''), 'text', 1);
    return true;
  }

  /** Cancel whatever is in progress (listening, running an action, speaking). */
  cancel() {
    if (this._destroyed) return;
    this._invalidateSession();
    this._safe(() => this.recognizer && this.recognizer.abort());
    this._safe(() => this.synthesizer && this.synthesizer.cancel());
    this._setState('idle');
  }

  /** Permanently stop. Call on unmount. Late callbacks become no-ops. */
  destroy() {
    if (this._destroyed) return;
    this._invalidateSession();
    this._safe(() => this.recognizer && this.recognizer.abort());
    this._safe(() => this.synthesizer && this.synthesizer.cancel());
    this._destroyed = true;
    this._state = 'idle';
    this._events.clear();
  }

  // ---- internals ---------------------------------------------------------

  _beginSession() {
    this._invalidateSession();
    this._abort = new AbortController();
    return { id: this._sessionId, signal: this._abort.signal };
  }

  _invalidateSession() {
    this._sessionId += 1;
    this._clearTimer();
    if (this._abort) {
      this._abort.abort();
      this._abort = null;
    }
  }

  _isCurrent(token) {
    return !this._destroyed && token.id === this._sessionId && !token.signal.aborted;
  }

  _clearTimer() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  _setState(state) {
    if (this._destroyed || this._state === state) return;
    this._state = state;
    this._events.emit('statechange', { state });
  }

  _safe(fn) {
    try {
      return fn();
    } catch (_) {
      return undefined;
    }
  }

  async _handleTranscript(token, text, source, confidence) {
    if (!this._isCurrent(token)) return;
    this._events.emit('transcript', { text, source, confidence });
    this._setState('processing');

    const match = this.matcher.match(text);
    if (!match) {
      this._fail(token, ErrorCodes.NO_MATCH, text);
      return;
    }

    const result = await this.registry.execute(match.actionId, {
      transcript: text,
      normalized: match.normalized,
      signal: token.signal,
    });

    // Cancelled / unmounted while the action was running: report nothing, speak nothing.
    if (!this._isCurrent(token)) return;
    if (result.cancelled) {
      this._setState('idle');
      return;
    }

    this._events.emit('result', {
      actionId: match.actionId,
      ok: result.ok,
      message: result.message,
      transcript: text,
    });
    await this._speak(token, result.message);
  }

  async _fail(token, code, transcript) {
    if (!this._isCurrent(token)) return;
    let message = new VoiceError(code).message;
    if (code === ErrorCodes.NO_MATCH && this.unknownCommandHint) {
      message = `${message} ${this.unknownCommandHint}`;
    }
    this._events.emit('error', { code, message, transcript });
    await this._speak(token, message);
  }

  async _speak(token, text) {
    if (!this._isCurrent(token)) return;
    const synth = this.synthesizer;
    if (!text || !synth || !synth.isSupported()) {
      this._setState('idle');
      return;
    }
    this._setState('speaking');
    try {
      await synth.speak(text);
    } catch (_) {
      /* speech failure must not affect the already-determined result */
    }
    if (this._isCurrent(token)) this._setState('idle');
  }
}
