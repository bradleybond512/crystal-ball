import assert from 'node:assert/strict';
import { test } from 'node:test';

// The module reads localStorage at import time, and its sebuf client delegates to
// globalThis.fetch at call time — both have to be in place before importing.
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  },
});

let respond: () => Promise<Response> = () => Promise.reject(new Error('no responder installed'));
globalThis.fetch = (() => respond()) as typeof fetch;

const { fetchCachedTheaterPosture } = await import('../cached-theater-posture.js');
const { fetchCachedRiskScores } = await import('../cached-risk-scores.js');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Each pair below shares one module's singleton state and must run in order: the
// first test's failure is what arms the backoff the second one observes.

test('theater posture: one caller cancelling does not deny the cache fallback to a concurrent caller', async () => {
  const inflight = deferred<Response>();
  respond = () => inflight.promise;

  const a = new AbortController();
  const b = new AbortController();

  const forA = fetchCachedTheaterPosture(a.signal);
  const forB = fetchCachedTheaterPosture(b.signal); // deduplicated onto A's in-flight fetch

  a.abort();
  await assert.rejects(forA, (e: unknown) => e instanceof DOMException && e.name === 'AbortError');

  // The runtime's own 15s timeout now fires on the shared fetch, after A walked away.
  // Classifying that as A's cancellation and rethrowing it handed B an AbortError.
  inflight.reject(new DOMException('Fetch is aborted', 'AbortError'));

  assert.equal(await forB, null, 'B never cancelled, so it must get the cache fallback');
});

test('theater posture: a failed fetch arms the backoff instead of retrying', async () => {
  // The rethrow also skipped `lastErrorAt = Date.now()`, so a down sidecar was
  // retried on every call rather than backed off.
  let refetched = false;
  respond = () => { refetched = true; return Promise.reject(new TypeError('Load failed')); };

  assert.equal(await fetchCachedTheaterPosture(), null);
  assert.equal(refetched, false, 'the previous failure must suppress this refetch');
});

test('risk scores: one caller cancelling does not deny the cache fallback to a concurrent caller', async () => {
  const inflight = deferred<Response>();
  respond = () => inflight.promise;

  const a = new AbortController();
  const b = new AbortController();

  const forA = fetchCachedRiskScores(a.signal);
  const forB = fetchCachedRiskScores(b.signal);

  a.abort();
  await assert.rejects(forA, (e: unknown) => e instanceof DOMException && e.name === 'AbortError');

  inflight.reject(new DOMException('Fetch is aborted', 'AbortError'));

  assert.equal(await forB, null, 'B never cancelled, so it must get the cache fallback');
});

test('risk scores: a failed fetch arms the throttle instead of retrying', async () => {
  let refetched = false;
  respond = () => { refetched = true; return Promise.reject(new TypeError('Load failed')); };

  assert.equal(await fetchCachedRiskScores(), null);
  assert.equal(refetched, false, 'the previous failure must suppress this refetch');
});
