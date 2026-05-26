/**
 * Tests for UrbanSecurityPanel — pure helper functions and static data.
 *
 * Run with: npx tsx --test tests/components/urban-security-panel.test.mts
 *
 * Pure-logic tests only; no DOM required.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  unrestTypeColor,
  unrestTypeLabel,
  unrestIntensityColor,
  unrestIntensityLabel,
  eventOutcomeColor,
  eventOutcomeLabel,
  territoryControlColor,
  territoryControlLabel,
  trendDirectionColor,
  trendDirectionLabel,
  incidentCategoryColor,
  incidentCategoryLabel,
  alertLevelColor,
  alertLevelLabel,
  violenceScoreColor,
  tensionScoreColor,
  tensionTrajectoryColor,
  tensionTrajectoryLabel,
  countHighIntensityHotspots,
  countNoGoZones,
  countHighAlertCities,
  countRisingTensionCities,
  countEscalatedEvents,
  UNREST_HOTSPOTS,
  PROTEST_EVENTS,
  GANG_TERRITORY_INDICATORS,
  URBAN_VIOLENCE_INDEX,
  POLICE_INCIDENT_FEEDS,
  SOCIAL_TENSION_SCORES,
  type UnrestType,
  type UnrestIntensity,
  type EventOutcome,
  type TerritoryControl,
  type TrendDirection,
  type IncidentCategory,
  type AlertLevel,
  type TensionTrajectory,
  type UnrestHotspot,
  type GangTerritoryIndicator,
  type PoliceIncidentFeed,
  type SocialTensionScore,
  type ProtestEvent,
} from '../../src/components/urban-security-helpers.ts';

// ── unrestTypeColor ───────────────────────────────────────────────────────

test('unrestTypeColor: siege returns red', () => {
  assert.ok(unrestTypeColor('siege').includes('#ef4444'));
});

test('unrestTypeColor: riot returns orange', () => {
  assert.ok(unrestTypeColor('riot').includes('#fb923c'));
});

test('unrestTypeColor: looting returns orange', () => {
  assert.ok(unrestTypeColor('looting').includes('#fb923c'));
});

test('unrestTypeColor: protest returns yellow', () => {
  assert.ok(unrestTypeColor('protest').includes('#facc15'));
});

test('unrestTypeColor: strike returns yellow', () => {
  assert.ok(unrestTypeColor('strike').includes('#facc15'));
});

test('unrestTypeColor: all types return non-empty strings', () => {
  const types: UnrestType[] = ['protest', 'riot', 'looting', 'strike', 'siege'];
  for (const t of types) assert.ok(unrestTypeColor(t).length > 0);
});

// ── unrestTypeLabel ───────────────────────────────────────────────────────

test('unrestTypeLabel: siege returns "Siege"', () => {
  assert.equal(unrestTypeLabel('siege'), 'Siege');
});

test('unrestTypeLabel: protest returns "Protest"', () => {
  assert.equal(unrestTypeLabel('protest'), 'Protest');
});

test('unrestTypeLabel: all types return non-empty strings', () => {
  const types: UnrestType[] = ['protest', 'riot', 'looting', 'strike', 'siege'];
  for (const t of types) assert.ok(unrestTypeLabel(t).length > 0);
});

// ── unrestIntensityColor ──────────────────────────────────────────────────

test('unrestIntensityColor: severe returns red', () => {
  assert.ok(unrestIntensityColor('severe').includes('#ef4444'));
});

test('unrestIntensityColor: high returns orange', () => {
  assert.ok(unrestIntensityColor('high').includes('#fb923c'));
});

test('unrestIntensityColor: moderate returns yellow', () => {
  assert.ok(unrestIntensityColor('moderate').includes('#facc15'));
});

test('unrestIntensityColor: low returns green', () => {
  assert.ok(unrestIntensityColor('low').includes('#4caf50'));
});

// ── unrestIntensityLabel ──────────────────────────────────────────────────

test('unrestIntensityLabel: severe returns "Severe"', () => {
  assert.equal(unrestIntensityLabel('severe'), 'Severe');
});

test('unrestIntensityLabel: all levels return non-empty strings', () => {
  const levels: UnrestIntensity[] = ['low', 'moderate', 'high', 'severe'];
  for (const i of levels) assert.ok(unrestIntensityLabel(i).length > 0);
});

// ── eventOutcomeColor ─────────────────────────────────────────────────────

test('eventOutcomeColor: escalated returns red', () => {
  assert.ok(eventOutcomeColor('escalated').includes('#ef4444'));
});

test('eventOutcomeColor: suppressed returns orange', () => {
  assert.ok(eventOutcomeColor('suppressed').includes('#fb923c'));
});

test('eventOutcomeColor: resolved returns green', () => {
  assert.ok(eventOutcomeColor('resolved').includes('#4caf50'));
});

test('eventOutcomeColor: ongoing returns yellow', () => {
  assert.ok(eventOutcomeColor('ongoing').includes('#facc15'));
});

test('eventOutcomeColor: dispersed returns yellow', () => {
  assert.ok(eventOutcomeColor('dispersed').includes('#facc15'));
});

test('eventOutcomeColor: all outcomes return non-empty strings', () => {
  const outcomes: EventOutcome[] = ['ongoing', 'dispersed', 'escalated', 'suppressed', 'resolved'];
  for (const o of outcomes) assert.ok(eventOutcomeColor(o).length > 0);
});

// ── eventOutcomeLabel ─────────────────────────────────────────────────────

test('eventOutcomeLabel: escalated returns "Escalated"', () => {
  assert.equal(eventOutcomeLabel('escalated'), 'Escalated');
});

test('eventOutcomeLabel: all outcomes return non-empty strings', () => {
  const outcomes: EventOutcome[] = ['ongoing', 'dispersed', 'escalated', 'suppressed', 'resolved'];
  for (const o of outcomes) assert.ok(eventOutcomeLabel(o).length > 0);
});

// ── territoryControlColor ─────────────────────────────────────────────────

test('territoryControlColor: no-go returns red', () => {
  assert.ok(territoryControlColor('no-go').includes('#ef4444'));
});

test('territoryControlColor: criminal returns red', () => {
  assert.ok(territoryControlColor('criminal').includes('#ef4444'));
});

test('territoryControlColor: contested returns orange', () => {
  assert.ok(territoryControlColor('contested').includes('#fb923c'));
});

test('territoryControlColor: fragmented returns yellow', () => {
  assert.ok(territoryControlColor('fragmented').includes('#facc15'));
});

test('territoryControlColor: state returns green', () => {
  assert.ok(territoryControlColor('state').includes('#4caf50'));
});

// ── territoryControlLabel ─────────────────────────────────────────────────

test('territoryControlLabel: no-go returns "No-Go Zone"', () => {
  assert.equal(territoryControlLabel('no-go'), 'No-Go Zone');
});

test('territoryControlLabel: criminal returns "Criminal Control"', () => {
  assert.equal(territoryControlLabel('criminal'), 'Criminal Control');
});

test('territoryControlLabel: all types return non-empty strings', () => {
  const types: TerritoryControl[] = ['state', 'contested', 'criminal', 'fragmented', 'no-go'];
  for (const c of types) assert.ok(territoryControlLabel(c).length > 0);
});

// ── trendDirectionColor ───────────────────────────────────────────────────

test('trendDirectionColor: deteriorating returns red', () => {
  assert.ok(trendDirectionColor('deteriorating').includes('#ef4444'));
});

test('trendDirectionColor: stable returns grey', () => {
  assert.ok(trendDirectionColor('stable').includes('#9e9e9e'));
});

test('trendDirectionColor: improving returns green', () => {
  assert.ok(trendDirectionColor('improving').includes('#4caf50'));
});

// ── trendDirectionLabel ───────────────────────────────────────────────────

test('trendDirectionLabel: deteriorating returns "Deteriorating"', () => {
  assert.equal(trendDirectionLabel('deteriorating'), 'Deteriorating');
});

test('trendDirectionLabel: all directions return non-empty strings', () => {
  const dirs: TrendDirection[] = ['improving', 'stable', 'deteriorating'];
  for (const d of dirs) assert.ok(trendDirectionLabel(d).length > 0);
});

// ── incidentCategoryColor ─────────────────────────────────────────────────

test('incidentCategoryColor: terrorism returns red', () => {
  assert.ok(incidentCategoryColor('terrorism').includes('#ef4444'));
});

test('incidentCategoryColor: violent-crime returns orange', () => {
  assert.ok(incidentCategoryColor('violent-crime').includes('#fb923c'));
});

test('incidentCategoryColor: civil-disorder returns orange', () => {
  assert.ok(incidentCategoryColor('civil-disorder').includes('#fb923c'));
});

test('incidentCategoryColor: trafficking returns yellow', () => {
  assert.ok(incidentCategoryColor('trafficking').includes('#facc15'));
});

test('incidentCategoryColor: property-crime returns green', () => {
  assert.ok(incidentCategoryColor('property-crime').includes('#4caf50'));
});

// ── incidentCategoryLabel ─────────────────────────────────────────────────

test('incidentCategoryLabel: terrorism returns "Terrorism"', () => {
  assert.equal(incidentCategoryLabel('terrorism'), 'Terrorism');
});

test('incidentCategoryLabel: violent-crime returns "Violent Crime"', () => {
  assert.equal(incidentCategoryLabel('violent-crime'), 'Violent Crime');
});

test('incidentCategoryLabel: all categories return non-empty strings', () => {
  const cats: IncidentCategory[] = [
    'violent-crime', 'property-crime', 'civil-disorder', 'terrorism', 'trafficking',
  ];
  for (const c of cats) assert.ok(incidentCategoryLabel(c).length > 0);
});

// ── alertLevelColor ───────────────────────────────────────────────────────

test('alertLevelColor: 4 returns red', () => {
  assert.ok(alertLevelColor(4).includes('#ef4444'));
});

test('alertLevelColor: 3 returns orange', () => {
  assert.ok(alertLevelColor(3).includes('#fb923c'));
});

test('alertLevelColor: 2 returns yellow', () => {
  assert.ok(alertLevelColor(2).includes('#facc15'));
});

test('alertLevelColor: 1 returns green', () => {
  assert.ok(alertLevelColor(1).includes('#4caf50'));
});

test('alertLevelColor: 0 returns grey', () => {
  assert.ok(alertLevelColor(0).includes('#9e9e9e'));
});

// ── alertLevelLabel ───────────────────────────────────────────────────────

test('alertLevelLabel: 4 returns "Critical"', () => {
  assert.equal(alertLevelLabel(4), 'Critical');
});

test('alertLevelLabel: 0 returns "None"', () => {
  assert.equal(alertLevelLabel(0), 'None');
});

test('alertLevelLabel: all levels return non-empty strings', () => {
  const levels: AlertLevel[] = [0, 1, 2, 3, 4];
  for (const l of levels) assert.ok(alertLevelLabel(l).length > 0);
});

// ── violenceScoreColor ────────────────────────────────────────────────────

test('violenceScoreColor: 9 returns red', () => {
  assert.ok(violenceScoreColor(9).includes('#ef4444'));
});

test('violenceScoreColor: 8 returns red', () => {
  assert.ok(violenceScoreColor(8).includes('#ef4444'));
});

test('violenceScoreColor: 7 returns orange', () => {
  assert.ok(violenceScoreColor(7).includes('#fb923c'));
});

test('violenceScoreColor: 6 returns orange', () => {
  assert.ok(violenceScoreColor(6).includes('#fb923c'));
});

test('violenceScoreColor: 5 returns yellow', () => {
  assert.ok(violenceScoreColor(5).includes('#facc15'));
});

test('violenceScoreColor: 3 returns green', () => {
  assert.ok(violenceScoreColor(3).includes('#4caf50'));
});

// ── tensionScoreColor ─────────────────────────────────────────────────────

test('tensionScoreColor: 8.1 returns red', () => {
  assert.ok(tensionScoreColor(8.1).includes('#ef4444'));
});

test('tensionScoreColor: 7.5 returns orange', () => {
  assert.ok(tensionScoreColor(7.5).includes('#fb923c'));
});

test('tensionScoreColor: 4.0 returns yellow', () => {
  assert.ok(tensionScoreColor(4).includes('#facc15'));
});

test('tensionScoreColor: 2.0 returns green', () => {
  assert.ok(tensionScoreColor(2).includes('#4caf50'));
});

// ── tensionTrajectoryColor ────────────────────────────────────────────────

test('tensionTrajectoryColor: rising returns red', () => {
  assert.ok(tensionTrajectoryColor('rising').includes('#ef4444'));
});

test('tensionTrajectoryColor: stable returns grey', () => {
  assert.ok(tensionTrajectoryColor('stable').includes('#9e9e9e'));
});

test('tensionTrajectoryColor: falling returns green', () => {
  assert.ok(tensionTrajectoryColor('falling').includes('#4caf50'));
});

// ── tensionTrajectoryLabel ────────────────────────────────────────────────

test('tensionTrajectoryLabel: rising returns "Rising"', () => {
  assert.equal(tensionTrajectoryLabel('rising'), 'Rising');
});

test('tensionTrajectoryLabel: all trajectories return non-empty strings', () => {
  const trajs: TensionTrajectory[] = ['rising', 'stable', 'falling'];
  for (const t of trajs) assert.ok(tensionTrajectoryLabel(t).length > 0);
});

// ── countHighIntensityHotspots ────────────────────────────────────────────

test('countHighIntensityHotspots: counts high and severe', () => {
  const spots: UnrestHotspot[] = [
    { city: 'A', country: 'X', unrestType: 'riot', intensity: 'severe', participants: 0, daysActive: 1, trigger: '' },
    { city: 'B', country: 'X', unrestType: 'protest', intensity: 'high', participants: 0, daysActive: 1, trigger: '' },
    { city: 'C', country: 'X', unrestType: 'strike', intensity: 'moderate', participants: 0, daysActive: 1, trigger: '' },
    { city: 'D', country: 'X', unrestType: 'protest', intensity: 'low', participants: 0, daysActive: 1, trigger: '' },
  ];
  assert.equal(countHighIntensityHotspots(spots), 2);
});

test('countHighIntensityHotspots: returns 0 for empty array', () => {
  assert.equal(countHighIntensityHotspots([]), 0);
});

// ── countNoGoZones ────────────────────────────────────────────────────────

test('countNoGoZones: counts no-go and criminal', () => {
  const territories: GangTerritoryIndicator[] = [
    { city: 'A', country: 'X', controlType: 'no-go', activeFactions: 5, homicidePer100k: 100, trend: 'deteriorating', factionNote: '' },
    { city: 'B', country: 'X', controlType: 'criminal', activeFactions: 3, homicidePer100k: 60, trend: 'stable', factionNote: '' },
    { city: 'C', country: 'X', controlType: 'contested', activeFactions: 2, homicidePer100k: 40, trend: 'stable', factionNote: '' },
    { city: 'D', country: 'X', controlType: 'state', activeFactions: 0, homicidePer100k: 5, trend: 'improving', factionNote: '' },
  ];
  assert.equal(countNoGoZones(territories), 2);
});

test('countNoGoZones: does not count contested', () => {
  const territories: GangTerritoryIndicator[] = [
    { city: 'A', country: 'X', controlType: 'contested', activeFactions: 2, homicidePer100k: 40, trend: 'stable', factionNote: '' },
  ];
  assert.equal(countNoGoZones(territories), 0);
});

// ── countHighAlertCities ──────────────────────────────────────────────────

test('countHighAlertCities: counts alertLevel >= 3', () => {
  const feeds: PoliceIncidentFeed[] = [
    { city: 'A', country: 'X', incidentCategory: 'violent-crime', dailyAverage: 100, hotspotDistrict: 'D1', alertLevel: 4 },
    { city: 'B', country: 'X', incidentCategory: 'civil-disorder', dailyAverage: 50, hotspotDistrict: 'D2', alertLevel: 3 },
    { city: 'C', country: 'X', incidentCategory: 'trafficking', dailyAverage: 20, hotspotDistrict: 'D3', alertLevel: 2 },
    { city: 'D', country: 'X', incidentCategory: 'property-crime', dailyAverage: 10, hotspotDistrict: 'D4', alertLevel: 1 },
  ];
  assert.equal(countHighAlertCities(feeds), 2);
});

test('countHighAlertCities: returns 0 when all below threshold', () => {
  const feeds: PoliceIncidentFeed[] = [
    { city: 'A', country: 'X', incidentCategory: 'trafficking', dailyAverage: 10, hotspotDistrict: 'D1', alertLevel: 2 },
  ];
  assert.equal(countHighAlertCities(feeds), 0);
});

// ── countRisingTensionCities ──────────────────────────────────────────────

test('countRisingTensionCities: counts only rising trajectory', () => {
  const scores: SocialTensionScore[] = [
    { metro: 'A', country: 'X', tensionScore: 8, trajectory: 'rising', drivers: [] },
    { metro: 'B', country: 'X', tensionScore: 7, trajectory: 'rising', drivers: [] },
    { metro: 'C', country: 'X', tensionScore: 6, trajectory: 'stable', drivers: [] },
    { metro: 'D', country: 'X', tensionScore: 5, trajectory: 'falling', drivers: [] },
  ];
  assert.equal(countRisingTensionCities(scores), 2);
});

// ── countEscalatedEvents ──────────────────────────────────────────────────

test('countEscalatedEvents: counts only escalated outcome', () => {
  const events: ProtestEvent[] = [
    { city: 'A', country: 'X', date: '', participants: 0, outcome: 'escalated', casualties: 2, description: '' },
    { city: 'B', country: 'X', date: '', participants: 0, outcome: 'dispersed', casualties: 0, description: '' },
    { city: 'C', country: 'X', date: '', participants: 0, outcome: 'escalated', casualties: 1, description: '' },
  ];
  assert.equal(countEscalatedEvents(events), 2);
});

test('countEscalatedEvents: returns 0 when none escalated', () => {
  const events: ProtestEvent[] = [
    { city: 'A', country: 'X', date: '', participants: 0, outcome: 'resolved', casualties: 0, description: '' },
  ];
  assert.equal(countEscalatedEvents(events), 0);
});

// ── Static data integrity ─────────────────────────────────────────────────

test('UNREST_HOTSPOTS has at least 6 entries', () => {
  assert.ok(UNREST_HOTSPOTS.length >= 6);
});

test('UNREST_HOTSPOTS: all cities are non-empty strings', () => {
  for (const h of UNREST_HOTSPOTS) assert.ok(h.city.length > 0);
});

test('UNREST_HOTSPOTS: all daysActive are positive', () => {
  for (const h of UNREST_HOTSPOTS) assert.ok(h.daysActive > 0);
});

test('PROTEST_EVENTS has at least 5 entries', () => {
  assert.ok(PROTEST_EVENTS.length >= 5);
});

test('PROTEST_EVENTS: all casualties are non-negative', () => {
  for (const e of PROTEST_EVENTS) assert.ok(e.casualties >= 0);
});

test('PROTEST_EVENTS: all participant counts are non-negative', () => {
  for (const e of PROTEST_EVENTS) assert.ok(e.participants >= 0);
});

test('GANG_TERRITORY_INDICATORS has at least 5 entries', () => {
  assert.ok(GANG_TERRITORY_INDICATORS.length >= 5);
});

test('GANG_TERRITORY_INDICATORS: all homicide rates are positive', () => {
  for (const g of GANG_TERRITORY_INDICATORS) assert.ok(g.homicidePer100k > 0);
});

test('GANG_TERRITORY_INDICATORS: all faction counts are positive', () => {
  for (const g of GANG_TERRITORY_INDICATORS) assert.ok(g.activeFactions > 0);
});

test('URBAN_VIOLENCE_INDEX has at least 6 entries', () => {
  assert.ok(URBAN_VIOLENCE_INDEX.length >= 6);
});

test('URBAN_VIOLENCE_INDEX: all scores are in range 0–10', () => {
  for (const v of URBAN_VIOLENCE_INDEX) {
    assert.ok(v.score >= 0 && v.score <= 10);
  }
});

test('URBAN_VIOLENCE_INDEX: all global ranks are positive', () => {
  for (const v of URBAN_VIOLENCE_INDEX) assert.ok(v.globalRank > 0);
});

test('POLICE_INCIDENT_FEEDS has at least 5 entries', () => {
  assert.ok(POLICE_INCIDENT_FEEDS.length >= 5);
});

test('POLICE_INCIDENT_FEEDS: all daily averages are positive', () => {
  for (const f of POLICE_INCIDENT_FEEDS) assert.ok(f.dailyAverage > 0);
});

test('POLICE_INCIDENT_FEEDS: all alert levels are in range 0–4', () => {
  for (const f of POLICE_INCIDENT_FEEDS) {
    assert.ok(f.alertLevel >= 0 && f.alertLevel <= 4);
  }
});

test('SOCIAL_TENSION_SCORES has at least 5 entries', () => {
  assert.ok(SOCIAL_TENSION_SCORES.length >= 5);
});

test('SOCIAL_TENSION_SCORES: all tension scores are in range 0–10', () => {
  for (const s of SOCIAL_TENSION_SCORES) {
    assert.ok(s.tensionScore >= 0 && s.tensionScore <= 10);
  }
});

test('SOCIAL_TENSION_SCORES: all entries have at least one driver', () => {
  for (const s of SOCIAL_TENSION_SCORES) assert.ok(s.drivers.length > 0);
});

// ── Static data: count helpers on real data ───────────────────────────────

test('UNREST_HOTSPOTS: at least 2 high/severe hotspots', () => {
  assert.ok(countHighIntensityHotspots(UNREST_HOTSPOTS) >= 2);
});

test('GANG_TERRITORY_INDICATORS: at least 1 no-go/criminal zone', () => {
  assert.ok(countNoGoZones(GANG_TERRITORY_INDICATORS) >= 1);
});

test('POLICE_INCIDENT_FEEDS: at least 2 high-alert cities', () => {
  assert.ok(countHighAlertCities(POLICE_INCIDENT_FEEDS) >= 2);
});

test('SOCIAL_TENSION_SCORES: at least 2 rising tension cities', () => {
  assert.ok(countRisingTensionCities(SOCIAL_TENSION_SCORES) >= 2);
});
