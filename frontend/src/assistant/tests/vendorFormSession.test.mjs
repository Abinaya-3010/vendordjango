import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createVendorFormSession,
  extractFieldsFromText,
  normalizeEmail,
  getMissingRequiredFields,
  isAffirmative,
  isNegative,
  isCancel,
  isRepeat,
  isGoBack,
  detectCorrection,
  REQUIRED_VENDOR_FIELDS,
} from '../vendorFormSession.js'
import { createAssistant } from '../useAssistant.js'

function makeMockController(initial = {}) {
  const fields = { ...(initial.fields || {}) }
  const state = { open: true, mode: 'add', blockedBy: null, ...(initial.state || {}) }
  let saveCalls = 0
  let openAddCalls = 0

  return {
    fields,
    state,
    get saveCalls() { return saveCalls },
    get openAddCalls() { return openAddCalls },
    getState: () => ({ ...state }),
    getValues: () => ({ ...fields }),
    openAdd: () => {
      openAddCalls++
      if (state.blockedBy) return { opened: false, reason: 'blocked' }
      state.open = true
      return { opened: true }
    },
    setFields: (vals) => {
      if (state.blockedBy) return { success: false, reason: 'blocked' }
      if (state.mode === 'edit') return { success: false, reason: 'edit-in-progress' }
      Object.assign(fields, vals)
      return { success: true, values: { ...fields } }
    },
    save: async () => {
      saveCalls++
      return { success: true }
    },
  }
}

// ---------------------------------------------------------------------------
// 1. Utilities and parsing
// ---------------------------------------------------------------------------
test('normalizeEmail converts spoken phrases to valid email string', () => {
  assert.equal(normalizeEmail('john at example dot com'), 'john@example.com')
  assert.equal(normalizeEmail('SUPPORT AT ACME-CORP DOT COM'), 'support@acme-corp.com')
  assert.equal(normalizeEmail('user.name at domain dot org'), 'user.name@domain.org')
  assert.equal(normalizeEmail('already@valid.com'), 'already@valid.com')
})

test('getMissingRequiredFields accurately tracks name, company, email', () => {
  assert.deepEqual(getMissingRequiredFields({}), ['name', 'company', 'email'])
  assert.deepEqual(getMissingRequiredFields({ name: 'Acme' }), ['company', 'email'])
  assert.deepEqual(getMissingRequiredFields({ name: 'Acme', company: 'Acme Inc' }), ['email'])
  assert.deepEqual(getMissingRequiredFields({ name: 'Acme', company: 'Acme Inc', email: 'a@b.com' }), [])
  // Whitespace-only values count as missing
  assert.deepEqual(getMissingRequiredFields({ name: '   ', company: 'Acme Inc', email: 'a@b.com' }), ['name'])
})

test('intent recognition: affirmative, negative, cancel, repeat, go back', () => {
  assert.equal(isAffirmative('yes'), true)
  assert.equal(isAffirmative('YES please'), true)
  assert.equal(isAffirmative('save it'), true)
  assert.equal(isAffirmative('sí'), true)
  assert.equal(isAffirmative('guardar'), true)
  assert.equal(isAffirmative('maybe later'), false)

  assert.equal(isNegative('no'), true)
  assert.equal(isNegative("don't save"), true)
  assert.equal(isNegative('not yet'), true)
  assert.equal(isNegative('no guardar'), true)
  assert.equal(isNegative('yes'), false)

  assert.equal(isCancel('cancel'), true)
  assert.equal(isCancel('stop'), true)
  assert.equal(isCancel('cancelar'), true)

  assert.equal(isRepeat('repeat that'), true)
  assert.equal(isRepeat('say that again'), true)
  assert.equal(isRepeat('repite'), true)

  assert.equal(isGoBack('go back'), true)
  assert.equal(isGoBack('previous'), true)
  assert.equal(isGoBack('atrás'), true)
})

test('detectCorrection identifies target field and optional replacement value', () => {
  const c1 = detectCorrection('change email to test@example.com')
  assert.deepEqual(c1, { field: 'email', value: 'test@example.com' })

  const c2 = detectCorrection('update company to Global Logistics')
  assert.deepEqual(c2, { field: 'company', value: 'Global Logistics' })

  const c3 = detectCorrection('change email')
  assert.deepEqual(c3, { field: 'email', value: '' })

  const c4 = detectCorrection('cambiar teléfono a 1234567890')
  assert.deepEqual(c4, { field: 'phone', value: '1234567890' })

  assert.equal(detectCorrection('just a normal answer'), null)
})

test('extractFieldsFromText handles single-field answers and multi-field statements', () => {
  // Direct answer to prompt
  const res1 = extractFieldsFromText('Acme Supplies Ltd', 'name')
  assert.deepEqual(res1, { name: 'Acme Supplies Ltd' })

  // Strips conversational filler
  const res2 = extractFieldsFromText('The company is Acme Corp', 'company')
  assert.deepEqual(res2, { company: 'Acme Corp' })

  // Spoken email in direct answer
  const res3 = extractFieldsFromText('billing at acme dot com', 'email')
  assert.deepEqual(res3, { email: 'billing@acme.com' })

  // Multi-field statement
  const res4 = extractFieldsFromText('Name is Beta Tech, company is Beta Corp, and email is info at beta dot com', 'name')
  assert.deepEqual(res4, {
    name: 'Beta Tech',
    company: 'Beta Corp',
    email: 'info@beta.com',
  })
})

// ---------------------------------------------------------------------------
// 2. VendorFormSession state machine
// ---------------------------------------------------------------------------
test('VendorFormSession: full multi-turn interactive filling with confirmation and save', async () => {
  const ctrl = makeMockController()
  const session = createVendorFormSession({ getController: () => ctrl })

  // 1. Start session with empty form
  const r1 = session.start({})
  assert.equal(r1.success, true)
  assert.equal(r1.action, 'ask_field')
  assert.equal(r1.field, 'name')
  assert.match(r1.reply, /name/i)
  assert.equal(session.isActive(), true)

  // 2. Turn 1: user provides name
  const r2 = await session.processInput('Apex Industrial')
  assert.equal(ctrl.fields.name, 'Apex Industrial')
  assert.equal(r2.action, 'ask_field')
  assert.equal(r2.field, 'company')
  assert.match(r2.reply, /company/i)

  // 3. Turn 2: user provides company
  const r3 = await session.processInput('Apex Holdings')
  assert.equal(ctrl.fields.company, 'Apex Holdings')
  assert.equal(r3.action, 'ask_field')
  assert.equal(r3.field, 'email')
  assert.match(r3.reply, /email/i)

  // 4. Turn 3: user provides email
  const r4 = await session.processInput('apex at holdings dot com')
  assert.equal(ctrl.fields.email, 'apex@holdings.com')
  assert.equal(r4.action, 'confirm_save')
  assert.match(r4.reply, /draft ready/i)
  assert.match(r4.reply, /Apex Industrial/)
  assert.match(r4.reply, /save this vendor now/i)

  // 5. Turn 4: user confirms save
  assert.equal(ctrl.saveCalls, 0) // No save prior to confirmation!
  const r5 = await session.processInput('yes, please save')
  assert.equal(r5.ok, true)
  assert.equal(r5.action, 'saved')
  assert.match(r5.reply, /saved successfully/i)
  assert.equal(ctrl.saveCalls, 1)
  assert.equal(session.isActive(), false) // Session complete
})

test('VendorFormSession: multi-field initial start jumps directly to missing fields', async () => {
  const ctrl = makeMockController()
  const session = createVendorFormSession({ getController: () => ctrl })

  // Name and company already provided upfront
  const r1 = session.start({ name: 'Delta Services', company: 'Delta Group' })
  assert.equal(r1.success, true)
  assert.equal(r1.action, 'ask_field')
  assert.equal(r1.field, 'email') // Skips name and company!
  assert.match(r1.reply, /email/i)
})

test('VendorFormSession: user provides multiple details in one answer', async () => {
  const ctrl = makeMockController()
  const session = createVendorFormSession({ getController: () => ctrl })

  session.start({}) // asks for name
  const r = await session.processInput('Name is Gamma Ltd, company is Gamma Corp, email is gamma@corp.com')
  assert.equal(ctrl.fields.name, 'Gamma Ltd')
  assert.equal(ctrl.fields.company, 'Gamma Corp')
  assert.equal(ctrl.fields.email, 'gamma@corp.com')
  assert.equal(r.action, 'confirm_save')
  assert.match(r.reply, /draft ready/i)
})

test('VendorFormSession: correction command during form filling', async () => {
  const ctrl = makeMockController()
  const session = createVendorFormSession({ getController: () => ctrl })

  session.start({})
  await session.processInput('Omega Corp') // sets name
  assert.equal(ctrl.fields.name, 'Omega Corp')

  // User corrects name before proceeding
  const r = await session.processInput('change name to Omega International')
  assert.equal(ctrl.fields.name, 'Omega International')
  assert.match(r.reply, /Updated name/i)
  assert.equal(r.field, 'company') // Still prompts for company
})

test('VendorFormSession: repeat command repeats last prompt without modifying draft', async () => {
  const ctrl = makeMockController()
  const session = createVendorFormSession({ getController: () => ctrl })

  const startRes = session.start({})
  const repeatRes = await session.processInput('repeat that')
  assert.equal(repeatRes.action, 'repeat')
  assert.equal(repeatRes.reply, startRes.reply)
  assert.deepEqual(ctrl.fields, {})
})

test('VendorFormSession: go back returns to previous question', async () => {
  const ctrl = makeMockController()
  const session = createVendorFormSession({ getController: () => ctrl })

  session.start({})
  await session.processInput('Alpha Supplies') // name
  // Now on company. User says go back:
  const backRes = await session.processInput('go back')
  assert.equal(backRes.field, 'name')
  assert.match(backRes.reply, /name/i)
})

test('VendorFormSession: cancellation leaves draft and never saves', async () => {
  const ctrl = makeMockController()
  const session = createVendorFormSession({ getController: () => ctrl })

  session.start({ name: 'Partial Draft' })
  assert.equal(session.isActive(), true)

  const cancelRes = await session.processInput('cancel')
  assert.equal(cancelRes.action, 'cancelled')
  assert.equal(session.isActive(), false)
  assert.equal(ctrl.saveCalls, 0)
  assert.equal(ctrl.fields.name, 'Partial Draft') // draft preserved
})

test('VendorFormSession: confirmation rejection does not save and leaves draft open', async () => {
  const ctrl = makeMockController()
  const session = createVendorFormSession({ getController: () => ctrl })

  session.start({ name: 'Test', company: 'Test Co', email: 'test@example.com' })
  const r = await session.processInput('no, not yet')
  assert.equal(r.action, 'not_saved')
  assert.equal(r.ok, false)
  assert.match(r.reply, /draft remains open/i)
  assert.equal(ctrl.saveCalls, 0) // Did NOT save
  assert.equal(session.isActive(), false)
})

test('VendorFormSession: ambiguous confirmation response is rejected and clarified', async () => {
  const ctrl = makeMockController()
  const session = createVendorFormSession({ getController: () => ctrl })

  session.start({ name: 'Test', company: 'Test Co', email: 'test@example.com' })
  const r = await session.processInput('maybe tomorrow')
  assert.equal(r.action, 'clarify_confirm')
  assert.match(r.reply, /say 'yes' to save or 'no'/i)
  assert.equal(ctrl.saveCalls, 0)
  assert.equal(session.isActive(), true) // Still waiting for clear answer
})

test('VendorFormSession: edit mode and dialog conflict block session initialization', () => {
  const ctrlEdit = makeMockController({ state: { mode: 'edit' } })
  const sEdit = createVendorFormSession({ getController: () => ctrlEdit })
  const rEdit = sEdit.start({})
  assert.equal(rEdit.success, false)
  assert.equal(rEdit.reason, 'edit-in-progress')

  const ctrlBlocked = makeMockController({ state: { blockedBy: 'detail-dialog' } })
  const sBlocked = createVendorFormSession({ getController: () => ctrlBlocked })
  const rBlocked = sBlocked.start({})
  assert.equal(rBlocked.success, false)
  assert.equal(rBlocked.reason, 'blocked')
})

test('VendorFormSession: Spanish bilingual questions, draft summary, and confirmation', async () => {
  const ctrl = makeMockController()
  const session = createVendorFormSession({
    getController: () => ctrl,
    getLang: () => 'es-ES',
  })

  // Start in Spanish
  const r1 = session.start({})
  assert.match(r1.reply, /nombre del proveedor/i)

  // Turn 1
  const r2 = await session.processInput('Distribuciones S.A.')
  assert.match(r2.reply, /nombre de la empresa/i)

  // Turn 2
  const r3 = await session.processInput('Grupo Distribución')
  assert.match(r3.reply, /correo electrónico/i)

  // Turn 3
  const r4 = await session.processInput('contacto@distribuciones.es')
  assert.match(r4.reply, /Borrador de proveedor listo/i)
  assert.match(r4.reply, /guardar este proveedor ahora/i)

  // Turn 4: confirm in Spanish
  const r5 = await session.processInput('sí, guardar')
  assert.equal(r5.ok, true)
  assert.match(r5.reply, /guardado con éxito/i)
  assert.equal(ctrl.saveCalls, 1)
})

// ---------------------------------------------------------------------------
// 3. End-to-end integration with createAssistant
// ---------------------------------------------------------------------------
test('createAssistant: end-to-end multi-turn voice form flow from open to save', async () => {
  const ctrl = makeMockController()
  const spoken = []
  const synth = {
    isSupported: () => true,
    speak: (t) => { spoken.push(t); return Promise.resolve() },
    cancel: () => {},
  }
  let recHandlers = null
  const rec = {
    isSupported: () => true,
    start: (h) => { recHandlers = h },
    stop: () => {},
    abort: () => {},
  }

  const a = createAssistant({
    ask: async () => ({
      reply: 'Opening vendor form.',
      actions: [{ type: 'open_vendor_form', page: 'vendors', path: '/vendors', fields: {} }],
    }),
    getPathname: () => '/vendors',
    getController: () => ctrl,
    synthesizer: synth,
    recognizer: rec,
  })

  // 1. Initial voice command: "create vendor"
  a.toggleMic()
  recHandlers.onResult('create vendor')
  await new Promise((r) => setTimeout(r, 10))

  assert.equal(ctrl.state.open, true)
  assert.equal(a.formSession.isActive(), true)
  // Assistant combined reply spoken
  assert.ok(spoken.some((s) => s.includes("What is the vendor's name?")))

  // 2. Next turn: user speaks vendor name
  a.toggleMic()
  recHandlers.onResult('Solaris Energies')
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(ctrl.fields.name, 'Solaris Energies')
  assert.ok(spoken.some((s) => s.includes('What is the company name?')))

  // 3. Next turn: user speaks company name
  a.toggleMic()
  recHandlers.onResult('Solaris Power Corp')
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(ctrl.fields.company, 'Solaris Power Corp')
  assert.ok(spoken.some((s) => s.includes("What is the vendor's email address?")))

  // 4. Next turn: user speaks email address
  a.toggleMic()
  recHandlers.onResult('info at solaris dot com')
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(ctrl.fields.email, 'info@solaris.com')
  assert.ok(spoken.some((s) => s.includes('Would you like to save this vendor now?')))

  // 5. Turn 5: user confirms save
  assert.equal(ctrl.saveCalls, 0) // No save prior to explicit confirmation
  a.toggleMic()
  recHandlers.onResult('yes save')
  await new Promise((r) => setTimeout(r, 10))

  assert.equal(ctrl.saveCalls, 1)
  assert.equal(a.formSession.isActive(), false)
  assert.ok(spoken.some((s) => s.includes('saved successfully')))
})

test('createAssistant: text-to-speech lifecycle prevents microphone capture while speaking', async () => {
  let recStarted = false
  let resolveSpeak = null
  const synth = {
    isSupported: () => true,
    speak: () => new Promise((resolve) => { resolveSpeak = resolve }),
    cancel: () => { if (resolveSpeak) resolveSpeak() },
  }
  const rec = {
    isSupported: () => true,
    start: () => { recStarted = true },
    stop: () => {},
    abort: () => {},
  }
  const a = createAssistant({
    ask: async () => ({ reply: 'Talking now.', actions: [] }),
    synthesizer: synth,
    recognizer: rec,
  })

  const submitPromise = a.submit('hello')
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(a.state.status, 'speaking')

  // While speaking, startListening must NOT activate recognizer
  a.toggleMic()
  assert.equal(recStarted, false)
  assert.equal(a.state.status, 'speaking')

  // Interrupting speech resets state to idle
  a.stopSpeaking()
  assert.equal(a.state.status, 'idle')
  await submitPromise
})
