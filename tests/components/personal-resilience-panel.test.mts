import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDomainInterestRows,
  buildRegionalContext,
  buildRiskFactors,
  recommendationForRisk,
  riskAsPercentage,
  riskFromResilience,
  riskTier,
  severityForExposure,
} from '../../src/components/personal-resilience-helpers.js';
import type {
  AlertHistoryEntry,
  DomainExposure,
  ResilienceProfile,
} from '../../src/services/intelligence/personal-resilience-model.js';

const NOW = 1_750_000_000_000;

function exposure(over: Partial<DomainExposure> = {}): DomainExposure {
  return {
    domain: over.domain ?? 'wildfire',
    exposureLevel: over.exposureLevel ?? 0.5,
    relevantRegions: over.relevantRegions ?? ['La Porte, IN'],
    alertsReceived: over.alertsReceived ?? 2,
  };
}

function profile(over: Partial<ResilienceProfile> = {}): ResilienceProfile {
  return {
    userId: over.userId ?? 'default',
    overallResilienceScore: over.overallResilienceScore ?? 0.6,
    riskExposure: over.riskExposure ?? [exposure()],
    preparednessLevel: over.preparednessLevel ?? 'medium',
    topRisks: over.topRisks ?? ['wildfire'],
    recommendations: over.recommendations ?? ['Monitor local wildfire alerts'],
    lastUpdated: over.lastUpdated ?? NOW,
  };
}

// ── riskFromResilience / riskAsPercentage ────────────────────────────────────

describe('riskFromResilience', () => {
  it('inverts resilience to risk', () => {
    assert.ok(Math.abs(riskFromResilience(0.7) - 0.3) < 1e-9);
    assert.equal(riskFromResilience(0), 1);
    assert.equal(riskFromResilience(1), 0);
  });

  it('clamps non-finite to 0 risk', () => {
    assert.equal(riskFromResilience(Number.NaN), 0);
  });

  it('clamps out-of-range resilience', () => {
    assert.equal(riskFromResilience(-0.5), 1);
    assert.equal(riskFromResilience(1.5), 0);
  });
});

describe('riskAsPercentage', () => {
  it('renders 0–100 integer', () => {
    assert.equal(riskAsPercentage(0.345), 35);
    assert.equal(riskAsPercentage(0), 0);
    assert.equal(riskAsPercentage(1), 100);
  });

  it('clamps out-of-range to 0/100', () => {
    assert.equal(riskAsPercentage(-1), 0);
    assert.equal(riskAsPercentage(2), 100);
  });
});

// ── riskTier / recommendationForRisk ─────────────────────────────────────────

describe('riskTier', () => {
  it('returns "none" below 0.30', () => {
    assert.equal(riskTier(0.0), 'none');
    assert.equal(riskTier(0.29), 'none');
  });

  it('returns "monitor" for 0.30–0.49', () => {
    assert.equal(riskTier(0.3), 'monitor');
    assert.equal(riskTier(0.49), 'monitor');
  });

  it('returns "review" for 0.50–0.69', () => {
    assert.equal(riskTier(0.5), 'review');
    assert.equal(riskTier(0.69), 'review');
  });

  it('returns "action" at 0.70+', () => {
    assert.equal(riskTier(0.7), 'action');
    assert.equal(riskTier(0.99), 'action');
  });
});

describe('recommendationForRisk', () => {
  it('returns null below 0.30', () => {
    assert.equal(recommendationForRisk(0.1), null);
  });

  it('returns "Monitor local alerts" for 0.30–0.49', () => {
    assert.equal(recommendationForRisk(0.4), 'Monitor local alerts');
  });

  it('returns "Review emergency kit" for 0.50–0.69', () => {
    assert.equal(recommendationForRisk(0.6), 'Review emergency kit');
  });

  it('returns "Consider action plan" at 0.70+', () => {
    assert.equal(recommendationForRisk(0.75), 'Consider action plan');
    assert.equal(recommendationForRisk(0.95), 'Consider action plan');
  });
});

// ── severityForExposure ──────────────────────────────────────────────────────

describe('severityForExposure', () => {
  it('low when exposure < 0.30', () => {
    assert.equal(severityForExposure(0), 'low');
    assert.equal(severityForExposure(0.29), 'low');
  });

  it('medium when exposure 0.30–0.59', () => {
    assert.equal(severityForExposure(0.45), 'medium');
  });

  it('high when exposure 0.60–0.84', () => {
    assert.equal(severityForExposure(0.7), 'high');
  });

  it('critical when exposure ≥ 0.85', () => {
    assert.equal(severityForExposure(0.85), 'critical');
    assert.equal(severityForExposure(1.0), 'critical');
  });
});

// ── buildRiskFactors ─────────────────────────────────────────────────────────

describe('buildRiskFactors', () => {
  it('returns [] when profile is undefined', () => {
    assert.deepEqual(buildRiskFactors(undefined), []);
  });

  it('returns [] when riskExposure is empty', () => {
    assert.deepEqual(buildRiskFactors(profile({ riskExposure: [] })), []);
  });

  it('sorts by contribution desc', () => {
    const p = profile({
      riskExposure: [
        exposure({ domain: 'a', exposureLevel: 0.2 }),
        exposure({ domain: 'b', exposureLevel: 0.8 }),
        exposure({ domain: 'c', exposureLevel: 0.5 }),
      ],
    });
    const rows = buildRiskFactors(p);
    assert.deepEqual(rows.map((r) => r.domain), ['b', 'c', 'a']);
  });

  it('weights sum to ~1 across factors', () => {
    const p = profile({
      riskExposure: [
        exposure({ domain: 'a', exposureLevel: 0.2 }),
        exposure({ domain: 'b', exposureLevel: 0.8 }),
      ],
    });
    const rows = buildRiskFactors(p);
    const sum = rows.reduce((s, r) => s + r.weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `weights should sum to 1, got ${sum}`);
  });

  it('caps at 5 factors', () => {
    const p = profile({
      riskExposure: Array.from({ length: 8 }, (_, i) =>
        exposure({ domain: `d-${i}`, exposureLevel: 0.1 * (i + 1) })),
    });
    assert.equal(buildRiskFactors(p).length, 5);
  });

  it('passes alertsReceived through', () => {
    const rows = buildRiskFactors(profile({ riskExposure: [exposure({ alertsReceived: 17 })] }));
    assert.equal(rows[0]!.alertsReceived, 17);
  });

  it('labels severity from exposureLevel', () => {
    const rows = buildRiskFactors(profile({
      riskExposure: [
        exposure({ domain: 'low', exposureLevel: 0.1 }),
        exposure({ domain: 'crit', exposureLevel: 0.9 }),
      ],
    }));
    const labels = Object.fromEntries(rows.map((r) => [r.domain, r.severity]));
    assert.equal(labels['crit'], 'critical');
    assert.equal(labels['low'], 'low');
  });
});

// ── buildRegionalContext ─────────────────────────────────────────────────────

describe('buildRegionalContext', () => {
  it('returns [] when profile is undefined and no userRegions given', () => {
    assert.deepEqual(buildRegionalContext(undefined, [], []), []);
  });

  it('uses userRegions when no profile', () => {
    const rows = buildRegionalContext(undefined, ['Chicago'], []);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.region, 'Chicago');
    assert.equal(rows[0]!.threatLevel, 'calm');
  });

  it('dedups regions across profile and userRegions', () => {
    const p = profile({ riskExposure: [exposure({ relevantRegions: ['Chicago', 'Detroit'] })] });
    const rows = buildRegionalContext(p, ['Chicago'], []);
    const ids = rows.map((r) => r.region).sort();
    assert.deepEqual(ids, ['Chicago', 'Detroit']);
  });

  it('ignores alerts whose region is not in user regions', () => {
    const p = profile({ riskExposure: [exposure({ relevantRegions: ['Chicago'] })] });
    const alerts: AlertHistoryEntry[] = [
      { domain: 'fire', severity: 0.9 },
      { domain: 'flood', severity: 0.4 },
    ];
    const rows = buildRegionalContext(p, [], alerts, (_a, i) => ['Chicago', 'Boston'][i]);
    const chicago = rows.find((r) => r.region === 'Chicago');
    assert.equal(chicago?.matchingAlertCount, 1);
    assert.equal(chicago?.topDomain, 'fire');
  });

  it('elevates threat level by severity', () => {
    const p = profile({ riskExposure: [exposure({ relevantRegions: ['Chicago'] })] });
    const alerts: AlertHistoryEntry[] = [{ domain: 'fire', severity: 0.9 }];
    const rows = buildRegionalContext(p, [], alerts, () => 'Chicago');
    assert.equal(rows[0]!.threatLevel, 'critical');
  });

  it('escalates threat level by count when severity is low', () => {
    const p = profile({ riskExposure: [exposure({ relevantRegions: ['Chicago'] })] });
    const alerts: AlertHistoryEntry[] = Array.from({ length: 5 }, () => ({ domain: 'mild', severity: 0.05 }));
    const rows = buildRegionalContext(p, [], alerts, () => 'Chicago');
    assert.equal(rows[0]!.threatLevel, 'elevated');
  });

  it('topDomain is the highest-severity contributor', () => {
    const p = profile({ riskExposure: [exposure({ relevantRegions: ['Chicago'] })] });
    const alerts: AlertHistoryEntry[] = [
      { domain: 'flood', severity: 0.4 },
      { domain: 'fire', severity: 0.8 },
      { domain: 'wind', severity: 0.3 },
    ];
    const rows = buildRegionalContext(p, [], alerts, () => 'Chicago');
    assert.equal(rows[0]!.topDomain, 'fire');
  });

  it('rows sort critical → elevated → watch → calm', () => {
    const p = profile({ riskExposure: [
      exposure({ relevantRegions: ['Calm', 'Hot', 'Watch'] }),
    ] });
    const alerts: AlertHistoryEntry[] = [
      { domain: 'a', severity: 0.9 },
      { domain: 'b', severity: 0.4 },
    ];
    const rows = buildRegionalContext(p, [], alerts, (_a, i) => ['Hot', 'Watch'][i]);
    assert.deepEqual(rows.map((r) => r.region), ['Hot', 'Watch', 'Calm']);
  });

  it('drops empty/whitespace region strings', () => {
    const rows = buildRegionalContext(undefined, ['', 'Chicago'], []);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.region, 'Chicago');
  });
});

// ── buildDomainInterestRows ──────────────────────────────────────────────────

describe('buildDomainInterestRows', () => {
  it('returns [] when profile is undefined', () => {
    assert.deepEqual(buildDomainInterestRows(undefined), []);
  });

  it('defaults interestWeight uniformly when no weights declared', () => {
    const p = profile({
      riskExposure: [
        exposure({ domain: 'a', exposureLevel: 0.3 }),
        exposure({ domain: 'b', exposureLevel: 0.3 }),
      ],
    });
    const rows = buildDomainInterestRows(p);
    assert.equal(rows.length, 2);
    for (const r of rows) assert.ok(Math.abs(r.interestWeight - 0.5) < 1e-9);
  });

  it('honors declared weights and normalizes to sum 1', () => {
    const p = profile({
      riskExposure: [
        exposure({ domain: 'fire', exposureLevel: 0.4 }),
        exposure({ domain: 'flood', exposureLevel: 0.4 }),
      ],
    });
    const rows = buildDomainInterestRows(p, { fire: 3, flood: 1 });
    const fire = rows.find((r) => r.domain === 'fire');
    const flood = rows.find((r) => r.domain === 'flood');
    assert.ok(Math.abs((fire?.interestWeight ?? 0) - 0.75) < 1e-9);
    assert.ok(Math.abs((flood?.interestWeight ?? 0) - 0.25) < 1e-9);
  });

  it('clamps negative declared weights to 0', () => {
    const p = profile({
      riskExposure: [
        exposure({ domain: 'a', exposureLevel: 0.5 }),
        exposure({ domain: 'b', exposureLevel: 0.5 }),
      ],
    });
    const rows = buildDomainInterestRows(p, { a: -3, b: 1 });
    const a = rows.find((r) => r.domain === 'a');
    assert.equal(a?.interestWeight, 0);
  });

  it('scoreContribution multiplies interestWeight × exposureLevel', () => {
    const p = profile({
      riskExposure: [exposure({ domain: 'fire', exposureLevel: 0.8 })],
    });
    const rows = buildDomainInterestRows(p, { fire: 1 });
    assert.ok(Math.abs(rows[0]!.scoreContribution - 0.8) < 1e-9);
  });

  it('sorts by scoreContribution desc', () => {
    const p = profile({
      riskExposure: [
        exposure({ domain: 'low-exposure', exposureLevel: 0.1 }),
        exposure({ domain: 'high-exposure', exposureLevel: 0.9 }),
      ],
    });
    const rows = buildDomainInterestRows(p);
    assert.equal(rows[0]!.domain, 'high-exposure');
  });
});
