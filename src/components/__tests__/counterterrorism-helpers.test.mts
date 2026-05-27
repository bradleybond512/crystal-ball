import assert from 'node:assert/strict';
import test from 'node:test';

import {
  threatLevelColor,
  threatLevelLabel,
  attackVectorLabel,
  groupAffiliationLabel,
  incidentDomainLabel,
  activityTrendLabel,
  activityTrendColor,
  groupSeverityScore,
  classifyFromIncidentData,
  aggregateIncidents,
  aggregateFatalities,
  countActiveThreatGroups,
  countHighThreatCountries,
  countHighImpactEvents,
  sortGroupsBySeverity,
  sortCountriesByIncidents,
  sortEventsByCasualties,
  sortVectorsByIncidents,
  dominantVector,
  formatActiveRegions,
  renderIncidentTrendsSection,
  renderThreatGroupsSection,
  renderAttackVectorsSection,
  renderCountryAssessmentsSection,
  renderHighImpactEventsSection,
  INCIDENT_TRENDS,
  THREAT_GROUPS,
  ATTACK_VECTOR_STATS,
  COUNTRY_ASSESSMENTS,
  HIGH_IMPACT_EVENTS,
  type ThreatLevel,
  type ActivityTrend,
  type AttackVector,
  type GroupAffiliation,
  type IncidentDomain,
  type TerrorismIncidentTrend,
  type ThreatGroup,
  type AttackVectorStat,
  type CountryThreatAssessment,
  type HighImpactEvent,
} from '../counterterrorism-helpers.ts';

// ── threatLevelColor ────────────────────────────────────────────────────────

test('threatLevelColor covers every ThreatLevel', () => {
  const levels: ThreatLevel[] = ['low', 'moderate', 'substantial', 'severe', 'critical'];
  for (const l of levels) {
    const c = threatLevelColor(l);
    assert.ok(c.startsWith('var(') || c.startsWith('#'), `unexpected color for ${l}: ${c}`);
  }
});

test('threatLevelColor critical is red', () => {
  assert.match(threatLevelColor('critical'), /ef4444/);
});

test('threatLevelColor low is green', () => {
  assert.match(threatLevelColor('low'), /22c55e/);
});

// ── threatLevelLabel ────────────────────────────────────────────────────────

test('threatLevelLabel returns human-readable labels', () => {
  assert.equal(threatLevelLabel('low'), 'Low');
  assert.equal(threatLevelLabel('moderate'), 'Moderate');
  assert.equal(threatLevelLabel('substantial'), 'Substantial');
  assert.equal(threatLevelLabel('severe'), 'Severe');
  assert.equal(threatLevelLabel('critical'), 'Critical');
});

// ── attackVectorLabel ───────────────────────────────────────────────────────

test('attackVectorLabel covers all vectors', () => {
  const vectors: AttackVector[] = ['vehicle', 'ied', 'cbrn', 'cyber_enabled', 'active_shooter', 'suicide_bombing', 'kidnapping', 'arson'];
  for (const v of vectors) {
    const label = attackVectorLabel(v);
    assert.ok(label.length > 0, `empty label for ${v}`);
  }
});

test('attackVectorLabel ied is descriptive', () => {
  assert.match(attackVectorLabel('ied'), /IED/);
});

// ── groupAffiliationLabel ───────────────────────────────────────────────────

test('groupAffiliationLabel covers all affiliations', () => {
  const affiliations: GroupAffiliation[] = ['isis_isil', 'al_qaeda', 'domestic_extremist', 'separatist', 'narco_terrorist', 'lone_wolf', 'state_sponsored'];
  for (const a of affiliations) {
    const label = groupAffiliationLabel(a);
    assert.ok(label.length > 0, `empty label for ${a}`);
  }
});

test('groupAffiliationLabel isis_isil includes ISIS', () => {
  assert.match(groupAffiliationLabel('isis_isil'), /ISIS/);
});

// ── incidentDomainLabel ─────────────────────────────────────────────────────

test('incidentDomainLabel covers all domains', () => {
  const domains: IncidentDomain[] = ['europe', 'middle_east', 'africa', 'south_asia', 'southeast_asia', 'americas', 'central_asia'];
  for (const d of domains) {
    const label = incidentDomainLabel(d);
    assert.ok(label.length > 0, `empty label for ${d}`);
  }
});

// ── activityTrendLabel / activityTrendColor ─────────────────────────────────

test('activityTrendLabel covers all trends', () => {
  const trends: ActivityTrend[] = ['increasing', 'stable', 'decreasing', 'resurgent', 'dormant'];
  for (const t of trends) {
    const label = activityTrendLabel(t);
    assert.ok(label.length > 0, `empty label for ${t}`);
  }
});

test('activityTrendColor increasing is red', () => {
  assert.match(activityTrendColor('increasing'), /ef4444/);
});

test('activityTrendColor decreasing is green', () => {
  assert.match(activityTrendColor('decreasing'), /22c55e/);
});

// ── groupSeverityScore ──────────────────────────────────────────────────────

test('groupSeverityScore returns 0-100', () => {
  for (const g of THREAT_GROUPS) {
    const score = groupSeverityScore(g);
    assert.ok(score >= 0 && score <= 100, `score out of range for ${g.name}: ${score}`);
  }
});

test('groupSeverityScore critical group scores higher than moderate group', () => {
  const critical: ThreatGroup = {
    name: 'Test Critical',
    affiliation: 'isis_isil',
    primaryRegion: 'Test',
    activeInRegions: ['A', 'B', 'C'],
    activityTrend: 'increasing',
    estimatedStrength: 5000,
    lastKnownActivity: '2025-01-01',
    threatLevel: 'critical',
    notes: '',
  };
  const moderate: ThreatGroup = {
    name: 'Test Moderate',
    affiliation: 'lone_wolf',
    primaryRegion: 'Test',
    activeInRegions: ['A'],
    activityTrend: 'dormant',
    estimatedStrength: 10,
    lastKnownActivity: '2025-01-01',
    threatLevel: 'moderate',
    notes: '',
  };
  assert.ok(groupSeverityScore(critical) > groupSeverityScore(moderate));
});

test('groupSeverityScore with zero regions still valid', () => {
  const g: ThreatGroup = {
    name: 'No Regions',
    affiliation: 'lone_wolf',
    primaryRegion: 'Unknown',
    activeInRegions: [],
    activityTrend: 'dormant',
    estimatedStrength: 1,
    lastKnownActivity: '2025-01-01',
    threatLevel: 'low',
    notes: '',
  };
  const score = groupSeverityScore(g);
  assert.ok(score >= 0 && score <= 100);
});

// ── classifyFromIncidentData ────────────────────────────────────────────────

test('classifyFromIncidentData zero incidents is low', () => {
  assert.equal(classifyFromIncidentData(0, 0), 'low');
});

test('classifyFromIncidentData high counts is critical', () => {
  assert.equal(classifyFromIncidentData(100, 100), 'critical');
});

test('classifyFromIncidentData moderate range', () => {
  // score = 5*1 + 5*2 = 15 => low; score = 10*1 + 5*2 = 20 => moderate
  assert.equal(classifyFromIncidentData(10, 5), 'moderate');
});

test('classifyFromIncidentData severe range', () => {
  // score = 30*1 + 35*2 = 100 => severe
  assert.equal(classifyFromIncidentData(30, 35), 'severe');
});

// ── aggregateIncidents / aggregateFatalities ────────────────────────────────

test('aggregateIncidents sums all trends when no quarter filter', () => {
  const total = aggregateIncidents(INCIDENT_TRENDS);
  const expected = INCIDENT_TRENDS.reduce((s, t) => s + t.incidentCount, 0);
  assert.equal(total, expected);
});

test('aggregateIncidents filters by quarter', () => {
  const q1Total = aggregateIncidents(INCIDENT_TRENDS, 'Q1 2025');
  const allTotal = aggregateIncidents(INCIDENT_TRENDS);
  // All fixture data is Q1 2025, so should be equal
  assert.equal(q1Total, allTotal);
});

test('aggregateIncidents returns 0 for unknown quarter', () => {
  assert.equal(aggregateIncidents(INCIDENT_TRENDS, 'Q4 1990'), 0);
});

test('aggregateFatalities sums all fatalities', () => {
  const total = aggregateFatalities(INCIDENT_TRENDS);
  const expected = INCIDENT_TRENDS.reduce((s, t) => s + t.fatalityCount, 0);
  assert.equal(total, expected);
});

test('aggregateFatalities empty array is zero', () => {
  assert.equal(aggregateFatalities([]), 0);
});

// ── countActiveThreatGroups ─────────────────────────────────────────────────

test('countActiveThreatGroups counts increasing and resurgent only', () => {
  const count = countActiveThreatGroups(THREAT_GROUPS);
  const expected = THREAT_GROUPS.filter(
    g => g.activityTrend === 'increasing' || g.activityTrend === 'resurgent',
  ).length;
  assert.equal(count, expected);
});

test('countActiveThreatGroups empty array is zero', () => {
  assert.equal(countActiveThreatGroups([]), 0);
});

test('countActiveThreatGroups stable groups not counted', () => {
  const stableOnly: ThreatGroup[] = THREAT_GROUPS.filter(g => g.activityTrend === 'stable');
  assert.equal(countActiveThreatGroups(stableOnly), 0);
});

// ── countHighThreatCountries ────────────────────────────────────────────────

test('countHighThreatCountries counts severe and critical', () => {
  const count = countHighThreatCountries(COUNTRY_ASSESSMENTS);
  const expected = COUNTRY_ASSESSMENTS.filter(
    a => a.threatLevel === 'severe' || a.threatLevel === 'critical',
  ).length;
  assert.equal(count, expected);
});

test('countHighThreatCountries empty array is zero', () => {
  assert.equal(countHighThreatCountries([]), 0);
});

// ── countHighImpactEvents ───────────────────────────────────────────────────

test('countHighImpactEvents counts severe and critical events', () => {
  const count = countHighImpactEvents(HIGH_IMPACT_EVENTS);
  const expected = HIGH_IMPACT_EVENTS.filter(
    e => e.significance === 'severe' || e.significance === 'critical',
  ).length;
  assert.equal(count, expected);
});

test('countHighImpactEvents low significance not counted', () => {
  const lowEvents: HighImpactEvent[] = [{
    date: '2025-01-01',
    location: 'Test',
    country: 'Test',
    vector: 'arson',
    affiliation: 'lone_wolf',
    killed: 0,
    wounded: 1,
    summary: 'Minor incident',
    significance: 'low',
  }];
  assert.equal(countHighImpactEvents(lowEvents), 0);
});

// ── sortGroupsBySeverity ────────────────────────────────────────────────────

test('sortGroupsBySeverity returns sorted descending', () => {
  const sorted = sortGroupsBySeverity(THREAT_GROUPS);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(
      groupSeverityScore(sorted[i - 1]!) >= groupSeverityScore(sorted[i]!),
      'not sorted descending',
    );
  }
});

test('sortGroupsBySeverity does not mutate original', () => {
  const original = [...THREAT_GROUPS];
  sortGroupsBySeverity(THREAT_GROUPS);
  assert.deepEqual(THREAT_GROUPS, original);
});

// ── sortCountriesByIncidents ────────────────────────────────────────────────

test('sortCountriesByIncidents returns sorted descending', () => {
  const sorted = sortCountriesByIncidents(COUNTRY_ASSESSMENTS);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(
      sorted[i - 1]!.incidentsPast12Months >= sorted[i]!.incidentsPast12Months,
    );
  }
});

// ── sortEventsByCasualties ──────────────────────────────────────────────────

test('sortEventsByCasualties orders by killed+wounded descending', () => {
  const sorted = sortEventsByCasualties(HIGH_IMPACT_EVENTS);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!.killed + sorted[i - 1]!.wounded;
    const curr = sorted[i]!.killed + sorted[i]!.wounded;
    assert.ok(prev >= curr);
  }
});

// ── sortVectorsByIncidents ──────────────────────────────────────────────────

test('sortVectorsByIncidents orders by incident count descending', () => {
  const sorted = sortVectorsByIncidents(ATTACK_VECTOR_STATS);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i - 1]!.incidentsPast12Months >= sorted[i]!.incidentsPast12Months);
  }
});

// ── dominantVector ──────────────────────────────────────────────────────────

test('dominantVector returns null for empty array', () => {
  assert.equal(dominantVector([]), null);
});

test('dominantVector returns vector with most incidents', () => {
  const stats: AttackVectorStat[] = [
    { vector: 'ied', incidentsPast12Months: 100, fatalitiesPast12Months: 50, percentOfTotal: 50, trend: 'stable', primaryRegion: 'Test' },
    { vector: 'vehicle', incidentsPast12Months: 200, fatalitiesPast12Months: 20, percentOfTotal: 50, trend: 'stable', primaryRegion: 'Test' },
  ];
  assert.equal(dominantVector(stats), 'vehicle');
});

// ── formatActiveRegions ─────────────────────────────────────────────────────

test('formatActiveRegions joins regions with comma', () => {
  const g: ThreatGroup = { ...THREAT_GROUPS[0]!, activeInRegions: ['A', 'B', 'C'] };
  assert.equal(formatActiveRegions(g), 'A, B, C');
});

test('formatActiveRegions empty array returns Unknown', () => {
  const g: ThreatGroup = { ...THREAT_GROUPS[0]!, activeInRegions: [] };
  assert.equal(formatActiveRegions(g), 'Unknown');
});

// ── render functions ────────────────────────────────────────────────────────

test('renderIncidentTrendsSection returns non-empty string', () => {
  const html = renderIncidentTrendsSection(INCIDENT_TRENDS);
  assert.ok(html.length > 100);
});

test('renderIncidentTrendsSection contains table element', () => {
  const html = renderIncidentTrendsSection(INCIDENT_TRENDS);
  assert.ok(html.includes('<table'));
});

test('renderIncidentTrendsSection includes domain labels', () => {
  const html = renderIncidentTrendsSection(INCIDENT_TRENDS);
  assert.ok(html.includes('Africa'));
  assert.ok(html.includes('Europe'));
});

test('renderThreatGroupsSection returns non-empty string', () => {
  const html = renderThreatGroupsSection(THREAT_GROUPS);
  assert.ok(html.length > 100);
});

test('renderThreatGroupsSection contains group names', () => {
  const html = renderThreatGroupsSection(THREAT_GROUPS);
  assert.ok(html.includes('Al-Shabaab'));
});

test('renderThreatGroupsSection contains threat badges', () => {
  const html = renderThreatGroupsSection(THREAT_GROUPS);
  assert.ok(html.includes('Critical') || html.includes('Severe'));
});

test('renderAttackVectorsSection returns non-empty string', () => {
  const html = renderAttackVectorsSection(ATTACK_VECTOR_STATS);
  assert.ok(html.length > 100);
});

test('renderAttackVectorsSection includes vector labels', () => {
  const html = renderAttackVectorsSection(ATTACK_VECTOR_STATS);
  assert.ok(html.includes('IED'));
  assert.ok(html.includes('Vehicle'));
});

test('renderCountryAssessmentsSection returns non-empty string', () => {
  const html = renderCountryAssessmentsSection(COUNTRY_ASSESSMENTS);
  assert.ok(html.length > 100);
});

test('renderCountryAssessmentsSection includes country names', () => {
  const html = renderCountryAssessmentsSection(COUNTRY_ASSESSMENTS);
  assert.ok(html.includes('Somalia'));
  assert.ok(html.includes('Mali'));
});

test('renderHighImpactEventsSection returns non-empty string', () => {
  const html = renderHighImpactEventsSection(HIGH_IMPACT_EVENTS);
  assert.ok(html.length > 100);
});

test('renderHighImpactEventsSection includes event locations', () => {
  const html = renderHighImpactEventsSection(HIGH_IMPACT_EVENTS);
  assert.ok(html.includes('Bamako'));
  assert.ok(html.includes('Mogadishu'));
});

// ── fixture data integrity ──────────────────────────────────────────────────

test('INCIDENT_TRENDS has at least 5 entries', () => {
  assert.ok(INCIDENT_TRENDS.length >= 5);
});

test('THREAT_GROUPS has at least 5 entries', () => {
  assert.ok(THREAT_GROUPS.length >= 5);
});

test('ATTACK_VECTOR_STATS has at least 5 entries', () => {
  assert.ok(ATTACK_VECTOR_STATS.length >= 5);
});

test('COUNTRY_ASSESSMENTS has at least 5 entries', () => {
  assert.ok(COUNTRY_ASSESSMENTS.length >= 5);
});

test('HIGH_IMPACT_EVENTS has at least 3 entries', () => {
  assert.ok(HIGH_IMPACT_EVENTS.length >= 3);
});

test('all INCIDENT_TRENDS have positive incident counts', () => {
  for (const t of INCIDENT_TRENDS) {
    assert.ok(t.incidentCount > 0, `zero incidents for ${t.domain}`);
  }
});

test('all THREAT_GROUPS have valid threatLevel', () => {
  const valid: ThreatLevel[] = ['low', 'moderate', 'substantial', 'severe', 'critical'];
  for (const g of THREAT_GROUPS) {
    assert.ok(valid.includes(g.threatLevel), `invalid threatLevel for ${g.name}`);
  }
});
