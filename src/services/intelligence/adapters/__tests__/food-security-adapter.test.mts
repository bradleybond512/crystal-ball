import assert from 'node:assert/strict';
import test from 'node:test';
import { fewsNetToObservations, hdxHapiToObservations } from '../food-security-adapter.ts';

// ── FEWS NET ──────────────────────────────────────────────────────────────

test('fewsNet IPC phase 4 produces HIGH observation', () => {
  const obs = fewsNetToObservations({
    results: [{ country: 'SO', country_name: 'Somalia', current_phase: 4, period_date: '2026-06-01' }],
  });
  assert.equal(obs.length, 1);
  assert.equal(obs[0]?.severity, 'HIGH');
  assert.equal(obs[0]?.sourceId, 'fews-net');
  assert.ok(obs[0]?.entityIds?.includes('SO'));
});

test('fewsNet IPC phase 5 produces CRITICAL', () => {
  const obs = fewsNetToObservations({ results: [{ country: 'SS', current_phase: 5 }] });
  assert.equal(obs[0]?.severity, 'CRITICAL');
});

test('fewsNet IPC phase 2 (stressed) produces no observation', () => {
  const obs = fewsNetToObservations({ results: [{ country: 'ET', current_phase: 2 }] });
  assert.equal(obs.length, 0);
});

test('fewsNet uses projected_phase when higher', () => {
  const obs = fewsNetToObservations({ results: [{ country: 'YE', current_phase: 2, projected_phase: 4 }] });
  assert.equal(obs.length, 1);
  assert.equal(obs[0]?.severity, 'HIGH');
});

test('fewsNet empty/malformed returns empty', () => {
  assert.deepEqual(fewsNetToObservations({}), []);
  assert.deepEqual(fewsNetToObservations({ results: [] }), []);
});

// ── HDX HAPI ─────────────────────────────────────────────────────────────

test('hdxHapi IPC phase 3 produces MEDIUM observation', () => {
  const obs = hdxHapiToObservations({
    data: [{ location_code: 'MLI', location_name: 'Mali', ipc_phase: 3, population_in_phase: 2_500_000 }],
  });
  assert.equal(obs.length, 1);
  assert.equal(obs[0]?.severity, 'MEDIUM');
  assert.equal(obs[0]?.sourceId, 'hdx-hapi');
  assert.ok(obs[0]?.title?.includes('2.5M'));
});

test('hdxHapi deduplicates to worst phase per location', () => {
  const obs = hdxHapiToObservations({
    data: [
      { location_code: 'NER', ipc_phase: 2 },
      { location_code: 'NER', ipc_phase: 4 }, // same country, worse phase
    ],
  });
  assert.equal(obs.length, 1);
  assert.equal(obs[0]?.severity, 'HIGH');
});

test('hdxHapi empty/malformed returns empty', () => {
  assert.deepEqual(hdxHapiToObservations({}), []);
  assert.deepEqual(hdxHapiToObservations({ data: [] }), []);
});
