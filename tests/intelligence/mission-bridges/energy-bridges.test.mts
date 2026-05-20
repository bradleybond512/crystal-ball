/**
 * Tests for energy/infrastructure mission bridges.
 *
 * Covers:
 *   - Auto-registration at module load
 *   - PowerOutageBridge.normalize() — NERC/EIA customer tiers + edge cases
 *   - PipelineDisruptionBridge.normalize() — all status severity levels
 *   - RefineryIncidentBridge.normalize() — capLossPct + lostBpd + combined logic
 *   - Null guard: missing or empty id returns null
 *
 * Run with: npx tsx --test tests/intelligence/mission-bridges/energy-bridges.test.mts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PowerOutageBridge,
  PipelineDisruptionBridge,
  RefineryIncidentBridge,
} from '../../../src/services/intelligence/mission-bridges/energy-bridges.ts';
import {
  getMissionBridgeRegistry,
  __resetMissionBridgeRegistry,
} from '../../../src/services/intelligence/mission-bridges/mission-bridge-core.ts';

// ── Auto-registration ─────────────────────────────────────────────────

test('importing energy-bridges registers PowerOutageBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('energy', 'power-outages'));
});

test('importing energy-bridges registers PipelineDisruptionBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('energy', 'pipeline-disruptions'));
});

test('importing energy-bridges registers RefineryIncidentBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('energy', 'refinery-incidents'));
});

test('all energy bridges retrievable by domain', () => {
  const bridges = getMissionBridgeRegistry().getByDomain('energy');
  assert.equal(bridges.length, 3);
});

// ── PowerOutageBridge — properties ───────────────────────────────────

const outageBridge = new PowerOutageBridge();

test('PowerOutageBridge.domain is energy', () => {
  assert.equal(outageBridge.domain, 'energy');
});

test('PowerOutageBridge.feedId is power-outages', () => {
  assert.equal(outageBridge.feedId, 'power-outages');
});

// ── PowerOutageBridge — customer thresholds ───────────────────────────

test('PowerOutageBridge: 500,000 customers → severity 4', () => {
  const r = outageBridge.normalize({ id: 'out1', customersAffected: 500_000, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('PowerOutageBridge: 1,000,000 customers → severity 4', () => {
  const r = outageBridge.normalize({ id: 'out2', customersAffected: 1_000_000, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('PowerOutageBridge: 100,000 customers → severity 3', () => {
  const r = outageBridge.normalize({ id: 'out3', customersAffected: 100_000, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('PowerOutageBridge: 499,999 customers → severity 3 (below 500K)', () => {
  const r = outageBridge.normalize({ id: 'out4', customersAffected: 499_999, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('PowerOutageBridge: 10,000 customers → severity 2', () => {
  const r = outageBridge.normalize({ id: 'out5', customersAffected: 10_000, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('PowerOutageBridge: 99,999 customers → severity 2 (below 100K)', () => {
  const r = outageBridge.normalize({ id: 'out6', customersAffected: 99_999, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('PowerOutageBridge: 1 customer → severity 1 (minor)', () => {
  const r = outageBridge.normalize({ id: 'out7', customersAffected: 1, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('PowerOutageBridge: 9,999 customers → severity 1 (below 10K)', () => {
  const r = outageBridge.normalize({ id: 'out8', customersAffected: 9_999, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('PowerOutageBridge: 0 customers → severity 1 (default minor)', () => {
  const r = outageBridge.normalize({ id: 'out9', customersAffected: 0, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('PowerOutageBridge: missing customersAffected → severity 1', () => {
  const r = outageBridge.normalize({ id: 'out10', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('PowerOutageBridge: region included in description fallback', () => {
  const r = outageBridge.normalize({ id: 'out11', customersAffected: 50_000, region: 'Northeast', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Northeast'));
});

test('PowerOutageBridge: explicit description takes precedence', () => {
  const r = outageBridge.normalize({ id: 'out12', customersAffected: 200_000, description: 'Storm-related outage', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.description, 'Storm-related outage');
});

test('PowerOutageBridge: missing id → null', () => {
  assert.equal(outageBridge.normalize({ customersAffected: 100_000 }), null);
});

test('PowerOutageBridge: empty string id → null', () => {
  assert.equal(outageBridge.normalize({ id: '', customersAffected: 100_000 }), null);
});

test('PowerOutageBridge: missing timestamp falls back to Date.now()', () => {
  const before = Date.now();
  const r = outageBridge.normalize({ id: 'out13', customersAffected: 5_000 });
  const after = Date.now();
  assert.ok(r);
  assert.ok(r.timestamp >= before && r.timestamp <= after);
});

test('PowerOutageBridge: raw payload preserved', () => {
  const raw = { id: 'out14', customersAffected: 250_000, region: 'Midwest', timestamp: 8000 };
  const r = outageBridge.normalize(raw);
  assert.ok(r);
  assert.deepEqual(r.raw, raw);
});

// ── PipelineDisruptionBridge — properties ────────────────────────────

const pipelineBridge = new PipelineDisruptionBridge();

test('PipelineDisruptionBridge.domain is energy', () => {
  assert.equal(pipelineBridge.domain, 'energy');
});

test('PipelineDisruptionBridge.feedId is pipeline-disruptions', () => {
  assert.equal(pipelineBridge.feedId, 'pipeline-disruptions');
});

// ── PipelineDisruptionBridge — status severity mapping ────────────────

test('PipelineDisruptionBridge: full_rupture → severity 4', () => {
  const r = pipelineBridge.normalize({ id: 'pip1', status: 'full_rupture', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('PipelineDisruptionBridge: explosion → severity 4', () => {
  const r = pipelineBridge.normalize({ id: 'pip2', status: 'explosion', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('PipelineDisruptionBridge: major_leak → severity 3', () => {
  const r = pipelineBridge.normalize({ id: 'pip3', status: 'major_leak', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('PipelineDisruptionBridge: fire → severity 3', () => {
  const r = pipelineBridge.normalize({ id: 'pip4', status: 'fire', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('PipelineDisruptionBridge: partial_shutdown → severity 2', () => {
  const r = pipelineBridge.normalize({ id: 'pip5', status: 'partial_shutdown', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('PipelineDisruptionBridge: reduced_flow → severity 2', () => {
  const r = pipelineBridge.normalize({ id: 'pip6', status: 'reduced_flow', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('PipelineDisruptionBridge: pressure_anomaly → severity 1', () => {
  const r = pipelineBridge.normalize({ id: 'pip7', status: 'pressure_anomaly', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('PipelineDisruptionBridge: unknown status → severity 1 (default)', () => {
  const r = pipelineBridge.normalize({ id: 'pip8', status: 'routine_inspection', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('PipelineDisruptionBridge: FULL_RUPTURE (uppercase) → severity 4 (case-insensitive)', () => {
  const r = pipelineBridge.normalize({ id: 'pip9', status: 'FULL_RUPTURE', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('PipelineDisruptionBridge: status with spaces normalised to underscores', () => {
  const r = pipelineBridge.normalize({ id: 'pip10', status: 'full rupture', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('PipelineDisruptionBridge: pipelineName used in description', () => {
  const r = pipelineBridge.normalize({ id: 'pip11', status: 'major_leak', pipelineName: 'Colonial Pipeline', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Colonial Pipeline'));
});

test('PipelineDisruptionBridge: name field fallback when pipelineName absent', () => {
  const r = pipelineBridge.normalize({ id: 'pip12', status: 'fire', name: 'Trans-Alaska', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Trans-Alaska'));
});

test('PipelineDisruptionBridge: explicit description takes precedence', () => {
  const r = pipelineBridge.normalize({ id: 'pip13', status: 'explosion', description: 'Section 4B detonated', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.description, 'Section 4B detonated');
});

test('PipelineDisruptionBridge: missing id → null', () => {
  assert.equal(pipelineBridge.normalize({ status: 'major_leak' }), null);
});

// ── RefineryIncidentBridge — properties ──────────────────────────────

const refineryBridge = new RefineryIncidentBridge();

test('RefineryIncidentBridge.domain is energy', () => {
  assert.equal(refineryBridge.domain, 'energy');
});

test('RefineryIncidentBridge.feedId is refinery-incidents', () => {
  assert.equal(refineryBridge.feedId, 'refinery-incidents');
});

// ── RefineryIncidentBridge — capacityLossPct tiers ──────────────────

test('RefineryIncidentBridge: capLossPct 75% → severity 4', () => {
  const r = refineryBridge.normalize({ id: 'ref1', capacityLossPct: 75, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('RefineryIncidentBridge: capLossPct 90% → severity 4', () => {
  const r = refineryBridge.normalize({ id: 'ref2', capacityLossPct: 90, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('RefineryIncidentBridge: capLossPct 40% → severity 3', () => {
  const r = refineryBridge.normalize({ id: 'ref3', capacityLossPct: 40, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('RefineryIncidentBridge: capLossPct 74% → severity 3 (below 75%)', () => {
  const r = refineryBridge.normalize({ id: 'ref4', capacityLossPct: 74, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('RefineryIncidentBridge: capLossPct 15% → severity 2', () => {
  const r = refineryBridge.normalize({ id: 'ref5', capacityLossPct: 15, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('RefineryIncidentBridge: capLossPct 39% → severity 2 (below 40%)', () => {
  const r = refineryBridge.normalize({ id: 'ref6', capacityLossPct: 39, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('RefineryIncidentBridge: capLossPct 5% → severity 1 (minor)', () => {
  const r = refineryBridge.normalize({ id: 'ref7', capacityLossPct: 5, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

// ── RefineryIncidentBridge — lostBpd tiers ──────────────────────────

test('RefineryIncidentBridge: lostBpd 500,000 → severity 4', () => {
  const r = refineryBridge.normalize({ id: 'ref8', lostBpd: 500_000, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('RefineryIncidentBridge: lostBpd 100,000 → severity 3', () => {
  const r = refineryBridge.normalize({ id: 'ref9', lostBpd: 100_000, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('RefineryIncidentBridge: lostBpd 10,000 → severity 2', () => {
  const r = refineryBridge.normalize({ id: 'ref10', lostBpd: 10_000, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('RefineryIncidentBridge: lostBpd 1,000 → severity 1 (minor)', () => {
  const r = refineryBridge.normalize({ id: 'ref11', lostBpd: 1_000, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('RefineryIncidentBridge: lostBpd 0, no capLossPct → severity 1 (default)', () => {
  const r = refineryBridge.normalize({ id: 'ref12', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

// ── RefineryIncidentBridge — max(capLossPct, lostBpd) logic ──────────

test('RefineryIncidentBridge: capLossPct drives severity when higher than bpd', () => {
  // capLossPct=90% → 4; lostBpd=50K → 2 → max = 4
  const r = refineryBridge.normalize({ id: 'ref13', capacityLossPct: 90, lostBpd: 50_000, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('RefineryIncidentBridge: lostBpd drives severity when higher than capLossPct', () => {
  // capLossPct=10% → 1; lostBpd=600K → 4 → max = 4
  const r = refineryBridge.normalize({ id: 'ref14', capacityLossPct: 10, lostBpd: 600_000, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('RefineryIncidentBridge: capLossPct in description when provided', () => {
  const r = refineryBridge.normalize({ id: 'ref15', capacityLossPct: 60, refineryName: 'Port Arthur', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Port Arthur'));
  assert.ok(r.description.includes('60'));
});

test('RefineryIncidentBridge: lostBpd in description when no capLossPct', () => {
  const r = refineryBridge.normalize({ id: 'ref16', lostBpd: 250_000, refineryName: 'Galveston Bay', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Galveston Bay'));
  assert.ok(r.description.includes('250,000'));
});

test('RefineryIncidentBridge: name field fallback when refineryName absent', () => {
  const r = refineryBridge.normalize({ id: 'ref17', lostBpd: 50_000, name: 'Baytown', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Baytown'));
});

test('RefineryIncidentBridge: explicit description takes precedence', () => {
  const r = refineryBridge.normalize({ id: 'ref18', capacityLossPct: 80, description: 'Fire in crude unit', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.description, 'Fire in crude unit');
});

test('RefineryIncidentBridge: missing id → null', () => {
  assert.equal(refineryBridge.normalize({ capacityLossPct: 50 }), null);
});

test('RefineryIncidentBridge: empty string id → null', () => {
  assert.equal(refineryBridge.normalize({ id: '', lostBpd: 100_000 }), null);
});

test('RefineryIncidentBridge: raw payload preserved', () => {
  const raw = { id: 'ref19', capacityLossPct: 55, lostBpd: 120_000, refineryName: 'Whiting', timestamp: 9000 };
  const r = refineryBridge.normalize(raw);
  assert.ok(r);
  assert.deepEqual(r.raw, raw);
});

// ── Registry isolation ─────────────────────────────────────────────────

test('resetting registry removes all energy bridges', () => {
  __resetMissionBridgeRegistry();
  const reg = getMissionBridgeRegistry();
  assert.equal(reg.has('energy', 'power-outages'), false);
  assert.equal(reg.has('energy', 'pipeline-disruptions'), false);
  assert.equal(reg.has('energy', 'refinery-incidents'), false);
});
