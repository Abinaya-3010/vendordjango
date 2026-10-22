import test from 'node:test'
import assert from 'node:assert/strict'
import { createAssistant, speakable } from '../useAssistant.js'

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