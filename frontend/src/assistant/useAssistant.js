
import { reactive } from 'vue'
import { DEFAULT_MESSAGES, MESSAGES, ErrorCodes } from '../voice/core/errors.js'
import { getFormController, VENDOR_FORM } from '../voice/adapters/vendorpro/formBridge.js'
import { createVendorFormSession } from './vendorFormSession.js'

/** Explicit allowlist of approved router paths. Mirrors the server allowlist. A path must be in this
 *  list AND pass the injected canNavigate() check (e.g. "the router really has this route"). */
export const ALLOWED_PATHS = Object.freeze([
  '/', '/vendors', '/rfqs', '/quotations', '/purchase-orders', '/invoices', '/inventory',
])

export const ALLOWED_FORM_FIELDS = Object.freeze([
  'name', 'company', 'email', 'phone', 'category', 'address',
])

/** Extract and validate string fields allowed in the vendor form. Disallows any other keys or non-strings. */
export function extractAllowedFields(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const clean = {}
  for (const key of ALLOWED_FORM_FIELDS) {
    if (typeof raw[key] === 'string') {
      const val = raw[key].trim()
      if (val) clean[key] = val
    }
  }
  return clean
}

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
  getController = getFormController,
  getPathname = () => (typeof window !== 'undefined' ? window.location.pathname : '/'),
  timeoutMs = 2000,
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

  // Browser-local preferred name for the person using the assistant.
  // This is separate from the assistant's own display name.
  const USER_NAME_KEY = 'vendorpro.user.preferredName'
  function readPreferredName() {
    try {
      return typeof localStorage !== 'undefined'
        ? (localStorage.getItem(USER_NAME_KEY) || '').trim()
        : ''
    } catch {
      return ''
    }
  }
  let preferredName = readPreferredName()

  function respondLocally(reply) {
    push('assistant', reply)
    return speak(reply)
  }

  function preferredNameIntent(input) {
    const value = input.trim().replace(/[.!?]+$/, '').trim()
    if (/^(?:what(?:'s| is) (?:my name|the name you call me)|what (?:name|do you call me)|how do you (?:address|call) me|do you remember my name|what should you call me)\??$/i.test(value)) {
      return preferredName
        ? `I call you ${preferredName}.`
        : "You haven't told me what you'd like to be called yet. You can say 'Call me Abi'."
    }
    if (/^(?:forget (?:my name|what to call me)|don't call me by (?:my )?name|clear my preferred name)$/i.test(value)) {
      preferredName = ''
      try { if (typeof localStorage !== 'undefined') localStorage.removeItem(USER_NAME_KEY) } catch { /* browser storage unavailable */ }
      return "Okay, I won't use a preferred name for you."
    }
    const match = value.match(/^(?:please\s+)?(?:call me|you can call me|my name is|change my name to|change what you call me to|i prefer to be called)\s+(.+)$/i)
    if (!match) return null
    const name = match[1].trim().replace(/[.!?]+$/, '').trim()
    // Reject sentence-like or suspicious values rather than storing arbitrary chat text.
    if (!name || name.length > 40 || name.split(/\s+/).length > 4 || !/^[\p{L}][\p{L}\p{M} .'-]*$/u.test(name)) {
      return 'Please tell me a short name, for example: Call me Abi.'
    }
    try {
      if (typeof localStorage === 'undefined') throw new Error('Storage unavailable')
      localStorage.setItem(USER_NAME_KEY, name)
    } catch {
      return "I couldn't save that name in this browser. Please check browser storage settings."
    }
    preferredName = name
    return `Sure, I'll call you ${preferredName}.`
  }



  const formSession = createVendorFormSession({
    getController: () => getController(VENDOR_FORM),
    getLang: () => state.lang,
  })

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

  async function submit(raw, source = 'text') {
    const text = String(raw || '').trim()
    if (!text || state.status === 'processing') return
    const token = ++sessionId
    stopSpeaking()
    if (recognizer) recognizer.abort()

    if (formSession.isActive()) {
      push('user', text)
      state.status = 'processing'
      try {
        const sessionRes = await formSession.processInput(text)
        if (token !== sessionId) return
        if (sessionRes && sessionRes.reply) {
          push('assistant', sessionRes.reply)
          await speak(sessionRes.reply)
          if (token === sessionId && formSession.isActive() && source === 'voice' && state.voiceOutput) {
            startListening()
          }
        } else {
          state.status = 'idle'
        }
      } catch {
        if (token !== sessionId) return
        formSession.cancel()
        state.status = 'idle'
      }
      return
    }

    // Resolve personal-name requests deterministically, without asking Gemini.
    // Vendor form turns are handled above, so a vendor name is never mistaken for a user preference.
    const nameReply = preferredNameIntent(text)
    if (nameReply !== null) {
      push('user', text)
      await respondLocally(nameReply)
      return
    }

    const prior = history()
    push('user', text)
    state.status = 'processing'
    try {
      const data = await ask(text, prior, state.lang)
      if (token !== sessionId) return // cancelled or superseded
      let replyToSpeak = data.reply
      let sessionPrompt = ''

      const actions = Array.isArray(data.actions) ? data.actions : []
      const openVendorAction = actions.find((act) => act && act.type === 'open_vendor_form')

      if (openVendorAction) {
        if (openVendorAction.path === '/vendors') {
          const currentPath = getPathname()
          let navFailed = false
          if (currentPath !== '/vendors') {
            if (allowedPaths.includes('/vendors') && canNavigate('/vendors')) {
              try {
                const navResult = await Promise.resolve(navigate('/vendors'))
                if (navResult && typeof navResult === 'object' && navResult.type) {
                  navFailed = true
                }
              } catch {
                navFailed = true
              }
            } else {
              navFailed = true
            }
          }

          if (navFailed) {
            const navFailMsg = state.lang === 'es-ES'
              ? 'No se pudo navegar a la página de proveedores.'
              : 'Could not navigate to the vendors page.'
            push('assistant', data.reply)
            push('system', navFailMsg)
            await speak(data.reply)
            return
          }

          let ctrl = getController(VENDOR_FORM)
          if (!ctrl && timeoutMs > 0) {
            const start = Date.now()
            while (Date.now() - start < timeoutMs) {
              await new Promise((r) => setTimeout(r, 20))
              if (token !== sessionId) return
              ctrl = getController(VENDOR_FORM)
              if (ctrl) break
            }
          }
          if (token !== sessionId) return

          if (!ctrl) {
            const errText = state.lang === 'es-ES'
              ? 'No se pudo abrir el formulario de proveedores.'
              : 'Could not open the vendor form.'
            push('assistant', data.reply)
            push('system', errText)
          } else {
            const formState = ctrl.getState ? ctrl.getState() : {}
            if (formState.blockedBy) {
              const blockedMsg = state.lang === 'es-ES'
                ? 'No se puede abrir el formulario de proveedores porque hay otro diálogo abierto. Por favor, ciérrelo primero.'
                : 'Cannot open the vendor form because another dialog is currently open. Please close it first.'
              push('assistant', data.reply)
              push('system', blockedMsg)
            } else if (formState.mode === 'edit') {
              const editMsg = state.lang === 'es-ES'
                ? 'Un proveedor se está editando actualmente. Por favor, termine o cierre la edición primero.'
                : 'A vendor is currently being edited. Please finish or close it first.'
              push('assistant', data.reply)
              push('system', editMsg)
            } else {
              let opened = true
              if (!formState.open && ctrl.openAdd) {
                const openRes = ctrl.openAdd()
                if (openRes && openRes.opened === false && openRes.reason === 'blocked') {
                  opened = false
                  const blockedMsg = state.lang === 'es-ES'
                    ? 'No se puede abrir el formulario de proveedores porque hay otro diálogo abierto. Por favor, ciérrelo primero.'
                    : 'Cannot open the vendor form because another dialog is currently open. Please close it first.'
                  push('assistant', data.reply)
                  push('system', blockedMsg)
                }
              }
              if (opened) {
                const fields = extractAllowedFields(openVendorAction.fields)
                if (Object.keys(fields).length > 0 && ctrl.setFields) {
                  ctrl.setFields(fields)
                }
                const sessionStart = formSession.start(fields)
                if (sessionStart && sessionStart.success && sessionStart.reply) {
                  sessionPrompt = sessionStart.reply
                }
                push('assistant', data.reply)
                if (sessionPrompt) {
                  push('assistant', sessionPrompt)
                  replyToSpeak = `${data.reply} ${sessionPrompt}`.trim()
                }
              }
            }
          }
        } else {
          const sysMsg = state.lang === 'es-ES'
            ? 'Se ignoró una acción con una ruta desconocida.'
            : 'Ignored an action with an unexpected path.'
          push('assistant', data.reply)
          push('system', sysMsg)
        }
      } else {
        push('assistant', data.reply)
        const path = data.navigation && data.navigation.path
        if (path) {
          if (allowedPaths.includes(path) && canNavigate(path)) {
            try {
              await Promise.resolve(navigate(path))
            } catch {
              // Ignore navigation error
            }
          } else {
            const sysMsg = state.lang === 'es-ES'
              ? 'Se ignoró una solicitud de navegación a una página desconocida.'
              : 'Ignored a navigation request to an unknown page.'
            push('system', sysMsg)
          }
        }
      }
      await speak(replyToSpeak)
      if (token === sessionId && formSession.isActive() && source === 'voice' && state.voiceOutput) {
        startListening()
      }
    } catch (err) {
      if (token !== sessionId) return
      const dict = MESSAGES[state.lang] || DEFAULT_MESSAGES
      const errMsg = (err && err.message) || dict[ErrorCodes.ACTION_FAILED] || DEFAULT_MESSAGES.ACTION_FAILED
      push('error', errMsg)
      state.status = 'idle'
    }
  }

  function startListening() {
    if (state.status === 'processing' || state.status === 'speaking') return
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
        submit(transcript, 'voice')
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
    if (recognizer && typeof recognizer.stop === 'function') {
      recognizer.stop()
    } else {
      sessionId++
      if (recognizer) recognizer.abort()
      if (state.status === 'listening') state.status = 'idle'
    }
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
    if (formSession) formSession.cancel()
    stopSpeaking()
    stopListening()
    state.messages.splice(0)
  }

  return { state, submit, toggleMic, stopListening, stopSpeaking, setVoiceOutput, setLang, clear, formSession }
}
