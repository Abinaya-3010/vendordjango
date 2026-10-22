"""Tests for the reusable core: no VendorPro, no database. Uses a toy 'calculator' domain."""
import ast
import subprocess
import sys
import types as pytypes
from pathlib import Path
from unittest import TestCase, mock

from assistant.core.engine import AssistantEngine
from assistant.core.history import sanitize_history
from assistant.core.providers.gemini import GeminiProvider, _gemini_schema
from assistant.core.tools import Param, Tool, ToolRegistry
from assistant.core.types import AssistantError, ModelResponse, ToolCall, ToolError

CORE = Path(__file__).resolve().parents[1] / 'core'
BACKEND = CORE.parents[1]


def toy_registry():
    return ToolRegistry([
        Tool('add', 'Add two integers.', {'a': Param('integer', 'a'), 'b': Param('integer', 'b')},
             lambda x: {'sum': x['a'] + x['b']}, required=('a', 'b'),
             to_action=lambda o: {'type': 'toast', 'text': f"sum={o['sum']}"}),
        Tool('top', 'Rows.', {'limit': Param('integer', 'n', minimum=1, maximum=3, clamp=True)},
             lambda x: {'n': x.get('limit', 3)}),
    ])


class Seq:
    def __init__(self, *items):
        self.items, self.specs_seen = list(items), []

    def generate(self, system, turns, tools):
        self.specs_seen.append(tools)
        r = self.items.pop(0)
        return r(turns) if callable(r) else r


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


class CoreReuseTests(TestCase):
    def test_toy_domain_end_to_end(self):
        p = Seq(ModelResponse(tool_calls=[ToolCall('1', 'add', {'a': 2, 'b': 3})]),
                lambda t: ModelResponse(text=f"Result {t[-1]['results'][0]['output']['sum']}"))
        res = AssistantEngine(p, toy_registry(), 'You are a calculator.').run_turn('2+3?')
        self.assertEqual((res.reply, res.tools_used), ('Result 5', ['add']))
        self.assertEqual(res.actions, [{'type': 'toast', 'text': 'sum=5'}])
        specs = p.specs_seen[0]
        self.assertEqual([s.name for s in specs], ['add', 'top'])      # providers see specs, not handlers
        self.assertFalse(hasattr(specs[0], 'handler'))

    def test_registry_allowlist_and_validation(self):
        reg = toy_registry()
        for name, args in (('nope', {}), ('add', {'a': 1}), ('add', {'a': 1, 'b': 'x'}), ('add', {'a': True, 'b': 1}),
                           ('add', {'a': 1, 'b': 2, 'c': 3}), ('add', [1]), (None, {})):
            with self.assertRaises(ToolError, msg=(name, args)):
                reg.run(name, args)
        self.assertEqual(reg.run('top', {'limit': 99})[0], {'n': 3})      # clamp=True
        with self.assertRaises(ValueError):
            ToolRegistry([toy_registry().get('add'), toy_registry().get('add')])

    def test_history_sanitiser(self):
        self.assertEqual(sanitize_history(None), [])
        with self.assertRaises(ValueError):
            sanitize_history('x')
        h = [{'role': 'system', 'text': 'x'}, 'junk', {'role': 'user', 'text': ' q '}, {'role': 'assistant', 'text': 'a' * 5000}]
        out = sanitize_history(h, max_chars=10)
        self.assertEqual(out, [{'role': 'user', 'text': 'q'}, {'role': 'assistant', 'text': 'a' * 10}])

    def test_deadline_stops_new_model_calls(self):
        clk = Clock()

        def slow_tool_call(turns):
            clk.t += 41            # first model call "took" 41s of the 45s budget
            return ModelResponse(tool_calls=[ToolCall('1', 'add', {'a': 1, 'b': 1})])
        p = Seq(slow_tool_call, ModelResponse(text='never reached'))
        with self.assertRaises(AssistantError) as c:
            AssistantEngine(p, toy_registry(), 's', total_timeout_seconds=45, min_call_seconds=5, clock=clk).run_turn('x')
        self.assertEqual((c.exception.code, c.exception.status), ('timeout', 504))
        self.assertEqual(len(p.items), 1)                      # second model call was NOT made

    def test_deadline_allows_call_with_enough_time_left(self):
        clk = Clock()

        def first(turns):
            clk.t += 39            # 6s left >= min_call_seconds
            return ModelResponse(tool_calls=[ToolCall('1', 'add', {'a': 1, 'b': 1})])
        p = Seq(first, ModelResponse(text='done'))
        res = AssistantEngine(p, toy_registry(), 's', total_timeout_seconds=45, clock=clk).run_turn('x')
        self.assertEqual(res.reply, 'done')

    def test_no_deadline_when_disabled(self):
        p = Seq(ModelResponse(text='ok'))
        self.assertEqual(AssistantEngine(p, toy_registry(), 's', total_timeout_seconds=None).run_turn('x').reply, 'ok')


class CoreIsolationTests(TestCase):
    FORBIDDEN = ('django', 'rest_framework', 'vms', 'corsheaders')

    def test_core_imports_nothing_project_specific(self):
        files = [p for p in CORE.rglob('*.py')]
        self.assertGreaterEqual(len(files), 6)
        for f in files:
            depth = len(f.relative_to(CORE).parts) - 1             # 0 for core/x.py, 1 for core/providers/x.py
            for node in ast.walk(ast.parse(f.read_text())):
                if isinstance(node, ast.Import):
                    mods = [a.name for a in node.names]
                elif isinstance(node, ast.ImportFrom):
                    self.assertLessEqual(node.level, depth + 1, f'{f} escapes core via relative import')
                    mods = [node.module or ''] if node.level == 0 else []
                else:
                    continue
                for m in mods:
                    top = m.split('.')[0]
                    self.assertNotIn(top, self.FORBIDDEN, f'{f} imports {m}')
                    if top == 'assistant':
                        self.assertTrue(m.startswith('assistant.core'), f'{f} imports {m}')

    def test_core_imports_without_django_or_vms_installed(self):
        code = ("import sys\nfor m in ('django','rest_framework','vms','corsheaders'): sys.modules[m]=None\n"
                "import assistant.core.engine, assistant.core.tools, assistant.core.history, assistant.core.providers.gemini\n"
                "print('ok')")
        r = subprocess.run([sys.executable, '-c', code], cwd=BACKEND, capture_output=True, text=True)
        self.assertEqual((r.returncode, r.stdout.strip()), (0, 'ok'), r.stderr[-500:])


# ---- Gemini adapter glue, exercised with a STUB SDK (not the real google-genai package) ----
def stub_sdk():
    class Obj:
        def __init__(self, **kw): self.__dict__.update(kw)
    t = pytypes.SimpleNamespace(
        HttpOptions=Obj, Content=Obj, Part=type('Part', (Obj,), {'from_function_response': staticmethod(lambda **kw: Obj(**kw))}),
        FunctionDeclaration=Obj, Tool=Obj, GenerateContentConfig=Obj, AutomaticFunctionCallingConfig=Obj)
    g = pytypes.ModuleType('google.genai'); g.types = t; g.Client = lambda **kw: Obj(**kw)
    google = pytypes.ModuleType('google'); google.genai = g
    return {'google': google, 'google.genai': g, 'google.genai.types': t}, Obj


class GeminiProviderTests(TestCase):
    USER = [{'role': 'user', 'text': 'x'}]

    def provider(self, Obj, handler, **kw):
        class Models:
            def generate_content(s, model, contents, config): return handler(model, contents, config)
        return GeminiProvider('k', 'gemini-test', client=Obj(models=Models()), **kw)

    def test_missing_key(self):
        with self.assertRaises(AssistantError) as c:
            GeminiProvider('', 'm').generate('s', self.USER, toy_registry().specs())
        self.assertEqual(c.exception.code, 'missing_api_key')

    def test_schema_conversion(self):
        s = _gemini_schema(toy_registry().get('add').json_schema())
        self.assertEqual((s['type'], s['properties']['a']['type']), ('OBJECT', 'INTEGER'))

    def test_function_call_and_text_paths_and_config(self):
        mods, Obj = stub_sdk(); seen = {}
        cand = Obj(content='RAW', finish_reason='STOP')
        fc = Obj(name='add', args={'a': 1, 'b': 2}, id=None)

        def handler(model, contents, config):
            seen.update(model=model, config=config, contents=contents)
            return Obj(candidates=[cand], function_calls=[fc] if len(contents) == 1 else None, text='done')
        with mock.patch.dict(sys.modules, mods):
            p = self.provider(Obj, handler)
            r1 = p.generate('sys', self.USER, toy_registry().specs())
            self.assertEqual((r1.tool_calls[0].name, r1.tool_calls[0].args, r1.raw), ('add', {'a': 1, 'b': 2}, 'RAW'))
            self.assertTrue(seen['config'].automatic_function_calling.disable)
            self.assertEqual((seen['model'], seen['config'].max_output_tokens), ('gemini-test', 4096))
            turns = self.USER + [{'role': 'model', 'text': '', 'tool_calls': r1.tool_calls, 'raw': 'RAW'},
                                 {'role': 'tool', 'results': [{'id': 'call_0', 'name': 'add', 'output': {'sum': 3}}]}]
            self.assertEqual(p.generate('sys', turns, toy_registry().specs()).text, 'done')
            self.assertEqual(seen['contents'][1], 'RAW')

    def test_output_token_cap_is_configurable_and_clamped(self):
        mods, Obj = stub_sdk(); seen = {}

        def handler(model, contents, config):
            seen['max'] = config.max_output_tokens
            return Obj(candidates=[Obj(content='c', finish_reason='STOP')], function_calls=None, text='ok')
        with mock.patch.dict(sys.modules, mods):
            for given, expected in ((8000, 8000), (10, 256), (10 ** 9, 65536)):
                self.provider(Obj, handler, max_output_tokens=given).generate('s', self.USER, toy_registry().specs())
                self.assertEqual(seen['max'], expected)

    def test_truncation_gives_clear_error_but_partial_text_is_kept(self):
        mods, Obj = stub_sdk()
        empty = lambda m, c, cfg: Obj(candidates=[Obj(content='c', finish_reason='FinishReason.MAX_TOKENS')], function_calls=None, text=None)
        partial = lambda m, c, cfg: Obj(candidates=[Obj(content='c', finish_reason='FinishReason.MAX_TOKENS')], function_calls=None, text='Half an answ')
        plain_empty = lambda m, c, cfg: Obj(candidates=[Obj(content='c', finish_reason='STOP')], function_calls=None, text=None)
        with mock.patch.dict(sys.modules, mods):
            with self.assertRaises(AssistantError) as c:
                self.provider(Obj, empty).generate('s', self.USER, toy_registry().specs())
            self.assertEqual((c.exception.code, c.exception.status), ('output_truncated', 502))
            self.assertIn('GEMINI_MAX_OUTPUT_TOKENS', c.exception.message)
            self.assertEqual(self.provider(Obj, partial).generate('s', self.USER, toy_registry().specs()).text, 'Half an answ')
            # empty without MAX_TOKENS is left to the engine's generic empty_response handling
            self.assertEqual(self.provider(Obj, plain_empty).generate('s', self.USER, toy_registry().specs()).text, '')

    def test_error_mapping_never_includes_key(self):
        mods, Obj = stub_sdk()

        def boom(code):
            def handler(m, c, cfg):
                e = Exception('boom SECRETKEY123'); e.code = code; e.message = 'boom SECRETKEY123'; raise e
            return self.provider(Obj, handler)
        expect = {429: 'rate_limited', 401: 'invalid_api_key', 403: 'invalid_api_key', 404: 'invalid_model',
                  400: 'bad_request', 504: 'timeout', 500: 'provider_error'}
        with mock.patch.dict(sys.modules, mods):
            for code, name in expect.items():
                with self.assertRaises(AssistantError) as c, self.assertLogs('assistant.core.providers.gemini', 'WARNING'):
                    boom(code).generate('s', self.USER, toy_registry().specs())
                self.assertEqual(c.exception.code, name)
                self.assertNotIn('SECRETKEY123', c.exception.message)
