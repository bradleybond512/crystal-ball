// src/services/survival/__tests__/snapshot-integrity.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportSnapshotEnvelope,
  importSnapshotEnvelope,
  safeDeserializeSnapshot,
  validateSnapshot,
  snapshotChecksum,
  SNAPSHOT_ENVELOPE_KIND,
  SNAPSHOT_ENVELOPE_VERSION,
} from '../snapshot-integrity.ts';
import { buildSnapshot, SNAPSHOT_VERSION } from '../world-snapshot.ts';
import type { NwsAlertMinimal, AlertPolygon, SavedPlace } from '../../weather/weather-threat-types.ts';
import type { WorldSnapshot } from '../survival-types.ts';

const NOW = 1_700_000_000_000;
const HOME: SavedPlace = { id: 'home', label: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 };

function around(lat: number, lon: number): AlertPolygon {
  const d = 0.2;
  return { rings: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] };
}
const ALERTS: NwsAlertMinimal[] = [{
  id: 'al-t', event: 'Tornado Warning', polygon: around(HOME.lat, HOME.lon),
  sent: new Date(NOW - 60_000).toISOString(), expires: new Date(NOW + 3_600_000).toISOString(),
}];

function realSnapshot(): WorldSnapshot {
  return buildSnapshot({ weatherAlerts: ALERTS, savedPlaces: [HOME], weatherFetchedAtMs: NOW - 60_000 }, { now: NOW });
}

// ── round-trip ────────────────────────────────────────────────────────────────

test('export → import round-trips a real snapshot intact', () => {
  const snap = realSnapshot();
  const result = importSnapshotEnvelope(exportSnapshotEnvelope(snap));
  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.snapshot.posture.worstAxis, 'physical_safety');
  assert.equal(result.snapshot.posture.overallBand, 'critical');
  assert.deepEqual(result.snapshot, snap);
});

test('the envelope carries kind, versions, and a 16-hex checksum', () => {
  const env = JSON.parse(exportSnapshotEnvelope(realSnapshot()));
  assert.equal(env.kind, SNAPSHOT_ENVELOPE_KIND);
  assert.equal(env.envelopeVersion, SNAPSHOT_ENVELOPE_VERSION);
  assert.equal(env.snapshotVersion, SNAPSHOT_VERSION);
  assert.match(env.checksum, /^[0-9a-f]{16}$/);
});

test('the checksum is deterministic and independent of key order', () => {
  const snap = realSnapshot();
  // Re-serialize with a deliberately different top-level key order.
  const reordered: WorldSnapshot = {
    plan: snap.plan, posture: snap.posture, savedPlaces: snap.savedPlaces,
    weatherAlerts: snap.weatherAlerts, freshness: snap.freshness,
    capturedAtMs: snap.capturedAtMs, version: snap.version,
  };
  assert.equal(snapshotChecksum(reordered), snapshotChecksum(snap));
});

// ── corruption / tamper guard ───────────────────────────────────────────────

test('a mutated snapshot body fails the checksum guard', () => {
  const env = JSON.parse(exportSnapshotEnvelope(realSnapshot()));
  env.snapshot.posture.overallLevel = 0; // flip a value, leave the stale checksum
  const result = importSnapshotEnvelope(JSON.stringify(env));
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.reason, 'checksum_mismatch');
});

test('a truncated envelope is rejected as malformed JSON, not trusted', () => {
  const json = exportSnapshotEnvelope(realSnapshot());
  const result = importSnapshotEnvelope(json.slice(0, json.length - 10));
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.reason, 'malformed_json');
});

test('a missing checksum field does not fail open', () => {
  const env = JSON.parse(exportSnapshotEnvelope(realSnapshot()));
  delete env.checksum;
  const result = importSnapshotEnvelope(JSON.stringify(env));
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.reason, 'checksum_mismatch');
});

// ── envelope framing ─────────────────────────────────────────────────────────

test('a non-envelope object is rejected', () => {
  const result = importSnapshotEnvelope(JSON.stringify(realSnapshot()));
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.reason, 'not_an_envelope');
});

test('an unsupported envelope version is rejected', () => {
  const env = JSON.parse(exportSnapshotEnvelope(realSnapshot()));
  env.envelopeVersion = 99;
  const result = importSnapshotEnvelope(JSON.stringify(env));
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.reason, 'unsupported_envelope_version');
});

test('garbage input is a malformed_json failure, never a throw', () => {
  const result = importSnapshotEnvelope('}{not json');
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.reason, 'malformed_json');
});

// ── version + shape (checksum valid, payload broken) ────────────────────────

test('a future snapshot version with a valid checksum is still rejected', () => {
  const snap = { ...realSnapshot(), version: 2 } as unknown as WorldSnapshot;
  const env = {
    kind: SNAPSHOT_ENVELOPE_KIND, envelopeVersion: SNAPSHOT_ENVELOPE_VERSION,
    snapshotVersion: 2, checksum: snapshotChecksum(snap), snapshot: snap,
  };
  const result = importSnapshotEnvelope(JSON.stringify(env));
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.reason, 'unsupported_snapshot_version');
});

test('a structurally broken snapshot with a valid checksum fails closed with reasons', () => {
  // posture null survives JSON round-trip (unlike undefined), so the checksum
  // stays valid and the failure is the shape guard, not the corruption guard.
  const bad = { ...realSnapshot(), posture: null } as unknown as WorldSnapshot;
  const env = {
    kind: SNAPSHOT_ENVELOPE_KIND, envelopeVersion: SNAPSHOT_ENVELOPE_VERSION,
    snapshotVersion: SNAPSHOT_VERSION, checksum: snapshotChecksum(bad), snapshot: bad,
  };
  const result = importSnapshotEnvelope(JSON.stringify(env));
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.reason, 'invalid_shape');
  assert.ok((result.errors ?? []).some((e) => e.includes('posture')));
});

test('a NaN axis level with a valid checksum is rejected as invalid shape', () => {
  const snap = realSnapshot();
  const bad = structuredClone(snap);
  bad.posture.axes[0]!.level = Number.NaN;
  const env = {
    kind: SNAPSHOT_ENVELOPE_KIND, envelopeVersion: SNAPSHOT_ENVELOPE_VERSION,
    snapshotVersion: SNAPSHOT_VERSION, checksum: snapshotChecksum(bad), snapshot: bad,
  };
  const result = importSnapshotEnvelope(JSON.stringify(env));
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.reason, 'invalid_shape');
  assert.ok((result.errors ?? []).some((e) => e.includes('level')));
});

// ── validateSnapshot directly ────────────────────────────────────────────────

test('validateSnapshot accepts a real snapshot with no errors', () => {
  const v = validateSnapshot(realSnapshot());
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, []);
});

test('validateSnapshot flags a non-object', () => {
  const v = validateSnapshot(42);
  assert.equal(v.ok, false);
  assert.ok(v.errors.length > 0);
});

test('validateSnapshot reports an invalid axis name and band together', () => {
  const snap = structuredClone(realSnapshot());
  snap.posture.axes[0]!.axis = 'not_an_axis' as never;
  snap.posture.axes[1]!.band = 'nope' as never;
  const v = validateSnapshot(snap);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('is not a survival axis')));
  assert.ok(v.errors.some((e) => e.includes('is not a band')));
});

test('validateSnapshot rejects a bad committed-move status', () => {
  const snap = structuredClone(realSnapshot());
  snap.plan.committed.push({ moveId: 'm1', committedAtMs: NOW, status: 'bogus' as never });
  const v = validateSnapshot(snap);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('status')));
});

test('validateSnapshot rejects freshness with a wrong domain', () => {
  const snap = structuredClone(realSnapshot());
  snap.freshness[0]!.domain = 'markets' as never;
  const v = validateSnapshot(snap);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('snapshot domain')));
});

// ── safeDeserializeSnapshot (bare, no envelope) ─────────────────────────────

test('safeDeserializeSnapshot accepts a bare valid snapshot', () => {
  const result = safeDeserializeSnapshot(JSON.stringify(realSnapshot()));
  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.snapshot.posture.worstAxis, 'physical_safety');
});

test('safeDeserializeSnapshot rejects an unknown version rather than casting it', () => {
  const result = safeDeserializeSnapshot(JSON.stringify({ version: 999 }));
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.reason, 'unsupported_snapshot_version');
});

test('safeDeserializeSnapshot rejects a partial object as invalid shape', () => {
  const result = safeDeserializeSnapshot(JSON.stringify({ version: SNAPSHOT_VERSION }));
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.reason, 'invalid_shape');
});

test('safeDeserializeSnapshot never throws on garbage', () => {
  const result = safeDeserializeSnapshot('not json at all');
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.reason, 'malformed_json');
});
