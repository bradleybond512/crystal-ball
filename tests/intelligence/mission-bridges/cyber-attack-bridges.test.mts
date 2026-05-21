/**
 * Tests for the three new cyber mission bridges added on top of the
 * shipped 4-bridge baseline:
 *
 *   • CyberAttackMissionBridge          (cyber:cyber-attack)
 *   • DataBreachMissionBridge           (cyber:data-breach)
 *   • InfrastructureCompromiseMissionBridge (cyber:infra-compromise)
 *
 * Each bridge extends MissionBridgeBase + self-registers. Tests cover
 * stage / data-class / sector tier mappings, escalation rules, fallback
 * behavior, null-id guard, and registry wiring.
 *
 * Run: npx tsx --test tests/intelligence/mission-bridges/cyber-attack-bridges.test.mts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CyberAttackMissionBridge,
  DataBreachMissionBridge,
  InfrastructureCompromiseMissionBridge,
} from '../../../src/services/intelligence/mission-bridges/cyber-bridges.ts';
import {
  getMissionBridgeRegistry,
} from '../../../src/services/intelligence/mission-bridges/mission-bridge-core.ts';

// ── Registry wiring ───────────────────────────────────────────────────

test('registry: CyberAttackMissionBridge is registered under cyber:cyber-attack', () => {
  assert.equal(getMissionBridgeRegistry().has('cyber', 'cyber-attack'), true);
});

test('registry: DataBreachMissionBridge is registered under cyber:data-breach', () => {
  assert.equal(getMissionBridgeRegistry().has('cyber', 'data-breach'), true);
});

test('registry: InfrastructureCompromiseMissionBridge is registered under cyber:infra-compromise', () => {
  assert.equal(getMissionBridgeRegistry().has('cyber', 'infra-compromise'), true);
});

test('registry: getByDomain("cyber") returns at least 7 bridges (4 legacy + 3 new)', () => {
  const bridges = getMissionBridgeRegistry().getByDomain('cyber');
  assert.ok(bridges.length >= 7, `expected ≥7, got ${bridges.length}`);
});

// ── CyberAttackMissionBridge ──────────────────────────────────────────

const cyberAttack = new CyberAttackMissionBridge();

test('CyberAttack: confirmed_impact stage → severity 4', () => {
  const ev = cyberAttack.normalize({ id: 'a1', stage: 'confirmed_impact' });
  assert.equal(ev?.severity, 4);
});

test('CyberAttack: in_progress stage → severity 3', () => {
  const ev = cyberAttack.normalize({ id: 'a2', stage: 'in_progress' });
  assert.equal(ev?.severity, 3);
});

test('CyberAttack: attempted stage → severity 2', () => {
  const ev = cyberAttack.normalize({ id: 'a3', stage: 'attempted' });
  assert.equal(ev?.severity, 2);
});

test('CyberAttack: probe stage → severity 1', () => {
  const ev = cyberAttack.normalize({ id: 'a4', stage: 'probe' });
  assert.equal(ev?.severity, 1);
});

test('CyberAttack: unknown stage falls through to severity 1', () => {
  const ev = cyberAttack.normalize({ id: 'a5', stage: 'whatever' });
  assert.equal(ev?.severity, 1);
});

test('CyberAttack: kill-chain "exploitation" escalates over "reconnaissance" stage', () => {
  const ev = cyberAttack.normalize({ id: 'a6', stage: 'reconnaissance', killChain: 'exploitation' });
  assert.equal(ev?.severity, 4);
});

test('CyberAttack: kill-chain delivery → severity 3 even when stage is missing', () => {
  const ev = cyberAttack.normalize({ id: 'a7', killChain: 'delivery' });
  assert.equal(ev?.severity, 3);
});

test('CyberAttack: includes actor + target in description fallback', () => {
  const ev = cyberAttack.normalize({ id: 'a8', stage: 'attempted', actor: 'apt29', target: 'mailserver' });
  assert.match(ev!.description, /apt29/);
  assert.match(ev!.description, /mailserver/);
});

test('CyberAttack: custom description wins over the synthesized one', () => {
  const ev = cyberAttack.normalize({ id: 'a9', stage: 'probe', description: 'custom blurb' });
  assert.equal(ev?.description, 'custom blurb');
});

test('CyberAttack: missing id → null', () => {
  assert.equal(cyberAttack.normalize({ stage: 'probe' }), null);
  assert.equal(cyberAttack.normalize({ id: '' }), null);
});

test('CyberAttack: stage normalization tolerates spaces ("in progress" === "in_progress")', () => {
  const ev = cyberAttack.normalize({ id: 'a10', stage: 'in progress' });
  assert.equal(ev?.severity, 3);
});

// ── DataBreachMissionBridge ───────────────────────────────────────────

const dataBreach = new DataBreachMissionBridge();

test('DataBreach: financial dataClass → severity 4 regardless of record count', () => {
  const ev = dataBreach.normalize({ id: 'b1', dataClass: 'financial', recordCount: 50 });
  assert.equal(ev?.severity, 4);
});

test('DataBreach: health dataClass → severity 4', () => {
  const ev = dataBreach.normalize({ id: 'b2', dataClass: 'health' });
  assert.equal(ev?.severity, 4);
});

test('DataBreach: credentials dataClass at baseline → severity 3', () => {
  const ev = dataBreach.normalize({ id: 'b3', dataClass: 'credentials', recordCount: 1000 });
  assert.equal(ev?.severity, 3);
});

test('DataBreach: pii dataClass → severity 3', () => {
  const ev = dataBreach.normalize({ id: 'b4', dataClass: 'pii' });
  assert.equal(ev?.severity, 3);
});

test('DataBreach: email dataClass at low volume → severity 2', () => {
  const ev = dataBreach.normalize({ id: 'b5', dataClass: 'email', recordCount: 500 });
  assert.equal(ev?.severity, 2);
});

test('DataBreach: unknown dataClass → severity 1', () => {
  const ev = dataBreach.normalize({ id: 'b6', dataClass: 'sensor_logs' });
  assert.equal(ev?.severity, 1);
});

test('DataBreach: 1M-record email breach escalates 2 → 3', () => {
  const ev = dataBreach.normalize({ id: 'b7', dataClass: 'email', recordCount: 1_000_000 });
  assert.equal(ev?.severity, 3);
});

test('DataBreach: 10M-record email breach escalates 2 → 4 (capped)', () => {
  const ev = dataBreach.normalize({ id: 'b8', dataClass: 'email', recordCount: 10_000_000 });
  assert.equal(ev?.severity, 4);
});

test('DataBreach: 10M-record financial breach stays capped at 4 (no over-escalation)', () => {
  const ev = dataBreach.normalize({ id: 'b9', dataClass: 'financial', recordCount: 50_000_000 });
  assert.equal(ev?.severity, 4);
});

test('DataBreach: organization name appears in fallback description', () => {
  const ev = dataBreach.normalize({ id: 'b10', dataClass: 'pii', organization: 'AcmeCorp', recordCount: 5000 });
  assert.match(ev!.description, /AcmeCorp/);
});

test('DataBreach: missing id → null', () => {
  assert.equal(dataBreach.normalize({ dataClass: 'financial' }), null);
});

// ── InfrastructureCompromiseMissionBridge ─────────────────────────────

const infraCompromise = new InfrastructureCompromiseMissionBridge();

test('InfraCompromise: outage impact → severity 4', () => {
  const ev = infraCompromise.normalize({ id: 'c1', impact: 'outage' });
  assert.equal(ev?.severity, 4);
});

test('InfraCompromise: service_disruption impact → severity 3', () => {
  const ev = infraCompromise.normalize({ id: 'c2', impact: 'service_disruption' });
  assert.equal(ev?.severity, 3);
});

test('InfraCompromise: degraded impact → severity 3', () => {
  const ev = infraCompromise.normalize({ id: 'c3', impact: 'degraded' });
  assert.equal(ev?.severity, 3);
});

test('InfraCompromise: contained impact → severity 2', () => {
  const ev = infraCompromise.normalize({ id: 'c4', impact: 'contained' });
  assert.equal(ev?.severity, 2);
});

test('InfraCompromise: scanning impact → severity 1', () => {
  const ev = infraCompromise.normalize({ id: 'c5', impact: 'scanning' });
  assert.equal(ev?.severity, 1);
});

test('InfraCompromise: power_grid sector enforces a floor of 3 even on "contained" impact', () => {
  const ev = infraCompromise.normalize({ id: 'c6', impact: 'contained', sector: 'power_grid' });
  assert.equal(ev?.severity, 3);
});

test('InfraCompromise: hospital sector enforces a floor of 3 on a "scanning" impact', () => {
  const ev = infraCompromise.normalize({ id: 'c7', impact: 'scanning', sector: 'hospital' });
  assert.equal(ev?.severity, 3);
});

test('InfraCompromise: transit sector floor is 2 (lower than power)', () => {
  const ev = infraCompromise.normalize({ id: 'c8', impact: 'scanning', sector: 'transit' });
  assert.equal(ev?.severity, 2);
});

test('InfraCompromise: sector floor does not downgrade a higher impact reading', () => {
  const ev = infraCompromise.normalize({ id: 'c9', impact: 'outage', sector: 'transit' });
  assert.equal(ev?.severity, 4);
});

test('InfraCompromise: unknown impact + unknown sector → severity 1', () => {
  const ev = infraCompromise.normalize({ id: 'c10', impact: 'mystery', sector: 'mystery' });
  assert.equal(ev?.severity, 1);
});

test('InfraCompromise: operator name appears in fallback description', () => {
  const ev = infraCompromise.normalize({ id: 'c11', impact: 'outage', sector: 'power_grid', operator: 'CenturyEnergy' });
  assert.match(ev!.description, /CenturyEnergy/);
});

test('InfraCompromise: missing id → null', () => {
  assert.equal(infraCompromise.normalize({ impact: 'outage' }), null);
});

test('InfraCompromise: timestamp passes through when provided', () => {
  const ev = infraCompromise.normalize({ id: 'c12', impact: 'degraded', timestamp: 1_700_000_000_000 });
  assert.equal(ev?.timestamp, 1_700_000_000_000);
});

// ── JSON-serializable contract ────────────────────────────────────────

test('All new bridges return JSON-serializable events', () => {
  const e1 = cyberAttack.normalize({ id: 'x1', stage: 'attempted' });
  const e2 = dataBreach.normalize({ id: 'x2', dataClass: 'financial' });
  const e3 = infraCompromise.normalize({ id: 'x3', impact: 'outage', sector: 'utilities' });
  for (const e of [e1, e2, e3]) {
    assert.ok(e);
    const round = JSON.parse(JSON.stringify(e));
    assert.deepEqual(round, e);
  }
});
