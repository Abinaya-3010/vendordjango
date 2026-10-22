import { ErrorCodes } from '../core/errors.js';

const ERROR_MAP = {
  'not-allowed': ErrorCodes.PERMISSION_DENIED,
  'service-not-allowed': ErrorCodes.PERMISSION_DENIED,
  'audio-capture': ErrorCodes.NO_MICROPHONE,
  'no-speech': ErrorCodes.NO_SPEECH,
  network: ErrorCodes.NETWORK,
  'language-not-supported': ErrorCodes.UNSUPPORTED,
};

function safeLog(level, message, detail) {
  if (typeof console !== 'undefined' && typeof console[level] === 'function') {
    if (detail !== undefined) {
      console[level](`[SpeechRecognizer] ${message}`, detail);
    } else {
      console[level](`[SpeechRecognizer] ${message}`);
    }
  }
}

/**
 * Recognizer provider backed by the browser Web Speech API
 * (SpeechRecognition / webkitSpeechRecognition). Supports dynamic locale (`lang`).
 */
export class BrowserSpeechRecognizer {
  constructor(globalObj = typeof globalThis !== 'undefined' ? globalThis : undefined) {
    this._Ctor = globalObj && (globalObj.SpeechRecognition || globalObj.webkitSpeechRecognition);
    this._active = null;
  }

  isSupported() {
    return typeof this._Ctor === 'function';
  }

  start({ lang = 'en-US', onResult, onError }) {
    if (!this.isSupported()) {
      safeLog('warn', 'Web Speech API is not supported in this environment');
      onError(ErrorCodes.UNSUPPORTED);
      return;
    }
    this.abort();

    const rec = new this._Ctor();
    let settled = false;
    let latestTranscript = '';
    let latestConfidence = 0.8;
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let stopFallbackTimer = null;

    const detach = () => {
      if (stopFallbackTimer) {
        clearTimeout(stopFallbackTimer);
        stopFallbackTimer = null;
      }
      rec.onstart = null;
      rec.onaudiostart = null;
      rec.onsoundstart = null;
      rec.onspeechstart = null;
      rec.onspeechend = null;
      rec.onaudioend = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.onnomatch = null;
      if (this._active === handle) this._active = null;
    };
    const settle = (fn) => {
      if (settled) return;
      settled = true;
      detach();
      fn();
    };

    const handle = {
      stop: () => {
        if (settled) return;
        safeLog('info', 'stop requested');
        try {
          rec.stop();
        } catch (_) { /* ignore */ }
        stopFallbackTimer = setTimeout(() => {
          if (!settled) {
            safeLog('info', 'stop timeout fallback triggered');
            if (latestTranscript) {
              settle(() => onResult(latestTranscript, latestConfidence));
            } else {
              settle(() => onError(ErrorCodes.NO_SPEECH));
            }
          }
        }, 1200);
      },
      abort: () => {
        if (settled) return;
        settled = true;
        safeLog('info', 'abort called');
        detach();
        try { rec.abort(); } catch (_) { /* ignore */ }
      },
    };

    rec.onstart = () => safeLog('info', 'recognition started');
    rec.onaudiostart = () => safeLog('info', 'audio capture started');
    rec.onsoundstart = () => safeLog('info', 'sound detected');
    rec.onspeechstart = () => safeLog('info', 'speech detected');
    rec.onspeechend = () => safeLog('info', 'speech ended');
    rec.onaudioend = () => safeLog('info', 'audio capture ended');

    rec.onresult = (event) => {
      let fullText = '';
      let confidenceSum = 0;
      let count = 0;

      const results = event && event.results ? event.results : [];
      let allFinal = results.length > 0;

      for (let i = 0; i < results.length; i += 1) {
        const result = results[i];
        if (result) {
          if (!result.isFinal) {
            allFinal = false;
          }
          if (result[0]) {
            const chunk = result[0].transcript || '';
            if (chunk) {
              fullText += ` ${chunk}`;
            }
            confidenceSum += result[0].confidence || 0;
            count += 1;
          }
        }
      }

      fullText = fullText.trim();
      if (fullText) {
        latestTranscript = fullText;
        if (count > 0 && confidenceSum > 0) {
          latestConfidence = confidenceSum / count;
        }
        safeLog('info', 'result received', { charCount: fullText.length, isFinal: allFinal });
      }

      if (allFinal && fullText) {
        settle(() => {
          try { rec.stop(); } catch (_) { /* ignore */ }
          onResult(fullText, latestConfidence);
        });
      }
    };

    rec.onerror = (event) => {
      const err = event && event.error;
      safeLog('warn', 'recognition error', { code: err });
      if (err === 'aborted') {
        settled = true;
        detach();
        return;
      }
      if (latestTranscript) {
        settle(() => {
          try { rec.stop(); } catch (_) { /* ignore */ }
          onResult(latestTranscript, latestConfidence);
        });
        return;
      }
      settle(() => onError(ERROR_MAP[err] || ErrorCodes.RECOGNITION_FAILED));
    };

    rec.onend = () => {
      safeLog('info', 'recognition ended', { hasTranscript: !!latestTranscript });
      if (latestTranscript) {
        settle(() => onResult(latestTranscript, latestConfidence));
      } else {
        settle(() => onError(ErrorCodes.NO_SPEECH));
      }
    };

    this._active = handle;
    try {
      rec.start();
    } catch (_) {
      safeLog('warn', 'failed to start recognition');
      settle(() => onError(ErrorCodes.RECOGNITION_FAILED));
    }
  }

  stop() {
    const active = this._active;
    if (active && typeof active.stop === 'function') {
      active.stop();
    }
  }

  abort() {
    const active = this._active;
    this._active = null;
    if (active) active.abort();
  }
}