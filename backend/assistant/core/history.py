def sanitize_history(raw, max_turns: int = 12, max_chars: int = 1500) -> list:
    """Keep only well-formed user/assistant TEXT turns; everything else is dropped.
    History is conversational context only - it can never carry tool results or permissions.
    Raises ValueError if ``raw`` is not a list (None -> empty)."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError('history must be a list')
    out = []
    for h in raw[-max_turns:]:
        if not isinstance(h, dict) or h.get('role') not in ('user', 'assistant'):
            continue
        text = h.get('text')
        if isinstance(text, str) and text.strip():
            out.append({'role': h['role'], 'text': text.strip()[:max_chars]})
    return out
