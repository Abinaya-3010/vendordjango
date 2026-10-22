"""Test-only settings: SQLite in memory so tests run without PostgreSQL."""
from .settings import *  # noqa

DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
GEMINI_API_KEY = ''
