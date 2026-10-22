import { API } from '../api'

// Must exceed the server's worst case: ASSISTANT_TOTAL_TIMEOUT_SECONDS - 5 + GEMINI_TIMEOUT_SECONDS
// (defaults 45 - 5 + 20 = 60 s). Override with VITE_ASSISTANT_TIMEOUT_MS in frontend/.env.
const TIMEOUT_MS = Number(import.meta.env.VITE_ASSISTANT_TIMEOUT_MS) || 75000

/** POST a question (plus text-only history and language) to the Django assistant endpoint.
 * Returns structured error messages mapped for en-US or es-ES. */
export async function askAssistant(message, history, lang = 'en-US') {
  try {
    const res = await API.post('/assistant/chat', { message, history, lang }, { timeout: TIMEOUT_MS })
    return res.data.data // { reply, navigation, toolsUsed }
  } catch (err) {
    if (err.response && err.response.data && err.response.data.message) {
      const e = new Error(err.response.data.message)
      e.code = err.response.data.code
      throw e
    }
    const isEs = lang === 'es-ES'
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      throw new Error(isEs ? 'El asistente tardó demasiado en responder. Por favor, inténtalo de nuevo.' : 'The assistant took too long to respond. Please try again.')
    }
    throw new Error(isEs ? 'No se pudo conectar con el servidor VendorPro. ¿Está ejecutándose el backend?' : 'Could not reach the VendorPro server. Is the backend running?')
  }
}