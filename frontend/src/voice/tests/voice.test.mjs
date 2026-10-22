// Run with: node --test frontend/src/voice/tests/voice.test.mjs   (Node >= 22, no dependencies)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VoiceAssistant, ActionRegistry, CommandMatcher, normalizeTranscript, ErrorCodes,
  BrowserSpeechRecognizer, BrowserSpeechSynthesizer,
} from '../index.js';
import { registerFormController, getFormController, VENDOR_FORM } from '../adapters/vendorpro/formBridge.js';
import { createVendorProActions } from '../adapters/vendorpro/vendorActions.js';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

// ---------- fakes ----------
class FakeRecognizer {
  constructor(supported = true) { this.supported = supported; this.handlers = null; this.aborts = 0; this.throwOnStart = false; }
  isSupported() { return this.supported; }
  start(h) { if (this.throwOnStart) throw new Error('boom'); this.handlers = h; }
  abort() { this.aborts += 1; }
  say(text) { this.handlers.onResult(text, 0.9); }   // deliver even if stale: core must ignore
  fail(code) { this.handlers.onError(code); }
}
class FakeSynth {
  constructor(supported = true) { this.supported = supported; this.spoken = []; this.cancels = 0; this.reject = false; }
  isSupported() { return this.supported; }
  async speak(t) { this.spoken.push(t); if (this.reject) throw new Error('tts'); }
  cancel() { this.cancels += 1; }
}
function build({ handler, recognizer = new FakeRecognizer(), synth = new FakeSynth(), ...opts } = {}) {
  const registry = new ActionRegistry();
  const calls = [];
  registry.register({
    id: 'test.go', phrases: ['go test', 'run test'],
    handler: handler || (async (ctx) => { calls.push(ctx); return { ok: true, message: 'Done.' }; }),
  });
  const a = new VoiceAssistant({ recognizer, synthesizer: synth, registry, ...opts });
  const events = [];
  ['statechange', 'transcript', 'result', 'error'].forEach((e) => a.on(e, (p) => events.push([e, p])));
  return { a, recognizer, synth, calls, events, registry };
}

// ---------- normalisation & matching ----------
test('normalizeTranscript', () => {
  assert.equal(normalizeTranscript('Open the Add Vendor page, please.'), 'add vendor');
  assert.equal(normalizeTranscript("I want to add a new vendor"), 'add new vendor');
  assert.equal(normalizeTranscript('Take me to the vendors page'), 'vendors');
  assert.equal(normalizeTranscript("Go to vendor's list"), 'vendors list');
  assert.equal(normalizeTranscript(''), '');
  assert.equal(normalizeTranscript(null), '');
});

test('matcher: accepts intended phrases, rejects others (incl. negation and chatter)', async () => {
  const actions = createVendorProActions({ navigate() {}, getPathname: () => '/' });
  const reg = new ActionRegistry();
  actions.forEach((x) => reg.register(x));
  const m = new CommandMatcher(reg);
  const yes = {
    'open vendors': 'vendors.navigate', 'Go to the vendors page': 'vendors.navigate',
    'show me the vendor list': 'vendors.navigate', 'vendors': 'vendors.navigate',
    'Open the Add Vendor page': 'vendors.openAddForm', 'add vendor': 'vendors.openAddForm',
    'add a new vendor': 'vendors.openAddForm', 'I want to add a vendor please': 'vendors.openAddForm',
    'open add vendor form': 'vendors.openAddForm', 'create new vendor': 'vendors.openAddForm',
  };
  for (const [t, id] of Object.entries(yes)) assert.equal(m.match(t)?.actionId, id, t);
  for (const t of ["don't add vendor", 'never add a vendor', 'what about vendors', 'delete vendor',
    'open invoices', 'add vendor and delete everything', "what's the weather", '', '   ', 'submit vendor']) {
    assert.equal(m.match(t), null, t);
  }
});

// ---------- registry ----------
test('registry validation', async () => {
  const r = new ActionRegistry();
  const h = async () => ({ ok: true, message: 'x' });
  assert.throws(() => r.register({ id: '', phrases: ['a'], handler: h }));
  assert.throws(() => r.register({ id: 'a', phrases: [], handler: h }));
  assert.throws(() => r.register({ id: 'a', phrases: ['a'], handler: 5 }));
  assert.throws(() => r.register({ id: 'a', phrases: ['a'], handler: h, requiresConfirmation: true }));
  const un = r.register({ id: 'a', phrases: ['alpha'], handler: h });
  assert.throws(() => r.register({ id: 'a', phrases: ['beta'], handler: h }), /already registered/);
  assert.throws(() => r.register({ id: 'b', phrases: ['Alpha'], handler: h }), /conflicts/);
  assert.equal(un(), true); assert.equal(r.has('a'), false);
  r.register({ id: 'b', phrases: ['alpha'], handler: h }); // phrase freed
});

test('registry.execute never rejects; bad results and throws become failures', async () => {
  const r = new ActionRegistry();
  r.register({ id: 'throws', phrases: ['t1'], handler: async () => { throw new Error('x'); } });
  r.register({ id: 'bad', phrases: ['t2'], handler: async () => 'nope' });
  const origErr = console.error; console.error = () => {};
  try {
    assert.equal((await r.execute('throws', {})).ok, false);
    assert.equal((await r.execute('bad', {})).ok, false);
    assert.equal((await r.execute('missing', {})).ok, false);
  } finally { console.error = origErr; }
});

// ---------- assistant flow ----------
test('happy path: voice -> match -> action -> spoken message -> idle', async () => {
  const { a, recognizer, synth, calls, events } = build();
  assert.equal(a.startListening(), true);
  assert.equal(a.state, 'listening');
  recognizer.say('Please go test');
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, false);
  assert.deepEqual(synth.spoken, ['Done.']);
  assert.equal(a.state, 'idle');
  assert.ok(events.some(([e, p]) => e === 'result' && p.ok === true && p.message === 'Done.'));
});

test('a failed action speaks its failure message, not success', async () => {
  const { a, recognizer, synth } = build({ handler: async () => ({ ok: false, message: 'It failed.' }) });
  a.startListening(); recognizer.say('go test'); await tick();
  assert.deepEqual(synth.spoken, ['It failed.']);
});

test('unknown command: no action, hint spoken', async () => {
  const { a, recognizer, synth, calls, events } = build({ unknownCommandHint: 'Try go test.' });
  a.startListening(); recognizer.say('what is the weather'); await tick();
  assert.equal(calls.length, 0);
  assert.match(synth.spoken[0], /didn't understand that\. Try go test\./);
  assert.ok(events.some(([e, p]) => e === 'error' && p.code === ErrorCodes.NO_MATCH));
  assert.equal(a.state, 'idle');
});

test('recognizer errors map to messages (permission, mic, network, silence)', async () => {
  for (const [code, re] of [
    [ErrorCodes.PERMISSION_DENIED, /Microphone access is blocked/],
    [ErrorCodes.NO_MICROPHONE, /couldn't find a microphone/],
    [ErrorCodes.NETWORK, /internet connection/],
    [ErrorCodes.NO_SPEECH, /didn't hear anything/],
  ]) {
    const { a, recognizer, synth, events, calls } = build();
    a.startListening(); recognizer.fail(code); await tick();
    assert.match(synth.spoken[0], re);
    assert.ok(events.some(([e, p]) => e === 'error' && p.code === code));
    assert.equal(calls.length, 0); assert.equal(a.state, 'idle');
  }
});

test('unsupported recognizer: UNSUPPORTED error, typed fallback still works', async () => {
  const { a, synth, events, calls } = build({ recognizer: new FakeRecognizer(false) });
  assert.equal(a.capabilities().recognition, false);
  assert.equal(a.startListening(), false); await tick();
  assert.ok(events.some(([e, p]) => e === 'error' && p.code === ErrorCodes.UNSUPPORTED));
  assert.equal(a.state, 'idle');
  assert.equal(a.submitText('go test'), true); await tick();
  assert.equal(calls.length, 1);
  assert.ok(synth.spoken.includes('Done.'));
});

test('recognizer.start throwing is reported, not thrown', async () => {
  const rec = new FakeRecognizer(); rec.throwOnStart = true;
  const { a, events } = build({ recognizer: rec });
  a.startListening(); await tick();
  assert.ok(events.some(([e, p]) => e === 'error' && p.code === ErrorCodes.RECOGNITION_FAILED));
  assert.equal(a.state, 'idle');
});

test('listen timeout -> NO_SPEECH and recognizer aborted', async () => {
  const { a, recognizer, events } = build({ listenTimeoutMs: 20 });
  a.startListening(); await tick(60);
  assert.ok(events.some(([e, p]) => e === 'error' && p.code === ErrorCodes.NO_SPEECH));
  assert.ok(recognizer.aborts >= 1); assert.equal(a.state, 'idle');
});

test('busy: second start is refused while not idle', async () => {
  const { a } = build();
  assert.equal(a.startListening(), true);
  assert.equal(a.startListening(), false);
  assert.equal(a.submitText('go test'), false);
  a.cancel(); // clear the listen timer
});

test('CANCEL: a late recognition result after cancel() cannot run an action', async () => {
  const { a, recognizer, calls, synth, events } = build();
  a.startListening(); a.cancel();
  assert.equal(a.state, 'idle');
  recognizer.say('go test'); recognizer.fail(ErrorCodes.NETWORK); await tick();
  assert.equal(calls.length, 0); assert.equal(synth.spoken.length, 0);
  assert.ok(!events.some(([e]) => e === 'transcript' || e === 'result' || e === 'error'));
  assert.equal(a.state, 'idle');
});

test('UNMOUNT: a late recognition result after destroy() cannot run an action or emit', async () => {
  const { a, recognizer, calls, synth, events } = build();
  a.startListening(); a.destroy();
  const before = events.length;
  recognizer.say('go test'); await tick();
  assert.equal(calls.length, 0); assert.equal(synth.spoken.length, 0);
  assert.equal(events.length, before);
  assert.equal(a.startListening(), false); assert.equal(a.submitText('go test'), false);
  a.destroy(); // idempotent
});

test('CANCEL while action runs: signal aborted, late result is dropped and nothing is spoken', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  let seenSignal;
  const { a, recognizer, synth, events } = build({
    handler: async ({ signal }) => { seenSignal = signal; await gate; return { ok: true, message: 'late' }; },
  });
  a.startListening(); recognizer.say('go test'); await tick();
  assert.equal(a.state, 'processing');
  a.cancel();
  assert.equal(seenSignal.aborted, true);
  release(); await tick();
  assert.equal(synth.spoken.length, 0);
  assert.ok(!events.some(([e]) => e === 'result'));
  assert.equal(a.state, 'idle');
});

test('DESTROY while action runs: no speech, no events', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { a, recognizer, synth, events } = build({ handler: async () => { await gate; return { ok: true, message: 'late' }; } });
  a.startListening(); recognizer.say('go test'); await tick();
  a.destroy(); const n = events.length; release(); await tick();
  assert.equal(synth.spoken.length, 0); assert.equal(events.length, n);
});

test('handler reporting cancelled stays silent', async () => {
  const { a, recognizer, synth } = build({ handler: async () => ({ ok: false, cancelled: true, message: '' }) });
  a.startListening(); recognizer.say('go test'); await tick();
  assert.equal(synth.spoken.length, 0); assert.equal(a.state, 'idle');
});

test('speech synthesis failure/absence does not change the result', async () => {
  const s1 = new FakeSynth(); s1.reject = true;
  const t1 = build({ synth: s1 }); t1.a.startListening(); t1.recognizer.say('go test'); await tick();
  assert.ok(t1.events.some(([e, p]) => e === 'result' && p.ok)); assert.equal(t1.a.state, 'idle');
  const t2 = build({ synth: new FakeSynth(false) }); t2.a.startListening(); t2.recognizer.say('go test'); await tick();
  assert.ok(t2.events.some(([e, p]) => e === 'result' && p.ok)); assert.equal(t2.a.state, 'idle');
});

test('cancel() while speaking returns to idle and cancels synthesis', async () => {
  const synth = new FakeSynth(); synth.speak = () => new Promise(() => {}); // never resolves
  const { a, recognizer } = build({ synth });
  a.startListening(); recognizer.say('go test'); await tick();
  assert.equal(a.state, 'speaking'); const c = synth.cancels;
  a.cancel(); assert.equal(a.state, 'idle'); assert.ok(synth.cancels > c);
});

// ---------- providers (fake browser APIs) ----------
function fakeSpeechCtor() {
  const instances = [];
  class R {
    constructor() { instances.push(this); this.started = false; this.aborted = false; this.stopped = false; }
    start() { if (R.throwStart) throw new Error('InvalidState'); this.started = true; }
    stop() { this.stopped = true; } abort() { this.aborted = true; }
  }
  return { R, instances };
}
const finalResult = (text, conf = 0.8) => ({ resultIndex: 0, results: [Object.assign([{ transcript: text, confidence: conf }], { isFinal: true })] });

test('BrowserSpeechRecognizer: result, error mapping, silence, abort detaches', () => {
  const { R, instances } = fakeSpeechCtor();
  const rec = new BrowserSpeechRecognizer({ SpeechRecognition: R });
  assert.equal(rec.isSupported(), true);
  assert.equal(new BrowserSpeechRecognizer({}).isSupported(), false);
  assert.equal(new BrowserSpeechRecognizer({ webkitSpeechRecognition: R }).isSupported(), true);

  let got = [];
  rec.start({ lang: 'en-US', onResult: (t, c) => got.push(['r', t, c]), onError: (c) => got.push(['e', c]) });
  const i = instances[0];
  assert.equal(i.lang, 'en-US'); assert.equal(i.continuous, false); assert.equal(i.interimResults, false);
  i.onresult(finalResult(' open vendors ')); i.onend && i.onend(); // end after result must not also report
  assert.deepEqual(got, [['r', 'open vendors', 0.8]]);

  for (const [browserErr, code] of [['not-allowed', 'PERMISSION_DENIED'], ['service-not-allowed', 'PERMISSION_DENIED'],
    ['audio-capture', 'NO_MICROPHONE'], ['no-speech', 'NO_SPEECH'], ['network', 'NETWORK'], ['weird', 'RECOGNITION_FAILED']]) {
    got = []; rec.start({ onResult() {}, onError: (c) => got.push(c) });
    instances.at(-1).onerror({ error: browserErr });
    assert.deepEqual(got, [code], browserErr);
  }
  got = []; rec.start({ onResult() {}, onError: (c) => got.push(c) });
  instances.at(-1).onend(); assert.deepEqual(got, ['NO_SPEECH']);

  // abort(): handlers detached, late result/error/end ignored
  got = []; rec.start({ onResult: () => got.push('r'), onError: () => got.push('e') });
  const j = instances.at(-1); const { onresult, onerror, onend } = j;
  rec.abort(); assert.equal(j.aborted, true);
  assert.equal(j.onresult, null);
  onresult && onresult(finalResult('late')); onerror && onerror({ error: 'network' }); onend && onend();
  assert.deepEqual(got, []);

  // starting again aborts the previous instance
  rec.start({ onResult() {}, onError() {} }); const k = instances.at(-1);
  rec.start({ onResult() {}, onError() {} }); assert.equal(k.aborted, true);

  // start() throwing
  R.throwStart = true; got = [];
  rec.start({ onResult() {}, onError: (c) => got.push(c) }); assert.deepEqual(got, ['RECOGNITION_FAILED']);
});

test('BrowserSpeechSynthesizer: speaks, resolves on end, cancel resolves pending, unsupported is a no-op', async () => {
  const spoken = [];
  class U { constructor(t) { this.text = t; } }
  const synth = { cancels: 0, speak(u) { spoken.push(u); }, cancel() { this.cancels += 1; }, getVoices: () => [{ lang: 'fr-FR' }, { lang: 'en-US', default: true, name: 'E' }] };
  const s = new BrowserSpeechSynthesizer({ globalObj: { speechSynthesis: synth, SpeechSynthesisUtterance: U } });
  assert.equal(s.isSupported(), true);
  const p = s.speak('Hello'); assert.equal(spoken[0].text, 'Hello'); assert.equal(spoken[0].lang, 'en-US'); assert.equal(spoken[0].voice.name, 'E');
  spoken[0].onend(); await p;
  const p2 = s.speak('Again'); s.cancel(); await p2; // resolves via cancel()
  assert.equal(await new BrowserSpeechSynthesizer({ globalObj: {} }).speak('x'), undefined);
  assert.equal(new BrowserSpeechSynthesizer({ globalObj: {} }).isSupported(), false);
});

// ---------- VendorPro actions against fake page controllers ----------
function makeHost(initial = '/') {
  const h = { path: initial, navigations: [], navigate(p) { h.navigations.push(p); h.path = p; }, getPathname: () => h.path };
  return h;
}
/** Fake VendorsPage controller with a mutable state, mimicking commit latency. */
function fakeController(state, { openDelay = 10, openWorks = true } = {}) {
  const c = {
    state: { open: false, mode: null, blockedBy: null, ...state }, openCalls: 0,
    getState() { return c.state; },
    openAdd() {
      c.openCalls += 1;
      const s = c.state;
      if (s.blockedBy) return { opened: false, reason: 'blocked' };
      if (s.open) return { opened: false, reason: s.mode === 'edit' ? 'edit-in-progress' : 'already-open' };
      if (openWorks) setTimeout(() => { c.state = { open: true, mode: 'add', blockedBy: null }; }, openDelay);
      return { opened: true };
    },
  };
  return c;
}
const run = async (id, host, signal = new AbortController().signal, timeoutMs = 300) => {
  const a = createVendorProActions(host, { timeoutMs }).find((x) => x.id === id);
  return a.handler({ signal });
};

test('openAddForm: on /vendors, closed modal -> opens and verifies BEFORE reporting success', async () => {
  const host = makeHost('/vendors'); const c = fakeController({}, { openDelay: 40 });
  const off = registerFormController(VENDOR_FORM, c);
  try {
    const r = await run('vendors.openAddForm', host);
    assert.deepEqual(r, { ok: true, message: 'Opening the Add Vendor form.' });
    assert.equal(c.state.open, true); assert.equal(c.state.mode, 'add'); // success only after the state was true
    assert.equal(host.navigations.length, 0); // no redundant navigation
  } finally { off(); }
});

test('openAddForm: from another page navigates to /vendors, waits for page mount, then opens', async () => {
  const host = makeHost('/invoices'); const c = fakeController({});
  const origNav = host.navigate;
  host.navigate = (p) => { origNav(p); setTimeout(() => registerFormController(VENDOR_FORM, c), 30); }; // page mounts later
  try {
    const r = await run('vendors.openAddForm', host);
    assert.equal(r.ok, true); assert.deepEqual(host.navigations, ['/vendors']); assert.equal(c.state.open, true);
  } finally { registerFormController(VENDOR_FORM, c)(); }
});

test('openAddForm: EDIT mode is never touched or reset', async () => {
  const host = makeHost('/vendors'); const c = fakeController({ open: true, mode: 'edit' });
  const off = registerFormController(VENDOR_FORM, c);
  try {
    const r = await run('vendors.openAddForm', host);
    assert.equal(r.ok, false); assert.match(r.message, /being edited/);
    assert.equal(c.openCalls, 0); assert.deepEqual(c.state, { open: true, mode: 'edit', blockedBy: null });
  } finally { off(); }
});

test('openAddForm: ADD already open -> not reset, reports already open', async () => {
  const host = makeHost('/vendors'); const c = fakeController({ open: true, mode: 'add' });
  const off = registerFormController(VENDOR_FORM, c);
  try {
    const r = await run('vendors.openAddForm', host);
    assert.deepEqual(r, { ok: true, message: 'The Add Vendor form is already open.' }); assert.equal(c.openCalls, 0);
  } finally { off(); }
});

test('openAddForm: vendor-details window open -> refused (modal would be hidden behind it)', async () => {
  const host = makeHost('/vendors'); const c = fakeController({ blockedBy: 'vendor-details' });
  const off = registerFormController(VENDOR_FORM, c);
  try {
    const r = await run('vendors.openAddForm', host);
    assert.equal(r.ok, false); assert.match(r.message, /details window/); assert.equal(c.openCalls, 0);
  } finally { off(); }
});

test('openAddForm: controller claims opened but state never confirms -> FAILS (no false success)', async () => {
  const host = makeHost('/vendors'); const c = fakeController({}, { openWorks: false });
  const off = registerFormController(VENDOR_FORM, c);
  try {
    const r = await run('vendors.openAddForm', host, undefined, 120);
    assert.equal(r.ok, false); assert.match(r.message, /couldn't confirm/);
  } finally { off(); }
});

test('openAddForm: Vendors page never mounts -> fails honestly', async () => {
  const host = makeHost('/invoices');
  const r = await run('vendors.openAddForm', host, undefined, 100);
  assert.equal(r.ok, false); assert.match(r.message, /couldn't open the Vendors page/);
});

test('openAddForm: aborted while waiting -> cancelled, modal never opened', async () => {
  const host = makeHost('/invoices'); const c = fakeController({}); const ac = new AbortController();
  host.navigate = (p) => { host.path = p; setTimeout(() => registerFormController(VENDOR_FORM, c), 80); };
  const p = run('vendors.openAddForm', host, ac.signal, 500);
  setTimeout(() => ac.abort(), 20);
  const r = await p;
  assert.equal(r.cancelled, true); assert.equal(c.openCalls, 0);
  await tick(120); // let the fake page's delayed mount fire, then clean it up
  registerFormController(VENDOR_FORM, c)();
  assert.equal(c.openCalls, 0); // and the late mount still never caused an open
});

test('vendors.navigate: verifies mount; "already there" wording', async () => {
  const c = fakeController({}); const off = registerFormController(VENDOR_FORM, c);
  try {
    assert.deepEqual(await run('vendors.navigate', makeHost('/vendors')), { ok: true, message: "You're already on the Vendors page." });
    const host = makeHost('/'); const r = await run('vendors.navigate', host);
    assert.deepEqual(r, { ok: true, message: 'Opening Vendors.' }); assert.deepEqual(host.navigations, ['/vendors']);
    assert.equal((await run('vendors.navigate', makeHost('/vendors/'))).ok, true); // trailing slash
  } finally { off(); }
  assert.equal((await run('vendors.navigate', makeHost('/'), undefined, 80)).ok, false); // no page -> no success
});

test('formBridge: stale unregister does not remove a newer controller', () => {
  const a = fakeController({}), b = fakeController({});
  const offA = registerFormController(VENDOR_FORM, a); const offB = registerFormController(VENDOR_FORM, b);
  offA(); assert.equal(getFormController(VENDOR_FORM), b);
  offB(); assert.equal(getFormController(VENDOR_FORM), null);
});

test('end-to-end: assistant + vendor actions + fake page (voice and typed)', async () => {
  const host = makeHost('/'); const c = fakeController({});
  const origNav = host.navigate; host.navigate = (p) => { origNav(p); setTimeout(() => registerFormController(VENDOR_FORM, c), 15); };
  const recognizer = new FakeRecognizer(); const synth = new FakeSynth();
  const a = new VoiceAssistant({ recognizer, synthesizer: synth });
  createVendorProActions(host).forEach((x) => a.registerAction(x));
  a.startListening(); recognizer.say('Open the Add Vendor page'); await tick(200);
  assert.deepEqual(synth.spoken, ['Opening the Add Vendor form.']);
  assert.equal(c.state.open, true); assert.equal(a.state, 'idle');
  // saying it again while open must not reset
  a.startListening(); recognizer.say('add vendor'); await tick(100);
  assert.equal(synth.spoken.at(-1), 'The Add Vendor form is already open.'); assert.equal(c.openCalls, 1);
  a.destroy(); registerFormController(VENDOR_FORM, c)();
});
