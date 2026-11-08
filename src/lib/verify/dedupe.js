// Per-batch de-duplication: the same key is computed once, concurrent and later callers share the
// result. Scope it to ONE batch (a run of certificates, or one request): it is deliberately not a
// process-wide cache, so one user's verification data is never served to another user's request
// (CLAUDE.md rule 4's spirit) and serverless instances need no shared state.
//
// A key whose computation rejects is forgotten, so a transient failure is not cached.

/**
 * @template T
 * @returns {{ run: (key: string, fn: () => Promise<T>) => Promise<T>, size: () => number }}
 */
export function createDeduper() {
  /** @type {Map<string, Promise<T>>} */
  const inflight = new Map();
  return {
    run(key, fn) {
      const existing = inflight.get(key);
      if (existing) return existing;
      const p = fn();
      inflight.set(key, p);
      p.catch(() => inflight.delete(key));
      return p;
    },
    size: () => inflight.size,
  };
}
