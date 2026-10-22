"""Generic tool definition, argument validation and registry. No domain knowledge."""
from dataclasses import dataclass
from typing import Any, Callable

from .types import ToolError, ToolSpec


@dataclass(frozen=True)
class Param:
    type: str  # 'string' | 'integer' | 'boolean'
    description: str
    enum: tuple = ()
    minimum: int | None = None
    maximum: int | None = None
    clamp: bool = False  # integers: clamp into [minimum, maximum] instead of rejecting


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    params: dict
    handler: Callable[[dict], dict]
    required: tuple = ()
    # Optional: turn a successful output into a client action, e.g. {'type': 'navigate', 'path': '/x'}.
    to_action: Callable[[dict], dict | None] | None = None

    def json_schema(self) -> dict:
        props = {}
        for pname, p in self.params.items():
            d: dict[str, Any] = {'type': p.type, 'description': p.description}
            if p.enum:
                d['enum'] = list(p.enum)
            if p.minimum is not None:
                d['minimum'] = p.minimum
            if p.maximum is not None:
                d['maximum'] = p.maximum
            props[pname] = d
        return {'type': 'object', 'properties': props, 'required': list(self.required)}

    def spec(self) -> ToolSpec:
        return ToolSpec(self.name, self.description, self.json_schema())


class ToolRegistry:
    """Allowlist of tools. Only tools registered here can ever be executed."""

    def __init__(self, tools, max_string: int = 100):
        self._tools: dict[str, Tool] = {}
        for t in tools:
            if t.name in self._tools:
                raise ValueError(f'Duplicate tool "{t.name}".')
            self._tools[t.name] = t
        self.max_string = max_string

    def __iter__(self):
        return iter(self._tools)

    def __contains__(self, name):
        return name in self._tools

    def get(self, name) -> Tool | None:
        return self._tools.get(name) if isinstance(name, str) else None

    def specs(self) -> list:
        return [t.spec() for t in self._tools.values()]

    def validate(self, tool: Tool, args: Any) -> dict:
        if args is None:
            args = {}
        if not isinstance(args, dict):
            raise ToolError('Arguments must be an object.')
        unknown = set(args) - set(tool.params)
        if unknown:
            raise ToolError(f'Unknown argument(s): {", ".join(sorted(map(str, unknown)))}.')
        clean: dict[str, Any] = {}
        for name, value in args.items():
            p = tool.params[name]
            if value is None:
                continue
            if p.type == 'string':
                if not isinstance(value, str):
                    raise ToolError(f'"{name}" must be a string.')
                value = value.strip()
                if not value:
                    continue
                if len(value) > self.max_string:
                    raise ToolError(f'"{name}" is too long.')
                if p.enum and value not in p.enum:
                    raise ToolError(f'"{name}" must be one of: {", ".join(p.enum)}.')
            elif p.type == 'integer':
                if isinstance(value, bool):
                    raise ToolError(f'"{name}" must be an integer.')
                if isinstance(value, float) and value.is_integer():
                    value = int(value)
                if not isinstance(value, int):
                    raise ToolError(f'"{name}" must be an integer.')
                if p.clamp:
                    if p.minimum is not None:
                        value = max(value, p.minimum)
                    if p.maximum is not None:
                        value = min(value, p.maximum)
                else:
                    if p.minimum is not None and value < p.minimum:
                        raise ToolError(f'"{name}" must be >= {p.minimum}.')
                    if p.maximum is not None and value > p.maximum:
                        raise ToolError(f'"{name}" must be <= {p.maximum}.')
            elif p.type == 'boolean':
                if not isinstance(value, bool):
                    raise ToolError(f'"{name}" must be true or false.')
            else:
                raise ToolError(f'Unsupported parameter type for "{name}".')
            clean[name] = value
        missing = [r for r in tool.required if r not in clean]
        if missing:
            raise ToolError(f'Missing required argument(s): {", ".join(missing)}.')
        return clean

    def run(self, name, args):
        """Validate and execute one model-requested call. Returns (output, client_action_or_None)."""
        tool = self.get(name)
        if tool is None:
            raise ToolError(f'Unknown tool "{str(name)[:40]}".')
        output = tool.handler(self.validate(tool, args))
        action = tool.to_action(output) if tool.to_action else None
        return output, action
