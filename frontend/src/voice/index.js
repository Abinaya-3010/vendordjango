/**
 * Public entry point of the reusable voice assistant SDK.
 * Nothing under ./core imports React, a router, axios or any app code.
 */
import { VoiceAssistant } from './core/VoiceAssistant.js';
import { BrowserSpeechRecognizer } from './providers/BrowserSpeechRecognizer.js';
import { BrowserSpeechSynthesizer } from './providers/BrowserSpeechSynthesizer.js';

export { VoiceAssistant } from './core/VoiceAssistant.js';
export { ActionRegistry } from './core/ActionRegistry.js';
export { CommandMatcher } from './core/CommandMatcher.js';
export { normalizeTranscript } from './core/normalize.js';
export { poll } from './core/utils.js';
export { ErrorCodes, VoiceError, DEFAULT_MESSAGES } from './core/errors.js';
export { BrowserSpeechRecognizer } from './providers/BrowserSpeechRecognizer.js';
export { BrowserSpeechSynthesizer } from './providers/BrowserSpeechSynthesizer.js';

/** Convenience factory: assistant using the browser speech providers. */
export function createBrowserVoiceAssistant(options = {}) {
  return new VoiceAssistant({
    recognizer: new BrowserSpeechRecognizer(),
    synthesizer: new BrowserSpeechSynthesizer({ lang: options.lang || 'en-US' }),
    ...options,
  });
}
