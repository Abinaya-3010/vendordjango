import test from 'node:test'
import assert from 'node:assert/strict'
import { createAssistant, speakable, extractAllowedFields } from '../useAssistant.js'

const synth = (supported = true) => ({
  spoken: [], cancelled: 0, resolve: null, lang: 'en-US',
  isSupported: () => supported,
  speak(t) { this.spoken.push(t); return Promise.resolve() },
  cancel() { this.cancelled++ },
})
const rec = (supported = true) => ({
  handlers: null, aborted: 0,
  isSupported: () => supported,
  start(h) { this.handlers = h }, abort() { this.aborted++ },
})
const make = (over = {}) => {
  const navs = [], calls = []
  const s = synth(), r = rec()
  const a = createAssistant({
    ask: async (m, h) => { calls.push({ m, h }); return { reply: 'You have **2** vendors.', navigation: null } },
    navigate: (p) => navs.push(p), recognizer: r, synthesizer: s, ...over,
  })
  return { a, navs, calls, s, r }
}

test('typed question goes through ask, shows reply, speaks it', async () => {
  const { a, calls, s } = make()
  await a.submit('Show me all vendors')
  assert.deepEqual(a.state.messages.map((m) => m.role), ['user', 'assistant'])
  assert.equal(calls[0].m, 'Show me all vendors')
  assert.deepEqual(s.spoken, ['You have 2 vendors.'])
  assert.equal(a.state.status, 'idle')
})

test('voice: recognised text appears as user message and uses same pipeline', async () => {
  const { a, r, calls } = make()
  a.toggleMic()
  assert.equal(a.state.status, 'listening')
  r.handlers.onResult('which rfqs are pending')
  await new Promise((res) => setTimeout(res, 0))
  assert.equal(a.state.messages[0].text, 'which rfqs are pending')
  assert.equal(calls.length, 1)
})

test('follow-up sends prior text turns only', async () => {
  const { a, calls } = make()
  await a.submit('pending POs?')
  await a.submit('which vendors?')
  assert.deepEqual(calls[1].h, [{ role: 'user', text: 'pending POs?' }, { role: 'assistant', text: 'You have **2** vendors.' }])
})

test('errors are shown, not spoken, and excluded from history', async () => {
  const { a, calls, s } = make({ ask: async () => { throw new Error('boom') } })
  await a.submit('x')
  assert.equal(a.state.messages.at(-1).role, 'error')
  assert.equal(s.spoken.length, 0)
  assert.equal(a.state.status, 'idle')
})

test('unsupported microphone reports error and does not pretend', () => {
  const { a } = make({ recognizer: rec(false) })
  assert.equal(a.state.micSupported, false)
  a.toggleMic()
  assert.equal(a.state.status, 'idle')
  assert.match(a.state.messages[0].text, /isn't supported/)
})

test('recognition errors (denied permission) surface a message', () => {
  const { a, r } = make()
  a.toggleMic(); r.handlers.onError('PERMISSION_DENIED')
  assert.match(a.state.messages[0].text, /Microphone access is blocked/)
  assert.equal(a.state.status, 'idle')
})

test('bilingual language switching and Spanish errors', () => {
  const { a, r, s } = make({ lang: 'en-US' })
  assert.equal(a.state.lang, 'en-US')
  a.setLang('es-ES')
  assert.equal(a.state.lang, 'es-ES')
  assert.equal(s.lang, 'es-ES')
  a.toggleMic(); r.handlers.onError('PERMISSION_DENIED')
  assert.match(a.state.messages[0].text, /micrófono está bloqueado/)
})

test('navigation only to allowlisted paths', async () => {
  const ok = make({ ask: async () => ({ reply: 'Opening.', navigation: { path: '/inventory' } }) })
  await ok.a.submit('open inventory'); assert.deepEqual(ok.navs, ['/inventory'])
  const bad = make({ ask: async () => ({ reply: 'x', navigation: { path: 'https://evil.example' } }) })
  await bad.a.submit('go'); assert.deepEqual(bad.navs, []); assert.equal(bad.a.state.messages.at(-1).role, 'system')
})

test('navigation needs BOTH the explicit allowlist and the injected canNavigate check', async () => {
  const noRoute = make({ ask: async () => ({ reply: 'x', navigation: { path: '/vendors' } }), canNavigate: () => false })
  await noRoute.a.submit('go'); assert.deepEqual(noRoute.navs, []); assert.equal(noRoute.a.state.messages.at(-1).role, 'system')
  const notListed = make({ ask: async () => ({ reply: 'x', navigation: { path: '/admin' } }), canNavigate: () => true })
  await notListed.a.submit('go'); assert.deepEqual(notListed.navs, [])
  const custom = make({ ask: async () => ({ reply: 'x', navigation: { path: '/reports' } }), allowedPaths: ['/reports'], canNavigate: (p) => p === '/reports' })
  await custom.a.submit('go'); assert.deepEqual(custom.navs, ['/reports'])
})

test('voice output toggle and stop speaking', async () => {
  const { a, s } = make()
  a.setVoiceOutput(false)
  await a.submit('hi'); assert.equal(s.spoken.length, 0)
  a.state.status = 'speaking'; a.stopSpeaking()
  assert.equal(a.state.status, 'idle'); assert.ok(s.cancelled > 0)
})

test('unsupported speech synthesis does not break replies', async () => {
  const { a } = make({ synthesizer: synth(false) })
  await a.submit('hi'); assert.equal(a.state.messages.at(-1).role, 'assistant'); assert.equal(a.state.status, 'idle')
})

test('speakable strips markdown', () => assert.equal(speakable('**Hi** `there`'), 'Hi there'))

const fakeController = (initialState = {}) => {
  const state = { open: false, mode: null, blockedBy: null, ...initialState }
  const fields = { ...(initialState.fields || {}) }
  let openCalls = 0
  let setFieldsCalls = 0
  return {
    state,
    fields,
    get openCalls() { return openCalls },
    get setFieldsCalls() { return setFieldsCalls },
    getState: () => ({ ...state }),
    openAdd: () => {
      openCalls++
      if (state.blockedBy) return { opened: false, reason: 'blocked', blockedBy: state.blockedBy }
      if (state.open) return { opened: false, reason: 'already-open' }
      state.open = true
      state.mode = 'add'
      return { opened: true }
    },
    setFields: (vals) => {
      if (state.blockedBy) return { success: false, reason: 'blocked', blockedBy: state.blockedBy }
      if (state.mode === 'edit') return { success: false, reason: 'edit-in-progress' }
      setFieldsCalls++
      Object.assign(fields, vals)
      return { success: true, values: { ...fields } }
    },
  }
}

test('extractAllowedFields allows only permitted string fields', () => {
  const raw = {
    name: 'Acme Supplies',
    company: 'Acme Inc',
    email: 'acme@example.com',
    phone: '1234567890',
    category: 'IT',
    address: '123 Main St',
    pan: 'ABCDE1234F',
    gst: 'GST123',
    bankName: 'Bank',
    accountNumber: '123456',
    rating: 5,
    status: 'Active',
    invalidNumber: 12345,
    nested: { a: 1 },
  }
  const clean = extractAllowedFields(raw)
  assert.deepEqual(clean, {
    name: 'Acme Supplies',
    company: 'Acme Inc',
    email: 'acme@example.com',
    phone: '1234567890',
    category: 'IT',
    address: '123 Main St',
  })
  assert.deepEqual(extractAllowedFields(null), {})
  assert.deepEqual(extractAllowedFields('bad'), {})
})

test('action open_vendor_form: navigates to /vendors and opens dialog with fields', async () => {
  const ctrl = fakeController()
  const { a, navs } = make({
    ask: async () => ({
      reply: 'Opening vendor form.',
      actions: [{
        type: 'open_vendor_form',
        page: 'vendors',
        path: '/vendors',
        fields: { name: 'New Vendor', email: 'vendor@example.com' },
      }],
    }),
    getPathname: () => '/',
    getController: () => ctrl,
  })
  await a.submit('Add vendor New Vendor')
  assert.deepEqual(navs, ['/vendors'])
  assert.equal(ctrl.openCalls, 1)
  assert.equal(ctrl.state.open, true)
  assert.equal(ctrl.fields.name, 'New Vendor')
  assert.equal(ctrl.fields.email, 'vendor@example.com')
})

test('action open_vendor_form: opens dialog when already on /vendors without re-navigation', async () => {
  const ctrl = fakeController()
  const { a, navs } = make({
    ask: async () => ({
      reply: 'Opening form.',
      actions: [{ type: 'open_vendor_form', page: 'vendors', path: '/vendors', fields: {} }],
    }),
    getPathname: () => '/vendors',
    getController: () => ctrl,
  })
  await a.submit('Open vendor form')
  assert.deepEqual(navs, [])
  assert.equal(ctrl.openCalls, 1)
  assert.equal(ctrl.state.open, true)
})

test('action open_vendor_form: preserves existing add draft and does not re-open', async () => {
  const ctrl = fakeController({ open: true, mode: 'add', fields: { name: 'Existing Draft' } })
  const { a } = make({
    ask: async () => ({
      reply: 'Adding details.',
      actions: [{
        type: 'open_vendor_form',
        path: '/vendors',
        fields: { email: 'additional@example.com' },
      }],
    }),
    getPathname: () => '/vendors',
    getController: () => ctrl,
  })
  await a.submit('Fill in email additional@example.com')
  assert.equal(ctrl.openCalls, 0)
  assert.equal(ctrl.fields.name, 'Existing Draft')
  assert.equal(ctrl.fields.email, 'additional@example.com')
})

test('action open_vendor_form: refuses to touch form when in edit mode', async () => {
  const ctrl = fakeController({ open: true, mode: 'edit' })
  const { a } = make({
    ask: async () => ({
      reply: 'Cannot open.',
      actions: [{ type: 'open_vendor_form', path: '/vendors', fields: { name: 'Overwrite Attempt' } }],
    }),
    getPathname: () => '/vendors',
    getController: () => ctrl,
  })
  await a.submit('Add vendor')
  assert.equal(ctrl.openCalls, 0)
  assert.equal(ctrl.setFieldsCalls, 0)
  assert.equal(a.state.messages.at(-1).role, 'system')
  assert.match(a.state.messages.at(-1).text, /edit/i)
})

test('action open_vendor_form: rejects unexpected paths', async () => {
  const ctrl = fakeController()
  const { a, navs } = make({
    ask: async () => ({
      reply: 'Opening.',
      actions: [{ type: 'open_vendor_form', path: '/invoices', fields: {} }],
    }),
    getPathname: () => '/',
    getController: () => ctrl,
  })
  await a.submit('open form')
  assert.deepEqual(navs, [])
  assert.equal(ctrl.openCalls, 0)
  assert.equal(a.state.messages.at(-1).role, 'system')
  assert.match(a.state.messages.at(-1).text, /unexpected path/i)
})

test('action open_vendor_form: controller registration timeout reports safe error message', async () => {
  const { a } = make({
    ask: async () => ({
      reply: 'Opening.',
      actions: [{ type: 'open_vendor_form', path: '/vendors', fields: {} }],
    }),
    getPathname: () => '/',
    getController: () => null,
    timeoutMs: 40,
  })
  await a.submit('add vendor')
  assert.equal(a.state.messages.at(-1).role, 'system')
  assert.match(a.state.messages.at(-1).text, /Could not open/i)
})

test('action open_vendor_form: never calls a create or save API operation', async () => {
  let saveAttempted = false
  const ctrl = fakeController()
  ctrl.save = () => { saveAttempted = true }
  const { a } = make({
    ask: async () => ({
      reply: 'Opened form.',
      actions: [{ type: 'open_vendor_form', path: '/vendors', fields: { name: 'Test' } }],
    }),
    getPathname: () => '/vendors',
    getController: () => ctrl,
  })
  await a.submit('Add vendor Test')
  assert.equal(saveAttempted, false)
})

test('action open_vendor_form: when canNavigate(/vendors) is false, reports error and never calls setFields or navigate', async () => {
  const ctrl = fakeController()
  const { a, navs } = make({
    ask: async () => ({
      reply: 'Opening.',
      actions: [{ type: 'open_vendor_form', path: '/vendors', fields: { name: 'Acme' } }],
    }),
    getPathname: () => '/',
    canNavigate: (p) => p !== '/vendors',
    getController: () => ctrl,
  })
  await a.submit('Add vendor Acme')
  assert.deepEqual(navs, [])
  assert.equal(ctrl.openCalls, 0)
  assert.equal(ctrl.setFieldsCalls, 0)
  assert.equal(a.state.messages.at(-1).role, 'system')
  assert.match(a.state.messages.at(-1).text, /Could not navigate to the vendors page/i)
})

test('action open_vendor_form: when navigate rejects with error, handles gracefully and never calls setFields', async () => {
  const ctrl = fakeController()
  const { a } = make({
    ask: async () => ({
      reply: 'Opening.',
      actions: [{ type: 'open_vendor_form', path: '/vendors', fields: { name: 'Acme' } }],
    }),
    getPathname: () => '/',
    navigate: () => Promise.reject(new Error('Navigation aborted')),
    getController: () => ctrl,
  })
  await a.submit('Add vendor Acme')
  assert.equal(ctrl.openCalls, 0)
  assert.equal(ctrl.setFieldsCalls, 0)
  assert.equal(a.state.messages.at(-1).role, 'system')
  assert.match(a.state.messages.at(-1).text, /Could not navigate to the vendors page/i)
})

test('action open_vendor_form: whitespace-only field values are ignored and setFields is not called', async () => {
  assert.deepEqual(extractAllowedFields({ name: '   ', email: ' \t\r\n ' }), {})
  const ctrl = fakeController()
  const { a } = make({
    ask: async () => ({
      reply: 'Opening.',
      actions: [{ type: 'open_vendor_form', path: '/vendors', fields: { name: '   ', email: '   ' } }],
    }),
    getPathname: () => '/vendors',
    getController: () => ctrl,
  })
  await a.submit('open form')
  assert.equal(ctrl.openCalls, 1)
  assert.equal(ctrl.setFieldsCalls, 0)
  assert.deepEqual(ctrl.fields, {})
})

test('action open_vendor_form: blocked when detail-dialog is active and never calls setFields', async () => {
  const ctrl = fakeController({ open: false, mode: null, blockedBy: 'detail-dialog' })
  const { a } = make({
    ask: async () => ({
      reply: 'Opening.',
      actions: [{ type: 'open_vendor_form', path: '/vendors', fields: { name: 'Acme' } }],
    }),
    getPathname: () => '/vendors',
    getController: () => ctrl,
  })
  await a.submit('Add vendor Acme')
  assert.equal(ctrl.openCalls, 0)
  assert.equal(ctrl.setFieldsCalls, 0)
  assert.equal(a.state.messages.at(-1).role, 'system')
  assert.match(a.state.messages.at(-1).text, /another dialog is currently open/i)
})

test('action open_vendor_form: localized Spanish error messages for blocked state, navigation failure, and edit mode', async () => {
  // Navigation failure in Spanish
  const { a: aNavFail } = make({
    lang: 'es-ES',
    ask: async () => ({
      reply: 'Abriendo.',
      actions: [{ type: 'open_vendor_form', path: '/vendors', fields: {} }],
    }),
    getPathname: () => '/',
    canNavigate: () => false,
  })
  await aNavFail.submit('abrir proveedores')
  assert.equal(aNavFail.state.messages.at(-1).role, 'system')
  assert.equal(aNavFail.state.messages.at(-1).text, 'No se pudo navegar a la página de proveedores.')

  // Blocked by detail dialog in Spanish
  const ctrlBlocked = fakeController({ blockedBy: 'detail-dialog' })
  const { a: aBlocked } = make({
    lang: 'es-ES',
    ask: async () => ({
      reply: 'Abriendo.',
      actions: [{ type: 'open_vendor_form', path: '/vendors', fields: {} }],
    }),
    getPathname: () => '/vendors',
    getController: () => ctrlBlocked,
  })
  await aBlocked.submit('abrir proveedores')
  assert.equal(aBlocked.state.messages.at(-1).role, 'system')
  assert.equal(aBlocked.state.messages.at(-1).text, 'No se puede abrir el formulario de proveedores porque hay otro diálogo abierto. Por favor, ciérrelo primero.')

  // Edit mode in Spanish
  const ctrlEdit = fakeController({ open: true, mode: 'edit' })
  const { a: aEdit } = make({
    lang: 'es-ES',
    ask: async () => ({
      reply: 'Abriendo.',
      actions: [{ type: 'open_vendor_form', path: '/vendors', fields: { name: 'Test' } }],
    }),
    getPathname: () => '/vendors',
    getController: () => ctrlEdit,
  })
  await aEdit.submit('agregar proveedor')
  assert.equal(aEdit.state.messages.at(-1).role, 'system')
  assert.equal(aEdit.state.messages.at(-1).text, 'Un proveedor se está editando actualmente. Por favor, termine o cierre la edición primero.')

  // Unexpected path in Spanish
  const { a: aPath } = make({
    lang: 'es-ES',
    ask: async () => ({
      reply: 'Abriendo.',
      actions: [{ type: 'open_vendor_form', path: '/invalid', fields: {} }],
    }),
    getPathname: () => '/',
  })
  await aPath.submit('abrir')
  assert.equal(aPath.state.messages.at(-1).role, 'system')
  assert.equal(aPath.state.messages.at(-1).text, 'Se ignoró una acción con una ruta desconocida.')
})

test('action open_vendor_form: ensuring failed navigation or blocked actions never call setFields', async () => {
  const ctrlBlocked = fakeController({ blockedBy: 'detail-dialog' })
  const ctrlEdit = fakeController({ open: true, mode: 'edit' })
  const ctrlNavFail = fakeController()

  // 1. Blocked by detail dialog
  const { a: a1 } = make({
    ask: async () => ({ reply: 'r', actions: [{ type: 'open_vendor_form', path: '/vendors', fields: { name: 'A' } }] }),
    getPathname: () => '/vendors',
    getController: () => ctrlBlocked,
  })
  await a1.submit('add')
  assert.equal(ctrlBlocked.setFieldsCalls, 0)

  // 2. Blocked by active edit
  const { a: a2 } = make({
    ask: async () => ({ reply: 'r', actions: [{ type: 'open_vendor_form', path: '/vendors', fields: { name: 'B' } }] }),
    getPathname: () => '/vendors',
    getController: () => ctrlEdit,
  })
  await a2.submit('add')
  assert.equal(ctrlEdit.setFieldsCalls, 0)

  // 3. Navigation rejected
  const { a: a3 } = make({
    ask: async () => ({ reply: 'r', actions: [{ type: 'open_vendor_form', path: '/vendors', fields: { name: 'C' } }] }),
    getPathname: () => '/',
    navigate: () => Promise.reject(new Error('fail')),
    getController: () => ctrlNavFail,
  })
  await a3.submit('add')
  assert.equal(ctrlNavFail.setFieldsCalls, 0)
})

test('voice: stopListening delegates to recognizer.stop() if available and allows transcript delivery', async () => {
  let stopCalls = 0
  let abortCalls = 0
  let handlers = null
  const stoppableRec = {
    isSupported: () => true,
    start(h) { handlers = h },
    stop() { stopCalls++ },
    abort() { abortCalls++ },
  }
  const { a, calls } = make({ recognizer: stoppableRec })
  a.toggleMic()
  assert.equal(a.state.status, 'listening')

  // User clicks stop
  a.toggleMic()
  assert.equal(stopCalls, 1)
  assert.equal(abortCalls, 0)

  // Recognizer delivers transcript following stop
  handlers.onResult('create vendor Acme Supplies')
  await new Promise((res) => setTimeout(res, 0))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].m, 'create vendor Acme Supplies')
  assert.equal(a.state.messages[0].text, 'create vendor Acme Supplies')
})

test('voice: NO_SPEECH error reports localized message in English and Spanish', () => {
  const { a: aEn, r: rEn } = make({ lang: 'en-US' })
  aEn.toggleMic()
  rEn.handlers.onError('NO_SPEECH')
  assert.equal(aEn.state.messages.at(-1).role, 'error')
  assert.equal(aEn.state.messages.at(-1).text, "I didn't hear anything. Please try again.")

  const { a: aEs, r: rEs } = make({ lang: 'es-ES' })
  aEs.toggleMic()
  rEs.handlers.onError('NO_SPEECH')
  assert.equal(aEs.state.messages.at(-1).role, 'error')
  assert.equal(aEs.state.messages.at(-1).text, 'No escuché nada. Por favor, inténtalo de nuevo.')
})
