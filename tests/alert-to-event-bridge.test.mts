import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { unifiedAlertToNormalizedEvent } from '../src/services/alert-to-event-bridge.ts';

describe('alert-to-event-bridge', () => {
  const mockAlert = {
    id: 'test-1',
    source: 'nws',
    severity: 'high',
    title: 'Tornado Warning for Dallas County',
    body: 'Take shelter immediately.',
    timestamp: Date.parse('2026-04-14T15:00:00Z'),
    location: { lat: 32.78, lon: -96.80, label: 'Dallas, TX' },
    relevanceScore: 0.85,
    acknowledged: false,
    pinned: false,
  };

  it('converts UnifiedAlert to NormalizedEvent', () => {
    const event = unifiedAlertToNormalizedEvent(mockAlert);
    assert.equal(event.id, 'test-1');
    assert.equal(event.sourceId, 'nws');
    assert.equal(event.eventType, 'weather_disaster');
    assert.equal(event.title, 'Tornado Warning for Dallas County');
    assert.equal(event.location.lat, 32.78);
    assert.ok(event.timestamp.utc.includes('2026-04-14'));
    assert.ok(event.severity >= 0 && event.severity <= 100);
  });

  it('maps severity strings to numeric scores', () => {
    const event = unifiedAlertToNormalizedEvent(mockAlert);
    assert.equal(event.severity, 80);

    const lowAlert = { ...mockAlert, severity: 'low' };
    assert.equal(unifiedAlertToNormalizedEvent(lowAlert).severity, 20);
  });

  it('handles alerts without location gracefully', () => {
    const noLoc = { ...mockAlert, location: undefined };
    const event = unifiedAlertToNormalizedEvent(noLoc);
    assert.equal(event.location.confidence, 0.1);
  });
});
