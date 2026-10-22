import { ErrorCodes } from '../core/errors.js';

const ERROR_MAP = {
  'not-allowed': ErrorCodes.PERMISSION_DENIED,
  'service-not-allowed': ErrorCodes.PERMISSION_DENIED,
  'audio-capture': ErrorCodes.NO_MICROPHONE,
  'no-speech': ErrorCodes.NO_SPEECH,
  network: ErrorCodes.NETWORK,
  'language-not-supported': ErrorCodes.UNSUPPORTED,
};

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
      onError(ErrorCodes.UNSUPPORTED);
      return;
    }
    this.abort();

    const rec = new this._Ctor();
    let settled = false;
    const handle = {
      abort: () => {
        if (settled) return;
        settled = true;
        detach();
        try { rec.abort(); } catch (_) { /* ignore */ }
      },
    };
    const detach = () => {
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

    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let text = '';
      let confidenceSum = 0;
      let count = 0;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal && result[0]) {
          text += ` ${result[0].transcript}`;
          confidenceSum += result[0].confidence || 0;
          count += 1;
        }
      }
      text = text.trim();
      if (!text) return;
      settle(() => {
        try { rec.stop(); } catch (_) { /* ignore */ }
        onResult(text, count ? confidenceSum / count : 0);
      });
    };
    rec.onerror = (event) => {
      if (event.error === 'aborted') {
        settled = true;
        detach();
        return;
      }
      settle(() => onError(ERROR_MAP[event.error] || ErrorCodes.RECOGNITION_FAILED));
    };
    rec.onend = () => settle(() => onError(ErrorCodes.NO_SPEECH));

    this._active = handle;
    try {
      rec.start();
    } catch (_) {
      settle(() => onError(ErrorCodes.RECOGNITION_FAILED));
    }
  }

  abort() {
    const active = this._active;
    this._active = null;
    if (active) active.abort();
  }
}