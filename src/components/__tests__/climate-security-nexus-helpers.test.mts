import assert from 'node:assert/strict';
import test from 'node:test';

import {
  stressLevelColor,
  stressLevelLabel,
  causalChainLabel,
  eventStatusColor,
  eventStatusLabel,
  migrationTriggerLabel,
  adaptationStatusColor,
  adaptationStatusLabel,
  carbonDependencyColor,
  carbonDependencyLabel,
  installationRiskColor,
  installationRiskLabel,
  nexusStressLevel,
  carbonDependencyTier,
  installationRiskTier,
  sortByPopulationDesc,
  sortByMigrantCountDesc,
  sortByAmplificationDesc,
  sortByFundingGapDesc,
  sortByFragilityDesc,
  countEscalatingConflicts,
  countCriticalNexusRegions,
  countHighMigrationFlows,
  countAmplifiedConflicts,
  countFailingAdaptationPrograms,
  countExtremeCarbonDependents,
  countCriticalSeaLevelInstallations,
  renderConflictEventsSection,
  renderNexusStressSection,
  renderMigrationSection,
  renderWeatherAmplificationSection,
  renderAdaptationFailureSection,
  renderCarbonStateSection,
  renderSeaLevelInstallationsSection,
  CLIMATE_CONFLICT_EVENTS,
  NEXUS_STRESS_SCORES,
  MIGRATION_PRESSURES,
  WEATHER_AMPLIFICATIONS,
  ADAPTATION_FAILURES,
  CARBON_STATE_FRAGILITY,
  SEA_LEVEL_INSTALLATIONS,
  type StressLevel,
  type ClimateConflictEvent,
  type NexusStressScore,
  type MigrationPressure,
  type WeatherAmplifiedConflict,
  type AdaptationFailureSignal,
  type CarbonStateFragility,
  type SeaLevelInstallationRisk,
} from '../climate-security-nexus-helpers.ts';

// ── stressLevelColor ────────────────────────────────────────────────────────

test('stressLevelColor covers every StressLevel', () => {
  const levels: StressLevel[] = ['low', 'moderate', 'high', 'severe', 'critical'];
  for (const l of levels) {
    const c = stressLevelColor(l);
    assert.ok(c.startsWith('var(') || c.startsWith('#'), `unexpected color for ${l}: ${c}`);
  }
});

test('stressLevelColor critical is red', () => {
  assert.match(stressLevelColor('critical'), /ef4444/);
});

test('stressLevelColor low is green', () => {
  assert.match(stressLevelColor('low'), /22c55e/);
});

// ── stressLevelLabel ────────────────────────────────────────────────────────

test('stressLevelLabel returns capitalized human labels', () => {
  assert.equal(stressLevelLabel('low'), 'Low');
  assert.equal(stressLevelLabel('moderate'), 'Moderate');
  assert.equal(stressLevelLabel('high'), 'High');
  assert.equal(stressLevelLabel('severe'), 'Severe');
  assert.equal(stressLevelLabel('critical'), 'Critical');
});

// ── causalChainLabel ────────────────────────────────────────────────────────

test('causalChainLabel covers all five chain kinds', () => {
  assert.match(causalChainLabel('drought_unrest'), /Drought/);
  assert.match(causalChainLabel('flood_displacement_conflict'), /Flood/);
  assert.match(causalChainLabel('heat_food_riot'), /Heat/);
  assert.match(causalChainLabel('storm_governance_collapse'), /Storm/);
  assert.match(causalChainLabel('wildfire_grievance'), /Wildfire/);
});

// ── eventStatusColor / eventStatusLabel ────────────────────────────────────

test('eventStatusColor escalating is red', () => {
  assert.match(eventStatusColor('escalating'), /ef4444/);
});

test('eventStatusColor resolved is muted', () => {
  assert.match(eventStatusColor('resolved'), /9e9e9e/);
});

test('eventStatusLabel covers all five statuses', () => {
  assert.equal(eventStatusLabel('emerging'), 'Emerging');
  assert.equal(eventStatusLabel('ongoing'), 'Ongoing');
  assert.equal(eventStatusLabel('escalating'), 'Escalating');
  assert.equal(eventStatusLabel('subsiding'), 'Subsiding');
  assert.equal(eventStatusLabel('resolved'), 'Resolved');
});

// ── migrationTriggerLabel ───────────────────────────────────────────────────

test('migrationTriggerLabel covers all six triggers', () => {
  assert.equal(migrationTriggerLabel('drought'), 'Drought');
  assert.equal(migrationTriggerLabel('flooding'), 'Flooding');
  assert.equal(migrationTriggerLabel('sea_level_rise'), 'Sea level rise');
  assert.equal(migrationTriggerLabel('crop_failure'), 'Crop failure');
  assert.equal(migrationTriggerLabel('cyclone'), 'Cyclone');
  assert.equal(migrationTriggerLabel('water_scarcity'), 'Water scarcity');
});

// ── adaptationStatusColor / adaptationStatusLabel ──────────────────────────

test('adaptationStatusColor on_track is green', () => {
  assert.match(adaptationStatusColor('on_track'), /22c55e/);
});

test('adaptationStatusColor reversed is red', () => {
  assert.match(adaptationStatusColor('reversed'), /ef4444/);
});

test('adaptationStatusLabel covers all five statuses', () => {
  assert.equal(adaptationStatusLabel('on_track'), 'On track');
  assert.equal(adaptationStatusLabel('lagging'), 'Lagging');
  assert.equal(adaptationStatusLabel('failing'), 'Failing');
  assert.equal(adaptationStatusLabel('reversed'), 'Reversed');
  assert.equal(adaptationStatusLabel('unfunded'), 'Unfunded');
});

// ── carbonDependencyColor / carbonDependencyLabel ──────────────────────────

test('carbonDependencyColor extreme is red', () => {
  assert.match(carbonDependencyColor('extreme'), /ef4444/);
});

test('carbonDependencyColor low is green', () => {
  assert.match(carbonDependencyColor('low'), /22c55e/);
});

test('carbonDependencyLabel covers all four tiers', () => {
  assert.equal(carbonDependencyLabel('low'), 'Low');
  assert.equal(carbonDependencyLabel('medium'), 'Medium');
  assert.equal(carbonDependencyLabel('high'), 'High');
  assert.equal(carbonDependencyLabel('extreme'), 'Extreme');
});

// ── installationRiskColor / installationRiskLabel ──────────────────────────

test('installationRiskColor critical is red', () => {
  assert.match(installationRiskColor('critical'), /ef4444/);
});

test('installationRiskLabel covers all four tiers', () => {
  assert.equal(installationRiskLabel('low'), 'Low');
  assert.equal(installationRiskLabel('medium'), 'Medium');
  assert.equal(installationRiskLabel('high'), 'High');
  assert.equal(installationRiskLabel('critical'), 'Critical');
});

// ── nexusStressLevel ────────────────────────────────────────────────────────

test('nexusStressLevel returns critical at avg ≥ 80', () => {
  assert.equal(nexusStressLevel(85, 82, 80), 'critical');
});

test('nexusStressLevel returns severe at avg ≥ 65 and < 80', () => {
  assert.equal(nexusStressLevel(70, 65, 65), 'severe');
});

test('nexusStressLevel returns high at avg ≥ 50 and < 65', () => {
  assert.equal(nexusStressLevel(50, 55, 50), 'high');
});

test('nexusStressLevel returns moderate at avg ≥ 30 and < 50', () => {
  assert.equal(nexusStressLevel(30, 35, 30), 'moderate');
});

test('nexusStressLevel returns low below 30', () => {
  assert.equal(nexusStressLevel(10, 5, 20), 'low');
});

test('nexusStressLevel boundary: avg exactly 50 → high', () => {
  assert.equal(nexusStressLevel(50, 50, 50), 'high');
});

// ── carbonDependencyTier ────────────────────────────────────────────────────

test('carbonDependencyTier extreme at ≥ 60', () => {
  assert.equal(carbonDependencyTier(60), 'extreme');
  assert.equal(carbonDependencyTier(90), 'extreme');
});

test('carbonDependencyTier high at ≥ 40 and < 60', () => {
  assert.equal(carbonDependencyTier(40), 'high');
  assert.equal(carbonDependencyTier(59), 'high');
});

test('carbonDependencyTier medium at ≥ 20 and < 40', () => {
  assert.equal(carbonDependencyTier(20), 'medium');
  assert.equal(carbonDependencyTier(39), 'medium');
});

test('carbonDependencyTier low below 20', () => {
  assert.equal(carbonDependencyTier(0), 'low');
  assert.equal(carbonDependencyTier(19), 'low');
});

// ── installationRiskTier ────────────────────────────────────────────────────

test('installationRiskTier returns low when decadalRiseMm is 0', () => {
  assert.equal(installationRiskTier(5, 0), 'low');
});

test('installationRiskTier critical when inundation ≤ 25 years', () => {
  // 1 m elevation, 400 mm/decade → years = (1000/400)*10 = 25 years
  assert.equal(installationRiskTier(1.0, 400), 'critical');
});

test('installationRiskTier high when inundation 25–50 years', () => {
  // 2 m elevation, 80 mm/decade → years = (2000/80)*10 = 250? No.
  // years = (elev * 1000) / decadalRiseMm * 10
  // For high: 25 < years ≤ 50
  // years = (e*1000/d)*10 = 26 → e=1, d=384.6; let's use e=1, d=200 → years=50 → high
  assert.equal(installationRiskTier(1.0, 200), 'high');
});

test('installationRiskTier medium when inundation 50–100 years', () => {
  // e=1, d=100 → years=(1000/100)*10=100 → medium boundary
  assert.equal(installationRiskTier(1.0, 100), 'medium');
});

test('installationRiskTier low when inundation > 100 years', () => {
  // e=10, d=5 → years=(10000/5)*10=20000 → low
  assert.equal(installationRiskTier(10, 5), 'low');
});

// ── sort comparators ────────────────────────────────────────────────────────

test('sortByPopulationDesc orders by populationAffectedMillions descending', () => {
  const a: ClimateConflictEvent = { region: 'A', trigger: 't', chain: 'drought_unrest', populationAffectedMillions: 5, status: 'ongoing', evidence: '' };
  const b: ClimateConflictEvent = { region: 'B', trigger: 't', chain: 'drought_unrest', populationAffectedMillions: 20, status: 'ongoing', evidence: '' };
  const sorted = [a, b].sort(sortByPopulationDesc);
  assert.equal(sorted[0]!.region, 'B');
});

test('sortByMigrantCountDesc orders by estimatedMigrantsThousands descending', () => {
  const a: MigrationPressure = { origin: 'A', destinationRegion: 'X', trigger: 'drought', estimatedMigrantsThousands: 100, level: 'high', notes: '' };
  const b: MigrationPressure = { origin: 'B', destinationRegion: 'Y', trigger: 'flooding', estimatedMigrantsThousands: 500, level: 'critical', notes: '' };
  const sorted = [a, b].sort(sortByMigrantCountDesc);
  assert.equal(sorted[0]!.origin, 'B');
});

test('sortByAmplificationDesc orders by amplificationFactor descending', () => {
  const a: WeatherAmplifiedConflict = { region: 'A', hazard: 'h', preexistingConflict: 'c', amplificationFactor: 1.2, status: 'ongoing', notes: '' };
  const b: WeatherAmplifiedConflict = { region: 'B', hazard: 'h', preexistingConflict: 'c', amplificationFactor: 1.9, status: 'escalating', notes: '' };
  const sorted = [a, b].sort(sortByAmplificationDesc);
  assert.equal(sorted[0]!.region, 'B');
});

test('sortByFundingGapDesc orders by fundingGapMillions descending', () => {
  const a: AdaptationFailureSignal = { country: 'A', programArea: 'p', status: 'failing', fundingGapMillions: 200, notes: '' };
  const b: AdaptationFailureSignal = { country: 'B', programArea: 'p', status: 'unfunded', fundingGapMillions: 800, notes: '' };
  const sorted = [a, b].sort(sortByFundingGapDesc);
  assert.equal(sorted[0]!.country, 'B');
});

test('sortByFragilityDesc orders by fragilityIndex descending', () => {
  const a: CarbonStateFragility = { country: 'A', hydrocarbonRevenueSharePct: 50, fragilityIndex: 40, dependencyTier: 'high', notes: '' };
  const b: CarbonStateFragility = { country: 'B', hydrocarbonRevenueSharePct: 80, fragilityIndex: 90, dependencyTier: 'extreme', notes: '' };
  const sorted = [a, b].sort(sortByFragilityDesc);
  assert.equal(sorted[0]!.country, 'B');
});

// ── count helpers ───────────────────────────────────────────────────────────

test('countEscalatingConflicts counts escalating and ongoing', () => {
  const rows: ClimateConflictEvent[] = [
    { region: 'A', trigger: 't', chain: 'drought_unrest', populationAffectedMillions: 1, status: 'escalating', evidence: '' },
    { region: 'B', trigger: 't', chain: 'drought_unrest', populationAffectedMillions: 1, status: 'ongoing', evidence: '' },
    { region: 'C', trigger: 't', chain: 'drought_unrest', populationAffectedMillions: 1, status: 'resolved', evidence: '' },
  ];
  assert.equal(countEscalatingConflicts(rows), 2);
});

test('countEscalatingConflicts returns 0 for empty array', () => {
  assert.equal(countEscalatingConflicts([]), 0);
});

test('countCriticalNexusRegions counts critical and severe', () => {
  const rows: NexusStressScore[] = [
    { region: 'A', waterStress: 90, foodStress: 85, energyStress: 80, level: 'critical', notes: '' },
    { region: 'B', waterStress: 70, foodStress: 65, energyStress: 66, level: 'severe', notes: '' },
    { region: 'C', waterStress: 50, foodStress: 45, energyStress: 40, level: 'high', notes: '' },
  ];
  assert.equal(countCriticalNexusRegions(rows), 2);
});

test('countHighMigrationFlows counts critical and severe levels', () => {
  const rows: MigrationPressure[] = [
    { origin: 'A', destinationRegion: 'X', trigger: 'drought', estimatedMigrantsThousands: 500, level: 'critical', notes: '' },
    { origin: 'B', destinationRegion: 'Y', trigger: 'flooding', estimatedMigrantsThousands: 200, level: 'severe', notes: '' },
    { origin: 'C', destinationRegion: 'Z', trigger: 'cyclone', estimatedMigrantsThousands: 20, level: 'moderate', notes: '' },
  ];
  assert.equal(countHighMigrationFlows(rows), 2);
});

test('countAmplifiedConflicts counts rows with factor ≥ 1.5', () => {
  const rows: WeatherAmplifiedConflict[] = [
    { region: 'A', hazard: 'h', preexistingConflict: 'c', amplificationFactor: 1.5, status: 'ongoing', notes: '' },
    { region: 'B', hazard: 'h', preexistingConflict: 'c', amplificationFactor: 1.4, status: 'ongoing', notes: '' },
    { region: 'C', hazard: 'h', preexistingConflict: 'c', amplificationFactor: 2.0, status: 'escalating', notes: '' },
  ];
  assert.equal(countAmplifiedConflicts(rows), 2);
});

test('countFailingAdaptationPrograms counts failing, reversed, unfunded', () => {
  const rows: AdaptationFailureSignal[] = [
    { country: 'A', programArea: 'p', status: 'failing', fundingGapMillions: 100, notes: '' },
    { country: 'B', programArea: 'p', status: 'reversed', fundingGapMillions: 200, notes: '' },
    { country: 'C', programArea: 'p', status: 'unfunded', fundingGapMillions: 50, notes: '' },
    { country: 'D', programArea: 'p', status: 'lagging', fundingGapMillions: 30, notes: '' },
    { country: 'E', programArea: 'p', status: 'on_track', fundingGapMillions: 0, notes: '' },
  ];
  assert.equal(countFailingAdaptationPrograms(rows), 3);
});

test('countExtremeCarbonDependents counts extreme and high tiers', () => {
  const rows: CarbonStateFragility[] = [
    { country: 'A', hydrocarbonRevenueSharePct: 90, fragilityIndex: 88, dependencyTier: 'extreme', notes: '' },
    { country: 'B', hydrocarbonRevenueSharePct: 55, fragilityIndex: 70, dependencyTier: 'high', notes: '' },
    { country: 'C', hydrocarbonRevenueSharePct: 25, fragilityIndex: 40, dependencyTier: 'medium', notes: '' },
  ];
  assert.equal(countExtremeCarbonDependents(rows), 2);
});

test('countCriticalSeaLevelInstallations counts critical and high risk tiers', () => {
  const rows: SeaLevelInstallationRisk[] = [
    { installation: 'A', branch: 'Navy', meanElevationMeters: 1.5, decadalRiseMm: 50, risk: 'critical', notes: '' },
    { installation: 'B', branch: 'Navy', meanElevationMeters: 4.0, decadalRiseMm: 35, risk: 'high', notes: '' },
    { installation: 'C', branch: 'Air Force', meanElevationMeters: 8.0, decadalRiseMm: 30, risk: 'medium', notes: '' },
  ];
  assert.equal(countCriticalSeaLevelInstallations(rows), 2);
});

// ── render functions ────────────────────────────────────────────────────────

test('renderConflictEventsSection returns div with data-section attribute', () => {
  const html = renderConflictEventsSection(CLIMATE_CONFLICT_EVENTS.slice(0, 2));
  assert.match(html, /data-section="climate-conflict"/);
});

test('renderConflictEventsSection shows empty message for empty array', () => {
  const html = renderConflictEventsSection([]);
  assert.match(html, /No active climate-conflict events/);
});

test('renderConflictEventsSection escapes XSS in region names', () => {
  const row: ClimateConflictEvent = {
    region: '<script>alert(1)</script>',
    trigger: 'flood',
    chain: 'drought_unrest',
    populationAffectedMillions: 1,
    status: 'ongoing',
    evidence: 'safe',
  };
  const html = renderConflictEventsSection([row]);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('renderNexusStressSection returns div with data-section attribute', () => {
  const html = renderNexusStressSection(NEXUS_STRESS_SCORES.slice(0, 2));
  assert.match(html, /data-section="nexus-stress"/);
});

test('renderNexusStressSection shows empty message for empty array', () => {
  const html = renderNexusStressSection([]);
  assert.match(html, /No nexus stress data/);
});

test('renderMigrationSection renders M suffix for migrants ≥ 1M', () => {
  const row: MigrationPressure = {
    origin: 'Region X',
    destinationRegion: 'North',
    trigger: 'flooding',
    estimatedMigrantsThousands: 1500, // 1.5M
    level: 'critical',
    notes: 'test',
  };
  const html = renderMigrationSection([row]);
  assert.match(html, /1\.5M/);
});

test('renderMigrationSection renders K suffix for migrants < 1M', () => {
  const row: MigrationPressure = {
    origin: 'Region Y',
    destinationRegion: 'South',
    trigger: 'drought',
    estimatedMigrantsThousands: 250,
    level: 'high',
    notes: 'test',
  };
  const html = renderMigrationSection([row]);
  assert.match(html, /250K/);
});

test('renderMigrationSection shows empty message for empty array', () => {
  const html = renderMigrationSection([]);
  assert.match(html, /No active migration flows tracked/);
});

test('renderWeatherAmplificationSection shows amplification factor', () => {
  const row: WeatherAmplifiedConflict = {
    region: 'Sudan',
    hazard: 'Heat dome',
    preexistingConflict: 'Civil war',
    amplificationFactor: 1.8,
    status: 'escalating',
    notes: 'test',
  };
  const html = renderWeatherAmplificationSection([row]);
  assert.match(html, /1\.8×/);
});

test('renderWeatherAmplificationSection shows empty message for empty array', () => {
  const html = renderWeatherAmplificationSection([]);
  assert.match(html, /No weather-amplified conflicts tracked/);
});

test('renderAdaptationFailureSection renders B suffix for funding gap ≥ 1B', () => {
  const row: AdaptationFailureSignal = {
    country: 'TestCountry',
    programArea: 'Flood adaptation',
    status: 'failing',
    fundingGapMillions: 2500,
    notes: 'test',
  };
  const html = renderAdaptationFailureSection([row]);
  assert.match(html, /2\.5B gap/);
});

test('renderAdaptationFailureSection renders M suffix for funding gap < 1B', () => {
  const row: AdaptationFailureSignal = {
    country: 'SmallCountry',
    programArea: 'Cyclone prep',
    status: 'unfunded',
    fundingGapMillions: 350,
    notes: 'test',
  };
  const html = renderAdaptationFailureSection([row]);
  assert.match(html, /350M gap/);
});

test('renderAdaptationFailureSection shows empty message for empty array', () => {
  const html = renderAdaptationFailureSection([]);
  assert.match(html, /No adaptation failure signals/);
});

test('renderCarbonStateSection shows hydrocarbon revenue percentage', () => {
  const row: CarbonStateFragility = {
    country: 'Ruritania',
    hydrocarbonRevenueSharePct: 78,
    fragilityIndex: 81,
    dependencyTier: 'high',
    notes: 'test',
  };
  const html = renderCarbonStateSection([row]);
  assert.match(html, /78%/);
});

test('renderCarbonStateSection shows empty message for empty array', () => {
  const html = renderCarbonStateSection([]);
  assert.match(html, /No carbon-dependent states tracked/);
});

test('renderSeaLevelInstallationsSection shows elevation and rise rate', () => {
  const row: SeaLevelInstallationRisk = {
    installation: 'Test Base',
    branch: 'Navy',
    meanElevationMeters: 3.0,
    decadalRiseMm: 50,
    risk: 'critical',
    notes: 'test',
  };
  const html = renderSeaLevelInstallationsSection([row]);
  assert.match(html, /3\.0 m/);
  assert.match(html, /50 mm\/decade/);
});

test('renderSeaLevelInstallationsSection shows empty message for empty array', () => {
  const html = renderSeaLevelInstallationsSection([]);
  assert.match(html, /No installation risk data/);
});

// ── static reference data integrity ─────────────────────────────────────────

test('CLIMATE_CONFLICT_EVENTS has at least 5 entries', () => {
  assert.ok(CLIMATE_CONFLICT_EVENTS.length >= 5);
});

test('NEXUS_STRESS_SCORES has at least 5 entries', () => {
  assert.ok(NEXUS_STRESS_SCORES.length >= 5);
});

test('MIGRATION_PRESSURES has at least 5 entries', () => {
  assert.ok(MIGRATION_PRESSURES.length >= 5);
});

test('WEATHER_AMPLIFICATIONS has at least 5 entries', () => {
  assert.ok(WEATHER_AMPLIFICATIONS.length >= 5);
});

test('ADAPTATION_FAILURES has at least 5 entries', () => {
  assert.ok(ADAPTATION_FAILURES.length >= 5);
});

test('CARBON_STATE_FRAGILITY has at least 5 entries', () => {
  assert.ok(CARBON_STATE_FRAGILITY.length >= 5);
});

test('SEA_LEVEL_INSTALLATIONS has at least 5 entries', () => {
  assert.ok(SEA_LEVEL_INSTALLATIONS.length >= 5);
});

test('CARBON_STATE_FRAGILITY every row has a valid dependencyTier', () => {
  const validTiers = new Set(['low', 'medium', 'high', 'extreme']);
  for (const row of CARBON_STATE_FRAGILITY) {
    assert.ok(
      validTiers.has(row.dependencyTier),
      `${row.country}: unexpected dependencyTier "${row.dependencyTier}"`,
    );
  }
});

test('NEXUS_STRESS_SCORES every row has a valid StressLevel', () => {
  const validLevels = new Set(['low', 'moderate', 'high', 'severe', 'critical']);
  for (const row of NEXUS_STRESS_SCORES) {
    assert.ok(
      validLevels.has(row.level),
      `${row.region}: unexpected level "${row.level}"`,
    );
  }
});
