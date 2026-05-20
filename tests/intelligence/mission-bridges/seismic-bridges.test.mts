/**
 * Tests for seismic mission bridges.
 *
 * Covers:
 *   - Auto-registration at module load
 *   - USGSEarthquakeBridge.normalize() — all magnitude tiers + edge cases
 *   - TsunamiWarningBridge.normalize() — all PTWC warning levels
 *   - VolcanicAlertBridge.normalize() — all USGS VAL / aviation color codes
 *   - Null guard: missing or empty id returns null
 *
 * Run with: npx tsx --test tests/intelligence/mission-bridges/seismic-bridges.test.mts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  USGSEarthquakeBridge,
  TsunamiWarningBridge,
  VolcanicAlertBridge,
} from '../../../src/services/intelligence/mission-bridges/seismic-bridges.ts';
import {
  getMissionBridgeRegistry,
  __resetMissionBridgeRegistry,
} from '../../../src/services/intelligence/mission-bridges/mission-bridge-core.ts';

// ── Auto-registration ─────────────────────────────────────────────────

test('importing seismic-bridges registers USGSEarthquakeBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('seismic', 'usgs-earthquakes'));
});

test('importing seismic-bridges registers TsunamiWarningBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('seismic', 'tsunami-warnings'));
});

test('importing seismic-bridges registers VolcanicAlertBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('seismic', 'volcanic-alerts'));
});

test('all seismic bridges retrievable by domain', () => {
  const bridges = getMissionBridgeRegistry().getByDomain('seismic');
  assert.equal(bridges.length, 3);
});

// ── USGSEarthquakeBridge — properties ────────────────────────────────

const quakeBridge = new USGSEarthquakeBridge();

test('USGSEarthquakeBridge.domain is seismic', () => {
  assert.equal(quakeBridge.domain, 'seismic');
});

test('USGSEarthquakeBridge.feedId is usgs-earthquakes', () => {
  assert.equal(quakeBridge.feedId, 'usgs-earthquakes');
});

// ── USGSEarthquakeBridge — magnitude thresholds ───────────────────────

test('USGSEarthquakeBridge: M7.0 → severity 4 (major)', () => {
  const r = quakeBridge.normalize({ id: 'eq1', magnitude: 7.0, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('USGSEarthquakeBridge: M8.5 → severity 4 (major)', () => {
  const r = quakeBridge.normalize({ id: 'eq2', magnitude: 8.5, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('USGSEarthquakeBridge: M6.0 → severity 3 (strong)', () => {
  const r = quakeBridge.normalize({ id: 'eq3', magnitude: 6.0, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('USGSEarthquakeBridge: M6.9 → severity 3 (strong, below 7.0)', () => {
  const r = quakeBridge.normalize({ id: 'eq4', magnitude: 6.9, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('USGSEarthquakeBridge: M4.5 → severity 2 (moderate)', () => {
  const r = quakeBridge.normalize({ id: 'eq5', magnitude: 4.5, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('USGSEarthquakeBridge: M5.9 → severity 2 (moderate, below 6.0)', () => {
  const r = quakeBridge.normalize({ id: 'eq6', magnitude: 5.9, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('USGSEarthquakeBridge: M2.5 → severity 1 (minor)', () => {
  const r = quakeBridge.normalize({ id: 'eq7', magnitude: 2.5, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('USGSEarthquakeBridge: M4.4 → severity 1 (minor, below 4.5)', () => {
  const r = quakeBridge.normalize({ id: 'eq8', magnitude: 4.4, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('USGSEarthquakeBridge: M1.0 → severity 0 (micro)', () => {
  const r = quakeBridge.normalize({ id: 'eq9', magnitude: 1.0, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 0);
});

test('USGSEarthquakeBridge: M0.0 → severity 0', () => {
  const r = quakeBridge.normalize({ id: 'eq10', magnitude: 0, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 0);
});

test('USGSEarthquakeBridge: place included in description fallback', () => {
  const r = quakeBridge.normalize({ id: 'eq11', magnitude: 5.5, place: '10km NE of Tōkyō', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Tōkyō'));
});

test('USGSEarthquakeBridge: explicit description takes precedence', () => {
  const r = quakeBridge.normalize({ id: 'eq12', magnitude: 7.2, description: 'Major quake off coast', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.description, 'Major quake off coast');
});

test('USGSEarthquakeBridge: missing id → null', () => {
  assert.equal(quakeBridge.normalize({ magnitude: 7.5 }), null);
});

test('USGSEarthquakeBridge: empty string id → null', () => {
  assert.equal(quakeBridge.normalize({ id: '', magnitude: 7.5 }), null);
});

test('USGSEarthquakeBridge: missing timestamp falls back to Date.now()', () => {
  const before = Date.now();
  const r = quakeBridge.normalize({ id: 'eq13', magnitude: 3.0 });
  const after = Date.now();
  assert.ok(r);
  assert.ok(r.timestamp >= before && r.timestamp <= after);
});

test('USGSEarthquakeBridge: raw payload preserved', () => {
  const raw = { id: 'eq14', magnitude: 6.5, place: 'Pacific Ocean', timestamp: 5000 };
  const r = quakeBridge.normalize(raw);
  assert.ok(r);
  assert.deepEqual(r.raw, raw);
});

// ── TsunamiWarningBridge — properties ────────────────────────────────

const tsunamiBridge = new TsunamiWarningBridge();

test('TsunamiWarningBridge.domain is seismic', () => {
  assert.equal(tsunamiBridge.domain, 'seismic');
});

test('TsunamiWarningBridge.feedId is tsunami-warnings', () => {
  assert.equal(tsunamiBridge.feedId, 'tsunami-warnings');
});

// ── TsunamiWarningBridge — PTWC level mapping ─────────────────────────

test('TsunamiWarningBridge: warning → severity 4', () => {
  const r = tsunamiBridge.normalize({ id: 'ts1', level: 'warning', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('TsunamiWarningBridge: advisory → severity 3', () => {
  const r = tsunamiBridge.normalize({ id: 'ts2', level: 'advisory', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('TsunamiWarningBridge: watch → severity 2', () => {
  const r = tsunamiBridge.normalize({ id: 'ts3', level: 'watch', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('TsunamiWarningBridge: information → severity 1', () => {
  const r = tsunamiBridge.normalize({ id: 'ts4', level: 'information', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('TsunamiWarningBridge: unknown level → severity 0', () => {
  const r = tsunamiBridge.normalize({ id: 'ts5', level: 'none', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 0);
});

test('TsunamiWarningBridge: WARNING (uppercase) → severity 4 (case-insensitive)', () => {
  const r = tsunamiBridge.normalize({ id: 'ts6', level: 'WARNING', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('TsunamiWarningBridge: region included in description fallback', () => {
  const r = tsunamiBridge.normalize({ id: 'ts7', level: 'warning', region: 'Pacific Coast', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Pacific Coast'));
});

test('TsunamiWarningBridge: explicit description takes precedence', () => {
  const r = tsunamiBridge.normalize({ id: 'ts8', level: 'advisory', description: 'Potential wave 0.3m', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.description, 'Potential wave 0.3m');
});

test('TsunamiWarningBridge: missing id → null', () => {
  assert.equal(tsunamiBridge.normalize({ level: 'warning' }), null);
});

// ── VolcanicAlertBridge — properties ─────────────────────────────────

const volcBridge = new VolcanicAlertBridge();

test('VolcanicAlertBridge.domain is seismic', () => {
  assert.equal(volcBridge.domain, 'seismic');
});

test('VolcanicAlertBridge.feedId is volcanic-alerts', () => {
  assert.equal(volcBridge.feedId, 'volcanic-alerts');
});

// ── VolcanicAlertBridge — USGS VAL / aviation color code mapping ───────

test('VolcanicAlertBridge: warning → severity 4', () => {
  const r = volcBridge.normalize({ id: 'v1', alertLevel: 'warning', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('VolcanicAlertBridge: red → severity 4 (aviation color code)', () => {
  const r = volcBridge.normalize({ id: 'v2', alertLevel: 'red', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('VolcanicAlertBridge: watch → severity 3', () => {
  const r = volcBridge.normalize({ id: 'v3', alertLevel: 'watch', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('VolcanicAlertBridge: orange → severity 3 (aviation color code)', () => {
  const r = volcBridge.normalize({ id: 'v4', alertLevel: 'orange', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('VolcanicAlertBridge: advisory → severity 2', () => {
  const r = volcBridge.normalize({ id: 'v5', alertLevel: 'advisory', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('VolcanicAlertBridge: yellow → severity 2 (aviation color code)', () => {
  const r = volcBridge.normalize({ id: 'v6', alertLevel: 'yellow', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('VolcanicAlertBridge: normal → severity 1', () => {
  const r = volcBridge.normalize({ id: 'v7', alertLevel: 'normal', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('VolcanicAlertBridge: green → severity 1 (aviation color code)', () => {
  const r = volcBridge.normalize({ id: 'v8', alertLevel: 'green', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('VolcanicAlertBridge: unassigned level → severity 0', () => {
  const r = volcBridge.normalize({ id: 'v9', alertLevel: '', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 0);
});

test('VolcanicAlertBridge: ORANGE (uppercase) → severity 3 (case-insensitive)', () => {
  const r = volcBridge.normalize({ id: 'v10', alertLevel: 'ORANGE', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('VolcanicAlertBridge: volcanoName used in description', () => {
  const r = volcBridge.normalize({ id: 'v11', alertLevel: 'warning', volcanoName: 'Kilauea', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Kilauea'));
});

test('VolcanicAlertBridge: name field fallback when volcanoName absent', () => {
  const r = volcBridge.normalize({ id: 'v12', alertLevel: 'watch', name: 'Rainier', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Rainier'));
});

test('VolcanicAlertBridge: explicit description takes precedence', () => {
  const r = volcBridge.normalize({ id: 'v13', alertLevel: 'red', description: 'Eruption imminent', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.description, 'Eruption imminent');
});

test('VolcanicAlertBridge: missing id → null', () => {
  assert.equal(volcBridge.normalize({ alertLevel: 'warning' }), null);
});

// ── Registry isolation ─────────────────────────────────────────────────

test('resetting registry removes all seismic bridges', () => {
  __resetMissionBridgeRegistry();
  const reg = getMissionBridgeRegistry();
  assert.equal(reg.has('seismic', 'usgs-earthquakes'), false);
  assert.equal(reg.has('seismic', 'tsunami-warnings'), false);
  assert.equal(reg.has('seismic', 'volcanic-alerts'), false);
});
