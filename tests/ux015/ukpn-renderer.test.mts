import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUkpnOutages, ageUkpnOutages, unavailableUkpnOutages } from '../../src/services/infrastructure/ukpn-outages.ts';

import { normalizeUkpnSnapshot } from '../../src-tauri/sidecar/ukpn-live-faults.mjs';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const iso = (time: number) => new Date(time).toISOString();
function envelope() {
  return {
    schemaVersion: 1, provider: 'ukpn', scope: 'ukpn-regional', coverage: 'partial',
    state: 'reported', apiConsistency: 'verified', publishedAt: iso(NOW - 60_000), retrievedAt: iso(NOW), expiresAt: iso(NOW + 840_000),
    counts: { raw: 3, accepted: 1, excluded: 1, invalid: 1 },
    exclusions: { restored: 1, planned: 0, multiple: 0, unknown: 0 },
    incidents: [{ id: 'fixture-1', customersAffected: 0, operatingZone: '<London>' }], reasonCode: null,
  };
}
function unavailable(value: unknown) {
  const result = parseUkpnOutages(value, NOW);
  assert.equal(result.state, 'unavailable');
  assert.equal(result.incidents.length, 0);
  assert.equal(result.apiConsistency, 'unverified');
}

test('strict UKPN contract preserves explicit zero, regional partial scope, and owned copies', () => {
  const input = envelope(); const result = parseUkpnOutages(input, NOW);
  assert.equal(result.state, 'reported'); assert.equal(result.coverage, 'partial');
  assert.equal(result.incidents[0]?.customersAffected, 0);
  assert.equal(result.incidents[0]?.operatingZone, '<London>');
  assert.equal(result.counts.invalid, 1);
  input.incidents[0]!.id = 'mutated'; input.counts.accepted = 99;
  assert.equal(result.incidents[0]?.id, 'fixture-1'); assert.equal(result.counts.accepted, 1);
});

test('renderer rejects wrong provider, scope, schema, completeness and state rather than inventing coverage', () => {
  for (const input of [null, [], {}, ...Object.entries({ schemaVersion: 2, provider: 'odin', scope: 'national', coverage: 'complete', state: 'healthy', apiConsistency: 'unverified', reasonCode: 'upstream_unavailable' }).map(([key, value]) => ({ ...envelope(), [key]: value }))]) unavailable(input);
});

test('renderer rejects unreconciled, fractional, negative and over-limit row counts', () => {
  for (const counts of [
    { raw: 4, accepted: 1, excluded: 1, invalid: 1 },
    { raw: 3, accepted: 2, excluded: 1, invalid: 0 },
    { raw: 101, accepted: 1, excluded: 1, invalid: 99 },
    { raw: 3, accepted: 1, excluded: -1, invalid: 3 },
    { raw: 3, accepted: 1, excluded: 1.5, invalid: 0.5 },
  ]) unavailable({ ...envelope(), counts });
  unavailable({ ...envelope(), exclusions: { restored: 0, planned: 0, multiple: 0, unknown: 0 } });
});

test('renderer validates bounded unique IDs, optional zones and safe customer counts', () => {
  for (const row of [
    { id: '', customersAffected: 1 }, { id: 'x'.repeat(81), customersAffected: 1 },
    { id: 'one', customersAffected: -1 }, { id: 'one', customersAffected: 1.5 },
    { id: 'one', customersAffected: Number.MAX_SAFE_INTEGER + 1 },
    { id: 'one', customersAffected: '0' }, { id: 'one', customersAffected: 0, operatingZone: 'x'.repeat(81) },
  ]) unavailable({ ...envelope(), incidents: [row] });
  const duplicate = envelope(); duplicate.incidents.push({ ...duplicate.incidents[0]! }); duplicate.counts = { raw: 2, accepted: 2, excluded: 0, invalid: 0 }; duplicate.exclusions.restored = 0;
  unavailable(duplicate);
  const extra = { ...envelope(), postcode: 'PRIVATE_CANARY', incidents: [{ ...envelope().incidents[0]!, latitude: 1, restoration: 'PRIVATE_CANARY' }] };
  assert.doesNotMatch(JSON.stringify(parseUkpnOutages(extra, NOW)), /PRIVATE_CANARY|latitude|restoration/);
});

test('publication expiry is authoritative at the boundary and retrieval never renews it', () => {
  const input = envelope(); const fresh = parseUkpnOutages(input, NOW);
  assert.equal(ageUkpnOutages(fresh, NOW + 839_999).state, 'reported');
  const stale = ageUkpnOutages(fresh, NOW + 840_000);
  assert.equal(stale.state, 'stale'); assert.equal(stale.reasonCode, 'publication_stale');
  assert.equal(stale.incidents.length, 0); assert.equal(stale.counts.accepted, 0);
  assert.equal(stale.publishedAt, input.publishedAt); assert.equal(stale.retrievedAt, input.retrievedAt); assert.equal(stale.expiresAt, input.expiresAt);
  assert.equal(fresh.state, 'reported'); assert.equal(fresh.incidents.length, 1);
  assert.equal(parseUkpnOutages(input, NOW + 840_000).state, 'stale');
});

test('renderer rejects ambiguous, future and inconsistent timestamps', () => {
  for (const patch of [
    { publishedAt: '2026-11-19T11:59:00' }, { publishedAt: '2026-02-30T00:00:00.000Z' },
    { retrievedAt: 'invalid' }, { retrievedAt: iso(NOW + 1) },
    { expiresAt: iso(NOW + 840_001) }, { publishedAt: null },
  ]) unavailable({ ...envelope(), ...patch });
  const future = parseUkpnOutages({ ...envelope(), publishedAt: iso(NOW + 1), expiresAt: iso(NOW + 900_001) }, NOW);
  assert.equal(future.state, 'unavailable'); assert.equal(future.incidents.length, 0);
  const rollback = ageUkpnOutages(parseUkpnOutages(envelope(), NOW), NOW - 60_001);
  assert.equal(rollback.state, 'unavailable'); assert.equal(rollback.reasonCode, 'publication_future'); assert.equal(rollback.incidents.length, 0);
});

test('verified empty replaces observations without asserting complete outage coverage', () => {
  const empty = { ...envelope(), state: 'empty', incidents: [], counts: { raw: 1, accepted: 0, excluded: 1, invalid: 0 } };
  const result = parseUkpnOutages(empty, NOW);
  assert.equal(result.state, 'empty'); assert.equal(result.coverage, 'partial'); assert.equal(result.incidents.length, 0);
  unavailable({ ...empty, state: 'reported' }); unavailable({ ...envelope(), state: 'empty' });
});

test('unavailable envelopes remain empty, unverified and isolated across calls', () => {
  const unavailableResult = unavailableUkpnOutages(NOW);
  assert.equal(unavailableResult.state, 'unavailable'); assert.equal(unavailableResult.apiConsistency, 'unverified');
  assert.equal(unavailableResult.coverage, 'partial'); assert.deepEqual(unavailableResult.incidents, []);
  assert.equal(parseUkpnOutages(unavailableResult, NOW).state, 'unavailable');
  unavailableResult.counts.raw = 20;
  assert.equal(unavailableUkpnOutages(NOW).counts.raw, 0);
  unavailable({ ...unavailableUkpnOutages(NOW), incidents: envelope().incidents });
});


test('actual provider envelopes cross the renderer boundary without gaining fields or coverage', () => {
  const meta = { metas: { default: { data_processed: iso(NOW - 60_000), records_count: 2 } } };
  const records = { total_count: 2, results: [
    { incidentreference: 'INTEGRATED', powercuttype: 'Unplanned', nocustomeraffected: 0, restoreddatetime: null, message: 'PRIVATE_CANARY' },
    { incidentreference: 'EXCLUDED', powercuttype: 'Multiple', nocustomeraffected: 10 },
  ] };
  const normalized = normalizeUkpnSnapshot(meta, records, meta, NOW);
  const rendered = parseUkpnOutages(normalized, NOW);
  assert.equal(rendered.state, 'reported'); assert.equal(rendered.apiConsistency, 'verified');
  assert.deepEqual(rendered.incidents, [{ id: 'INTEGRATED', customersAffected: 0 }]);
  assert.deepEqual(rendered.counts, { raw: 2, accepted: 1, excluded: 1, invalid: 0 });
  assert.equal(rendered.coverage, 'partial'); assert.doesNotMatch(JSON.stringify(rendered), /PRIVATE_CANARY|EXCLUDED/);
  const incoherent = normalizeUkpnSnapshot(meta, records, { metas: { default: { ...meta.metas.default, records_count: 3 } } }, NOW);
  assert.equal(parseUkpnOutages(incoherent, NOW).reasonCode, 'version_changed');
});
