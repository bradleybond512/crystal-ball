import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapSourceToEventType, mapRawTagsToEventType } from '../src/services/event-taxonomy-mapper.ts';

describe('event-taxonomy-mapper', () => {
  it('maps known alert sources to event types', () => {
    assert.equal(mapSourceToEventType('nws', 'Tornado Warning'), 'weather_disaster');
    assert.equal(mapSourceToEventType('gdacs', 'Earthquake M6.5'), 'earthquake');
    assert.equal(mapSourceToEventType('acled', 'Armed clash'), 'conflict');
    assert.equal(mapSourceToEventType('cyber', 'DDoS attack'), 'cyber_incident');
  });

  it('uses title keywords when source is ambiguous', () => {
    assert.equal(mapSourceToEventType('breaking-news', 'Massive protest in capital'), 'protest');
    assert.equal(mapSourceToEventType('breaking-news', 'Oil prices surge 8%'), 'economic_shock');
    assert.equal(mapSourceToEventType('breaking-news', 'Wildfire spreads across region'), 'wildfire');
  });

  it('returns closest match for unknown sources', () => {
    const result = mapSourceToEventType('unknown-feed', 'Something happened');
    assert.ok(result, 'Should return a fallback event type');
  });
});
