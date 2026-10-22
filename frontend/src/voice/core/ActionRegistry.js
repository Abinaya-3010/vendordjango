import { ErrorCodes, VoiceError } from './errors.js';
import { normalizeTranscript } from './normalize.js';

/**
 * Action definition:
 * {
 *   id: string,                      unique id, e.g. "vendors.openAddForm"
 *   description: string,
 *   phrases: string[],               English phrases that trigger it (matched exactly after normalisation)
 *   handler: async (ctx) => ({ ok: boolean, message: string, cancelled?: boolean })
 * }
 * ctx = { actionId, transcript, normalized, signal }   (signal is an AbortSignal)
 *
 * The handler is responsible for VERIFYING its outcome: `ok: true` must mean the
 * outcome really happened. The core speaks `message` as-is.
 */
export class ActionRegistry {
  constructor() {
    this._actions = new Map();
    this._phraseOwner = new Map();
  }

  /** Register an action. Returns an unregister function. Throws on invalid/duplicate definitions. */
  register(def) {
    if (!def || typeof def !== 'object') throw new TypeError('Action must be an object');
    const { id, handler, phrases } = def;
    if (typeof id !== 'string' || !id) throw new TypeError('Action id must be a non-empty string');
    if (typeof handler !== 'function') throw new TypeError(`Action "${id}" needs a handler function`);
    if (!Array.isArray(phrases) || phrases.length === 0) {
      throw new TypeError(`Action "${id}" needs at least one phrase`);
    }
    if (def.requiresConfirmation) {
      // Confirmation flows arrive with Milestone 2. Refuse rather than silently skip.
      throw new Error(`Action "${id}": requiresConfirmation is not supported yet`);
    }
    if (this._actions.has(id)) throw new Error(`Action "${id}" is already registered`);

    const normalizedPhrases = [];
    for (const phrase of phrases) {
      const norm = normalizeTranscript(phrase);
      if (!norm) throw new TypeError(`Action "${id}" has an empty phrase`);
      const owner = this._phraseOwner.get(norm);
      if (owner && owner !== id) {
        throw new Error(`Phrase "${phrase}" of "${id}" conflicts with action "${owner}"`);
      }
      normalizedPhrases.push(norm);
    }

    const entry = {
      id,
      description: def.description || '',
      phrases: [...phrases],
      normalizedPhrases,
      handler,
    };
    this._actions.set(id, entry);
    normalizedPhrases.forEach((p) => this._phraseOwner.set(p, id));

    return () => this.unregister(id, entry);
  }

  unregister(id, expectedEntry) {
    const entry = this._actions.get(id);
    if (!entry || (expectedEntry && entry !== expectedEntry)) return false;
    this._actions.delete(id);
    entry.normalizedPhrases.forEach((p) => {
      if (this._phraseOwner.get(p) === id) this._phraseOwner.delete(p);
    });
    return true;
  }

  has(id) {
    return this._actions.has(id);
  }

  list() {
    return [...this._actions.values()];
  }

  /** Never rejects. Always resolves to { ok, message, cancelled? }. */
  async execute(id, ctx) {
    const entry = this._actions.get(id);
    if (!entry) {
      return { ok: false, message: new VoiceError(ErrorCodes.ACTION_FAILED).message };
    }
    try {
      const result = await entry.handler({ ...ctx, actionId: id });
      if (!result || typeof result.ok !== 'boolean' || typeof result.message !== 'string') {
        return { ok: false, message: new VoiceError(ErrorCodes.ACTION_FAILED).message };
      }
      return { ok: result.ok, message: result.message, cancelled: !!result.cancelled };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[voice] action "${id}" threw`, err);
      return { ok: false, message: new VoiceError(ErrorCodes.ACTION_FAILED).message };
    }
  }
}
