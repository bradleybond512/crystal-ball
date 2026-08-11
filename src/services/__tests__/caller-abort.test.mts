import assert from 'node:assert/strict';
import { test } from 'node:test';

import { withCallerAbort } from '../caller-abort.js';

const isAbortError = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('one caller cancelling does not disturb the others', async () => {
  // The regression this guards: fetchCachedTheaterPosture / fetchCachedRiskScores
  // deduplicate concurrent callers onto one RPC. Deciding cancellation inside that
  // shared body handed an AbortError to callers that never cancelled.
  const shared = deferred<string>();
  const a = new AbortController();
  const b = new AbortController();

  const forA = withCallerAbort(shared.promise, a.signal);
  const forB = withCallerAbort(shared.promise, b.signal);

  a.abort();
  await assert.rejects(forA, isAbortError);

  shared.resolve('posture');
  assert.equal(await forB, 'posture', 'the caller that never cancelled still gets the result');
});

test('a cancelled caller does not cancel the shared work', async () => {
  const shared = deferred<string>();
  const a = new AbortController();

  const forA = withCallerAbort(shared.promise, a.signal);
  a.abort();
  await assert.rejects(forA, isAbortError);

  shared.resolve('still ran');
  assert.equal(await shared.promise, 'still ran');
});

test('a rejecting shared promise reaches every waiter', async () => {
  // Why the shared fetch body must take the cache fallback rather than rethrow:
  // anything it throws is what every deduplicated caller receives.
  const shared = deferred<string>();
  const b = new AbortController();
  const forB = withCallerAbort(shared.promise, b.signal);

  shared.reject(new TypeError('Load failed'));

  await assert.rejects(forB, (e: unknown) => e instanceof TypeError);
});

test('an already-aborted signal rejects immediately', async () => {
  const shared = deferred<string>();
  const a = new AbortController();
  a.abort();

  await assert.rejects(withCallerAbort(shared.promise, a.signal), isAbortError);
  shared.resolve('unused');
});

test('no signal passes the promise straight through', async () => {
  const shared = deferred<string>();
  assert.equal(withCallerAbort(shared.promise), shared.promise);
  shared.resolve('x');
});

test('aborting after the promise settled does not reject the caller', async () => {
  const shared = deferred<string>();
  const a = new AbortController();
  const forA = withCallerAbort(shared.promise, a.signal);

  shared.resolve('done');
  assert.equal(await forA, 'done');

  a.abort(); // listener was removed on settle; must not produce an unhandled rejection
  assert.equal(await forA, 'done');
});
