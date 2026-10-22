"""Provider-neutral, domain-neutral assistant loop.

Everything domain-specific is injected: the model ``provider``, the ``registry`` of allowlisted
tools and the ``system_prompt``. The engine validates every model-requested tool call (through the
registry), executes it, feeds the result back and stops with a final text answer.

Provider contract:  ``generate(system: str, turns: list, tools: list[ToolSpec]) -> ModelResponse``
Neutral turn format:
  {'role': 'user',  'text': str}
  {'role': 'model', 'text': str, 'tool_calls': [ToolCall...], 'raw': provider-private}
  {'role': 'tool',  'results': [{'id','name','output'}...]}

Deadline (cooperative, NOT pre-emptive): ``total_timeout_seconds`` is checked before each model
call; a new call is not started with less than ``min_call_seconds`` left. A call already in
flight is bounded only by the provider's own per-call timeout, and a running tool handler is never
interrupted. Worst case is therefore about
``total_timeout_seconds - min_call_seconds + provider_per_call_timeout`` plus tool time.
"""
import json
import logging
import time

from .history import sanitize_history
from .types import AssistantError, AssistantResult, ModelResponse, ToolError

log = logging.getLogger(__name__)


class AssistantEngine:
    def __init__(self, provider, registry, system_prompt: str, *, max_steps: int = 5, max_tool_calls: int = 6,
                 max_tool_output_chars: int = 12000, total_timeout_seconds: float | None = 45,
                 min_call_seconds: float = 5, clock=time.monotonic):
        self.provider = provider
        self.registry = registry
        self.system_prompt = system_prompt
        self.max_steps = max_steps
        self.max_tool_calls = max_tool_calls
        self.max_tool_output_chars = max_tool_output_chars
        self.total_timeout_seconds = total_timeout_seconds
        self.min_call_seconds = min_call_seconds
        self.clock = clock

    def _bounded(self, output):
        if len(json.dumps(output, default=str)) <= self.max_tool_output_chars:
            return output
        return {'error': 'Result too large; ask for fewer rows or narrower filters.'}

    def run_turn(self, message: str, history: list | None = None) -> AssistantResult:
        """Process one user message. ``history`` is text-only prior turns (sanitised again here)."""
        turns: list = []
        for h in sanitize_history(history):
            if h['role'] == 'user':
                turns.append({'role': 'user', 'text': h['text']})
            else:
                turns.append({'role': 'model', 'text': h['text'], 'tool_calls': [], 'raw': None})
        turns.append({'role': 'user', 'text': message})

        deadline = None if self.total_timeout_seconds is None else self.clock() + self.total_timeout_seconds
        actions, used = [], []
        for _ in range(self.max_steps):
            if deadline is not None and deadline - self.clock() < self.min_call_seconds:
                raise AssistantError('timeout', 'The assistant took too long. Please try a simpler question.', 504)
            resp = self.provider.generate(self.system_prompt, turns, self.registry.specs())
            if not isinstance(resp, ModelResponse):
                raise AssistantError('bad_model_response', 'The AI service returned an unusable response.')
            if not resp.tool_calls:
                text = (resp.text or '').strip()
                if not text:
                    raise AssistantError('empty_response', 'The AI service returned an empty answer. Please try again.')
                return AssistantResult(text, actions, used)

            turns.append({'role': 'model', 'text': resp.text or '', 'tool_calls': resp.tool_calls, 'raw': resp.raw})
            results = []
            for i, call in enumerate(resp.tool_calls):
                if i >= self.max_tool_calls:
                    out = {'error': 'Too many tool calls in one step; ignored.'}
                else:
                    try:
                        out, action = self.registry.run(call.name, call.args)
                        out = self._bounded(out)
                        used.append(call.name)
                        if action:
                            actions.append(action)
                    except ToolError as ex:
                        out = {'error': str(ex)}
                    except Exception:  # never leak internals to the model or the user
                        log.exception('Tool %s failed', call.name)
                        out = {'error': 'The data could not be retrieved.'}
                results.append({'id': call.id, 'name': call.name, 'output': out})
            turns.append({'role': 'tool', 'results': results})

        raise AssistantError('too_many_steps', 'I could not finish answering. Please try a more specific question.', 502)
