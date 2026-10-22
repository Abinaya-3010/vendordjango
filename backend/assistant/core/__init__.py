"""Reusable, framework-free assistant core.

Nothing in this package may import Django, DRF, any project app (e.g. ``vms``) or
``assistant.vendorpro``. A project plugs in its own tools, system prompt and model
provider through ``AssistantEngine(provider, registry, system_prompt)``.
"""
