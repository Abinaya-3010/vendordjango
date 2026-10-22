import { extractAllowedFields, ALLOWED_FORM_FIELDS } from './useAssistant.js'
import { getFormController, VENDOR_FORM } from '../voice/adapters/vendorpro/formBridge.js'

export const REQUIRED_VENDOR_FIELDS = Object.freeze(['name', 'company', 'email'])

export const PROMPTS = Object.freeze({
  'en-US': {
    name: "What is the vendor's name?",
    company: "What is the company name?",
    email: "What is the vendor's email address?",
    phone: "What is the phone number?",
    category: "What is the vendor's category?",
    address: "What is the vendor's address?",
    changePrompt: (field) => `What is the new ${field}?`,
    fieldUpdated: (field, val) => `Updated ${field} to ${val}.`,
    draftSummary: (f) =>
      `Vendor draft ready: Name is ${f.name || 'unspecified'}, Company is ${f.company || 'unspecified'}, Email is ${f.email || 'unspecified'}${f.phone ? ', Phone is ' + f.phone : ''}${f.category ? ', Category is ' + f.category : ''}${f.address ? ', Address is ' + f.address : ''}. Would you like to save this vendor now?`,
    saved: (name) => `Vendor ${name} saved successfully.`,
    notSaved: 'Not saved. The draft remains open for your review. You can make changes or save manually.',
    cancelled: 'Vendor creation cancelled.',
    ambiguousConfirm: "Please say 'yes' to save or 'no' to keep the draft without saving.",
    didNotCatch: (q) => `I didn't catch that. ${q}`,
    alreadyBeingEdited: 'A vendor is currently being edited. Please finish or close it first.',
    blockedByDialog: 'Cannot open the vendor form because another dialog is currently open. Please close it first.',
  },
  'es-ES': {
    name: '¿Cuál es el nombre del proveedor?',
    company: '¿Cuál es el nombre de la empresa?',
    email: '¿Cuál es el correo electrónico del proveedor?',
    phone: '¿Cuál es el número de teléfono?',
    category: '¿Cuál es la categoría del proveedor?',
    address: '¿Cuál es la dirección del proveedor?',
    changePrompt: (field) => `¿Cuál es el nuevo ${field}?`,
    fieldUpdated: (field, val) => `Se actualizó ${field} a ${val}.`,
    draftSummary: (f) =>
      `Borrador de proveedor listo: Nombre es ${f.name || 'no especificado'}, Empresa es ${f.company || 'no especificado'}, Correo electrónico es ${f.email || 'no especificado'}${f.phone ? ', Teléfono es ' + f.phone : ''}${f.category ? ', Categoría es ' + f.category : ''}${f.address ? ', Dirección es ' + f.address : ''}. ¿Desea guardar este proveedor ahora?`,
    saved: (name) => `Proveedor ${name} guardado con éxito.`,
    notSaved: 'No se guardó. El borrador permanece abierto para su revisión. Puede realizar cambios o guardar manualmente.',
    cancelled: 'Creación de proveedor cancelada.',
    ambiguousConfirm: "Por favor, diga 'sí' para guardar o 'no' para mantener el borrador sin guardar.",
    didNotCatch: (q) => `No entendí eso. ${q}`,
    alreadyBeingEdited: 'Un proveedor se está editando actualmente. Por favor, termine o cierre la edición primero.',
    blockedByDialog: 'No se puede abrir el formulario de proveedores porque hay otro diálogo abierto. Por favor, ciérrelo primero.',
  },
})

/** Normalizes voice email phrases like "john at example dot com" to "john@example.com" */
export function normalizeEmail(text) {
  if (!text) return ''
  let cleaned = String(text).trim().toLowerCase()
  cleaned = cleaned
    .replace(/\s+at\s+/gi, '@')
    .replace(/\s+dot\s+/gi, '.')
    .replace(/\s*@\s*/g, '@')
    .replace(/\s*\.\s*/g, '.')
    .replace(/\s+/g, '')

  const match = cleaned.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)
  return match ? match[0] : cleaned
}

/** Determines missing required fields given current form values */
export function getMissingRequiredFields(values = {}) {
  const missing = []
  for (const field of REQUIRED_VENDOR_FIELDS) {
    const val = values[field]
    if (!val || typeof val !== 'string' || !val.trim()) {
      missing.push(field)
    }
  }
  return missing
}

/** Check if utterance is an affirmative save confirmation */
export function isAffirmative(text) {
  const t = String(text || '').trim().toLowerCase()
  return /^(yes|yeah|yep|sure|confirm|confirmed|save|save it|please save|please do|ok|okay|sounds good|do it|sí|si|guardar|confirmar)(?:\s|$|[!.,?])/i.test(t)
}

/** Check if utterance is a negative confirmation */
export function isNegative(text) {
  const t = String(text || '').trim().toLowerCase()
  return /^(no|nope|don't save|do not save|not yet|keep draft|don't|no guardar|cancelar)(?:\s|$|[!.,?])/i.test(t)
}

/** Check if utterance is a cancel command */
export function isCancel(text) {
  const t = String(text || '').trim().toLowerCase()
  return /^(cancel|cancelar|stop|abort|close|exit|quit|never mind|close form)(?:\s|$|[!.,?])/i.test(t)
}

/** Check if utterance is a repeat command */
export function isRepeat(text) {
  const t = String(text || '').trim().toLowerCase()
  return /^(repeat|repeat that|say that again|what did you say|what was that|pardon|repita|repite|repite eso)(?:\s|$|[!.,?])/i.test(t)
}

/** Check if utterance is a go-back command */
export function isGoBack(text) {
  const t = String(text || '').trim().toLowerCase()
  return /^(go back|back|previous|previous field|atrás|atras|regresar|anterior)(?:\s|$|[!.,?])/i.test(t)
}

const FIELD_ALIAS_MAP = {
  name: 'name',
  nombre: 'name',
  company: 'company',
  empresa: 'company',
  email: 'email',
  correo: 'email',
  'correo electrónico': 'email',
  phone: 'phone',
  teléfono: 'phone',
  telefono: 'phone',
  category: 'category',
  categoría: 'category',
  categoria: 'category',
  address: 'address',
  dirección: 'address',
  direccion: 'address',
}

/** Detects requests to change/correct a specific field, e.g. "change email to x@y.com" or "change email" */
export function detectCorrection(text) {
  const t = String(text || '').trim()
  const match = t.match(/(?:change|update|edit|correct|cambiar|actualizar)\s+([a-zñáéíóú\s]+?)(?:\s+(?:to|a)\s+(.+))?$/i)
  if (!match) return null
  const rawField = match[1].trim().toLowerCase()
  const targetField = FIELD_ALIAS_MAP[rawField]
  if (!targetField || !ALLOWED_FORM_FIELDS.includes(targetField)) return null
  const value = match[2] ? match[2].trim() : ''
  return { field: targetField, value }
}

/** Extract recognized fields from multi-turn user utterance */
export function extractFieldsFromText(text, currentPromptField) {
  if (!text) return {}
  const raw = String(text).trim()
  const result = {}

  // 1. Multi-field pattern matching: "name is X, company is Y, email is Z"
  const multiPattern = /(?:(?:the\s+)?(name|company|email|phone|category|address|nombre|empresa|correo|teléfono|categoría|dirección)\s*(?:is|:|es)\s*([^,;]+))/gi
  let match
  let matchedAny = false
  while ((match = multiPattern.exec(raw)) !== null) {
    matchedAny = true
    const keyAlias = match[1].toLowerCase()
    const targetKey = FIELD_ALIAS_MAP[keyAlias]
    let val = (match[2] || '').trim()
    if (targetKey === 'email') val = normalizeEmail(val)
    if (targetKey && ALLOWED_FORM_FIELDS.includes(targetKey) && val) {
      result[targetKey] = val
    }
  }

  if (matchedAny && Object.keys(result).length > 0) {
    return extractAllowedFields(result)
  }

  // 2. Direct answer to currentPromptField
  if (currentPromptField && ALLOWED_FORM_FIELDS.includes(currentPromptField)) {
    let cleanVal = raw
    // Strip common leading conversational wrappers: "it is", "the name is", "my company is"
    cleanVal = cleanVal.replace(/^(?:the\s+|my\s+)?(?:name|company|email|phone|category|address)\s+(?:is|es)\s+/i, '')
    cleanVal = cleanVal.replace(/^(?:it\s+is|it's|is|es)\s+/i, '')
    cleanVal = cleanVal.replace(/^(?:put|set|enter)\s+/i, '')
    cleanVal = cleanVal.trim()

    if (currentPromptField === 'email') {
      cleanVal = normalizeEmail(cleanVal)
    }

    if (cleanVal) {
      result[currentPromptField] = cleanVal
      return extractAllowedFields(result)
    }
  }

  return {}
}

/**
 * Creates a stateful session manager for multi-turn voice/text form filling.
 */
export function createVendorFormSession({
  getController = () => getFormController(VENDOR_FORM),
  getLang = () => 'en-US',
  onSaveSuccess,
  onSessionEnd,
} = {}) {
  let state = 'idle' // 'idle' | 'filling' | 'awaiting_confirmation'
  let currentField = null
  let lastPrompt = ''
  let historyStack = []

  function getDict() {
    const lang = getLang()
    return PROMPTS[lang] || PROMPTS['en-US']
  }

  function isActive() {
    return state !== 'idle'
  }

  function getState() {
    return {
      status: state,
      currentField,
      lastPrompt,
      historyStack: [...historyStack],
    }
  }

  function cancel() {
    state = 'idle'
    currentField = null
    lastPrompt = ''
    historyStack = []
    if (onSessionEnd) onSessionEnd({ action: 'cancelled' })
  }

  /** Starts the multi-turn session after Add Vendor form is opened */
  function start(initialFields = {}) {
    const ctrl = getController()
    if (!ctrl) {
      cancel()
      return { success: false, reason: 'no-controller' }
    }

    const formState = ctrl.getState ? ctrl.getState() : {}
    if (formState.blockedBy) {
      cancel()
      const dict = getDict()
      return { success: false, reason: 'blocked', reply: dict.blockedByDialog }
    }
    if (formState.mode === 'edit') {
      cancel()
      const dict = getDict()
      return { success: false, reason: 'edit-in-progress', reply: dict.alreadyBeingEdited }
    }

    // Ensure dialog is open
    if (!formState.open && ctrl.openAdd) {
      const openRes = ctrl.openAdd()
      if (openRes && openRes.opened === false) {
        cancel()
        return { success: false, reason: 'open-failed' }
      }
    }

    // Apply any initial fields
    const cleanInitial = extractAllowedFields(initialFields)
    if (Object.keys(cleanInitial).length > 0 && ctrl.setFields) {
      ctrl.setFields(cleanInitial)
    }

    const currentValues = ctrl.getValues ? ctrl.getValues() : {}
    const missing = getMissingRequiredFields(currentValues)
    historyStack = []

    const dict = getDict()
    if (missing.length === 0) {
      state = 'awaiting_confirmation'
      currentField = null
      lastPrompt = dict.draftSummary(currentValues)
      return { success: true, action: 'confirm_save', reply: lastPrompt }
    }

    state = 'filling'
    currentField = missing[0]
    lastPrompt = dict[currentField] || dict.name
    return { success: true, action: 'ask_field', field: currentField, reply: lastPrompt }
  }

  /** Processes one user turn in the form filling workflow */
  async function processInput(rawText) {
    if (!isActive()) return null
    const text = String(rawText || '').trim()
    const ctrl = getController()
    const dict = getDict()

    if (!ctrl) {
      cancel()
      return { reply: dict.cancelled, action: 'cancelled' }
    }

    // 1. Check Cancel
    if (isCancel(text)) {
      cancel()
      return { reply: dict.cancelled, action: 'cancelled' }
    }

    // 2. Check Repeat
    if (isRepeat(text)) {
      return { reply: lastPrompt, action: 'repeat' }
    }

    // 3. Check Go Back
    if (isGoBack(text)) {
      if (state === 'awaiting_confirmation') {
        state = 'filling'
        currentField = historyStack.length > 0 ? historyStack.pop() : REQUIRED_VENDOR_FIELDS[REQUIRED_VENDOR_FIELDS.length - 1]
        lastPrompt = dict[currentField] || dict.name
        return { reply: lastPrompt, action: 'ask_field', field: currentField }
      }
      if (state === 'filling' && historyStack.length > 0) {
        currentField = historyStack.pop()
        lastPrompt = dict[currentField] || dict.name
        return { reply: lastPrompt, action: 'ask_field', field: currentField }
      }
      return { reply: lastPrompt, action: 'repeat' }
    }

    // 4. Check Correction ("change email to ...")
    const correction = detectCorrection(text)
    if (correction) {
      if (correction.value) {
        let val = correction.value
        if (correction.field === 'email') val = normalizeEmail(val)
        ctrl.setFields({ [correction.field]: val })
        const currentVals = ctrl.getValues ? ctrl.getValues() : {}
        const missing = getMissingRequiredFields(currentVals)
        if (missing.length === 0) {
          state = 'awaiting_confirmation'
          currentField = null
          lastPrompt = dict.draftSummary(currentVals)
          return { reply: lastPrompt, action: 'confirm_save' }
        }
        currentField = missing[0]
        state = 'filling'
        lastPrompt = dict[currentField]
        return { reply: `${dict.fieldUpdated(correction.field, val)} ${lastPrompt}`, action: 'ask_field', field: currentField }
      } else {
        currentField = correction.field
        state = 'filling'
        lastPrompt = dict.changePrompt(correction.field)
        return { reply: lastPrompt, action: 'ask_field', field: currentField }
      }
    }

    // 5. If awaiting confirmation
    if (state === 'awaiting_confirmation') {
      if (isAffirmative(text)) {
        const currentVals = ctrl.getValues ? ctrl.getValues() : {}
        const vendorName = currentVals.name || 'Vendor'
        state = 'idle'
        if (ctrl.save) {
          try {
            await Promise.resolve(ctrl.save())
          } catch {
            return { reply: dict.saveFailed, action: 'save_failed', ok: false }
          }
        }
        if (onSaveSuccess) onSaveSuccess(currentVals)
        if (onSessionEnd) onSessionEnd({ action: 'saved', values: currentVals })
        return { reply: dict.saved(vendorName), action: 'saved', ok: true }
      }
      if (isNegative(text)) {
        state = 'idle'
        if (onSessionEnd) onSessionEnd({ action: 'not_saved' })
        return { reply: dict.notSaved, action: 'not_saved', ok: false }
      }
      // Ambiguous: never treat as confirmation!
      return { reply: dict.ambiguousConfirm, action: 'clarify_confirm' }
    }

    // 6. In filling state: extract field values
    const extracted = extractFieldsFromText(text, currentField)
    if (Object.keys(extracted).length > 0) {
      if (ctrl.setFields) {
        ctrl.setFields(extracted)
      }
      if (currentField && !historyStack.includes(currentField)) {
        historyStack.push(currentField)
      }

      const currentVals = ctrl.getValues ? ctrl.getValues() : {}
      const missing = getMissingRequiredFields(currentVals)

      if (missing.length === 0) {
        state = 'awaiting_confirmation'
        currentField = null
        lastPrompt = dict.draftSummary(currentVals)
        return { reply: lastPrompt, action: 'confirm_save' }
      }

      currentField = missing[0]
      lastPrompt = dict[currentField] || dict.name
      return { reply: lastPrompt, action: 'ask_field', field: currentField }
    }

    // If nothing could be extracted from input
    return { reply: dict.didNotCatch(lastPrompt), action: 'did_not_catch' }
  }

  return {
    isActive,
    getState,
    start,
    processInput,
    cancel,
  }
}
