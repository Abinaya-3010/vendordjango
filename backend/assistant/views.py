from rest_framework.decorators import api_view, throttle_classes
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from .core.history import sanitize_history
from .core.types import AssistantError
from .wiring import get_engine

MAX_MESSAGE_CHARS = 1000


class AssistantThrottle(AnonRateThrottle):
    scope = 'assistant'


def _fail(code, message, status):
    return Response({'success': False, 'code': code, 'message': message}, status=status)


def _navigation(actions):
    """API keeps its original `navigation` field: the last navigate action, if any."""
    nav = [a for a in actions if a.get('type') == 'navigate']
    return {'page': nav[-1]['page'], 'path': nav[-1]['path']} if nav else None


@api_view(['POST'])
@throttle_classes([AssistantThrottle])
def chat(request):
    body = request.data if isinstance(request.data, dict) else {}
    message = body.get('message')
    lang = body.get('lang', 'en-US')
    if lang not in ('en-US', 'es-ES'):
        lang = 'en-US'
    if not isinstance(message, str) or not message.strip():
        return _fail('invalid_request', 'Please enter a question.', 400)
    message = message.strip()
    if len(message) > MAX_MESSAGE_CHARS:
        return _fail('invalid_request', f'Message is too long (max {MAX_MESSAGE_CHARS} characters).', 400)
    try:
        history = sanitize_history(body.get('history'))
    except ValueError:
        return _fail('invalid_request', 'history must be a list.', 400)
    try:
        result = get_engine(lang).run_turn(message, history)
    except AssistantError as ex:
        return _fail(ex.code, ex.message, ex.status)
    return Response({'success': True, 'data': {
        'reply': result.reply, 'navigation': _navigation(result.actions), 'toolsUsed': result.tools_used}})