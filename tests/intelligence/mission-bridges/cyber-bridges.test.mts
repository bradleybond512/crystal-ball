/**
 * Tests for cyber mission bridges.
 *
 * Covers:
 *   - Auto-registration at module load
 *   - CVEKevBridge.normalize() — CVSS tiers, KEV floor, edge cases
 *   - ThreatIntelBridge.normalize() — all threat types, fallbacks
 *   - BreachIntelBridge.normalize() — all breach classes, record-count escalation
 *   - InfraAttackBridge.normalize() — all attack types, unknown fallback
 *   - Null guard: missing or empty id returns null
 *
 * Run with: npx tsx --test tests/intelligence/mission-bridges/cyber-bridges.test.mts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CVEKevBridge,
  ThreatIntelBridge,
  BreachIntelBridge,
  InfraAttackBridge,
} from '../../../src/services/intelligence/mission-bridges/cyber-bridges.ts';
import {
  getMissionBridgeRegistry,
  __resetMissionBridgeRegistry,
} from '../../../src/services/intelligence/mission-bridges/mission-bridge-core.ts';

// ── Auto-registration ─────────────────────────────────────────────────

test('importing cyber-bridges registers CVEKevBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('cyber', 'cisa-kev'));
});

test('importing cyber-bridges registers ThreatIntelBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('cyber', 'threat-intel'));
});

test('importing cyber-bridges registers BreachIntelBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('cyber', 'breach-intel'));
});

test('importing cyber-bridges registers InfraAttackBridge', () => {
  assert.ok(getMissionBridgeRegistry().has('cyber', 'infra-attacks'));
});

test('all cyber bridges retrievable by domain', () => {
  const reg = getMissionBridgeRegistry();
  const cyberBridges = reg.getByDomain('cyber');
  assert.equal(cyberBridges.length, 4);
});

// ── CVEKevBridge — properties ─────────────────────────────────────────

const kevBridge = new CVEKevBridge();

test('CVEKevBridge.domain is cyber', () => {
  assert.equal(kevBridge.domain, 'cyber');
});

test('CVEKevBridge.feedId is cisa-kev', () => {
  assert.equal(kevBridge.feedId, 'cisa-kev');
});

// ── CVEKevBridge — severity mapping ───────────────────────────────────

test('CVEKevBridge: CVSS 9.8 → severity 4', () => {
  const r = kevBridge.normalize({ id: 'CVE-2024-0001', cvssScore: 9.8, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('CVEKevBridge: CVSS 7.5 → severity 3 (KEV floor)', () => {
  const r = kevBridge.normalize({ id: 'CVE-2024-0002', cvssScore: 7.5, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('CVEKevBridge: CVSS 4.0 → severity 3 (KEV floor overrides base 2)', () => {
  const r = kevBridge.normalize({ id: 'CVE-2024-0003', cvssScore: 4.0, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('CVEKevBridge: CVSS 0 → severity 3 (KEV floor)', () => {
  const r = kevBridge.normalize({ id: 'CVE-2024-0004', cvssScore: 0, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('CVEKevBridge: uses vulnerabilityName in description when description absent', () => {
  const r = kevBridge.normalize({ id: 'CVE-2024-0005', vulnerabilityName: 'Log4Shell', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Log4Shell'));
});

test('CVEKevBridge: explicit description takes precedence', () => {
  const r = kevBridge.normalize({ id: 'CVE-2024-0006', description: 'Critical RCE', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.description, 'Critical RCE');
});

test('CVEKevBridge: missing id → null', () => {
  assert.equal(kevBridge.normalize({ cvssScore: 9.8 }), null);
});

test('CVEKevBridge: empty string id → null', () => {
  assert.equal(kevBridge.normalize({ id: '', cvssScore: 9.8 }), null);
});

test('CVEKevBridge: missing timestamp falls back to Date.now()', () => {
  const before = Date.now();
  const r = kevBridge.normalize({ id: 'CVE-2024-0007' });
  const after = Date.now();
  assert.ok(r);
  assert.ok(r.timestamp >= before && r.timestamp <= after);
});

test('CVEKevBridge: raw payload preserved', () => {
  const raw = { id: 'CVE-2024-0008', cvssScore: 9.0, extra: 'data', timestamp: 2000 };
  const r = kevBridge.normalize(raw);
  assert.ok(r);
  assert.deepEqual(r.raw, raw);
});

// ── ThreatIntelBridge — properties ───────────────────────────────────

const threatBridge = new ThreatIntelBridge();

test('ThreatIntelBridge.domain is cyber', () => {
  assert.equal(threatBridge.domain, 'cyber');
});

test('ThreatIntelBridge.feedId is threat-intel', () => {
  assert.equal(threatBridge.feedId, 'threat-intel');
});

// ── ThreatIntelBridge — severity mapping ──────────────────────────────

test('ThreatIntelBridge: c2_server → severity 4', () => {
  const r = threatBridge.normalize({ id: 't1', threatType: 'c2_server', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('ThreatIntelBridge: ransomware → severity 4', () => {
  const r = threatBridge.normalize({ id: 't2', threatType: 'ransomware', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('ThreatIntelBridge: apt → severity 4', () => {
  const r = threatBridge.normalize({ id: 't3', threatType: 'apt', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('ThreatIntelBridge: botnet → severity 3', () => {
  const r = threatBridge.normalize({ id: 't4', threatType: 'botnet', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('ThreatIntelBridge: phishing → severity 2', () => {
  const r = threatBridge.normalize({ id: 't5', threatType: 'phishing', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('ThreatIntelBridge: malware_url → severity 2', () => {
  const r = threatBridge.normalize({ id: 't6', threatType: 'malware_url', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('ThreatIntelBridge: suspicious → severity 1', () => {
  const r = threatBridge.normalize({ id: 't7', threatType: 'suspicious', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('ThreatIntelBridge: unknown type → severity 1 (fallback)', () => {
  const r = threatBridge.normalize({ id: 't8', threatType: 'unknown_type', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('ThreatIntelBridge: case-insensitive threat type matching', () => {
  const r = threatBridge.normalize({ id: 't9', threatType: 'Ransomware', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('ThreatIntelBridge: uses ioc in description fallback', () => {
  const r = threatBridge.normalize({ id: 't10', threatType: 'phishing', ioc: '1.2.3.4', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('1.2.3.4'));
});

test('ThreatIntelBridge: uses indicator field when ioc absent', () => {
  const r = threatBridge.normalize({ id: 't11', threatType: 'botnet', indicator: 'evil.com', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('evil.com'));
});

test('ThreatIntelBridge: missing id → null', () => {
  assert.equal(threatBridge.normalize({ threatType: 'phishing' }), null);
});

// ── BreachIntelBridge — properties ───────────────────────────────────

const breachBridge = new BreachIntelBridge();

test('BreachIntelBridge.domain is cyber', () => {
  assert.equal(breachBridge.domain, 'cyber');
});

test('BreachIntelBridge.feedId is breach-intel', () => {
  assert.equal(breachBridge.feedId, 'breach-intel');
});

// ── BreachIntelBridge — severity mapping ──────────────────────────────

test('BreachIntelBridge: credentials breach → severity 4', () => {
  const r = breachBridge.normalize({ id: 'b1', breachClass: 'credentials', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('BreachIntelBridge: financial breach → severity 4', () => {
  const r = breachBridge.normalize({ id: 'b2', breachClass: 'financial', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('BreachIntelBridge: health breach → severity 3', () => {
  const r = breachBridge.normalize({ id: 'b3', breachClass: 'health', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('BreachIntelBridge: personal_pii breach → severity 3', () => {
  const r = breachBridge.normalize({ id: 'b4', breachClass: 'personal_pii', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('BreachIntelBridge: email breach → severity 2', () => {
  const r = breachBridge.normalize({ id: 'b5', breachClass: 'email', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('BreachIntelBridge: general breach → severity 1', () => {
  const r = breachBridge.normalize({ id: 'b6', breachClass: 'general', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('BreachIntelBridge: email breach + >1M records escalates to severity 3', () => {
  const r = breachBridge.normalize({ id: 'b7', breachClass: 'email', recordCount: 5_000_000, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('BreachIntelBridge: health breach + >1M records stays at 4 (already capped)', () => {
  const r = breachBridge.normalize({ id: 'b8', breachClass: 'credentials', recordCount: 10_000_000, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('BreachIntelBridge: exactly 1M records does NOT escalate', () => {
  const r = breachBridge.normalize({ id: 'b9', breachClass: 'email', recordCount: 1_000_000, timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('BreachIntelBridge: uses title in description fallback', () => {
  const r = breachBridge.normalize({ id: 'b10', breachClass: 'email', title: 'CompanyX Breach', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('CompanyX Breach'));
});

test('BreachIntelBridge: missing id → null', () => {
  assert.equal(breachBridge.normalize({ breachClass: 'credentials' }), null);
});

test('BreachIntelBridge: unknown breachClass → severity 1 (fallback)', () => {
  const r = breachBridge.normalize({ id: 'b11', breachClass: 'exotic_type', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

// ── InfraAttackBridge — properties ───────────────────────────────────

const attackBridge = new InfraAttackBridge();

test('InfraAttackBridge.domain is cyber', () => {
  assert.equal(attackBridge.domain, 'cyber');
});

test('InfraAttackBridge.feedId is infra-attacks', () => {
  assert.equal(attackBridge.feedId, 'infra-attacks');
});

// ── InfraAttackBridge — severity mapping ──────────────────────────────

test('InfraAttackBridge: ransomware_incident → severity 4', () => {
  const r = attackBridge.normalize({ id: 'a1', attackType: 'ransomware_incident', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('InfraAttackBridge: data_exfiltration → severity 4', () => {
  const r = attackBridge.normalize({ id: 'a2', attackType: 'data_exfiltration', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('InfraAttackBridge: ddos_critical → severity 3', () => {
  const r = attackBridge.normalize({ id: 'a3', attackType: 'ddos_critical', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('InfraAttackBridge: unauthorized_access → severity 3', () => {
  const r = attackBridge.normalize({ id: 'a4', attackType: 'unauthorized_access', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 3);
});

test('InfraAttackBridge: ddos_moderate → severity 2', () => {
  const r = attackBridge.normalize({ id: 'a5', attackType: 'ddos_moderate', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 2);
});

test('InfraAttackBridge: scanning → severity 1', () => {
  const r = attackBridge.normalize({ id: 'a6', attackType: 'scanning', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('InfraAttackBridge: unknown type → severity 1 (fallback)', () => {
  const r = attackBridge.normalize({ id: 'a7', attackType: 'unknown', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 1);
});

test('InfraAttackBridge: attack type with spaces normalized to underscores', () => {
  const r = attackBridge.normalize({ id: 'a8', attackType: 'ransomware incident', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.severity, 4);
});

test('InfraAttackBridge: uses target in description fallback', () => {
  const r = attackBridge.normalize({ id: 'a9', attackType: 'ddos_critical', target: 'Hospital Network', timestamp: 1000 });
  assert.ok(r);
  assert.ok(r.description.includes('Hospital Network'));
});

test('InfraAttackBridge: missing id → null', () => {
  assert.equal(attackBridge.normalize({ attackType: 'ddos_critical' }), null);
});

test('InfraAttackBridge: explicit description takes precedence', () => {
  const r = attackBridge.normalize({ id: 'a10', attackType: 'scanning', description: 'Port scan from AS12345', timestamp: 1000 });
  assert.ok(r);
  assert.equal(r.description, 'Port scan from AS12345');
});

// ── Registry isolation ─────────────────────────────────────────────────

test('resetting registry removes all cyber bridges', () => {
  __resetMissionBridgeRegistry();
  const reg = getMissionBridgeRegistry();
  assert.equal(reg.has('cyber', 'cisa-kev'), false);
  assert.equal(reg.has('cyber', 'threat-intel'), false);
  assert.equal(reg.has('cyber', 'breach-intel'), false);
  assert.equal(reg.has('cyber', 'infra-attacks'), false);
});
