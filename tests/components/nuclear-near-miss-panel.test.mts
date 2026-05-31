/**
 * Tests for NuclearNearMissPanel — pure helper functions and static data.
 *
 * Run with: npx tsx --test tests/components/nuclear-near-miss-panel.test.mts
 *
 * Pure-logic tests only; no DOM required.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBySeverity,
  getByType,
  getHighRisk,
  computeHistoricalRiskScore,
  computeCurrentRiskScore,
  severityClass,
  riskLevelClass,
  buildRenderData,
  SEVERITY_ORDER,
  RISK_LEVEL_ORDER,
  NEAR_MISS_INCIDENTS,
  CURRENT_RISK_INDICATORS,
  NEAR_MISS_DATA,
  type NearMissIncident,
  type CurrentRiskIndicator,
  type Severity,
  type RiskLevel,
  type IncidentType,
} from '../../src/components/nuclear-near-miss-helpers.ts';

// ── severityClass ─────────────────────────────────────────────────────────

test('severityClass: Catastrophic Near-Miss returns nnm-sev-catastrophic', () => {
  assert.equal(severityClass('Catastrophic Near-Miss'), 'nnm-sev-catastrophic');
});

test('severityClass: Critical returns nnm-sev-critical', () => {
  assert.equal(severityClass('Critical'), 'nnm-sev-critical');
});

test('severityClass: Serious returns nnm-sev-serious', () => {
  assert.equal(severityClass('Serious'), 'nnm-sev-serious');
});

test('severityClass: all Severity values return non-empty strings', () => {
  const all: Severity[] = ['Catastrophic Near-Miss', 'Critical', 'Serious'];
  for (const s of all) {
    assert.ok(severityClass(s).length > 0);
  }
});

// ── riskLevelClass ────────────────────────────────────────────────────────

test('riskLevelClass: Critical returns nnm-risk-critical', () => {
  assert.equal(riskLevelClass('Critical'), 'nnm-risk-critical');
});

test('riskLevelClass: High returns nnm-risk-high', () => {
  assert.equal(riskLevelClass('High'), 'nnm-risk-high');
});

test('riskLevelClass: Elevated returns nnm-risk-elevated', () => {
  assert.equal(riskLevelClass('Elevated'), 'nnm-risk-elevated');
});

test('riskLevelClass: Normal returns nnm-risk-normal', () => {
  assert.equal(riskLevelClass('Normal'), 'nnm-risk-normal');
});

test('riskLevelClass: all RiskLevel values return non-empty strings', () => {
  const all: RiskLevel[] = ['Critical', 'High', 'Elevated', 'Normal'];
  for (const r of all) {
    assert.ok(riskLevelClass(r).length > 0);
  }
});

// ── getBySeverity ─────────────────────────────────────────────────────────

test('getBySeverity: filters to Catastrophic Near-Miss only', () => {
  const result = getBySeverity(NEAR_MISS_INCIDENTS, 'Catastrophic Near-Miss');
  assert.ok(result.length > 0);
  for (const inc of result) {
    assert.equal(inc.severity, 'Catastrophic Near-Miss');
  }
});

test('getBySeverity: filters to Critical only', () => {
  const result = getBySeverity(NEAR_MISS_INCIDENTS, 'Critical');
  assert.ok(result.length > 0);
  for (const inc of result) {
    assert.equal(inc.severity, 'Critical');
  }
});

test('getBySeverity: filters to Serious only', () => {
  const result = getBySeverity(NEAR_MISS_INCIDENTS, 'Serious');
  assert.ok(result.length > 0);
  for (const inc of result) {
    assert.equal(inc.severity, 'Serious');
  }
});

test('getBySeverity: all severity buckets together equal total incident count', () => {
  const catastrophic = getBySeverity(NEAR_MISS_INCIDENTS, 'Catastrophic Near-Miss').length;
  const critical = getBySeverity(NEAR_MISS_INCIDENTS, 'Critical').length;
  const serious = getBySeverity(NEAR_MISS_INCIDENTS, 'Serious').length;
  assert.equal(catastrophic + critical + serious, NEAR_MISS_INCIDENTS.length);
});

test('getBySeverity: empty input returns empty array', () => {
  assert.deepEqual(getBySeverity([], 'Critical'), []);
});

// ── getByType ─────────────────────────────────────────────────────────────

test('getByType: filters to False Alarm only', () => {
  const result = getByType(NEAR_MISS_INCIDENTS, 'False Alarm');
  assert.ok(result.length > 0);
  for (const inc of result) {
    assert.equal(inc.incidentType, 'False Alarm');
  }
});

test('getByType: filters to Accident only', () => {
  const result = getByType(NEAR_MISS_INCIDENTS, 'Accident');
  assert.ok(result.length > 0);
  for (const inc of result) {
    assert.equal(inc.incidentType, 'Accident');
  }
});

test('getByType: all IncidentType buckets together equal total incident count', () => {
  const types: IncidentType[] = [
    'False Alarm',
    'Unauthorized Action',
    'Miscommunication',
    'Technical Failure',
    'Command Confusion',
    'Accident',
  ];
  const total = types.reduce(
    (sum, t) => sum + getByType(NEAR_MISS_INCIDENTS, t).length,
    0,
  );
  assert.equal(total, NEAR_MISS_INCIDENTS.length);
});

test('getByType: empty input returns empty array', () => {
  assert.deepEqual(getByType([], 'False Alarm'), []);
});

// ── getHighRisk ───────────────────────────────────────────────────────────

test('getHighRisk: returns only High and Critical indicators', () => {
  const result = getHighRisk(CURRENT_RISK_INDICATORS);
  for (const ind of result) {
    assert.ok(ind.level === 'High' || ind.level === 'Critical');
  }
});

test('getHighRisk: result is non-empty for seed data', () => {
  assert.ok(getHighRisk(CURRENT_RISK_INDICATORS).length > 0);
});

test('getHighRisk: excludes Elevated and Normal', () => {
  const result = getHighRisk(CURRENT_RISK_INDICATORS);
  for (const ind of result) {
    assert.notEqual(ind.level, 'Elevated');
    assert.notEqual(ind.level, 'Normal');
  }
});

test('getHighRisk: empty input returns empty array', () => {
  assert.deepEqual(getHighRisk([]), []);
});

// ── computeHistoricalRiskScore ────────────────────────────────────────────

test('computeHistoricalRiskScore: empty array returns 0', () => {
  assert.equal(computeHistoricalRiskScore([]), 0);
});

test('computeHistoricalRiskScore: all-Catastrophic set returns 100', () => {
  const inc: NearMissIncident[] = [
    {
      id: 'x1', date: '1983-01-01', actors: ['A'],
      incidentType: 'False Alarm', severity: 'Catastrophic Near-Miss',
      howResolved: 'resolved', description: 'desc', lesson: 'lesson',
    },
    {
      id: 'x2', date: '1983-01-02', actors: ['B'],
      incidentType: 'False Alarm', severity: 'Catastrophic Near-Miss',
      howResolved: 'resolved', description: 'desc', lesson: 'lesson',
    },
  ];
  assert.equal(computeHistoricalRiskScore(inc), 100);
});

test('computeHistoricalRiskScore: all-Serious set returns 30', () => {
  const inc: NearMissIncident[] = [
    {
      id: 'y1', date: '2000-01-01', actors: ['A'],
      incidentType: 'Accident', severity: 'Serious',
      howResolved: 'resolved', description: 'desc', lesson: 'lesson',
    },
  ];
  assert.equal(computeHistoricalRiskScore(inc), 30);
});

test('computeHistoricalRiskScore: result is 0-100', () => {
  const score = computeHistoricalRiskScore(NEAR_MISS_INCIDENTS);
  assert.ok(score >= 0 && score <= 100);
});

test('computeHistoricalRiskScore: seed data score is non-trivial (> 0)', () => {
  assert.ok(computeHistoricalRiskScore(NEAR_MISS_INCIDENTS) > 0);
});

// ── computeCurrentRiskScore ───────────────────────────────────────────────

test('computeCurrentRiskScore: empty array returns 0', () => {
  assert.equal(computeCurrentRiskScore([]), 0);
});

test('computeCurrentRiskScore: all-Critical set returns 100', () => {
  const inds: CurrentRiskIndicator[] = [
    { id: 'c1', category: 'Test', indicator: 'X', level: 'Critical', description: 'd' },
    { id: 'c2', category: 'Test', indicator: 'Y', level: 'Critical', description: 'd' },
  ];
  assert.equal(computeCurrentRiskScore(inds), 100);
});

test('computeCurrentRiskScore: all-Normal set returns 10', () => {
  const inds: CurrentRiskIndicator[] = [
    { id: 'n1', category: 'Test', indicator: 'Z', level: 'Normal', description: 'd' },
  ];
  assert.equal(computeCurrentRiskScore(inds), 10);
});

test('computeCurrentRiskScore: result is 0-100 for seed data', () => {
  const score = computeCurrentRiskScore(CURRENT_RISK_INDICATORS);
  assert.ok(score >= 0 && score <= 100);
});

// ── SEVERITY_ORDER ────────────────────────────────────────────────────────

test('SEVERITY_ORDER: Catastrophic > Critical > Serious', () => {
  assert.ok(SEVERITY_ORDER['Catastrophic Near-Miss'] > SEVERITY_ORDER['Critical']);
  assert.ok(SEVERITY_ORDER['Critical'] > SEVERITY_ORDER['Serious']);
});

// ── RISK_LEVEL_ORDER ──────────────────────────────────────────────────────

test('RISK_LEVEL_ORDER: Critical > High > Elevated > Normal', () => {
  assert.ok(RISK_LEVEL_ORDER['Critical'] > RISK_LEVEL_ORDER['High']);
  assert.ok(RISK_LEVEL_ORDER['High'] > RISK_LEVEL_ORDER['Elevated']);
  assert.ok(RISK_LEVEL_ORDER['Elevated'] > RISK_LEVEL_ORDER['Normal']);
});

// ── buildRenderData ───────────────────────────────────────────────────────

test('buildRenderData: incidents are sorted most-severe first', () => {
  const rd = buildRenderData(NEAR_MISS_DATA);
  for (let i = 1; i < rd.incidents.length; i++) {
    assert.ok(
      SEVERITY_ORDER[rd.incidents[i - 1].severity] >=
        SEVERITY_ORDER[rd.incidents[i].severity],
    );
  }
});

test('buildRenderData: currentIndicators sorted most-risky first', () => {
  const rd = buildRenderData(NEAR_MISS_DATA);
  for (let i = 1; i < rd.currentIndicators.length; i++) {
    assert.ok(
      RISK_LEVEL_ORDER[rd.currentIndicators[i - 1].level] >=
        RISK_LEVEL_ORDER[rd.currentIndicators[i].level],
    );
  }
});

test('buildRenderData: catastrophicCount matches getBySeverity count', () => {
  const rd = buildRenderData(NEAR_MISS_DATA);
  assert.equal(rd.catastrophicCount, getBySeverity(NEAR_MISS_INCIDENTS, 'Catastrophic Near-Miss').length);
});

test('buildRenderData: criticalIndicatorCount matches getHighRisk count', () => {
  const rd = buildRenderData(NEAR_MISS_DATA);
  assert.equal(rd.criticalIndicatorCount, getHighRisk(CURRENT_RISK_INDICATORS).length);
});

test('buildRenderData: passes through scores and metadata unchanged', () => {
  const rd = buildRenderData(NEAR_MISS_DATA);
  assert.equal(rd.historicalRiskScore, NEAR_MISS_DATA.historicalRiskScore);
  assert.equal(rd.currentRiskScore, NEAR_MISS_DATA.currentRiskScore);
  assert.equal(rd.mostDangerousDecade, NEAR_MISS_DATA.mostDangerousDecade);
  assert.equal(rd.doomsday_clock_minutes, NEAR_MISS_DATA.doomsday_clock_minutes);
});

test('buildRenderData: does not mutate original incidents array', () => {
  const originalOrder = NEAR_MISS_DATA.incidents.map((i) => i.id);
  buildRenderData(NEAR_MISS_DATA);
  assert.deepEqual(
    NEAR_MISS_DATA.incidents.map((i) => i.id),
    originalOrder,
  );
});

// ── Seed data invariants ──────────────────────────────────────────────────

test('NEAR_MISS_INCIDENTS: exactly 12 incidents', () => {
  assert.equal(NEAR_MISS_INCIDENTS.length, 12);
});

test('NEAR_MISS_INCIDENTS: all ids are unique', () => {
  const ids = NEAR_MISS_INCIDENTS.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('NEAR_MISS_INCIDENTS: all dates are valid ISO-8601 format YYYY-MM-DD', () => {
  for (const inc of NEAR_MISS_INCIDENTS) {
    assert.match(inc.date, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('NEAR_MISS_INCIDENTS: every incident has at least one actor', () => {
  for (const inc of NEAR_MISS_INCIDENTS) {
    assert.ok(inc.actors.length > 0);
  }
});

test('NEAR_MISS_INCIDENTS: every incident has non-empty description', () => {
  for (const inc of NEAR_MISS_INCIDENTS) {
    assert.ok(inc.description.length > 0);
  }
});

test('NEAR_MISS_INCIDENTS: every incident has non-empty lesson', () => {
  for (const inc of NEAR_MISS_INCIDENTS) {
    assert.ok(inc.lesson.length > 0);
  }
});

test('NEAR_MISS_INCIDENTS: every incident has non-empty howResolved', () => {
  for (const inc of NEAR_MISS_INCIDENTS) {
    assert.ok(inc.howResolved.length > 0);
  }
});

test('NEAR_MISS_INCIDENTS: petrov-1983 is Catastrophic Near-Miss False Alarm', () => {
  const petrov = NEAR_MISS_INCIDENTS.find((i) => i.id === 'petrov-1983');
  assert.ok(petrov);
  assert.equal(petrov!.severity, 'Catastrophic Near-Miss');
  assert.equal(petrov!.incidentType, 'False Alarm');
});

test('NEAR_MISS_INCIDENTS: arkhipov-1962 has timeToLaunch', () => {
  const ark = NEAR_MISS_INCIDENTS.find((i) => i.id === 'arkhipov-1962');
  assert.ok(ark);
  assert.ok(ark!.timeToLaunch !== undefined && ark!.timeToLaunch.length > 0);
});

test('NEAR_MISS_INCIDENTS: goldsboro-1961 is an Accident', () => {
  const g = NEAR_MISS_INCIDENTS.find((i) => i.id === 'goldsboro-1961');
  assert.ok(g);
  assert.equal(g!.incidentType, 'Accident');
});

test('NEAR_MISS_INCIDENTS: norwegian-rocket-1995 actors include Russia', () => {
  const n = NEAR_MISS_INCIDENTS.find((i) => i.id === 'norwegian-rocket-1995');
  assert.ok(n);
  assert.ok(n!.actors.includes('Russia'));
});

test('CURRENT_RISK_INDICATORS: exactly 8 indicators', () => {
  assert.equal(CURRENT_RISK_INDICATORS.length, 8);
});

test('CURRENT_RISK_INDICATORS: all ids are unique', () => {
  const ids = CURRENT_RISK_INDICATORS.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('CURRENT_RISK_INDICATORS: every indicator has non-empty description', () => {
  for (const ind of CURRENT_RISK_INDICATORS) {
    assert.ok(ind.description.length > 0);
  }
});

test('CURRENT_RISK_INDICATORS: every indicator has non-empty category', () => {
  for (const ind of CURRENT_RISK_INDICATORS) {
    assert.ok(ind.category.length > 0);
  }
});

test('CURRENT_RISK_INDICATORS: new-start indicator is Critical', () => {
  const ns = CURRENT_RISK_INDICATORS.find((i) => i.id === 'new-start');
  assert.ok(ns);
  assert.equal(ns!.level, 'Critical');
});

test('CURRENT_RISK_INDICATORS: nuclear-terrorism indicator is Normal', () => {
  const nt = CURRENT_RISK_INDICATORS.find((i) => i.id === 'nuclear-terrorism');
  assert.ok(nt);
  assert.equal(nt!.level, 'Normal');
});

test('NEAR_MISS_DATA: currentRiskScore is 72', () => {
  assert.equal(NEAR_MISS_DATA.currentRiskScore, 72);
});

test('NEAR_MISS_DATA: doomsday_clock_minutes is 90', () => {
  assert.equal(NEAR_MISS_DATA.doomsday_clock_minutes, 90);
});

test('NEAR_MISS_DATA: mostDangerousDecade is 1980s', () => {
  assert.equal(NEAR_MISS_DATA.mostDangerousDecade, '1980s');
});

test('NEAR_MISS_DATA: historicalRiskScore matches computeHistoricalRiskScore', () => {
  const computed = computeHistoricalRiskScore(NEAR_MISS_INCIDENTS);
  assert.equal(NEAR_MISS_DATA.historicalRiskScore, computed);
});
