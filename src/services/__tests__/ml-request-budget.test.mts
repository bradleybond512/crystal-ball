import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { ML_THRESHOLDS } from '../../config/ml-config.js';
import { AbandonedRequestIds, inferenceTimeoutFor } from '../ml-request-budget.js';

test('a warm model gets only the inference budget', () => {
  assert.equal(inferenceTimeoutFor(true), ML_THRESHOLDS.inferenceTimeoutMs);
});

test('a cold model gets the load budget on top of the inference budget', () => {
  assert.equal(
 inferenceTimeoutFor(false),
 ML_THRESHOLDS.modelLoadTimeoutMs + ML_THRESHOLDS.inferenceTimeoutMs
  );
});

test('a cold request outlasts the model load it has to wait for', () => {
  // The regression: charging a cold inference only inferenceTimeoutMs made the
  // manager give up mid-download, rejecting the caller with a misleading
  // "timed out" and orphaning the worker's real error.
  assert.ok(
 inferenceTimeoutFor(false) > ML_THRESHOLDS.modelLoadTimeoutMs,
 'cold budget must exceed the model load budget'
  );
  assert.ok(inferenceTimeoutFor(false) > inferenceTimeoutFor(true));
});

test('claim recognizes an abandoned id exactly once', () => {
  const log = new AbandonedRequestIds();
  log.add('ml-1-100');

  assert.equal(log.claim('ml-1-100'), true, 'first late reply is recognized');
  assert.equal(log.claim('ml-1-100'), false, 'a repeat reply is not silenced again');
});

test('claim rejects ids that were never abandoned', () => {
  const log = new AbandonedRequestIds();
  log.add('ml-1-100');

  assert.equal(log.claim('ml-2-200'), false);
  assert.equal(log.size, 1, 'a miss leaves the record intact');
});

test('the record is bounded and evicts oldest first', () => {
  const log = new AbandonedRequestIds(3);
  log.add('a');
  log.add('b');
  log.add('c');
  log.add('d');

  assert.equal(log.size, 3, 'never grows past the cap');
  assert.equal(log.claim('a'), false, 'oldest was evicted');
  assert.equal(log.claim('d'), true, 'newest is retained');
  assert.equal(log.claim('b'), true);
  assert.equal(log.claim('c'), true);
});

test('re-adding an id does not grow the record', () => {
  const log = new AbandonedRequestIds(3);
  log.add('a');
  log.add('a');

  assert.equal(log.size, 1);
});

test('a burst of concurrent requests sharing one failed load is fully absorbed', () => {
  // Five concurrent embed calls await the same model load; when it fails they
  // all time out, then all five late errors arrive against dead ids.
  const log = new AbandonedRequestIds();
  const ids = ['ml-1-1', 'ml-2-1', 'ml-3-1', 'ml-4-1', 'ml-5-1'];
  for (const id of ids) log.add(id);

  assert.deepEqual(
 ids.map(id => log.claim(id)),
 [true, true, true, true, true],
 'every orphaned reply is recognized, so none is logged as an error'
  );
  assert.equal(log.size, 0);
});
