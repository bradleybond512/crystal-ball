/**
 * Caller-scoped cancellation for a shared in-flight request.
 *
 * `fetchCachedRiskScores` / `fetchCachedTheaterPosture` deduplicate concurrent
 * callers onto a single RPC, so cancellation has to be scoped to the caller that
 * asked for it: one caller walking away must not decide what the others receive.
 * These helpers reject only the caller whose signal fired and leave the shared
 * promise running, so every caller still waiting gets its result.
 */

export function createAbortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

/**
 * Settle with `promise` unless `signal` fires first, in which case this caller —
 * and only this caller — is rejected. `promise` is never cancelled or otherwise
 * altered, so other waiters are unaffected.
 */
export function withCallerAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(createAbortError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- re-rejecting the original error
        reject(error);
      },
    );
  });
}
