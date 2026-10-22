from dataclasses import dataclass, field
from typing import Any


class ToolError(Exception):
    """Unknown tool or invalid arguments. The message is safe to show to the model."""


class AssistantError(Exception):
    """Error with a stable code and an HTTP-style status for whatever API layer wraps the engine."""

    def __init__(self, code: str, message: str, status: int = 502):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


@dataclass
class ToolCall:
    id: str
    name: str
    args: dict


@dataclass
class ModelResponse:
    text: str = ''
    tool_calls: list = field(default_factory=list)
    raw: Any = None  # provider-private payload echoed back on the next turn (e.g. thought signatures)


@dataclass
class ToolSpec:
    """What a provider is allowed to know about a tool. Handlers are never exposed to providers."""
    name: str
    description: str
    parameters: dict  # JSON-schema object


@dataclass
class AssistantResult:
    reply: str
    actions: list = field(default_factory=list)      # client actions emitted by tools (see Tool.to_action)
    tools_used: list = field(default_factory=list)
