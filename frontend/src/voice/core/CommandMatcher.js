import { normalizeTranscript } from './normalize.js';

/**
 * Rule-based English matcher. A transcript matches an action only when its
 * normalised form EQUALS one of the action's normalised phrases. Exact matching
 * is deliberate: "what about vendors" must not navigate anywhere.
 */
export class CommandMatcher {
  /** @param {import('./ActionRegistry.js').ActionRegistry} registry */
  constructor(registry) {
    this._registry = registry;
  }

  /** @returns {{ actionId: string, phrase: string, normalized: string } | null} */
  match(transcript) {
    const normalized = normalizeTranscript(transcript);
    if (!normalized) return null;
    for (const action of this._registry.list()) {
      const idx = action.normalizedPhrases.indexOf(normalized);
      if (idx !== -1) {
        return { actionId: action.id, phrase: action.phrases[idx], normalized };
      }
    }
    return null;
  }
}
