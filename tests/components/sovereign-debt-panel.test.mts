/**
 * SovereignDebtPanel — pure-helper unit tests.
 *
 * No DOM, no fetch: each test feeds fixture inputs into the exported
 * helpers and asserts the classification / scoring output. Seed
 * snapshots are also shape-checked so the panel can't silently render
 * malformed rows.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  // Section 1
  classifyCreditTier,
  creditTierColor,
  creditTierLabel,
  SOVEREIGN_CREDIT,
  // Section 2
  countActivePrograms,
  distressTierColor,
  distressTierLabel,
  MULTILATERAL_FLAGS,
  // Section 3
  classifyYieldCurve,
  curveSpreadBps,
  countInvertedCurves,
  yieldCurveColor,
  yieldCurveLabel,
  YIELD_CURVES,
  // Section 4
  activeRestructurings,
  restructuringColor,
  restructuringLabel,
  classifyReservePressure,
  reservePressureColor,
  reservePressureLabel,
  RESTRUCTURING_EVENTS,
  RESERVE_DRAWDOWNS,
  // Section 5
  computeContagionScore,
  contagionColor,
  contagionLabel,
  CONTAGION_REGIONS,
  type SovereignCreditEntry,
  type YieldCurvePoint,
  type ContagionScoreInput,
} from '../../src/components/sovereign-debt-helpers.ts';

// ── Section 1 — classifyCreditTier ─────────────────────────────────────────

describe('classifyCreditTier', () => {
  function entry(o: Partial<SovereignCreditEntry> = {}): Pick<SovereignCreditEntry, 'cdsSpread5y' | 'debtToGdp'> {
    return { cdsSpread5y: o.cdsSpread5y ?? 50, debtToGdp: o.debtToGdp ?? 0.4 };
  }

  it('returns investment for low CDS and low debt', () => {
    assert.equal(classifyCreditTier(entry()), 'investment');
  });

  it('returns high-yield when CDS crosses 150bp', () => {
    assert.equal(classifyCreditTier(entry({ cdsSpread5y: 200, debtToGdp: 0.3 })), 'high-yield');
  });

  it('returns high-yield when debt/GDP crosses 0.9', () => {
    assert.equal(classifyCreditTier(entry({ cdsSpread5y: 80, debtToGdp: 0.95 })), 'high-yield');
  });

  it('returns distressed at CDS ≥ 500', () => {
    assert.equal(classifyCreditTier(entry({ cdsSpread5y: 600, debtToGdp: 0.5 })), 'distressed');
  });

  it('returns distressed at debt/GDP ≥ 1.2', () => {
    assert.equal(classifyCreditTier(entry({ cdsSpread5y: 80, debtToGdp: 1.25 })), 'distressed');
  });

  it('returns default-imminent at CDS ≥ 1500', () => {
    assert.equal(classifyCreditTier(entry({ cdsSpread5y: 1600, debtToGdp: 0.5 })), 'default-imminent');
  });

  it('returns default-imminent at debt/GDP ≥ 2.0', () => {
    assert.equal(classifyCreditTier(entry({ cdsSpread5y: 30, debtToGdp: 2.5 })), 'default-imminent');
  });

  it('worst-of-two-signals wins (default beats distressed)', () => {
    assert.equal(classifyCreditTier(entry({ cdsSpread5y: 1700, debtToGdp: 0.4 })), 'default-imminent');
  });
});

describe('credit tier label/color tables', () => {
  it('every tier has a label and color', () => {
    for (const t of ['investment', 'high-yield', 'distressed', 'default-imminent'] as const) {
      assert.ok(creditTierLabel(t).length > 0);
      assert.match(creditTierColor(t), /^#[\da-f]{6}$/i);
    }
  });
});

// ── Section 2 — multilateral flags ────────────────────────────────────────

describe('countActivePrograms', () => {
  it('counts program + crisis only', () => {
    assert.equal(countActivePrograms(MULTILATERAL_FLAGS), 5);
  });

  it('returns 0 for empty list', () => {
    assert.equal(countActivePrograms([]), 0);
  });

  it('ignores monitoring tier', () => {
    const monitoringOnly = MULTILATERAL_FLAGS.filter((f) => f.tier === 'monitoring');
    assert.equal(countActivePrograms(monitoringOnly), 0);
  });
});

describe('distress tier label/color tables', () => {
  it('label + color exist for every distress tier', () => {
    for (const t of ['normal', 'monitoring', 'program', 'crisis'] as const) {
      assert.ok(distressTierLabel(t).length > 0);
      assert.match(distressTierColor(t), /^#[\da-f]{6}$/i);
    }
  });
});

// ── Section 3 — yield curve ────────────────────────────────────────────────

describe('curveSpreadBps', () => {
  it('returns 10y minus 2y in basis points', () => {
    assert.equal(curveSpreadBps({ yield2y: 4.0, yield10y: 4.5 }), 50);
  });

  it('returns negative for inverted curves', () => {
    assert.equal(curveSpreadBps({ yield2y: 4.5, yield10y: 4.0 }), -50);
  });

  it('rounds to integer bps', () => {
    assert.equal(curveSpreadBps({ yield2y: 4.123, yield10y: 4.456 }), 33);
  });
});

describe('classifyYieldCurve', () => {
  it('classifies normal when spread > 25bp', () => {
    assert.equal(classifyYieldCurve({ yield2y: 3.5, yield10y: 4.0 }), 'normal');
  });

  it('classifies flat when 0..25bp', () => {
    assert.equal(classifyYieldCurve({ yield2y: 4.0, yield10y: 4.1 }), 'flat');
  });

  it('classifies inverted when negative but > -100bp', () => {
    assert.equal(classifyYieldCurve({ yield2y: 4.3, yield10y: 4.0 }), 'inverted');
  });

  it('classifies deeply-inverted at ≤ -100bp', () => {
    assert.equal(classifyYieldCurve({ yield2y: 5.0, yield10y: 4.0 }), 'deeply-inverted');
  });
});

describe('countInvertedCurves', () => {
  it('counts inverted + deeply-inverted on the seed snapshot', () => {
    // USA (-5bp), DEU (-25bp), GBR (-35bp) inverted; ARG (-1250bp) deeply-inverted.
    assert.equal(countInvertedCurves(YIELD_CURVES), 4);
  });

  it('returns 0 for an empty list', () => {
    assert.equal(countInvertedCurves([]), 0);
  });

  it('label/color tables cover every state', () => {
    for (const s of ['normal', 'flat', 'inverted', 'deeply-inverted'] as const) {
      assert.ok(yieldCurveLabel(s).length > 0);
      assert.match(yieldCurveColor(s), /^#[\da-f]{6}$/i);
    }
  });
});

// ── Section 4 — restructurings + reserves ─────────────────────────────────

describe('activeRestructurings', () => {
  it('counts announced + in-negotiation + standstill + defaulted', () => {
    // Seed has 2 in-negotiation + 1 defaulted = 3 active.
    assert.equal(activeRestructurings(RESTRUCTURING_EVENTS), 3);
  });

  it('excludes completed restructurings', () => {
    const completedOnly = RESTRUCTURING_EVENTS.filter((e) => e.status === 'completed');
    assert.equal(activeRestructurings(completedOnly), 0);
  });
});

describe('classifyReservePressure', () => {
  it('depleted when cover < 1 month', () => {
    assert.equal(classifyReservePressure(0.5), 'depleted');
  });

  it('critical when cover 1..2 months', () => {
    assert.equal(classifyReservePressure(1.5), 'critical');
  });

  it('declining when cover 2..3 months', () => {
    assert.equal(classifyReservePressure(2.5), 'declining');
  });

  it('stable when cover ≥ 3 months', () => {
    assert.equal(classifyReservePressure(4.0), 'stable');
  });

  it('seed snapshot pressures match derived classification', () => {
    for (const r of RESERVE_DRAWDOWNS) {
      assert.equal(classifyReservePressure(r.importCoverMonths), r.pressure,
        `${r.country}: cover=${r.importCoverMonths} → expected ${classifyReservePressure(r.importCoverMonths)}, got ${r.pressure}`);
    }
  });

  it('color/label tables cover every pressure', () => {
    for (const p of ['stable', 'declining', 'critical', 'depleted'] as const) {
      assert.match(reservePressureColor(p), /^#[\da-f]{6}$/i);
      assert.ok(reservePressureLabel(p).length > 0);
    }
  });
});

describe('restructuring label/color tables', () => {
  it('covers every status', () => {
    for (const s of ['announced', 'in-negotiation', 'standstill', 'completed', 'defaulted'] as const) {
      assert.match(restructuringColor(s), /^#[\da-f]{6}$/i);
      assert.ok(restructuringLabel(s).length > 0);
    }
  });
});

// ── Section 5 — contagion scoring ──────────────────────────────────────────

describe('computeContagionScore', () => {
  function base(o: Partial<ContagionScoreInput> = {}): ContagionScoreInput {
    return {
      region: o.region ?? 'TestRegion',
      countries: o.countries ?? 4,
      distressedCount: o.distressedCount ?? 0,
      inProgramCount: o.inProgramCount ?? 0,
      invertedCurves: o.invertedCurves ?? 0,
      activeRestructurings: o.activeRestructurings ?? 0,
      averageCdsSpread5y: o.averageCdsSpread5y ?? 100,
    };
  }

  it('returns 0/Calm with no active drivers', () => {
    const r = computeContagionScore(base());
    assert.equal(r.risk, 0);
    assert.deepEqual(r.drivers, []);
  });

  it('adds 2 for ≥50% distressed share', () => {
    const r = computeContagionScore(base({ distressedCount: 2 })); // 2/4 = 50%
    assert.ok(r.risk >= 2);
    assert.ok(r.drivers.some((d) => d.includes('distressed')));
  });

  it('adds 1 for ≥25% distressed share', () => {
    const r = computeContagionScore(base({ countries: 4, distressedCount: 1 })); // 25%
    assert.equal(r.risk, 1);
  });

  it('adds 2 for ≥40% in-programme share', () => {
    const r = computeContagionScore(base({ countries: 5, inProgramCount: 2 })); // 40%
    assert.ok(r.risk >= 2);
    assert.ok(r.drivers.some((d) => d.includes('programme')));
  });

  it('adds 1 for ≥50% inverted curves', () => {
    const r = computeContagionScore(base({ countries: 4, invertedCurves: 2 })); // 50%
    assert.equal(r.risk, 1);
    assert.ok(r.drivers.some((d) => d.toLowerCase().includes('inverted')));
  });

  it('adds 1 for ≥3 active restructurings', () => {
    const r = computeContagionScore(base({ activeRestructurings: 3 }));
    assert.equal(r.risk, 1);
    assert.ok(r.drivers.some((d) => d.includes('restructurings')));
  });

  it('adds 2 for avg CDS ≥ 800bp', () => {
    const r = computeContagionScore(base({ averageCdsSpread5y: 900 }));
    assert.ok(r.risk >= 2);
    assert.ok(r.drivers.some((d) => d.includes('CDS')));
  });

  it('clamps to 4 (Crisis) when all drivers stack', () => {
    const r = computeContagionScore({
      region: 'CrisisRegion', countries: 4,
      distressedCount: 4, inProgramCount: 4, invertedCurves: 4,
      activeRestructurings: 4, averageCdsSpread5y: 1500,
    });
    assert.equal(r.risk, 4);
  });

  it('guards against zero countries (no divide-by-zero)', () => {
    const r = computeContagionScore({
      region: 'Empty', countries: 0,
      distressedCount: 0, inProgramCount: 0, invertedCurves: 0,
      activeRestructurings: 0, averageCdsSpread5y: 100,
    });
    assert.equal(r.risk, 0);
  });

  it('seed regions all produce valid risk 0..4', () => {
    for (const r of CONTAGION_REGIONS) {
      const out = computeContagionScore(r);
      assert.ok(out.risk >= 0 && out.risk <= 4, `${r.region} → ${out.risk}`);
    }
  });
});

describe('contagion label/color tables', () => {
  it('covers every risk level 0..4', () => {
    for (const lvl of [0, 1, 2, 3, 4] as const) {
      assert.match(contagionColor(lvl), /^#[\da-f]{6}$/i);
      assert.ok(contagionLabel(lvl).length > 0);
    }
  });
});

// ── Seed-data shape checks ────────────────────────────────────────────────

describe('seed snapshots', () => {
  it('SOVEREIGN_CREDIT entries have positive CDS and debt-to-GDP', () => {
    for (const c of SOVEREIGN_CREDIT) {
      assert.ok(c.cdsSpread5y > 0, c.country);
      assert.ok(c.debtToGdp > 0, c.country);
      assert.equal(c.iso3.length, 3);
    }
  });

  it('MULTILATERAL_FLAGS entries name a recognised source', () => {
    for (const f of MULTILATERAL_FLAGS) {
      assert.ok(['IMF', 'WorldBank', 'ParisClub'].includes(f.source), f.country);
    }
  });

  it('YIELD_CURVES entries have finite 2y and 10y yields', () => {
    for (const y of YIELD_CURVES) {
      assert.ok(Number.isFinite(y.yield2y));
      assert.ok(Number.isFinite(y.yield10y));
    }
  });

  it('CONTAGION_REGIONS distressedCount ≤ countries (sanity)', () => {
    for (const r of CONTAGION_REGIONS) {
      assert.ok(r.distressedCount <= r.countries, r.region);
      assert.ok(r.inProgramCount <= r.countries, r.region);
    }
  });
});
