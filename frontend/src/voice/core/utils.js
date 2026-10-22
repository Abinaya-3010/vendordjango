/**
 * Poll `check` until it returns a truthy value (resolved) or the timeout /
 * abort signal fires (resolves null). Never rejects.
 * Used by adapters to VERIFY an outcome before reporting success.
 */
export function poll(check, { timeoutMs = 2000, intervalMs = 50, signal } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      if (signal && signal.aborted) return resolve(null);
      let value = null;
      try {
        value = check();
      } catch (_) {
        value = null;
      }
      if (value) return resolve(value);
      if (Date.now() - startedAt >= timeoutMs) return resolve(null);
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}
