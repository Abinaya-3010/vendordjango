from django.test import TestCase
from rest_framework.test import APIClient
from unittest import mock
from assistant.core.types import AssistantResult

class BilingualViewTests(TestCase):
    def setUp(self):
        self.c = APIClient()

    def test_bilingual_request_propagation(self):
        captured = []

        class MockEngine:
            def run_turn(self, message, history):
                captured.append((message, history))
                return AssistantResult(reply='Hola mundo' if message.startswith('Hola') else 'Hello world')

        with mock.patch('assistant.views.get_engine') as mock_get_engine:
            mock_engine = MockEngine()
            mock_get_engine.side_effect = lambda lang: mock_engine

            # Test Spanish request
            res_es = self.c.post('/api/assistant/chat', {'message': 'Hola', 'lang': 'es-ES'}, format='json')
            self.assertEqual(res_es.status_code, 200)
            self.assertEqual(res_es.json()['data']['reply'], 'Hola mundo')
            mock_get_engine.assert_called_with('es-ES')

            # Test English request
            res_en = self.c.post('/api/assistant/chat', {'message': 'Hello', 'lang': 'en-US'}, format='json')
            self.assertEqual(res_en.status_code, 200)
            self.assertEqual(res_en.json()['data']['reply'], 'Hello world')
            mock_get_engine.assert_called_with('en-US')