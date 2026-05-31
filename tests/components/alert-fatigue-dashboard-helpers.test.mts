/**
 * Tests for alert-fatigue-dashboard-helpers.ts pure functions.
 *
 * Run: tsx --test tests/components/alert-fatigue-dashboard-helpers.test.mts
 * No DOM required — all functions are pure.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fatigueColor,
  fatiguePercent,
  recommendationLabel,
  recommendationDesc,
  recommendationIcon,
  trendDirection,
  trendArrow,
  domainBreakdown,
  previousWindowRate,
  formatRate,
  formatAckRate,
  type TrendDirection,
  type DomainEntry,
} from '../../src/components/alert-fatigue-dashboard-helpers.ts';
import type { AlertRecord } from '../../src/services/intelligence/alert-fatigue-detector.ts';

const NOW = 1_720_000_000_000;
const HOUR = 60 * 60 * 1000;

function makeAlert(overrides: Partial<AlertRecord> = {}): AlertRecord {
  return {
    id: 'a1',
    domain: 'cyber',
    severity: 50,
    timestamp: NOW - 1000,
    acknowledged: false,
    ...overrides,
  };
}

// ── fatigueColor ──────────────────────────────────────────────────────────

test('fatigueColor: score 0 → green', () => {
  assert.match(fatigueColor(0), /4caf50/);
});

test('fatigueColor: score 0.29 → green', () => {
  assert.match(fatigueColor(0.29), /4caf50/);
});

test('fatigueColor: score 0.3 → yellow', () => {
  assert.match(fatigueColor(0.3), /facc15/);
});

test('fatigueColor: score 0.5 → orange', () => {
  assert.match(fatigueColor(0.5), /fb923c/);
});

test('fatigueColor: score 0.8 → red (critical)', () => {
  assert.match(fatigueColor(0.8), /ef4444/);
});

test('fatigueColor: score 1.0 → red (critical)', () => {
  assert.match(fatigueColor(1.0), /ef4444/);
});

// ── fatiguePercent ────────────────────────────────────────────────────────

test('fatiguePercent: 0 → 0', () => {
  assert.equal(fatiguePercent(0), 0);
});

test('fatiguePercent: 0.5 → 50', () => {
  assert.equal(fatiguePercent(0.5), 50);
});

test('fatiguePercent: 1 → 100', () => {
  assert.equal(fatiguePercent(1), 100);
});

test('fatiguePercent: clamps values above 1', () => {
  assert.equal(fatiguePercent(2), 100);
});

test('fatiguePercent: clamps negative values', () => {
  assert.equal(fatiguePercent(-0.5), 0);
});

test('fatiguePercent: rounds correctly (0.456 → 46)', () => {
  assert.equal(fatiguePercent(0.456), 46);
});

// ── recommendationLabel ───────────────────────────────────────────────────

test('recommendationLabel: none → Normal', () => {
  assert.equal(recommendationLabel('none'), 'Normal');
});

test('recommendationLabel: batch → Batch', () => {
  assert.equal(recommendationLabel('batch'), 'Batch');
});

test('recommendationLabel: suppress-low → Suppress Low', () => {
  assert.equal(recommendationLabel('suppress-low'), 'Suppress Low');
});

test('recommendationLabel: escalate-only → Escalate Only', () => {
  assert.equal(recommendationLabel('escalate-only'), 'Escalate Only');
});

// ── recommendationDesc ────────────────────────────────────────────────────

test('recommendationDesc: none → contains "normally"', () => {
  assert.match(recommendationDesc('none'), /normal/i);
});

test('recommendationDesc: batch → mentions grouping/digest', () => {
  assert.match(recommendationDesc('batch'), /group|digest|bundle/i);
});

test('recommendationDesc: suppress-low → mentions low severity', () => {
  assert.match(recommendationDesc('suppress-low'), /low/i);
});

test('recommendationDesc: escalate-only → mentions critical', () => {
  assert.match(recommendationDesc('escalate-only'), /critical/i);
});

// ── recommendationIcon ────────────────────────────────────────────────────

test('recommendationIcon: all 4 recs return non-empty strings', () => {
  for (const rec of ['none', 'batch', 'suppress-low', 'escalate-only'] as const) {
    assert.ok(recommendationIcon(rec).length > 0, `empty icon for ${rec}`);
  }
});

test('recommendationIcon: none → checkmark-style icon', () => {
  assert.equal(recommendationIcon('none'), '✓');
});

// ── trendDirection ────────────────────────────────────────────────────────

test('trendDirection: equal rates → flat', () => {
  assert.equal(trendDirection(1.0, 1.0), 'flat');
});

test('trendDirection: small delta → flat (< 0.01)', () => {
  assert.equal(trendDirection(1.005, 1.0), 'flat');
});

test('trendDirection: higher current → up', () => {
  assert.equal(trendDirection(2.0, 1.0), 'up');
});

test('trendDirection: lower current → down', () => {
  assert.equal(trendDirection(0.5, 1.5), 'down');
});

// ── trendArrow ────────────────────────────────────────────────────────────

test('trendArrow: up → ▲', () => {
  assert.equal(trendArrow('up'), '▲');
});

test('trendArrow: down → ▼', () => {
  assert.equal(trendArrow('down'), '▼');
});

test('trendArrow: flat → →', () => {
  assert.equal(trendArrow('flat'), '→');
});

// ── domainBreakdown ───────────────────────────────────────────────────────

test('domainBreakdown: empty alerts → empty array', () => {
  assert.deepEqual(domainBreakdown([], HOUR, NOW), []);
});

test('domainBreakdown: single alert → one entry', () => {
  const result = domainBreakdown([makeAlert({ domain: 'weather' })], HOUR, NOW);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.domain, 'weather');
  assert.equal(result[0]!.count, 1);
});

test('domainBreakdown: sorts by count descending', () => {
  const alerts: AlertRecord[] = [
    makeAlert({ id: 'a1', domain: 'cyber' }),
    makeAlert({ id: 'a2', domain: 'weather' }),
    makeAlert({ id: 'a3', domain: 'weather' }),
    makeAlert({ id: 'a4', domain: 'seismic' }),
    makeAlert({ id: 'a5', domain: 'seismic' }),
    makeAlert({ id: 'a6', domain: 'seismic' }),
  ];
  const result = domainBreakdown(alerts, HOUR, NOW);
  assert.equal(result[0]!.domain, 'seismic');
  assert.equal(result[0]!.count, 3);
  assert.equal(result[1]!.domain, 'weather');
  assert.equal(result[2]!.domain, 'cyber');
});

test('domainBreakdown: counts acknowledged alerts separately', () => {
  const alerts: AlertRecord[] = [
    makeAlert({ id: 'a1', domain: 'cyber', acknowledged: true }),
    makeAlert({ id: 'a2', domain: 'cyber', acknowledged: false }),
  ];
  const result = domainBreakdown(alerts, HOUR, NOW);
  assert.equal(result[0]!.acked, 1);
  assert.equal(result[0]!.count, 2);
});

test('domainBreakdown: excludes alerts outside window', () => {
  const alerts: AlertRecord[] = [
    makeAlert({ id: 'a1', timestamp: NOW - HOUR - 1 }), // outside
    makeAlert({ id: 'a2', timestamp: NOW - HOUR + 1 }), // inside
  ];
  const result = domainBreakdown(alerts, HOUR, NOW);
  assert.equal(result.length, 1);
});

// ── previousWindowRate ────────────────────────────────────────────────────

test('previousWindowRate: no alerts in previous window → 0', () => {
  assert.equal(previousWindowRate([], HOUR, NOW), 0);
});

test('previousWindowRate: counts only previous window alerts', () => {
  // 60 alerts in previous window (1-2 hours ago) → 1/min
  const alerts = Array.from({ length: 60 }, (_, i) =>
    makeAlert({ id: `a${i}`, timestamp: NOW - HOUR - (i + 1) * 1000 })
  );
  const rate = previousWindowRate(alerts, HOUR, NOW);
  assert.ok(rate > 0.9 && rate <= 1.1, `expected ~1/min, got ${rate}`);
});

test('previousWindowRate: ignores current window alerts', () => {
  const currentAlerts = Array.from({ length: 60 }, (_, i) =>
    makeAlert({ id: `curr${i}`, timestamp: NOW - (i + 1) * 1000 })
  );
  assert.equal(previousWindowRate(currentAlerts, HOUR, NOW), 0);
});

// ── formatRate ────────────────────────────────────────────────────────────

test('formatRate: 0 → <0.1/min', () => {
  assert.equal(formatRate(0), '<0.1/min');
});

test('formatRate: 0.05 → <0.1/min', () => {
  assert.equal(formatRate(0.05), '<0.1/min');
});

test('formatRate: 1.5 → "1.5/min"', () => {
  assert.equal(formatRate(1.5), '1.5/min');
});

test('formatRate: 10.0 → "10.0/min"', () => {
  assert.equal(formatRate(10.0), '10.0/min');
});

// ── formatAckRate ─────────────────────────────────────────────────────────

test('formatAckRate: 0 → "0%"', () => {
  assert.equal(formatAckRate(0), '0%');
});

test('formatAckRate: 1 → "100%"', () => {
  assert.equal(formatAckRate(1), '100%');
});

test('formatAckRate: 0.75 → "75%"', () => {
  assert.equal(formatAckRate(0.75), '75%');
});

test('formatAckRate: clamps above 1 to 100%', () => {
  assert.equal(formatAckRate(1.5), '100%');
});
