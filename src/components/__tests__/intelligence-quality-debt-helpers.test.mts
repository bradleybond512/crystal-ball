/**
 * IntelligenceQualityDebtPanel helper tests.
 *
 * Covers every pure helper exported from
 * `intelligence-quality-debt-helpers.ts`:
 *   - computeQualityScore (penalty model + floor)
 *   - colorForScore (green / yellow / red bands)
 *   - trendVsPrevious (delta + direction + glyph)
 *   - summarizeActiveDebts (critical-first sort, resolved filter, age label)
 *   - formatAge / formatDuration (unit boundaries)
 *   - computeResolutionRate (week window, per-category averages, ratio edges)
 *   - computeDomainHealth (grade thresholds, global-domain fallback,
 *     last-verified tracking)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORY_LABEL,
  GRADE_COLOR,
  GRADE_GREEN_MIN,
  GRADE_YELLOW_MIN,
  SCORE_COLOR,
  SEVERITY_COLOR,
  SEVERITY_PENALTY,
  WEEK_MS,
  colorForScore,
  computeDomainHealth,
  computeQualityScore,
  computeResolutionRate,
  formatAge,
  formatDuration,
  summarizeActiveDebts,
  trendVsPrevious,
} from '../intelligence-quality-debt-helpers.ts';
import type { QualityDebt } from '@/services/intelligence/quality-debt-tracker';

// ── Fixtures ──────────────────────────────────────────────────────────

const T0 = 1_780_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function debt(overrides: Partial<QualityDebt> = {}): QualityDebt {
  return {
    id: overrides.id ?? 'debt-x',
    title: 'Sample debt',
    description: 'desc',
    category: 'data',
    severity: 'medium',
    estimatedImpact: 'impact line',
    createdAt: T0,
    status: 'open',
    ...overrides,
  };
}

// ── 1. computeQualityScore (5 tests) ──────────────────────────────────

describe('computeQualityScore', () => {
  it('returns 100 with no debts', () => {
    assert.equal(computeQualityScore([]), 100);
  });

  it('subtracts only open debts (resolved + in-progress excluded)', () => {
    const result = computeQualityScore([
      debt({ id: 'a', severity: 'critical', status: 'resolved' }),
      debt({ id: 'b', severity: 'high', status: 'in-progress' }),
      debt({ id: 'c', severity: 'medium', status: 'open' }),
    ]);
    assert.equal(result, 100 - SEVERITY_PENALTY.medium);
  });

  it('floors at 0 when penalty exceeds 100', () => {
    const eight = Array.from({ length: 8 }, (_, i) =>
      debt({ id: `c${i}`, severity: 'critical', status: 'open' }));
    assert.equal(computeQualityScore(eight), 0);
  });

  it('weights critical heavier than low', () => {
    const single = computeQualityScore([debt({ severity: 'critical', status: 'open' })]);
    const many = computeQualityScore(Array.from({ length: 12 }, () => debt({ severity: 'low', status: 'open' })));
    assert.ok(single < many, 'one critical should hurt more than twelve lows');
  });

  it('returns an integer in [0, 100]', () => {
    const result = computeQualityScore([debt({ severity: 'high', status: 'open' })]);
    assert.equal(Number.isInteger(result), true);
    assert.ok(result >= 0 && result <= 100);
  });
});

// ── 2. colorForScore (3 tests) ────────────────────────────────────────

describe('colorForScore', () => {
  it('returns green at the green threshold and above', () => {
    assert.equal(colorForScore(GRADE_GREEN_MIN), 'green');
    assert.equal(colorForScore(100), 'green');
  });

  it('returns yellow inside the [yellow_min, green_min) band', () => {
    assert.equal(colorForScore(GRADE_YELLOW_MIN), 'yellow');
    assert.equal(colorForScore(GRADE_GREEN_MIN - 1), 'yellow');
  });

  it('returns red below the yellow threshold', () => {
    assert.equal(colorForScore(GRADE_YELLOW_MIN - 1), 'red');
    assert.equal(colorForScore(0), 'red');
  });
});

// ── 3. trendVsPrevious (4 tests) ──────────────────────────────────────

describe('trendVsPrevious', () => {
  it('returns flat when previous is null', () => {
    const t = trendVsPrevious(80, null);
    assert.equal(t.direction, 'flat');
    assert.equal(t.delta, 0);
    assert.equal(t.glyph, '→');
  });

  it('returns up + ▲ glyph when current improves', () => {
    const t = trendVsPrevious(80, 60);
    assert.equal(t.direction, 'up');
    assert.equal(t.delta, 20);
    assert.equal(t.glyph, '▲');
  });

  it('returns down + ▼ glyph when current regresses', () => {
    const t = trendVsPrevious(50, 70);
    assert.equal(t.direction, 'down');
    assert.equal(t.delta, -20);
    assert.equal(t.glyph, '▼');
  });

  it('returns flat when scores equal', () => {
    const t = trendVsPrevious(75, 75);
    assert.equal(t.direction, 'flat');
    assert.equal(t.delta, 0);
  });
});

// ── 4. formatAge + formatDuration (4 tests) ──────────────────────────

describe('formatAge / formatDuration', () => {
  it('formatAge formats minutes / hours / days / months', () => {
    assert.equal(formatAge(T0, T0 + 30 * MIN), '30m');
    assert.equal(formatAge(T0, T0 + 5 * HOUR), '5h');
    assert.equal(formatAge(T0, T0 + 3 * DAY), '3d');
    assert.equal(formatAge(T0, T0 + 90 * DAY), '3mo');
  });

  it('formatAge returns "-" when createdAt is in the future', () => {
    assert.equal(formatAge(T0 + HOUR, T0), '-');
  });

  it('formatDuration shows hours+minutes for sub-day spans', () => {
    assert.equal(formatDuration(0), '0m');
    assert.equal(formatDuration(45 * MIN), '45m');
    assert.equal(formatDuration(3 * HOUR + 20 * MIN), '3h 20m');
    assert.equal(formatDuration(4 * HOUR), '4h');
  });

  it('formatDuration shows days+hours for multi-day spans', () => {
    assert.equal(formatDuration(2 * DAY + 5 * HOUR), '2d 5h');
    assert.equal(formatDuration(7 * DAY), '7d');
  });
});

// ── 5. summarizeActiveDebts (4 tests) ────────────────────────────────

describe('summarizeActiveDebts', () => {
  it('omits resolved debts but keeps in-progress', () => {
    const rows = summarizeActiveDebts(
      [
        debt({ id: 'a', status: 'resolved' }),
        debt({ id: 'b', status: 'in-progress' }),
        debt({ id: 'c', status: 'open' }),
      ],
      T0,
    );
    assert.deepEqual(rows.map((r) => r.id).sort(), ['b', 'c']);
  });

  it('sorts critical first, oldest within tie', () => {
    const rows = summarizeActiveDebts(
      [
        debt({ id: 'older-high',    severity: 'high',     createdAt: T0 - 2 * HOUR }),
        debt({ id: 'newer-high',    severity: 'high',     createdAt: T0 - 1 * HOUR }),
        debt({ id: 'fresh-crit',    severity: 'critical', createdAt: T0 }),
      ],
      T0,
    );
    assert.deepEqual(rows.map((r) => r.id), ['fresh-crit', 'older-high', 'newer-high']);
  });

  it('falls back to "global" when debt has no domain', () => {
    const rows = summarizeActiveDebts([debt({ id: 'no-domain' })], T0);
    assert.equal(rows[0]?.domain, 'global');
  });

  it('shapes rows with all display fields the panel needs', () => {
    const rows = summarizeActiveDebts(
      [debt({ id: 'r1', severity: 'high', category: 'latency', domain: 'ais', estimatedImpact: 'impact' })],
      T0 + 30 * MIN,
    );
    const r = rows[0]!;
    assert.equal(r.id, 'r1');
    assert.equal(r.domain, 'ais');
    assert.equal(r.severity, 'high');
    assert.equal(r.category, 'latency');
    assert.equal(r.ageLabel, '30m');
    assert.equal(r.estimatedImpact, 'impact');
  });
});

// ── 6. computeResolutionRate (5 tests) ───────────────────────────────

describe('computeResolutionRate', () => {
  it('reports zero opened + zero closed for empty input', () => {
    const r = computeResolutionRate([], T0);
    assert.equal(r.openedThisWeek, 0);
    assert.equal(r.closedThisWeek, 0);
    assert.equal(r.ratio, 0);
    assert.deepEqual(r.avgResolveMsByCategory, {});
  });

  it('counts opens / closes inside the rolling week window', () => {
    const r = computeResolutionRate(
      [
        debt({ id: 'new',    createdAt: T0 - 2 * DAY }),
        debt({ id: 'stale',  createdAt: T0 - 30 * DAY }),
        debt({ id: 'closed-recent', createdAt: T0 - 30 * DAY, status: 'resolved', resolvedAt: T0 - 1 * DAY }),
        debt({ id: 'closed-old',    createdAt: T0 - 60 * DAY, status: 'resolved', resolvedAt: T0 - 20 * DAY }),
      ],
      T0,
    );
    assert.equal(r.openedThisWeek, 1); // 'new' (created 2d ago) only
    assert.equal(r.closedThisWeek, 1); // 'closed-recent' (resolved 1d ago)
  });

  it('computes avg time-to-resolve per category, omitting empty categories', () => {
    const r = computeResolutionRate(
      [
        debt({ id: 'd1', category: 'data',  status: 'resolved', createdAt: T0 - 5 * HOUR, resolvedAt: T0 - 1 * HOUR }),
        debt({ id: 'd2', category: 'data',  status: 'resolved', createdAt: T0 - 7 * HOUR, resolvedAt: T0 - 1 * HOUR }),
        debt({ id: 'm1', category: 'model', status: 'resolved', createdAt: T0 - 10 * HOUR, resolvedAt: T0 - 2 * HOUR }),
      ],
      T0,
    );
    assert.equal(r.avgResolveMsByCategory.data, Math.round((4 * HOUR + 6 * HOUR) / 2));
    assert.equal(r.avgResolveMsByCategory.model, 8 * HOUR);
    assert.equal(r.avgResolveMsByCategory.latency, undefined);
  });

  it('uses 99.9× sentinel when closures > 0 but opens this week == 0', () => {
    const r = computeResolutionRate(
      [debt({ id: 'closed', createdAt: T0 - 30 * DAY, status: 'resolved', resolvedAt: T0 - 1 * DAY })],
      T0,
    );
    assert.equal(r.openedThisWeek, 0);
    assert.equal(r.closedThisWeek, 1);
    assert.equal(r.ratio, 99.9);
  });

  it('returns ratio 0 when neither opened nor closed this week', () => {
    const r = computeResolutionRate(
      [debt({ id: 'ancient', createdAt: T0 - 90 * DAY, status: 'open' })],
      T0,
    );
    assert.equal(r.ratio, 0);
  });
});

// ── 7. computeDomainHealth (5 tests) ─────────────────────────────────

describe('computeDomainHealth', () => {
  it('groups by domain and falls back to "global" for missing domain', () => {
    const rows = computeDomainHealth([
      debt({ id: 'a', domain: 'ais' }),
      debt({ id: 'b' /* no domain */ }),
      debt({ id: 'c', domain: 'ais' }),
    ]);
    const aisRow = rows.find((r) => r.domain === 'ais')!;
    const globalRow = rows.find((r) => r.domain === 'global')!;
    assert.equal(aisRow.openCount, 2);
    assert.equal(globalRow.openCount, 1);
  });

  it('grades a clean domain (no open debts) as A', () => {
    const rows = computeDomainHealth([
      debt({ id: 'a', domain: 'ais', status: 'resolved', resolvedAt: T0 }),
    ]);
    assert.equal(rows[0]?.grade, 'A');
    assert.equal(rows[0]?.weightedDensity, 0);
  });

  it('grades a single critical open debt as F', () => {
    const rows = computeDomainHealth([
      debt({ id: 'a', domain: 'cyber', severity: 'critical', status: 'open' }),
    ]);
    assert.equal(rows[0]?.grade, 'F');
  });

  it('tracks lastVerifiedAt as the latest resolvedAt across the domain', () => {
    const rows = computeDomainHealth([
      debt({ id: 'a', domain: 'ais', status: 'resolved', resolvedAt: T0 - 5 * DAY }),
      debt({ id: 'b', domain: 'ais', status: 'resolved', resolvedAt: T0 - 1 * DAY }),
      debt({ id: 'c', domain: 'ais', status: 'open' }),
    ]);
    const row = rows.find((r) => r.domain === 'ais')!;
    assert.equal(row.lastVerifiedAt, T0 - 1 * DAY);
  });

  it('sorts rows by weighted density descending (worst domain first)', () => {
    const rows = computeDomainHealth([
      debt({ id: 'a', domain: 'good',   severity: 'low',      status: 'open' }),
      debt({ id: 'b', domain: 'bad',    severity: 'critical', status: 'open' }),
      debt({ id: 'c', domain: 'middle', severity: 'high',     status: 'open' }),
    ]);
    assert.deepEqual(rows.map((r) => r.domain), ['bad', 'middle', 'good']);
  });
});

// ── 8. Constant + look-up tables (3 tests) ───────────────────────────

describe('constants', () => {
  it('SEVERITY_PENALTY orders critical > high > medium > low', () => {
    assert.ok(SEVERITY_PENALTY.critical > SEVERITY_PENALTY.high);
    assert.ok(SEVERITY_PENALTY.high     > SEVERITY_PENALTY.medium);
    assert.ok(SEVERITY_PENALTY.medium   > SEVERITY_PENALTY.low);
  });

  it('display tables cover every severity / category / grade', () => {
    for (const sev of ['critical', 'high', 'medium', 'low'] as const) {
      assert.ok(SEVERITY_COLOR[sev], `SEVERITY_COLOR missing ${sev}`);
    }
    for (const cat of ['data', 'model', 'coverage', 'latency', 'accuracy'] as const) {
      assert.ok(CATEGORY_LABEL[cat], `CATEGORY_LABEL missing ${cat}`);
    }
    for (const grade of ['A', 'B', 'C', 'D', 'F'] as const) {
      assert.ok(GRADE_COLOR[grade], `GRADE_COLOR missing ${grade}`);
    }
    for (const k of ['green', 'yellow', 'red'] as const) {
      assert.ok(SCORE_COLOR[k], `SCORE_COLOR missing ${k}`);
    }
  });

  it('WEEK_MS is exactly 7 days', () => {
    assert.equal(WEEK_MS, 7 * DAY);
  });
});
