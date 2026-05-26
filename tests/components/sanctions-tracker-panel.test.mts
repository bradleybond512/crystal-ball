/**
 * SanctionsTrackerPanel — pure-helper unit tests.
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
  countRegimesByBody,
  countComprehensiveRegimes,
  regimeScopeColor,
  regimeScopeLabel,
  ACTIVE_REGIMES,
  // Section 2
  isRecentlyDesignated,
  countRecentDesignations,
  designationColor,
  designationLabel,
  NEW_DESIGNATIONS,
  REFERENCE_NOW_MS,
  // Section 3
  highConfidenceEvasionCount,
  evasionPatternLabel,
  evasionConfidenceColor,
  evasionConfidenceLabel,
  EVASION_SIGNALS,
  // Section 4
  computeExposureScore,
  classifyExposure,
  exposureTierColor,
  exposureTierLabel,
  COUNTRY_EXPOSURE,
  // Section 5
  totalActiveCorridorVolumeUsdM,
  corridorStatusColor,
  corridorStatusLabel,
  TRADE_CORRIDORS,
  // Section 6
  totalFrozenAssetsUsdBn,
  frozenAssetsByJurisdiction,
  frozenAssetTypeLabel,
  FROZEN_ASSETS,
  // Aggregate
  totalAlertCount,
  type ActiveSanctionsRegime,
  type CountryExposure,
  type NewlyDesignated,
} from '../../src/components/sanctions-tracker-helpers.ts';

// ── Section 1 — Active Sanctions Regimes ──────────────────────────────────

describe('countRegimesByBody', () => {
  it('counts OFAC regimes in the seed snapshot', () => {
    // Russia, Iran, North Korea, Cuba, Syria, Venezuela, China, Hong Kong, Türkiye → 9
    assert.equal(countRegimesByBody(ACTIVE_REGIMES, 'OFAC'), 9);
  });

  it('counts EU regimes in the seed snapshot', () => {
    // Russia, Iran, Belarus → 3
    assert.equal(countRegimesByBody(ACTIVE_REGIMES, 'EU'), 3);
  });

  it('counts UN regimes in the seed snapshot', () => {
    // North Korea, Sudan → 2
    assert.equal(countRegimesByBody(ACTIVE_REGIMES, 'UN'), 2);
  });

  it('returns 0 for a body with no entries', () => {
    const onlyOfac: ActiveSanctionsRegime[] = ACTIVE_REGIMES.filter((r) => r.body === 'OFAC');
    assert.equal(countRegimesByBody(onlyOfac, 'EU'), 0);
  });
});

describe('countComprehensiveRegimes', () => {
  it('counts only comprehensive scope', () => {
    // Russia x2 + Iran + North Korea x2 + Cuba = 6 comprehensive in seed.
    assert.equal(countComprehensiveRegimes(ACTIVE_REGIMES), 6);
  });

  it('returns 0 for an empty list', () => {
    assert.equal(countComprehensiveRegimes([]), 0);
  });
});

describe('regime scope label/color tables', () => {
  it('every scope has a label and color', () => {
    for (const s of ['comprehensive', 'sectoral', 'targeted', 'secondary-risk'] as const) {
      assert.ok(regimeScopeLabel(s).length > 0);
      assert.match(regimeScopeColor(s), /^#[\da-f]{6}$/i);
    }
  });
});

// ── Section 2 — Newly Designated Entities ─────────────────────────────────

describe('isRecentlyDesignated', () => {
  it('returns true for a designation within the 30-day window', () => {
    const d = { designatedAt: REFERENCE_NOW_MS - 5 * 24 * 60 * 60 * 1000 };
    assert.equal(isRecentlyDesignated(d, REFERENCE_NOW_MS), true);
  });

  it('returns false for a designation older than 30 days', () => {
    const d = { designatedAt: REFERENCE_NOW_MS - 31 * 24 * 60 * 60 * 1000 };
    assert.equal(isRecentlyDesignated(d, REFERENCE_NOW_MS), false);
  });

  it('treats designations exactly at the boundary as recent (inclusive)', () => {
    const d = { designatedAt: REFERENCE_NOW_MS - 30 * 24 * 60 * 60 * 1000 };
    assert.equal(isRecentlyDesignated(d, REFERENCE_NOW_MS), true);
  });
});

describe('countRecentDesignations', () => {
  it('counts seed entries within 30 days of REFERENCE_NOW_MS', () => {
    // Seed dates (UTC, May 18 reference):
    //   May 10 ✓, May 14 ✓, May 2 ✓, Apr 27 ✓, Apr 28 ✓, Mar 8 ✗, Feb 12 ✗ → 5
    assert.equal(countRecentDesignations(NEW_DESIGNATIONS, REFERENCE_NOW_MS), 5);
  });

  it('returns 0 when reference time is far in the future', () => {
    const farFuture = REFERENCE_NOW_MS + 365 * 24 * 60 * 60 * 1000;
    assert.equal(countRecentDesignations(NEW_DESIGNATIONS, farFuture), 0);
  });

  it('returns 0 for an empty list', () => {
    assert.equal(countRecentDesignations([], REFERENCE_NOW_MS), 0);
  });
});

describe('designation label/color tables', () => {
  it('every designation type has a label and color', () => {
    for (const t of ['individual', 'entity', 'vessel', 'aircraft', 'crypto-address'] as const) {
      assert.ok(designationLabel(t).length > 0);
      assert.match(designationColor(t), /^#[\da-f]{6}$/i);
    }
  });
});

// ── Section 3 — Evasion Network Signals ───────────────────────────────────

describe('highConfidenceEvasionCount', () => {
  it('counts strong + confirmed only on the seed snapshot', () => {
    // Seed: 2 confirmed (dark-fleet Iran, crypto-laundering Lazarus) + 2 strong (shell, port-hopping) = 4
    assert.equal(highConfidenceEvasionCount(EVASION_SIGNALS), 4);
  });

  it('excludes moderate and weak', () => {
    const onlyWeak = EVASION_SIGNALS.filter((s) => s.confidence === 'weak' || s.confidence === 'moderate');
    assert.equal(highConfidenceEvasionCount(onlyWeak), 0);
  });

  it('returns 0 for an empty list', () => {
    assert.equal(highConfidenceEvasionCount([]), 0);
  });
});

describe('evasion label/color tables', () => {
  it('every pattern has a label', () => {
    for (const p of ['shell-company', 'dark-fleet', 'port-hopping', 'crypto-laundering', 'front-financier', 'trade-mis-invoicing'] as const) {
      assert.ok(evasionPatternLabel(p).length > 0);
    }
  });

  it('every confidence level has a label and color', () => {
    for (const c of ['weak', 'moderate', 'strong', 'confirmed'] as const) {
      assert.ok(evasionConfidenceLabel(c).length > 0);
      assert.match(evasionConfidenceColor(c), /^#[\da-f]{6}$/i);
    }
  });
});

// ── Section 4 — Secondary Sanctions Exposure ──────────────────────────────

describe('computeExposureScore', () => {
  function base(o: Partial<CountryExposure> = {}): Pick<CountryExposure, 'tradeShareWithTarget' | 'financialChannels'> {
    return {
      tradeShareWithTarget: o.tradeShareWithTarget ?? 0,
      financialChannels: o.financialChannels ?? 0,
    };
  }

  it('returns 0 when both signals are zero', () => {
    assert.equal(computeExposureScore(base()), 0);
  });

  it('scales trade share linearly up to 60', () => {
    assert.equal(computeExposureScore(base({ tradeShareWithTarget: 1, financialChannels: 0 })), 60);
  });

  it('caps the financial-channel contribution at 32', () => {
    // 100 channels would otherwise be 800; cap forces 32.
    assert.equal(computeExposureScore(base({ tradeShareWithTarget: 0, financialChannels: 100 })), 32);
  });

  it('awards the synergy bonus when both signals are non-trivial', () => {
    // tradeShare 0.1 → 6, channels 2 → 16, bonus +8 = 30.
    assert.equal(computeExposureScore(base({ tradeShareWithTarget: 0.1, financialChannels: 2 })), 30);
  });

  it('clamps the final score to 100', () => {
    assert.equal(computeExposureScore(base({ tradeShareWithTarget: 5, financialChannels: 20 })), 100);
  });

  it('rejects negative inputs (no negative score)', () => {
    assert.equal(computeExposureScore(base({ tradeShareWithTarget: -1, financialChannels: -5 })), 0);
  });
});

describe('classifyExposure', () => {
  it('classifies low when score < 25', () => {
    assert.equal(classifyExposure(0), 'low');
    assert.equal(classifyExposure(24), 'low');
  });

  it('classifies moderate when score 25..49', () => {
    assert.equal(classifyExposure(25), 'moderate');
    assert.equal(classifyExposure(49), 'moderate');
  });

  it('classifies high when score 50..74', () => {
    assert.equal(classifyExposure(50), 'high');
    assert.equal(classifyExposure(74), 'high');
  });

  it('classifies extreme when score ≥ 75', () => {
    assert.equal(classifyExposure(75), 'extreme');
    assert.equal(classifyExposure(100), 'extreme');
  });

  it('label/color tables cover every tier', () => {
    for (const t of ['low', 'moderate', 'high', 'extreme'] as const) {
      assert.ok(exposureTierLabel(t).length > 0);
      assert.match(exposureTierColor(t), /^#[\da-f]{6}$/i);
    }
  });
});

// ── Section 5 — Sanctions-Busting Trade Corridors ─────────────────────────

describe('totalActiveCorridorVolumeUsdM', () => {
  it('sums monthly volume across active corridors only', () => {
    // Seed active corridors:
    //   Russia→India 3200, Russia→China 4100, Iran→China 1900,
    //   DPRK→China 240, Venezuela→China 720 = 10,160M.
    // Disrupted (Russia→Türkiye 860, Belarus→China 310) and
    // hardened (Russia→EU 45) are excluded.
    assert.equal(totalActiveCorridorVolumeUsdM(TRADE_CORRIDORS), 10160);
  });

  it('returns 0 for an empty list', () => {
    assert.equal(totalActiveCorridorVolumeUsdM([]), 0);
  });

  it('ignores negative volume entries (defensive)', () => {
    const bad = [{ from: 'A', to: 'B', commodity: 'x', monthlyVolumeUsdM: -100, status: 'active' as const }];
    assert.equal(totalActiveCorridorVolumeUsdM(bad), 0);
  });
});

describe('corridor status label/color tables', () => {
  it('every status has a label and color', () => {
    for (const s of ['active', 'disrupted', 'hardened'] as const) {
      assert.ok(corridorStatusLabel(s).length > 0);
      assert.match(corridorStatusColor(s), /^#[\da-f]{6}$/i);
    }
  });
});

// ── Section 6 — Frozen Asset Tracking ─────────────────────────────────────

describe('totalFrozenAssetsUsdBn', () => {
  it('sums all asset values in the seed snapshot', () => {
    // 215 + 38 + 8.4 + 1.3 + 1.7 + 0.6 + 1.1 + 0.2 = 266.3
    assert.equal(totalFrozenAssetsUsdBn(FROZEN_ASSETS), 266.3);
  });

  it('returns 0 for an empty list', () => {
    assert.equal(totalFrozenAssetsUsdBn([]), 0);
  });

  it('ignores negative entries', () => {
    const bad = [{ jurisdiction: 'X', originCountry: 'Y', assetType: 'financial' as const, valueUsdBn: -10, program: 'p' }];
    assert.equal(totalFrozenAssetsUsdBn(bad), 0);
  });
});

describe('frozenAssetsByJurisdiction', () => {
  it('aggregates value by jurisdiction', () => {
    const map = frozenAssetsByJurisdiction(FROZEN_ASSETS);
    // EU 215, United States 38 + 1.7 = 39.7, Switzerland 8.4, etc.
    assert.equal(map.get('EU'), 215);
    assert.ok(Math.abs((map.get('United States') ?? 0) - 39.7) < 1e-9);
    assert.equal(map.get('Switzerland'), 8.4);
  });

  it('returns an empty map for an empty list', () => {
    const map = frozenAssetsByJurisdiction([]);
    assert.equal(map.size, 0);
  });
});

describe('frozen asset type labels', () => {
  it('every asset type has a label', () => {
    for (const t of ['financial', 'real-estate', 'luxury', 'vessel', 'aircraft'] as const) {
      assert.ok(frozenAssetTypeLabel(t).length > 0);
    }
  });
});

// ── Aggregate alert count ─────────────────────────────────────────────────

describe('totalAlertCount', () => {
  it('sums comprehensive regimes + recent designations + strong evasion signals', () => {
    // 6 + 5 + 4 = 15 on the seed snapshot.
    const n = totalAlertCount({
      regimes: ACTIVE_REGIMES,
      designations: NEW_DESIGNATIONS,
      evasions: EVASION_SIGNALS,
      nowMs: REFERENCE_NOW_MS,
    });
    assert.equal(n, 15);
  });

  it('returns 0 when every input list is empty', () => {
    const n = totalAlertCount({ regimes: [], designations: [], evasions: [], nowMs: REFERENCE_NOW_MS });
    assert.equal(n, 0);
  });
});

// ── Seed-data shape checks ────────────────────────────────────────────────

describe('seed snapshots', () => {
  it('ACTIVE_REGIMES entries have non-empty regime names and 3-letter iso3', () => {
    for (const r of ACTIVE_REGIMES) {
      assert.ok(r.regimeName.length > 0, r.country);
      assert.equal(r.iso3.length, 3, r.country);
      assert.ok(r.sinceYear >= 1900 && r.sinceYear <= 2100, r.country);
    }
  });

  it('NEW_DESIGNATIONS reference a recognised SanctionsBody', () => {
    const allowed = new Set(['OFAC', 'EU', 'UN', 'UK-OFSI', 'Canada-OSFI']);
    for (const d of NEW_DESIGNATIONS) {
      assert.ok(allowed.has(d.designator), d.name);
      assert.ok(d.name.length > 0);
    }
  });

  it('EVASION_SIGNALS have non-empty notes', () => {
    for (const s of EVASION_SIGNALS) {
      assert.ok(s.notes.length > 0, s.target);
      assert.ok(Number.isFinite(s.observedAt));
    }
  });

  it('COUNTRY_EXPOSURE values are bounded', () => {
    for (const e of COUNTRY_EXPOSURE) {
      assert.ok(e.tradeShareWithTarget >= 0 && e.tradeShareWithTarget <= 1, e.country);
      assert.ok(e.financialChannels >= 0, e.country);
    }
  });

  it('TRADE_CORRIDORS have a positive monthly volume', () => {
    for (const c of TRADE_CORRIDORS) {
      assert.ok(c.monthlyVolumeUsdM > 0, `${c.from}→${c.to}`);
    }
  });

  it('FROZEN_ASSETS values are non-negative', () => {
    for (const a of FROZEN_ASSETS) {
      assert.ok(a.valueUsdBn >= 0, a.jurisdiction);
    }
  });

  it('seed exposures classify into a known tier', () => {
    const tiers = new Set(['low', 'moderate', 'high', 'extreme']);
    for (const e of COUNTRY_EXPOSURE) {
      const score = computeExposureScore(e);
      const tier = classifyExposure(score);
      assert.ok(tiers.has(tier), `${e.country} → ${tier}`);
    }
  });
});

// ── Cross-section integration check ───────────────────────────────────────

describe('integration', () => {
  it('UAE is the top-exposed country in the seed snapshot', () => {
    const sorted = [...COUNTRY_EXPOSURE].sort((a, b) => computeExposureScore(b) - computeExposureScore(a));
    assert.equal(sorted[0]!.country, 'UAE');
  });

  it('the comprehensive regime count equals the number of seed Russia + Iran + DPRK + Cuba comprehensive rows', () => {
    const manual = ACTIVE_REGIMES.filter((r) => r.scope === 'comprehensive').length;
    assert.equal(countComprehensiveRegimes(ACTIVE_REGIMES), manual);
  });

  it('a new designation flips the recent counter when nowMs advances by 30 days', () => {
    const older: NewlyDesignated = {
      name: 'Older designation', type: 'entity', country: 'X',
      designator: 'OFAC', sectoralProgram: 'p',
      designatedAt: REFERENCE_NOW_MS - 40 * 24 * 60 * 60 * 1000,
    };
    assert.equal(isRecentlyDesignated(older, REFERENCE_NOW_MS), false);
    // Pull "now" 30 days earlier — the same designation becomes recent.
    assert.equal(isRecentlyDesignated(older, REFERENCE_NOW_MS - 30 * 24 * 60 * 60 * 1000), true);
  });
});
