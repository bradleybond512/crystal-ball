/**
 * Sidecar tests for /api/synthesis/correlations.
 *
 * Pure-test of the sanitiser that gates the POST → mirror flow.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

process.env.LOCAL_API_TOKEN ??= 'test-token-synthesis';

import { sanitizeCorrelationEvent } from '../local-api-server.mjs';

const NOW_MS = 1_745_000_000_000;

function valid(over = {}) {
  return {
    type: 'seismic-nuclear',
    severity: 'critical',
    domains: ['seismic', 'nuclear'],
    description: 'M6.1 earthquake 12 km from Diablo Canyon (US).',
    triggeredAt: NOW_MS,
    components: [
      { domain: 'seismic', source: 'USGS event us123', description: 'M6.1 at (35.21, -120.85)' },
      { domain: 'nuclear', source: 'Nuclear facility Diablo Canyon', description: 'Diablo Canyon, US' },
    ],
    ...over,
  };
}

test('sanitizeCorrelationEvent passes a well-formed event with ms triggeredAt', () => {
  const out = sanitizeCorrelationEvent(valid());
  assert.ok(out);
  assert.equal(out.type, 'seismic-nuclear');
  assert.equal(out.severity, 'critical');
  assert.deepEqual(out.domains, ['seismic', 'nuclear']);
  assert.equal(out.components.length, 2);
  assert.equal(out.triggeredAt, new Date(NOW_MS).toISOString());
});

test('sanitizeCorrelationEvent accepts ISO-string triggeredAt', () => {
  const iso = new Date(NOW_MS).toISOString();
  const out = sanitizeCorrelationEvent(valid({ triggeredAt: iso }));
  assert.ok(out);
  assert.equal(out.triggeredAt, iso);
});

test('sanitizeCorrelationEvent rejects unknown correlation type', () => {
  assert.equal(sanitizeCorrelationEvent(valid({ type: 'totally-made-up' })), null);
});

test('sanitizeCorrelationEvent rejects unknown severity', () => {
  assert.equal(sanitizeCorrelationEvent(valid({ severity: 'apocalyptic' })), null);
});

test('sanitizeCorrelationEvent rejects when all domains are invalid', () => {
  assert.equal(sanitizeCorrelationEvent(valid({ domains: ['foo', 'bar'] })), null);
});

test('sanitizeCorrelationEvent strips invalid domains but keeps valid ones', () => {
  const out = sanitizeCorrelationEvent(valid({ domains: ['seismic', 'made-up', 'nuclear'] }));
  assert.ok(out);
  assert.deepEqual(out.domains, ['seismic', 'nuclear']);
});

test('sanitizeCorrelationEvent rejects empty components array', () => {
  assert.equal(sanitizeCorrelationEvent(valid({ components: [] })), null);
});

test('sanitizeCorrelationEvent drops malformed components but keeps valid ones', () => {
  const out = sanitizeCorrelationEvent(valid({
    components: [
      { domain: 'seismic', source: 'USGS', description: 'OK' },
      { domain: 'nope' }, // invalid domain
      null,
      { domain: 'nuclear', source: 'plant', description: 'OK2' },
    ],
  }));
  assert.ok(out);
  assert.equal(out.components.length, 2);
});

test('sanitizeCorrelationEvent caps description length at 500', () => {
  const long = 'x'.repeat(2000);
  const out = sanitizeCorrelationEvent(valid({ description: long }));
  assert.ok(out);
  assert.equal(out.description.length, 500);
});

test('sanitizeCorrelationEvent rejects non-finite triggeredAt', () => {
  assert.equal(sanitizeCorrelationEvent(valid({ triggeredAt: 'not-a-date' })), null);
  assert.equal(sanitizeCorrelationEvent(valid({ triggeredAt: Number.NaN })), null);
});

test('sanitizeCorrelationEvent rejects null / non-object input', () => {
  assert.equal(sanitizeCorrelationEvent(null), null);
  assert.equal(sanitizeCorrelationEvent(undefined), null);
  assert.equal(sanitizeCorrelationEvent('string'), null);
  assert.equal(sanitizeCorrelationEvent(42), null);
});
