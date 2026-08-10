import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { formatLogArgument, isExpectedFeedFailure } from '../../log-bridge.ts';

test('Error formatting falls back to the message when WebKit provides an empty stack', () => {
  const error = new Error('Failed to fetch satellite tile');
  error.stack = '';

  assert.equal(formatLogArgument(error), 'Failed to fetch satellite tile');
});

test('Error formatting preserves the message when WebKit omits it from the stack', () => {
  const error = new Error('Illegal invocation');
  error.stack = 'setTimeout@[native code]';

  assert.equal(formatLogArgument(error), 'Illegal invocation\nsetTimeout@[native code]');
});

test('expected feed failures include WebKit aborts and upstream outages', () => {
  assert.equal(isExpectedFeedFailure('Fetch is aborted'), true);
  assert.equal(isExpectedFeedFailure('[CachedRiskScores] Fetch error: request cancelled'), true);
  assert.equal(isExpectedFeedFailure('All regions failed - upstream may be down'), true);
});
