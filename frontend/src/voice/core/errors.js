/** Stable error codes used across the core, providers and adapters. */
export const ErrorCodes = Object.freeze({
  UNSUPPORTED: 'UNSUPPORTED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NO_MICROPHONE: 'NO_MICROPHONE',
  NO_SPEECH: 'NO_SPEECH',
  NETWORK: 'NETWORK',
  RECOGNITION_FAILED: 'RECOGNITION_FAILED',
  NO_MATCH: 'NO_MATCH',
  ACTION_FAILED: 'ACTION_FAILED',
});

/** Localized user-facing messages for en-US and es-ES. Safe to speak aloud. */
export const MESSAGES = Object.freeze({
  'en-US': {
    [ErrorCodes.UNSUPPORTED]:
      "Voice recognition isn't supported in this browser. You can type a command instead.",
    [ErrorCodes.PERMISSION_DENIED]:
      'Microphone access is blocked. Please allow it in your browser settings.',
    [ErrorCodes.NO_MICROPHONE]: "I couldn't find a microphone.",
    [ErrorCodes.NO_SPEECH]: "I didn't hear anything. Please try again.",
    [ErrorCodes.NETWORK]: 'Speech recognition needs an internet connection.',
    [ErrorCodes.RECOGNITION_FAILED]: 'Speech recognition failed. Please try again.',
    [ErrorCodes.NO_MATCH]: "Sorry, I didn't understand that.",
    [ErrorCodes.ACTION_FAILED]: 'Something went wrong while doing that.',
  },
  'es-ES': {
    [ErrorCodes.UNSUPPORTED]:
      "El reconocimiento de voz no es compatible con este navegador. Puedes escribir un comando en su lugar.",
    [ErrorCodes.PERMISSION_DENIED]:
      'El acceso al micrófono está bloqueado. Por favor, permítelo en la configuración de tu navegador.',
    [ErrorCodes.NO_MICROPHONE]: "No pude encontrar un micrófono.",
    [ErrorCodes.NO_SPEECH]: "No escuché nada. Por favor, inténtalo de nuevo.",
    [ErrorCodes.NETWORK]: 'El reconocimiento de voz necesita una conexión a internet.',
    [ErrorCodes.RECOGNITION_FAILED]: 'El reconocimiento de voz falló. Por favor, inténtalo de nuevo.',
    [ErrorCodes.NO_MATCH]: "Lo siento, no entendí eso.",
    [ErrorCodes.ACTION_FAILED]: 'Algo salió mal al hacer eso.',
  },
});

export const DEFAULT_MESSAGES = MESSAGES['en-US'];

export class VoiceError extends Error {
  /**
   * @param {string} code one of ErrorCodes
   * @param {string} [message] user-facing message (defaults per code)
   * @param {string} [lang] locale ('en-US' or 'es-ES')
   */
  constructor(code, message, lang = 'en-US') {
    const dict = MESSAGES[lang] || DEFAULT_MESSAGES;
    super(message || dict[code] || DEFAULT_MESSAGES[code] || 'Something went wrong.');
    this.name = 'VoiceError';
    this.code = code;
  }
}