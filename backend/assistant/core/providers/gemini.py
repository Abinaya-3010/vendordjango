"""Gemini provider adapter (official Google Gen AI SDK: ``pip install google-genai``).

All Gemini-specific logic lives here. The key is passed in by the caller, never logged or returned.
Function calling is MANUAL (automatic function calling disabled) so the engine validates each call.
"""
import logging

from ..types import AssistantError, ModelResponse, ToolCall

log = logging.getLogger(__name__)

MIN_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS = 256, 65536


def _gemini_schema(node):
    """JSON-schema (lowercase types) -> Gemini Schema dict (uppercase types)."""
    if isinstance(node, dict):
        return {k: (v.upper() if k == 'type' and isinstance(v, str) else _gemini_schema(v)) for k, v in node.items()}
    if isinstance(node, list):
        return [_gemini_schema(x) for x in node]
    return node


class GeminiProvider:
    def __init__(self, api_key, model, timeout_seconds=20, max_output_tokens=4096, client=None):
        self.api_key = (api_key or '').strip()
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.max_output_tokens = max(MIN_OUTPUT_TOKENS, min(int(max_output_tokens), MAX_OUTPUT_TOKENS))
        self._client = client

    def _sdk(self):
        try:
            from google import genai
            from google.genai import types
        except ImportError as ex:
            raise AssistantError('config_error', 'The Google Gen AI SDK is not installed on the server '
                                 '(pip install google-genai).', 500) from ex
        return genai, types

    def _get_client(self, genai, types):
        if self._client is None:
            self._client = genai.Client(
                api_key=self.api_key,
                http_options=types.HttpOptions(timeout=int(self.timeout_seconds * 1000)),
            )
        return self._client

    def _contents(self, types, turns):
        contents = []
        for t in turns:
            if t['role'] == 'user':
                contents.append(types.Content(role='user', parts=[types.Part(text=t['text'])]))
            elif t['role'] == 'model':
                if t.get('raw') is not None:      # preserves provider-specific parts (e.g. thought signatures)
                    contents.append(t['raw'])
                elif t['text']:
                    contents.append(types.Content(role='model', parts=[types.Part(text=t['text'])]))
            elif t['role'] == 'tool':
                parts = [types.Part.from_function_response(name=r['name'], response={'result': r['output']})
                         for r in t['results']]
                contents.append(types.Content(role='user', parts=parts))
        return contents

    def generate(self, system, turns, tools):
        if self._client is None and not self.api_key:
            raise AssistantError('missing_api_key', 'The AI service is not configured: GEMINI_API_KEY is '
                                 'missing on the server.', 503)
        genai, types = self._sdk()
        client = self._get_client(genai, types)
        declarations = [
            types.FunctionDeclaration(
                name=s.name, description=s.description,
                parameters=_gemini_schema(s.parameters) if s.parameters.get('properties') else None)
            for s in tools
        ]
        config = types.GenerateContentConfig(
            system_instruction=system,
            tools=[types.Tool(function_declarations=declarations)],
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            temperature=0.2,
            max_output_tokens=self.max_output_tokens,
        )
        try:
            resp = client.models.generate_content(model=self.model, contents=self._contents(types, turns),
                                                  config=config)
        except AssistantError:
            raise
        except Exception as ex:
            raise self._map_error(ex) from None

        try:
            cand = resp.candidates[0] if resp.candidates else None
            calls = [ToolCall(id=getattr(fc, 'id', None) or f'call_{i}', name=fc.name, args=dict(fc.args or {}))
                     for i, fc in enumerate(resp.function_calls or [])]
            text = '' if calls else (resp.text or '')
            finish = str(getattr(cand, 'finish_reason', '') or '').upper()
        except Exception:
            raise AssistantError('bad_model_response', 'The AI service returned an unusable response.') from None
        if not calls and not text:
            if cand is None:
                raise AssistantError('bad_model_response', 'The AI service returned no answer (it may have been '
                                     'blocked). Try rephrasing.')
            if 'MAX_TOKENS' in finish:
                raise AssistantError('output_truncated', 'The AI used up its output limit before answering. Try a '
                                     'simpler question, or raise GEMINI_MAX_OUTPUT_TOKENS.', 502)
        return ModelResponse(text=text, tool_calls=calls, raw=cand.content if (cand and calls) else None)

    @staticmethod
    def _map_error(ex):
        code = getattr(ex, 'code', None)
        msg = str(getattr(ex, 'message', '') or ex).lower()
        log.warning('Gemini call failed: %s (code=%s)', type(ex).__name__, code)  # never log the key
        if code == 429:
            return AssistantError('rate_limited', 'The AI service is rate-limited right now. Please wait a '
                                  'moment and try again.', 429)
        if code in (401, 403) or 'api key' in msg or 'api_key' in msg:
            return AssistantError('invalid_api_key', 'The AI service rejected the server API key. Check '
                                  'GEMINI_API_KEY.', 503)
        if code == 404:
            return AssistantError('invalid_model', 'The configured Gemini model was not found. Check '
                                  'GEMINI_MODEL.', 503)
        if code == 400:
            return AssistantError('bad_request', 'The AI service rejected the request.', 502)
        if code in (408, 504) or 'timeout' in msg or 'timed out' in msg or 'deadline' in msg:
            return AssistantError('timeout', 'The AI service took too long to respond. Please try again.', 504)
        return AssistantError('provider_error', 'The AI service is unavailable right now. Please try again.', 502)
