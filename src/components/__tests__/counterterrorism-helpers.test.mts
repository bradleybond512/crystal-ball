/**
 * Unit tests for counterterrorism-helpers.ts
 * Run: npx tsx --test src/components/__tests__/counterterrorism-helpers.test.mts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyThreatTier,
  tierLabel,
  tierOrdinal,
  aggregateTier,
  analyzeAttackVectors,
  dominantVector,
  vectorLethalityScore,
  scoreGroupActivity,
  analyzeGroupActivity,
  computeIncidentFrequency,
  assessCasualtySeverity,
  topCasualtyEvent,
  computeCtEffectiveness,
  computeRegionScore,
  aggregateRegionRisks,
  buildRenderData,
  buildRegionRowHtml,
  buildGroupCardHtml,
  mostFrequent,
  escapeHtmlSimple,
  getMockIncidents,
  MOCK_SEED_NOW,
  TIER_COLORS,
  VECTOR_LABELS,
  type IncidentRecord,
  type ThreatTier,
} from '../counterterrorism-helpers.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = MOCK_SEED_NOW;
const d = (daysAgo: number): number => NOW - daysAgo * 24 * 60 * 60 * 1000;

const BASE_INCIDENT: IncidentRecord = {
  id: 'test-1',
  date: d(1),
  region: 'Middle East',
  country: 'Iraq',
  group: 'ISIS',
  vector: 'ied',
  killed: 5,
  wounded: 10,
  ctSuccess: false,
};

// ── classifyThreatTier ────────────────────────────────────────────────────────

describe('classifyThreatTier', () => {
  it('returns critical for score >= 80', () => {
    assert.equal(classifyThreatTier(80), 'critical');
    assert.equal(classifyThreatTier(100), 'critical');
    assert.equal(classifyThreatTier(95), 'critical');
  });

  it('returns high for score 60-79', () => {
    assert.equal(classifyThreatTier(60), 'high');
    assert.equal(classifyThreatTier(79), 'high');
    assert.equal(classifyThreatTier(70), 'high');
  });

  it('returns elevated for score 40-59', () => {
    assert.equal(classifyThreatTier(40), 'elevated');
    assert.equal(classifyThreatTier(59), 'elevated');
  });

  it('returns guarded for score 20-39', () => {
    assert.equal(classifyThreatTier(20), 'guarded');
    assert.equal(classifyThreatTier(39), 'guarded');
  });

  it('returns low for score < 20', () => {
    assert.equal(classifyThreatTier(0), 'low');
    assert.equal(classifyThreatTier(19), 'low');
  });

  it('clamps scores above 100 to critical', () => {
    assert.equal(classifyThreatTier(150), 'critical');
  });

  it('clamps negative scores to low', () => {
    assert.equal(classifyThreatTier(-10), 'low');
  });
});

// ── tierLabel ─────────────────────────────────────────────────────────────────

describe('tierLabel', () => {
  it('returns uppercase strings for all tiers', () => {
    const tiers: ThreatTier[] = ['critical', 'high', 'elevated', 'guarded', 'low'];
    for (const tier of tiers) {
      const label = tierLabel(tier);
      assert.equal(label, label.toUpperCase());
    }
  });

  it('returns CRITICAL for critical tier', () => {
    assert.equal(tierLabel('critical'), 'CRITICAL');
  });

  it('returns LOW for low tier', () => {
    assert.equal(tierLabel('low'), 'LOW');
  });
});

// ── tierOrdinal ───────────────────────────────────────────────────────────────

describe('tierOrdinal', () => {
  it('critical has highest ordinal', () => {
    assert.ok(tierOrdinal('critical') > tierOrdinal('high'));
  });

  it('low has lowest ordinal (0)', () => {
    assert.equal(tierOrdinal('low'), 0);
  });

  it('maintains strict ordering', () => {
    assert.ok(tierOrdinal('high') > tierOrdinal('elevated'));
    assert.ok(tierOrdinal('elevated') > tierOrdinal('guarded'));
    assert.ok(tierOrdinal('guarded') > tierOrdinal('low'));
  });
});

// ── aggregateTier ─────────────────────────────────────────────────────────────

describe('aggregateTier', () => {
  it('returns low for empty array', () => {
    assert.equal(aggregateTier([]), 'low');
  });

  it('returns max tier from scores', () => {
    assert.equal(aggregateTier([10, 85, 45]), 'critical');
  });

  it('handles all-low scores', () => {
    assert.equal(aggregateTier([5, 10, 15]), 'low');
  });
});

// ── analyzeAttackVectors ──────────────────────────────────────────────────────

describe('analyzeAttackVectors', () => {
  it('returns empty array for empty incidents', () => {
    assert.deepEqual(analyzeAttackVectors([]), []);
  });

  it('counts each vector correctly', () => {
    const incidents: IncidentRecord[] = [
      { ...BASE_INCIDENT, id: 'a', vector: 'ied' },
      { ...BASE_INCIDENT, id: 'b', vector: 'ied' },
      { ...BASE_INCIDENT, id: 'c', vector: 'suicide' },
    ];
    const result = analyzeAttackVectors(incidents);
    const ied = result.find((v) => v.vector === 'ied');
    assert.ok(ied);
    assert.equal(ied.count, 2);
    assert.equal(result[0]?.vector, 'ied'); // sorted by count
  });

  it('computes proportion correctly', () => {
    const incidents: IncidentRecord[] = [
      { ...BASE_INCIDENT, id: 'a', vector: 'ied' },
      { ...BASE_INCIDENT, id: 'b', vector: 'suicide' },
      { ...BASE_INCIDENT, id: 'c', vector: 'suicide' },
      { ...BASE_INCIDENT, id: 'd', vector: 'knife' },
    ];
    const result = analyzeAttackVectors(incidents);
    const suicide = result.find((v) => v.vector === 'suicide');
    assert.ok(suicide);
    assert.equal(suicide.proportion, 0.5);
  });

  it('sums killed and wounded per vector', () => {
    const incidents: IncidentRecord[] = [
      { ...BASE_INCIDENT, id: 'a', vector: 'ied', killed: 3, wounded: 7 },
      { ...BASE_INCIDENT, id: 'b', vector: 'ied', killed: 2, wounded: 4 },
    ];
    const result = analyzeAttackVectors(incidents);
    const ied = result.find((v) => v.vector === 'ied');
    assert.equal(ied?.killed, 5);
    assert.equal(ied?.wounded, 11);
  });
});

// ── dominantVector ────────────────────────────────────────────────────────────

describe('dominantVector', () => {
  it('returns other for empty list', () => {
    assert.equal(dominantVector([]), 'other');
  });

  it('returns the most common vector', () => {
    const incidents: IncidentRecord[] = [
      { ...BASE_INCIDENT, id: 'a', vector: 'ied' },
      { ...BASE_INCIDENT, id: 'b', vector: 'ied' },
      { ...BASE_INCIDENT, id: 'c', vector: 'knife' },
    ];
    assert.equal(dominantVector(incidents), 'ied');
  });
});

// ── vectorLethalityScore ──────────────────────────────────────────────────────

describe('vectorLethalityScore', () => {
  it('returns 0 when no matching incidents', () => {
    assert.equal(vectorLethalityScore([], 'ied'), 0);
  });

  it('computes killed + 0.5 * wounded per incident', () => {
    const incidents: IncidentRecord[] = [
      { ...BASE_INCIDENT, id: 'a', vector: 'suicide', killed: 10, wounded: 20 },
    ];
    // 10 + 0.5 * 20 = 20
    assert.equal(vectorLethalityScore(incidents, 'suicide'), 20);
  });

  it('averages across multiple incidents of same vector', () => {
    const incidents: IncidentRecord[] = [
      { ...BASE_INCIDENT, id: 'a', vector: 'ied', killed: 4, wounded: 0 },
      { ...BASE_INCIDENT, id: 'b', vector: 'ied', killed: 8, wounded: 0 },
    ];
    // (4 + 8) / 2 = 6
    assert.equal(vectorLethalityScore(incidents, 'ied'), 6);
  });
});

// ── scoreGroupActivity ────────────────────────────────────────────────────────

describe('scoreGroupActivity', () => {
  it('returns 0 for zero inputs', () => {
    assert.equal(scoreGroupActivity(0, 0, 0), 0);
  });

  it('caps at 100', () => {
    assert.equal(scoreGroupActivity(100, 100, 100), 100);
  });

  it('computes weighted formula correctly', () => {
    // 5*4 + 10*2 + 20*0.5 = 20 + 20 + 10 = 50
    assert.equal(scoreGroupActivity(5, 10, 20), 50);
  });
});

// ── analyzeGroupActivity ──────────────────────────────────────────────────────

describe('analyzeGroupActivity', () => {
  it('returns empty array for no incidents', () => {
    assert.deepEqual(analyzeGroupActivity([]), []);
  });

  it('groups incidents by threat group', () => {
    const incidents: IncidentRecord[] = [
      { ...BASE_INCIDENT, id: 'a', group: 'ISIS', killed: 5, wounded: 0 },
      { ...BASE_INCIDENT, id: 'b', group: 'ISIS', killed: 3, wounded: 0 },
      { ...BASE_INCIDENT, id: 'c', group: 'Al-Qaeda', killed: 1, wounded: 0 },
    ];
    const result = analyzeGroupActivity(incidents);
    assert.equal(result.length, 2);
    assert.equal(result[0]?.group, 'ISIS'); // higher score first
  });

  it('counts incidents correctly per group', () => {
    const incidents: IncidentRecord[] = [
      { ...BASE_INCIDENT, id: 'a', group: 'TTP' },
      { ...BASE_INCIDENT, id: 'b', group: 'TTP' },
      { ...BASE_INCIDENT, id: 'c', group: 'TTP' },
    ];
    const result = analyzeGroupActivity(incidents);
    assert.equal(result[0]?.incidentCount30d, 3);
  });
});

// ── computeIncidentFrequency ──────────────────────────────────────────────────

describe('computeIncidentFrequency', () => {
  it('returns zero counts for empty incidents', () => {
    const result = computeIncidentFrequency([], NOW);
    assert.equal(result.count30d, 0);
    assert.equal(result.count7d, 0);
    assert.equal(result.trend, 'stable');
  });

  it('counts incidents within 30d window', () => {
    const incidents: IncidentRecord[] = [
      { ...BASE_INCIDENT, id: 'a', date: d(5) },
      { ...BASE_INCIDENT, id: 'b', date: d(15) },
      { ...BASE_INCIDENT, id: 'c', date: d(35) }, // outside 30d
    ];
    const result = computeIncidentFrequency(incidents, NOW);
    assert.equal(result.count30d, 2);
  });

  it('counts incidents within 7d window', () => {
    const incidents: IncidentRecord[] = [
      { ...BASE_INCIDENT, id: 'a', date: d(3) },
      { ...BASE_INCIDENT, id: 'b', date: d(10) }, // outside 7d
    ];
    const result = computeIncidentFrequency(incidents, NOW);
    assert.equal(result.count7d, 1);
  });

  it('detects increasing trend when recent count exceeds prior by >10%', () => {
    const incidents: IncidentRecord[] = [
      { ...BASE_INCIDENT, id: 'a', date: d(5) },
      { ...BASE_INCIDENT, id: 'b', date: d(10) },
      { ...BASE_INCIDENT, id: 'c', date: d(15) },
      { ...BASE_INCIDENT, id: 'd', date: d(35) }, // prior period: 1
    ];
    const result = computeIncidentFrequency(incidents, NOW);
    assert.equal(result.trend, 'increasing');
  });

  it('computes dailyAvg30d correctly', () => {
    const incidents: IncidentRecord[] = [
      { ...BASE_INCIDENT, id: 'a', date: d(5) },
      { ...BASE_INCIDENT, id: 'b', date: d(10) },
    ];
    const result = computeIncidentFrequency(incidents, NOW);
    assert.equal(result.dailyAvg30d, 2 / 30);
  });
});

// ── assessCasualtySeverity ────────────────────────────────────────────────────

describe('assessCasualtySeverity', () => {
  it('returns none for 0 killed and 0 wounded', () => {
    assert.equal(assessCasualtySeverity(0, 0).label, 'none');
  });

  it('returns minor for small totals', () => {
    assert.equal(assessCasualtySeverity(0, 2).label, 'minor');
  });

  it('returns moderate for total >= 3 when killed < 3', () => {
    assert.equal(assessCasualtySeverity(1, 2).label, 'moderate');
  });

  it('returns severe for killed >= 3', () => {
    assert.equal(assessCasualtySeverity(3, 0).label, 'severe');
  });

  it('returns severe for total >= 10', () => {
    assert.equal(assessCasualtySeverity(1, 9).label, 'severe');
  });

  it('returns mass_casualty for killed >= 10', () => {
    assert.equal(assessCasualtySeverity(10, 5).label, 'mass_casualty');
  });

  it('includes total in result', () => {
    const result = assessCasualtySeverity(4, 6);
    assert.equal(result.total, 10);
  });
});

// ── topCasualtyEvent ──────────────────────────────────────────────────────────

describe('topCasualtyEvent', () => {
  it('returns none-label for empty list', () => {
    const result = topCasualtyEvent([]);
    assert.equal(result.label, 'none');
    assert.equal(result.killed, 0);
  });

  it('finds incident with most killed', () => {
    const incidents: IncidentRecord[] = [
      { ...BASE_INCIDENT, id: 'a', killed: 2, wounded: 5 },
      { ...BASE_INCIDENT, id: 'b', killed: 12, wounded: 3 },
      { ...BASE_INCIDENT, id: 'c', killed: 5, wounded: 20 },
    ];
    const result = topCasualtyEvent(incidents);
    assert.equal(result.killed, 12);
    assert.equal(result.label, 'mass_casualty');
  });
});

// ── computeCtEffectiveness ────────────────────────────────────────────────────

describe('computeCtEffectiveness', () => {
  it('returns rate 0 and poor for empty list', () => {
    const result = computeCtEffectiveness([]);
    assert.equal(result.rate, 0);
    assert.equal(result.label, 'poor');
  });

  it('counts successful CT ops correctly', () => {
    const incidents: IncidentRecord[] = [
      { ...BASE_INCIDENT, id: 'a', ctSuccess: true },
      { ...BASE_INCIDENT, id: 'b', ctSuccess: true },
      { ...BASE_INCIDENT, id: 'c', ctSuccess: false },
      { ...BASE_INCIDENT, id: 'd', ctSuccess: false },
    ];
    const result = computeCtEffectiveness(incidents);
    assert.equal(result.successful, 2);
    assert.equal(result.rate, 0.5);
    assert.equal(result.label, 'good');
  });

  it('returns excellent for rate >= 0.75', () => {
    const incidents: IncidentRecord[] = [
      { ...BASE_INCIDENT, id: 'a', ctSuccess: true },
      { ...BASE_INCIDENT, id: 'b', ctSuccess: true },
      { ...BASE_INCIDENT, id: 'c', ctSuccess: true },
      { ...BASE_INCIDENT, id: 'd', ctSuccess: false },
    ];
    const result = computeCtEffectiveness(incidents);
    assert.equal(result.label, 'excellent');
  });

  it('returns poor for rate < 0.25', () => {
    const incidents: IncidentRecord[] = [
      { ...BASE_INCIDENT, id: 'a', ctSuccess: false },
      { ...BASE_INCIDENT, id: 'b', ctSuccess: false },
      { ...BASE_INCIDENT, id: 'c', ctSuccess: false },
      { ...BASE_INCIDENT, id: 'd', ctSuccess: false },
    ];
    const result = computeCtEffectiveness(incidents);
    assert.equal(result.label, 'poor');
  });
});

// ── computeRegionScore ────────────────────────────────────────────────────────

describe('computeRegionScore', () => {
  it('returns 0 for zero inputs', () => {
    assert.equal(computeRegionScore(0, 0, 0), 0);
  });

  it('caps at 100', () => {
    assert.equal(computeRegionScore(100, 100, 100), 100);
  });

  it('applies correct weights', () => {
    // 2*5 + 3*3 + 4 = 10+9+4 = 23
    assert.equal(computeRegionScore(2, 3, 4), 23);
  });
});

// ── aggregateRegionRisks ──────────────────────────────────────────────────────

describe('aggregateRegionRisks', () => {
  it('returns empty for no incidents', () => {
    assert.deepEqual(aggregateRegionRisks([]), []);
  });

  it('groups by region correctly', () => {
    const incidents: IncidentRecord[] = [
      { ...BASE_INCIDENT, id: 'a', region: 'Europe' },
      { ...BASE_INCIDENT, id: 'b', region: 'Europe' },
      { ...BASE_INCIDENT, id: 'c', region: 'Sahel' },
    ];
    const result = aggregateRegionRisks(incidents);
    assert.equal(result.length, 2);
  });

  it('sorts regions by score descending', () => {
    const incidents: IncidentRecord[] = [
      { ...BASE_INCIDENT, id: 'a', region: 'Low Region', killed: 1, wounded: 1 },
      { ...BASE_INCIDENT, id: 'b', region: 'High Region', killed: 20, wounded: 30 },
    ];
    const result = aggregateRegionRisks(incidents);
    assert.equal(result[0]?.region, 'High Region');
  });

  it('computes ctSuccessRate correctly', () => {
    const incidents: IncidentRecord[] = [
      { ...BASE_INCIDENT, id: 'a', region: 'Test', ctSuccess: true },
      { ...BASE_INCIDENT, id: 'b', region: 'Test', ctSuccess: false },
    ];
    const result = aggregateRegionRisks(incidents);
    assert.equal(result[0]?.ctSuccessRate, 0.5);
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  it('returns valid structure for empty incidents', () => {
    const result = buildRenderData([], NOW);
    assert.equal(result.overallTier, 'low');
    assert.equal(result.overallScore, 0);
    assert.equal(result.regions.length, 0);
    assert.equal(result.groups.length, 0);
  });

  it('only includes incidents from last 30 days in regions/groups/vectors', () => {
    const incidents: IncidentRecord[] = [
      { ...BASE_INCIDENT, id: 'a', date: d(10) },
      { ...BASE_INCIDENT, id: 'b', date: d(40) }, // outside 30d
    ];
    const result = buildRenderData(incidents, NOW);
    assert.equal(result.regions[0]?.incidentCount30d, 1);
  });

  it('asOf matches provided nowMs', () => {
    const result = buildRenderData([], NOW);
    assert.equal(result.asOf, NOW);
  });

  it('uses mock incidents without errors', () => {
    const incidents = getMockIncidents(NOW);
    const result = buildRenderData(incidents, NOW);
    assert.ok(result.regions.length > 0);
    assert.ok(result.groups.length > 0);
    assert.ok(result.vectors.length > 0);
  });
});

// ── buildRegionRowHtml ────────────────────────────────────────────────────────

describe('buildRegionRowHtml', () => {
  it('produces a <tr> element string', () => {
    const region = aggregateRegionRisks([BASE_INCIDENT])[0]!;
    const html = buildRegionRowHtml(region);
    assert.ok(html.includes('<tr'));
    assert.ok(html.includes('</tr>'));
  });

  it('contains the region name', () => {
    const region = aggregateRegionRisks([BASE_INCIDENT])[0]!;
    const html = buildRegionRowHtml(region);
    assert.ok(html.includes('Middle East'));
  });

  it('contains the tier label', () => {
    const region = aggregateRegionRisks([BASE_INCIDENT])[0]!;
    const html = buildRegionRowHtml(region);
    assert.ok(html.includes(tierLabel(region.tier)));
  });
});

// ── buildGroupCardHtml ────────────────────────────────────────────────────────

describe('buildGroupCardHtml', () => {
  it('produces a div element string', () => {
    const groups = analyzeGroupActivity([BASE_INCIDENT]);
    const html = buildGroupCardHtml(groups[0]!);
    assert.ok(html.includes('<div'));
    assert.ok(html.includes('ISIS'));
  });

  it('contains incident count', () => {
    const groups = analyzeGroupActivity([BASE_INCIDENT]);
    const html = buildGroupCardHtml(groups[0]!);
    assert.ok(html.includes('1 incidents'));
  });
});

// ── mostFrequent ──────────────────────────────────────────────────────────────

describe('mostFrequent', () => {
  it('returns empty string for empty array', () => {
    assert.equal(mostFrequent([]), '');
  });

  it('returns single element', () => {
    assert.equal(mostFrequent(['a']), 'a');
  });

  it('returns most frequent element', () => {
    assert.equal(mostFrequent(['a', 'b', 'a', 'c', 'a']), 'a');
  });

  it('works with numbers', () => {
    assert.equal(mostFrequent([1, 2, 2, 3]), 2);
  });
});

// ── escapeHtmlSimple ──────────────────────────────────────────────────────────

describe('escapeHtmlSimple', () => {
  it('escapes ampersand', () => {
    assert.equal(escapeHtmlSimple('a & b'), 'a &amp; b');
  });

  it('escapes less-than', () => {
    assert.equal(escapeHtmlSimple('<script>'), '&lt;script&gt;');
  });

  it('escapes double quotes', () => {
    assert.equal(escapeHtmlSimple('"hello"'), '&quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    assert.equal(escapeHtmlSimple("it's"), 'it&#39;s');
  });

  it('leaves safe strings unchanged', () => {
    assert.equal(escapeHtmlSimple('Hello World'), 'Hello World');
  });
});

// ── getMockIncidents ──────────────────────────────────────────────────────────

describe('getMockIncidents', () => {
  it('returns at least 30 incidents', () => {
    const incidents = getMockIncidents(NOW);
    assert.ok(incidents.length >= 30);
  });

  it('all incidents have unique ids', () => {
    const incidents = getMockIncidents(NOW);
    const ids = new Set(incidents.map((i) => i.id));
    assert.equal(ids.size, incidents.length);
  });

  it('all incident dates are in the past relative to seed', () => {
    const incidents = getMockIncidents(NOW);
    for (const inc of incidents) {
      assert.ok(inc.date < NOW, `Incident ${inc.id} date is not in the past`);
    }
  });

  it('all killed and wounded are non-negative', () => {
    const incidents = getMockIncidents(NOW);
    for (const inc of incidents) {
      assert.ok(inc.killed >= 0);
      assert.ok(inc.wounded >= 0);
    }
  });

  it('is deterministic — same result for same seed', () => {
    const a = getMockIncidents(NOW);
    const b = getMockIncidents(NOW);
    assert.deepEqual(a, b);
  });

  it('produces different results for different seeds', () => {
    const a = getMockIncidents(NOW);
    const b = getMockIncidents(NOW + 7 * 24 * 60 * 60 * 1000);
    // Dates shift so they won't be equal
    assert.notDeepEqual(a[0]?.date, b[0]?.date);
  });
});

// ── TIER_COLORS / VECTOR_LABELS constants ────────────────────────────────────

describe('TIER_COLORS', () => {
  it('has an entry for all 5 tiers', () => {
    const tiers: ThreatTier[] = ['critical', 'high', 'elevated', 'guarded', 'low'];
    for (const tier of tiers) {
      assert.ok(TIER_COLORS[tier], `Missing color for ${tier}`);
    }
  });

  it('all values are hex color strings', () => {
    for (const color of Object.values(TIER_COLORS)) {
      assert.match(color, /^#[0-9a-fA-F]{6}$/, `${color} is not a valid hex color`);
    }
  });
});

describe('VECTOR_LABELS', () => {
  it('has labels for all defined attack vectors', () => {
    const vectors = ['vehicle', 'ied', 'suicide', 'knife', 'active_shooter', 'chemical', 'cyber', 'rocket', 'kidnapping', 'other'];
    for (const v of vectors) {
      assert.ok(VECTOR_LABELS[v as keyof typeof VECTOR_LABELS], `Missing label for ${v}`);
    }
  });
});

// ── Integration: buildRenderData with full mock dataset ───────────────────────

describe('integration: full mock dataset', () => {
  const incidents = getMockIncidents(NOW);
  const data = buildRenderData(incidents, NOW);

  it('produces valid overallTier', () => {
    const valid: ThreatTier[] = ['critical', 'high', 'elevated', 'guarded', 'low'];
    assert.ok(valid.includes(data.overallTier));
  });

  it('overallScore is between 0 and 100', () => {
    assert.ok(data.overallScore >= 0 && data.overallScore <= 100);
  });

  it('regions are sorted by score descending', () => {
    for (let i = 1; i < data.regions.length; i++) {
      assert.ok(data.regions[i - 1]!.score >= data.regions[i]!.score);
    }
  });

  it('groups are sorted by activityScore descending', () => {
    for (let i = 1; i < data.groups.length; i++) {
      assert.ok(data.groups[i - 1]!.activityScore >= data.groups[i]!.activityScore);
    }
  });

  it('vectors are sorted by count descending', () => {
    for (let i = 1; i < data.vectors.length; i++) {
      assert.ok(data.vectors[i - 1]!.count >= data.vectors[i]!.count);
    }
  });

  it('ctEffectiveness rate is between 0 and 1', () => {
    assert.ok(data.ctEffectiveness.rate >= 0 && data.ctEffectiveness.rate <= 1);
  });

  it('frequency count30d matches number of recent incidents', () => {
    const ms30d = 30 * 24 * 60 * 60 * 1000;
    const expected = incidents.filter((i) => NOW - i.date <= ms30d).length;
    assert.equal(data.frequency.count30d, expected);
  });

  it('all region tiers correspond to their scores', () => {
    for (const r of data.regions) {
      assert.equal(r.tier, classifyThreatTier(r.score));
    }
  });
});
