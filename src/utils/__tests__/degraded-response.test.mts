import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  degradedMessage,
  degradedReason,
  isAllSubsourcesNull,
  isDegradedResponse,
} from '../degraded-response';

describe('isDegradedResponse', () => {
  it('returns true when payload has degraded:true', () => {
    assert.equal(isDegradedResponse({ degraded: true, reason: 'down' }), true);
  });

  it('returns false for healthy responses', () => {
    assert.equal(isDegradedResponse({ data: [], items: [] }), false);
    assert.equal(isDegradedResponse({ degraded: false, data: [{ a: 1 }] }), false);
  });

  it('returns false for null / undefined / non-object inputs', () => {
    assert.equal(isDegradedResponse(null), false);
    assert.equal(isDegradedResponse(undefined), false);
    assert.equal(isDegradedResponse('degraded'), false);
    assert.equal(isDegradedResponse(42), false);
  });

  it('does NOT trigger on degraded === "true" string (strict boolean)', () => {
    assert.equal(isDegradedResponse({ degraded: 'true' }), false);
  });
});

describe('degradedReason', () => {
  it('returns the reason string when present', () => {
    assert.equal(
      degradedReason({ degraded: true, reason: 'OpenSky 503' }),
      'OpenSky 503',
    );
  });

  it('returns empty string when reason field is missing', () => {
    assert.equal(degradedReason({ degraded: true }), '');
  });

  it('returns empty string for non-degraded payloads', () => {
    assert.equal(degradedReason({ data: [] }), '');
    assert.equal(degradedReason(null), '');
  });
});

describe('degradedMessage', () => {
  it('combines source label, reason, and retry hint', () => {
    const msg = degradedMessage(
      { degraded: true, reason: 'OpenSky returned 503' },
      { sourceLabel: 'Military flight tracking', retryHint: 'Retrying in 5 min.' },
    );
    assert.match(msg, /Military flight tracking/);
    assert.match(msg, /OpenSky returned 503/);
    assert.match(msg, /Retrying in 5 min\./);
  });

  it('falls back to default labels when options omitted', () => {
    const msg = degradedMessage({ degraded: true, reason: 'down' });
    assert.match(msg, /Source unavailable/);
    assert.match(msg, /Will retry on the next refresh\./);
  });

  it('produces a clean message even when reason is empty', () => {
    const msg = degradedMessage({ degraded: true }, { sourceLabel: 'Foo' });
    assert.equal(msg, 'Foo unavailable. Will retry on the next refresh.');
  });
});

describe('isAllSubsourcesNull', () => {
  it('returns true when every named subsource is null', () => {
    assert.equal(
      isAllSubsourcesNull({ reliefweb: null, who: null }, ['reliefweb', 'who']),
      true,
    );
  });

  it('returns true when subsources are undefined', () => {
    assert.equal(isAllSubsourcesNull({ a: undefined, b: undefined }, ['a', 'b']), true);
  });

  it('returns false when at least one subsource has data', () => {
    assert.equal(
      isAllSubsourcesNull({ reliefweb: null, who: { cases: 1 } }, ['reliefweb', 'who']),
      false,
    );
  });

  it('returns false on empty key list', () => {
    assert.equal(isAllSubsourcesNull({ a: null }, []), false);
  });

  it('returns false on null / undefined / non-object inputs', () => {
    assert.equal(isAllSubsourcesNull(null, ['a']), false);
    assert.equal(isAllSubsourcesNull(undefined, ['a']), false);
  });
});
