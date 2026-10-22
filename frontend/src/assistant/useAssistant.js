import { reactive } from 'vue'
import { DEFAULT_MESSAGES, MESSAGES, ErrorCodes } from '../voice/core/errors.js'

/** Explicit allowlist of approved router paths. Mirrors the server allowlist. A path must be in this
 *  list AND pass the injected canNavigate() check (e.g. "the router really has this route"). */
export const ALLOWED_PATHS = Object.freeze([
  '/', '/vendors', '/rfqs', '/quotations', '/purchase-orders', '/invoices', '/inventory',
])
const MAX_HISTORY = 12

/** Strip markdown-ish characters so speech doesn't read "asterisk asterisk". */
export function speakable(text) {
  return String(text).replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Framework-light assistant controller with bilingual support (en-US, es-ES)
 * and robust session/cancellation protection.
 */
export function createAssistant({
  ask, navigate, recognizer, synthesizer, lang = 'en-US', voiceOutput = true,
  allowedPaths = ALLOWED_PATHS, canNavigate = () => true,
}) {
  const state = reactive({
    messages: [], // {id, role: 'user'|'assistant'|'error'|'system', text}
    status: 'idle',
    voiceOutput,
    lang,
    micSupported: !!(recognizer && recognizer.isSupported()),
    speechSupported: !!(synthesizer && synthesizer.isSupported()),
  })
  let nextId = 1
  let speakToken = 0
  let sessionId = 0

  const push = (role, text) => state.messages.push({ id: nextId++, role, text })

  function history() {
    return state.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, text: m.text }))
  }

  function stopSpeaking() {
    speakToken += 1
    if (synthesizer) synthesizer.cancel()
    if (state.status === 'speaking') state.status = 'idle'
  }

  async function speak(text) {
    if (!state.voiceOutput || !synthesizer || !synthesizer.isSupported()) {
      state.status = 'idle'
      return
    }
    const token = ++speakToken
    state.status = 'speaking'
    await synthesizer.speak(speakable(text))
    if (token === speakToken && state.status === 'speaking') state.status = 'idle'
  }

  async function submit(raw) {
    const text = String(raw || '').trim()
    if (!text || state.status === 'processing') return
    const token = ++sessionId
    stopSpeaking()
    if (recognizer) recognizer.abort()
    const prior = history()
    push('user', text)
    state.status = 'processing'
    try {
      const data = await ask(text, prior, state.lang)
      if (token !== sessionId) return // cancelled or superseded
      push('assistant', data.reply)
      const path = data.navigation && data.navigation.path
      if (path) {
        if (allowedPaths.includes(path) && canNavigate(path)) navigate(path)
        else {
          const sysMsg = state.lang === 'es-ES'
            ? 'Se ignoró una solicitud de navegación a una página desconocida.'
            : 'Ignored a navigation request to an unknown page.'
          push('system', sysMsg)
        }
      }
      await speak(data.reply)
    } catch (err) {
      if (token !== sessionId) return
      const dict = MESSAGES[state.lang] || DEFAULT_MESSAGES
      const errMsg = (err && err.message) || dict[ErrorCodes.ACTION_FAILED] || DEFAULT_MESSAGES.ACTION_FAILED
      push('error', errMsg)
      state.status = 'idle'
    }
  }

  function startListening() {
    if (state.status === 'processing') return
    const token = ++sessionId
    if (!recognizer || !recognizer.isSupported()) {
      const dict = MESSAGES[state.lang] || DEFAULT_MESSAGES
      push('error', dict[ErrorCodes.UNSUPPORTED] || DEFAULT_MESSAGES.UNSUPPORTED)
      return
    }
    stopSpeaking()
    state.status = 'listening'
    recognizer.start({
      lang: state.lang,
      onResult: (transcript) => {
        if (token !== sessionId) return
        state.status = 'idle'
        submit(transcript)
      },
      onError: (code) => {
        if (token !== sessionId) return
        state.status = 'idle'
        const dict = MESSAGES[state.lang] || DEFAULT_MESSAGES
        push('error', dict[code] || DEFAULT_MESSAGES[code] || DEFAULT_MESSAGES.RECOGNITION_FAILED)
      },
    })
  }

  function stopListening() {
    sessionId++
    if (recognizer) recognizer.abort()
    if (state.status === 'listening') state.status = 'idle'
  }

  function toggleMic() {
    if (state.status === 'listening') stopListening()
    else startListening()
  }

  function setVoiceOutput(on) {
    state.voiceOutput = !!on
    if (!on) stopSpeaking()
  }

  function setLang(newLang) {
    if (newLang === 'en-US' || newLang === 'es-ES') {
      if (state.status === 'listening') {
        stopListening()
      }
      state.lang = newLang
      if (synthesizer && typeof synthesizer.lang !== 'undefined') {
        synthesizer.lang = newLang
      }
    }
  }

  function clear() {
    sessionId++
    stopSpeaking()
    stopListening()
    state.messages.splice(0)
  }

  return { state, submit, toggleMic, stopListening, stopSpeaking, setVoiceOutput, setLang, clear }
}
