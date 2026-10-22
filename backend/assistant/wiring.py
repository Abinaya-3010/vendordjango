"""Django glue: turns settings into a ready AssistantEngine. The only place that knows about
Django settings, the VendorPro tools and the Gemini adapter at the same time."""
from django.conf import settings

from .core.engine import AssistantEngine
from .core.types import AssistantError
from .vendorpro.prompt import SYSTEM_PROMPT
from .vendorpro.tools import build_registry


def build_provider():
    name = getattr(settings, 'ASSISTANT_PROVIDER', 'gemini')
    if name == 'gemini':
        from .core.providers.gemini import GeminiProvider
        return GeminiProvider(
            api_key=settings.GEMINI_API_KEY,
            model=settings.GEMINI_MODEL,
            timeout_seconds=settings.GEMINI_TIMEOUT_SECONDS,
            max_output_tokens=settings.GEMINI_MAX_OUTPUT_TOKENS,
        )
    raise AssistantError('config_error', f'Unknown assistant provider "{name}".', 500)


def get_engine(lang='en-US') -> AssistantEngine:
    prompt = SYSTEM_PROMPT
    if lang == 'es-ES':
        prompt += "\n\nCRITICAL LANGUAGE INSTRUCTION: Respond fluently in Spanish (es-ES). Keep database IDs, enum values, record numbers (e.g. RFQ-0001, PO-0001), and tool parameters unchanged when answering."
    else:
        prompt += "\n\nCRITICAL LANGUAGE INSTRUCTION: Respond in English (en-US)."
    return AssistantEngine(build_provider(), build_registry(), prompt,
                           total_timeout_seconds=settings.ASSISTANT_TOTAL_TIMEOUT_SECONDS)