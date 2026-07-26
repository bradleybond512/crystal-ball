import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifySentryFailure,
  filterSentryEvent,
  stableSample,
} from '../sentry-filter.ts';

function event(message: string, filename = '/assets/app.js', eventId = 'evt-1') {
  return {
    event_id: eventId,
    exception: {
      values: [{
        value: message,
        stacktrace: { frames: [{ filename }] },
      }],
    },
    tags: {},
  };
}

test('dynamic imports and storage failures remain fully observable', () => {
  assert.equal(classifySentryFailure(event('Failed to fetch dynamically imported module')).code, 'dynamic-import');
  assert.equal(classifySentryFailure(event('QuotaExceededError')).code, 'storage');
  assert.ok(filterSentryEvent(event('Failed to fetch dynamically imported module')));
  assert.ok(filterSentryEvent(event('Connection to Indexed Database server lost')));
});

test('noisy network and map-internal errors use stable sampling', () => {
  assert.equal(classifySentryFailure(event('TypeError: Failed to fetch')).code, 'network');
  assert.equal(
    classifySentryFailure(event('TypeError: x', '/assets/maplibre-abc.js')).code,
    'map-internal',
  );
  assert.equal(stableSample('same-id', 0.1), stableSample('same-id', 0.1));
});

test('retained sampled events carry a stable reason code', () => {
  for (let i = 0; i < 10_000; i += 1) {
    const retained = filterSentryEvent(event('TypeError: Failed to fetch', '/assets/app.js', `evt-${i}`));
    if (!retained) continue;
    assert.equal(retained.tags?.reason_code, 'network');
    return;
  }
  assert.fail('expected deterministic sampler to retain at least one event');
});
