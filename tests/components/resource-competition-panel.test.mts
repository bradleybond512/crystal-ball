/**
 * Unit tests for resource-competition-helpers.
 *
 * Covers:
 *   - band classifiers (China-share → risk band)
 *   - color / label tables (concentration, alignment, arctic, ISA phase,
 *     nationalism kind/status, battery vulnerability)
 *   - sort comparators (dollar value, value-at-risk, dependency score)
 *   - aggregator counts (critical concentration, active nationalizations,
 *     contested Arctic claims, active ISA contracts, vulnerable battery
 *     minerals, China-aligned acquisitions)
 *   - render helpers (HTML escaping, empty-state branches, badge counts,
 *     section ordering)
 *   - static reference data invariants (non-empty, well-formed bands)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ARCTIC_DISPUTES,
  BATTERY_MINERAL_RISK,
  DEEP_SEA_MINING,
  NATIONALISM_EVENTS,
  RARE_EARTH_DEPENDENCY,
  STRATEGIC_MINERAL_EVENTS,
  alignmentColor,
  alignmentLabel,
  arcticStatusColor,
  arcticStatusLabel,
  batteryVulnerabilityColor,
  batteryVulnerabilityLabel,
  chinaShareRiskBand,
  concentrationRiskColor,
  concentrationRiskLabel,
  countActiveISAContracts,
  countActiveNationalizations,
  countChinaAlignedAcquisitions,
  countContestedArcticClaims,
  countCriticalConcentration,
  countVulnerableBatteryMinerals,
  isaPhaseColor,
  isaPhaseLabel,
  nationalismKindLabel,
  nationalismStatusColor,
  nationalismStatusLabel,
  renderArcticDisputesSection,
  renderBatteryMineralsSection,
  renderDeepSeaMiningSection,
  renderNationalismSection,
  renderRareEarthSection,
  renderStrategicMineralsSection,
  sortByDependencyScoreDesc,
  sortByDollarValueDesc,
  sortByValueAtRiskDesc,
} from '../../src/components/resource-competition-helpers';
import type {
  ArcticDispute,
  BatteryMineralRisk,
  DeepSeaMiningContract,
  NationalismEvent,
  RareEarthDependency,
  StrategicMineralEvent,
} from '../../src/components/resource-competition-helpers';

// ── Band classifier ───────────────────────────────────────────────────────

describe('chinaShareRiskBand', () => {
  it('returns critical at 80% and above', () => {
    assert.equal(chinaShareRiskBand(80), 'critical');
    assert.equal(chinaShareRiskBand(95), 'critical');
    assert.equal(chinaShareRiskBand(100), 'critical');
  });

  it('returns high in [60, 80)', () => {
    assert.equal(chinaShareRiskBand(60), 'high');
    assert.equal(chinaShareRiskBand(79.9), 'high');
  });

  it('returns medium in [40, 60)', () => {
    assert.equal(chinaShareRiskBand(40), 'medium');
    assert.equal(chinaShareRiskBand(59.9), 'medium');
  });

  it('returns low below 40%', () => {
    assert.equal(chinaShareRiskBand(0), 'low');
    assert.equal(chinaShareRiskBand(39.9), 'low');
  });
});

// ── Color / label tables ──────────────────────────────────────────────────

describe('concentrationRisk color/label', () => {
  it('maps all four bands to distinct colors', () => {
    const colors = new Set([
      concentrationRiskColor('low'),
      concentrationRiskColor('medium'),
      concentrationRiskColor('high'),
      concentrationRiskColor('critical'),
    ]);
    assert.equal(colors.size, 4);
  });

  it('produces human-readable labels for each band', () => {
    assert.equal(concentrationRiskLabel('low'), 'Low');
    assert.equal(concentrationRiskLabel('critical'), 'Critical');
  });
});

describe('alignmentColor / alignmentLabel', () => {
  it('returns china-aligned red and western-aligned blue', () => {
    assert.notEqual(alignmentColor('china_aligned'), alignmentColor('western_aligned'));
  });

  it('labels every bloc', () => {
    assert.equal(alignmentLabel('china_aligned'), 'China-aligned');
    assert.equal(alignmentLabel('western_aligned'), 'Western-aligned');
    assert.equal(alignmentLabel('russia_aligned'), 'Russia-aligned');
    assert.equal(alignmentLabel('non_aligned'), 'Non-aligned');
    assert.equal(alignmentLabel('contested'), 'Contested');
  });
});

describe('arcticStatus color/label', () => {
  it('elevates militarized status to a unique color', () => {
    const militarized = arcticStatusColor('militarized');
    assert.notEqual(militarized, arcticStatusColor('negotiation'));
    assert.notEqual(militarized, arcticStatusColor('unclos_review'));
  });

  it('labels every status', () => {
    assert.equal(arcticStatusLabel('negotiation'), 'In negotiation');
    assert.equal(arcticStatusLabel('icj_pending'), 'ICJ pending');
    assert.equal(arcticStatusLabel('militarized'), 'Militarized');
  });
});

describe('isaPhase color/label', () => {
  it('returns four distinct phase labels', () => {
    const labels = new Set([
      isaPhaseLabel('exploration'),
      isaPhaseLabel('exploitation'),
      isaPhaseLabel('moratorium'),
      isaPhaseLabel('suspended'),
    ]);
    assert.equal(labels.size, 4);
  });

  it('returns colors for every phase', () => {
    assert.ok(isaPhaseColor('exploration').length > 0);
    assert.ok(isaPhaseColor('suspended').length > 0);
  });
});

describe('nationalism kind/status', () => {
  it('labels every kind', () => {
    assert.equal(nationalismKindLabel('nationalization'), 'Nationalization');
    assert.equal(nationalismKindLabel('expropriation'), 'Expropriation');
    assert.equal(nationalismKindLabel('forced_equity'), 'Forced equity');
    assert.equal(nationalismKindLabel('export_ban'), 'Export ban');
    assert.equal(nationalismKindLabel('royalty_hike'), 'Royalty hike');
  });

  it('labels every status', () => {
    assert.equal(nationalismStatusLabel('pending'), 'Pending');
    assert.equal(nationalismStatusLabel('in_arbitration'), 'In arbitration');
    assert.equal(nationalismStatusLabel('enforced'), 'Enforced');
    assert.equal(nationalismStatusLabel('settled'), 'Settled');
    assert.equal(nationalismStatusLabel('reversed'), 'Reversed');
  });

  it('colors enforced differently from reversed', () => {
    assert.notEqual(nationalismStatusColor('enforced'), nationalismStatusColor('reversed'));
  });
});

describe('batteryVulnerability color/label', () => {
  it('escalates color from low to extreme', () => {
    const set = new Set([
      batteryVulnerabilityColor('low'),
      batteryVulnerabilityColor('medium'),
      batteryVulnerabilityColor('high'),
      batteryVulnerabilityColor('extreme'),
    ]);
    assert.equal(set.size, 4);
  });

  it('labels every band', () => {
    assert.equal(batteryVulnerabilityLabel('low'), 'Low');
    assert.equal(batteryVulnerabilityLabel('extreme'), 'Extreme');
  });
});

// ── Sort comparators ──────────────────────────────────────────────────────

describe('sortByDollarValueDesc', () => {
  it('orders bigger deals first', () => {
    const rows: StrategicMineralEvent[] = [
      { acquirer: 'A', targetCountry: 'X', mineral: 'Li', dollarValueMillions: 100, alignment: 'china_aligned', notes: '' },
      { acquirer: 'B', targetCountry: 'Y', mineral: 'Li', dollarValueMillions: 1000, alignment: 'western_aligned', notes: '' },
      { acquirer: 'C', targetCountry: 'Z', mineral: 'Li', dollarValueMillions: 500, alignment: 'china_aligned', notes: '' },
    ];
    const sorted = [...rows].sort(sortByDollarValueDesc);
    assert.deepEqual(sorted.map((r) => r.acquirer), ['B', 'C', 'A']);
  });
});

describe('sortByValueAtRiskDesc', () => {
  it('orders bigger arbitrations first', () => {
    const rows: NationalismEvent[] = [
      { country: 'A', mineral: 'Li', operator: 'X', kind: 'export_ban', valueAtRiskMillions: 200, status: 'enforced' },
      { country: 'B', mineral: 'Cu', operator: 'Y', kind: 'expropriation', valueAtRiskMillions: 10000, status: 'in_arbitration' },
      { country: 'C', mineral: 'Co', operator: 'Z', kind: 'royalty_hike', valueAtRiskMillions: 500, status: 'pending' },
    ];
    const sorted = [...rows].sort(sortByValueAtRiskDesc);
    assert.deepEqual(sorted.map((r) => r.country), ['B', 'C', 'A']);
  });
});

describe('sortByDependencyScoreDesc', () => {
  it('orders by descending geopoliticalDependencyScore', () => {
    const rows: BatteryMineralRisk[] = [
      { mineral: 'A', topProducerConcentrationHHI: 1000, processingConcentration: '', geopoliticalDependencyScore: 30, vulnerability: 'medium', notes: '' },
      { mineral: 'B', topProducerConcentrationHHI: 2000, processingConcentration: '', geopoliticalDependencyScore: 90, vulnerability: 'extreme', notes: '' },
      { mineral: 'C', topProducerConcentrationHHI: 3000, processingConcentration: '', geopoliticalDependencyScore: 55, vulnerability: 'high', notes: '' },
    ];
    const sorted = [...rows].sort(sortByDependencyScoreDesc);
    assert.deepEqual(sorted.map((r) => r.mineral), ['B', 'C', 'A']);
  });
});

// ── Aggregator counts ─────────────────────────────────────────────────────

describe('countCriticalConcentration', () => {
  it('counts critical + high (not medium / low)', () => {
    const rows: RareEarthDependency[] = [
      { element: 'A', chinaSharePct: 90, topAlternatives: '', refiningChoke: '', strategicApplication: '', concentrationRisk: 'critical' },
      { element: 'B', chinaSharePct: 70, topAlternatives: '', refiningChoke: '', strategicApplication: '', concentrationRisk: 'high' },
      { element: 'C', chinaSharePct: 50, topAlternatives: '', refiningChoke: '', strategicApplication: '', concentrationRisk: 'medium' },
      { element: 'D', chinaSharePct: 10, topAlternatives: '', refiningChoke: '', strategicApplication: '', concentrationRisk: 'low' },
    ];
    assert.equal(countCriticalConcentration(rows), 2);
  });
});

describe('countActiveNationalizations', () => {
  it('counts pending + in_arbitration + enforced, ignoring settled/reversed', () => {
    const rows: NationalismEvent[] = [
      { country: 'A', mineral: '', operator: '', kind: 'export_ban', valueAtRiskMillions: 0, status: 'pending' },
      { country: 'B', mineral: '', operator: '', kind: 'export_ban', valueAtRiskMillions: 0, status: 'in_arbitration' },
      { country: 'C', mineral: '', operator: '', kind: 'export_ban', valueAtRiskMillions: 0, status: 'enforced' },
      { country: 'D', mineral: '', operator: '', kind: 'export_ban', valueAtRiskMillions: 0, status: 'settled' },
      { country: 'E', mineral: '', operator: '', kind: 'export_ban', valueAtRiskMillions: 0, status: 'reversed' },
    ];
    assert.equal(countActiveNationalizations(rows), 3);
  });
});

describe('countContestedArcticClaims', () => {
  it('counts militarized + icj_pending + frozen', () => {
    const rows: ArcticDispute[] = [
      { area: 'A', claimants: '', hydrocarbonReserveLevel: 'low', diplomaticStatus: 'militarized', militaryPosture: '' },
      { area: 'B', claimants: '', hydrocarbonReserveLevel: 'low', diplomaticStatus: 'icj_pending', militaryPosture: '' },
      { area: 'C', claimants: '', hydrocarbonReserveLevel: 'low', diplomaticStatus: 'frozen', militaryPosture: '' },
      { area: 'D', claimants: '', hydrocarbonReserveLevel: 'low', diplomaticStatus: 'negotiation', militaryPosture: '' },
      { area: 'E', claimants: '', hydrocarbonReserveLevel: 'low', diplomaticStatus: 'unclos_review', militaryPosture: '' },
    ];
    assert.equal(countContestedArcticClaims(rows), 3);
  });
});

describe('countActiveISAContracts', () => {
  it('counts exploration + exploitation only', () => {
    const rows: DeepSeaMiningContract[] = [
      { contractor: 'A', sponsoringState: '', zone: '', phase: 'exploration', moratoriumNote: '' },
      { contractor: 'B', sponsoringState: '', zone: '', phase: 'exploitation', moratoriumNote: '' },
      { contractor: 'C', sponsoringState: '', zone: '', phase: 'moratorium', moratoriumNote: '' },
      { contractor: 'D', sponsoringState: '', zone: '', phase: 'suspended', moratoriumNote: '' },
    ];
    assert.equal(countActiveISAContracts(rows), 2);
  });
});

describe('countVulnerableBatteryMinerals', () => {
  it('counts extreme + high', () => {
    const rows: BatteryMineralRisk[] = [
      { mineral: 'A', topProducerConcentrationHHI: 0, processingConcentration: '', geopoliticalDependencyScore: 90, vulnerability: 'extreme', notes: '' },
      { mineral: 'B', topProducerConcentrationHHI: 0, processingConcentration: '', geopoliticalDependencyScore: 70, vulnerability: 'high', notes: '' },
      { mineral: 'C', topProducerConcentrationHHI: 0, processingConcentration: '', geopoliticalDependencyScore: 50, vulnerability: 'medium', notes: '' },
      { mineral: 'D', topProducerConcentrationHHI: 0, processingConcentration: '', geopoliticalDependencyScore: 10, vulnerability: 'low', notes: '' },
    ];
    assert.equal(countVulnerableBatteryMinerals(rows), 2);
  });
});

describe('countChinaAlignedAcquisitions', () => {
  it('counts only china_aligned rows', () => {
    const rows: StrategicMineralEvent[] = [
      { acquirer: 'A', targetCountry: '', mineral: '', dollarValueMillions: 0, alignment: 'china_aligned', notes: '' },
      { acquirer: 'B', targetCountry: '', mineral: '', dollarValueMillions: 0, alignment: 'china_aligned', notes: '' },
      { acquirer: 'C', targetCountry: '', mineral: '', dollarValueMillions: 0, alignment: 'western_aligned', notes: '' },
      { acquirer: 'D', targetCountry: '', mineral: '', dollarValueMillions: 0, alignment: 'non_aligned', notes: '' },
    ];
    assert.equal(countChinaAlignedAcquisitions(rows), 2);
  });
});

// ── Render helpers ────────────────────────────────────────────────────────

describe('renderRareEarthSection', () => {
  it('shows empty placeholder when no rows', () => {
    const html = renderRareEarthSection([]);
    assert.match(html, /No rare earth dependency data/);
    assert.match(html, /data-section="rare-earth"/);
  });

  it('escapes HTML in element and alternatives', () => {
    const html = renderRareEarthSection([
      { element: '<script>x</script>', chinaSharePct: 90, topAlternatives: '<img>', refiningChoke: '"q"', strategicApplication: '&amp;', concentrationRisk: 'critical' },
    ]);
    assert.doesNotMatch(html, /<script>x<\/script>/);
    assert.doesNotMatch(html, /<img>/);
    assert.match(html, /&lt;script&gt;/);
  });

  it('renders a badge with high/critical count', () => {
    const rows: RareEarthDependency[] = [
      { element: 'A', chinaSharePct: 90, topAlternatives: '', refiningChoke: '', strategicApplication: '', concentrationRisk: 'critical' },
      { element: 'B', chinaSharePct: 70, topAlternatives: '', refiningChoke: '', strategicApplication: '', concentrationRisk: 'high' },
    ];
    const html = renderRareEarthSection(rows);
    assert.match(html, /2 high\/critical/);
  });
});

describe('renderStrategicMineralsSection', () => {
  it('shows empty placeholder when no rows', () => {
    const html = renderStrategicMineralsSection([]);
    assert.match(html, /No strategic mineral acquisition/);
  });

  it('formats values < $1B in $M', () => {
    const html = renderStrategicMineralsSection([
      { acquirer: 'A', targetCountry: 'X', mineral: 'Li', dollarValueMillions: 200, alignment: 'china_aligned', notes: '' },
    ]);
    assert.match(html, /\$200M/);
  });

  it('formats values >= $1B in $B', () => {
    const html = renderStrategicMineralsSection([
      { acquirer: 'A', targetCountry: 'X', mineral: 'Li', dollarValueMillions: 3800, alignment: 'china_aligned', notes: '' },
    ]);
    assert.match(html, /\$3\.8B/);
  });

  it('sorts deals biggest first', () => {
    const html = renderStrategicMineralsSection([
      { acquirer: 'SmallCo', targetCountry: 'X', mineral: 'Li', dollarValueMillions: 100, alignment: 'china_aligned', notes: '' },
      { acquirer: 'BigCo', targetCountry: 'Y', mineral: 'Li', dollarValueMillions: 5000, alignment: 'china_aligned', notes: '' },
    ]);
    assert.ok(html.indexOf('BigCo') < html.indexOf('SmallCo'));
  });
});

describe('renderArcticDisputesSection', () => {
  it('shows empty placeholder when no rows', () => {
    const html = renderArcticDisputesSection([]);
    assert.match(html, /No Arctic disputes/);
  });

  it('renders area name + claimants', () => {
    const html = renderArcticDisputesSection([
      { area: 'Lomonosov Ridge', claimants: 'Russia / Canada', hydrocarbonReserveLevel: 'critical', diplomaticStatus: 'militarized', militaryPosture: 'high' },
    ]);
    assert.match(html, /Lomonosov Ridge/);
    assert.match(html, /Russia \/ Canada/);
  });
});

describe('renderDeepSeaMiningSection', () => {
  it('shows empty placeholder when no rows', () => {
    const html = renderDeepSeaMiningSection([]);
    assert.match(html, /No active ISA contracts/);
  });

  it('renders contractor + zone', () => {
    const html = renderDeepSeaMiningSection([
      { contractor: 'TMC', sponsoringState: 'Nauru', zone: 'CCZ', phase: 'exploitation', moratoriumNote: '24+ states oppose' },
    ]);
    assert.match(html, /TMC/);
    assert.match(html, /CCZ/);
    assert.match(html, /24\+ states oppose/);
  });
});

describe('renderNationalismSection', () => {
  it('shows empty placeholder when no rows', () => {
    const html = renderNationalismSection([]);
    assert.match(html, /No active nationalization/);
  });

  it('formats sub-$1B value-at-risk in $M', () => {
    const html = renderNationalismSection([
      { country: 'X', mineral: 'Li', operator: 'OpCo', kind: 'nationalization', valueAtRiskMillions: 600, status: 'enforced' },
    ]);
    assert.match(html, /\$600M at risk/);
  });

  it('formats >=$1B value-at-risk in $B', () => {
    const html = renderNationalismSection([
      { country: 'Panama', mineral: 'Cu', operator: 'First Quantum', kind: 'expropriation', valueAtRiskMillions: 10000, status: 'in_arbitration' },
    ]);
    assert.match(html, /\$10\.0B at risk/);
  });
});

describe('renderBatteryMineralsSection', () => {
  it('shows empty placeholder when no rows', () => {
    const html = renderBatteryMineralsSection([]);
    assert.match(html, /No battery mineral risk data/);
  });

  it('orders extreme-vulnerability rows first by dependency score', () => {
    const html = renderBatteryMineralsSection([
      { mineral: 'Copper', topProducerConcentrationHHI: 1800, processingConcentration: '', geopoliticalDependencyScore: 55, vulnerability: 'medium', notes: '' },
      { mineral: 'Graphite', topProducerConcentrationHHI: 6300, processingConcentration: '', geopoliticalDependencyScore: 92, vulnerability: 'extreme', notes: '' },
    ]);
    assert.ok(html.indexOf('Graphite') < html.indexOf('Copper'));
  });
});

// ── Static reference data invariants ──────────────────────────────────────

describe('static reference data', () => {
  it('ships at least one row in every dataset', () => {
    assert.ok(RARE_EARTH_DEPENDENCY.length > 0);
    assert.ok(STRATEGIC_MINERAL_EVENTS.length > 0);
    assert.ok(ARCTIC_DISPUTES.length > 0);
    assert.ok(DEEP_SEA_MINING.length > 0);
    assert.ok(NATIONALISM_EVENTS.length > 0);
    assert.ok(BATTERY_MINERAL_RISK.length > 0);
  });

  it('rare-earth shares stay in [0,100] and risk band is consistent with share', () => {
    for (const row of RARE_EARTH_DEPENDENCY) {
      assert.ok(row.chinaSharePct >= 0 && row.chinaSharePct <= 100, `${row.element} pct out of range`);
      const expected = chinaShareRiskBand(row.chinaSharePct);
      // Allow editorial uplift above the raw band (e.g., 78% labelled high, never 'low' or 'medium')
      const rank: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
      assert.ok(
        rank[row.concentrationRisk] >= rank[expected],
        `${row.element}: risk ${row.concentrationRisk} below band ${expected} for ${row.chinaSharePct}%`,
      );
    }
  });

  it('strategic mineral events have non-negative values', () => {
    for (const row of STRATEGIC_MINERAL_EVENTS) {
      assert.ok(row.dollarValueMillions >= 0, `${row.acquirer}: value negative`);
    }
  });

  it('nationalism events have non-negative value-at-risk', () => {
    for (const row of NATIONALISM_EVENTS) {
      assert.ok(row.valueAtRiskMillions >= 0, `${row.country}: value-at-risk negative`);
    }
  });

  it('battery dependency score is bounded [0,100]', () => {
    for (const row of BATTERY_MINERAL_RISK) {
      assert.ok(row.geopoliticalDependencyScore >= 0 && row.geopoliticalDependencyScore <= 100, `${row.mineral} dep out of range`);
    }
  });

  it('battery HHI is non-negative', () => {
    for (const row of BATTERY_MINERAL_RISK) {
      assert.ok(row.topProducerConcentrationHHI >= 0, `${row.mineral} HHI negative`);
    }
  });

  it('every Arctic dispute names at least one claimant', () => {
    for (const row of ARCTIC_DISPUTES) {
      assert.ok(row.claimants.length > 0, `${row.area} missing claimants`);
    }
  });

  it('every ISA contract names a sponsoring state', () => {
    for (const row of DEEP_SEA_MINING) {
      assert.ok(row.sponsoringState.length > 0, `${row.contractor} missing sponsor`);
    }
  });
});
