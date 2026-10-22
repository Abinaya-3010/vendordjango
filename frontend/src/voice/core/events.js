/**
 * Minimal event emitter. Framework-independent, no dependencies.
 * A throwing listener never breaks other listeners or the emitter's caller.
 */
export class Emitter {
  constructor() {
    this._handlers = new Map();
  }

  /** Subscribe. Returns an unsubscribe function. */
  on(event, fn) {
    if (typeof fn !== 'function') throw new TypeError('Listener must be a function');
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const set = this._handlers.get(event);
    if (set) set.delete(fn);
  }

  emit(event, payload) {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[voice] listener for "${event}" threw`, err);
      }
    }
  }

  clear() {
    this._handlers.clear();
  }
}
