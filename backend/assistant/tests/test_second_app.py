from django.test import TestCase
from assistant.core.engine import AssistantEngine
from assistant.core.tools import Param, Tool, ToolRegistry
from assistant.core.types import ModelResponse, ToolCall

class MockLibraryAppRegistry(ToolRegistry):
    def __init__(self):
        books = [
            {'id': 1, 'title': 'Python Programming', 'author': 'Guido'},
            {'id': 2, 'title': 'Django for Beginners', 'author': 'William'},
        ]
        tools = [
            Tool('list_books', 'List library books.', {
                'author': Param('string', 'Author filter.')
            }, lambda args: {'books': [b for b in books if not args.get('author') or args['author'].lower() in b['author'].lower()]}),
            Tool('navigate_library', 'Navigate to library section.', {
                'section': Param('string', 'Section name.', enum=('catalog', 'loans'))
            }, lambda args: {'navigated': True, 'section': args['section']}, to_action=lambda o: {'type': 'navigate', 'path': f"/library/{o['section']}"})
        ]
        super().__init__(tools)

class MockLibraryScriptedProvider:
    def __init__(self, responses):
        self.responses = list(responses)
    def generate(self, system, turns, tools):
        return self.responses.pop(0)

class SecondApplicationFixtureTests(TestCase):
    def test_shared_core_reused_for_second_app(self):
        registry = MockLibraryAppRegistry()
        provider = MockLibraryScriptedProvider([
            ModelResponse(tool_calls=[ToolCall('c1', 'list_books', {'author': 'Guido'})]),
            ModelResponse(text='The book is Python Programming by Guido.')
        ])
        engine = AssistantEngine(provider, registry, 'You are a library assistant.')
        result = engine.run_turn('Find books by Guido')
        self.assertEqual(result.reply, 'The book is Python Programming by Guido.')
        self.assertEqual(result.tools_used, ['list_books'])

    def test_second_app_navigation_action(self):
        registry = MockLibraryAppRegistry()
        provider = MockLibraryScriptedProvider([
            ModelResponse(tool_calls=[ToolCall('c2', 'navigate_library', {'section': 'catalog'})]),
            ModelResponse(text='Opening library catalog.')
        ])
        engine = AssistantEngine(provider, registry, 'Library assistant.')
        result = engine.run_turn('open catalog')
        self.assertEqual(result.actions, [{'type': 'navigate', 'path': '/library/catalog'}])