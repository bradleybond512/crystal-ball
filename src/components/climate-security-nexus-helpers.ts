/**
 * Pure helpers for ClimateSecurityNexusPanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 *
 * Sections:
 *   1. Climate-conflict causation events
 *   2. Water-food-energy nexus stress scores
 *   3. Climate migration pressure indicators
 *   4. Extreme weather conflict amplification events
 *   5. Climate adaptation failure signals
 *   6. Carbon-revenue dependent state fragility
 *   7. Sea level risk to military installations
 */

import { escapeHtml } from '@/utils/sanitize';

// ── Types ─────────────────────────────────────────────────────────────────

export type StressLevel = 'low' | 'moderate' | 'high' | 'severe' | 'critical';
export type CausalChainKind =
  | 'drought_unrest'
  | 'flood_displacement_conflict'
  | 'heat_food_riot'
  | 'storm_governance_collapse'
  | 'wildfire_grievance';
export type EventStatus = 'emerging' | 'ongoing' | 'escalating' | 'subsiding' | 'resolved';
export type MigrationTrigger =
  | 'drought'
  | 'flooding'
  | 'sea_level_rise'
  | 'crop_failure'
  | 'cyclone'
  | 'water_scarcity';
export type AdaptationStatus =
  | 'on_track'
  | 'lagging'
  | 'failing'
  | 'reversed'
  | 'unfunded';
export type CarbonDependencyTier = 'low' | 'medium' | 'high' | 'extreme';
export type InstallationRiskTier = 'low' | 'medium' | 'high' | 'critical';

export interface ClimateConflictEvent {
  region: string;
  trigger: string;
  chain: CausalChainKind;
  populationAffectedMillions: number;
  status: EventStatus;
  evidence: string;
}

export interface NexusStressScore {
  region: string;
  waterStress: number; // 0-100
  foodStress: number; // 0-100
  energyStress: number; // 0-100
  level: StressLevel;
  notes: string;
}

export interface MigrationPressure {
  origin: string;
  destinationRegion: string;
  trigger: MigrationTrigger;
  estimatedMigrantsThousands: number;
  level: StressLevel;
  notes: string;
}

export interface WeatherAmplifiedConflict {
  region: string;
  hazard: string;
  preexistingConflict: string;
  amplificationFactor: number; // 1.0 = baseline, 2.0 = doubled intensity
  status: EventStatus;
  notes: string;
}

export interface AdaptationFailureSignal {
  country: string;
  programArea: string;
  status: AdaptationStatus;
  fundingGapMillions: number;
  notes: string;
}

export interface CarbonStateFragility {
  country: string;
  hydrocarbonRevenueSharePct: number; // 0-100
  fragilityIndex: number; // 0-100
  dependencyTier: CarbonDependencyTier;
  notes: string;
}

export interface SeaLevelInstallationRisk {
  installation: string;
  branch: string;
  meanElevationMeters: number;
  decadalRiseMm: number; // mm per decade
  risk: InstallationRiskTier;
  notes: string;
}

// ── Color / label tables ──────────────────────────────────────────────────

export function stressLevelColor(s: StressLevel): string {
  const colors: Record<StressLevel, string> = {
    low:      'var(--severity-low,      #22c55e)',
    moderate: 'var(--severity-info,     #3b82f6)',
    high:     'var(--severity-medium,   #f59e0b)',
    severe:   'var(--severity-high,     #fb923c)',
    critical: 'var(--severity-critical, #ef4444)',
  };
  return colors[s];
}

export function stressLevelLabel(s: StressLevel): string {
  const labels: Record<StressLevel, string> = {
    low:      'Low',
    moderate: 'Moderate',
    high:     'High',
    severe:   'Severe',
    critical: 'Critical',
  };
  return labels[s];
}

export function causalChainLabel(k: CausalChainKind): string {
  const labels: Record<CausalChainKind, string> = {
    drought_unrest:             'Drought → unrest',
    flood_displacement_conflict: 'Flood → displacement → conflict',
    heat_food_riot:             'Heat → food → riot',
    storm_governance_collapse:  'Storm → governance collapse',
    wildfire_grievance:         'Wildfire → grievance',
  };
  return labels[k];
}

export function eventStatusColor(s: EventStatus): string {
  const colors: Record<EventStatus, string> = {
    emerging:   'var(--severity-info,     #3b82f6)',
    ongoing:    'var(--severity-medium,   #f59e0b)',
    escalating: 'var(--severity-critical, #ef4444)',
    subsiding:  'var(--severity-low,      #22c55e)',
    resolved:   'var(--text-secondary,    #9e9e9e)',
  };
  return colors[s];
}

export function eventStatusLabel(s: EventStatus): string {
  const labels: Record<EventStatus, string> = {
    emerging:   'Emerging',
    ongoing:    'Ongoing',
    escalating: 'Escalating',
    subsiding:  'Subsiding',
    resolved:   'Resolved',
  };
  return labels[s];
}

export function migrationTriggerLabel(t: MigrationTrigger): string {
  const labels: Record<MigrationTrigger, string> = {
    drought:         'Drought',
    flooding:        'Flooding',
    sea_level_rise:  'Sea level rise',
    crop_failure:    'Crop failure',
    cyclone:         'Cyclone',
    water_scarcity:  'Water scarcity',
  };
  return labels[t];
}

export function adaptationStatusColor(s: AdaptationStatus): string {
  const colors: Record<AdaptationStatus, string> = {
    on_track:  'var(--severity-low,      #22c55e)',
    lagging:   'var(--severity-medium,   #f59e0b)',
    failing:   'var(--severity-high,     #fb923c)',
    reversed:  'var(--severity-critical, #ef4444)',
    unfunded:  'var(--severity-critical, #ef4444)',
  };
  return colors[s];
}

export function adaptationStatusLabel(s: AdaptationStatus): string {
  const labels: Record<AdaptationStatus, string> = {
    on_track:  'On track',
    lagging:   'Lagging',
    failing:   'Failing',
    reversed:  'Reversed',
    unfunded:  'Unfunded',
  };
  return labels[s];
}

export function carbonDependencyColor(t: CarbonDependencyTier): string {
  const colors: Record<CarbonDependencyTier, string> = {
    low:     'var(--severity-low,      #22c55e)',
    medium:  'var(--severity-medium,   #f59e0b)',
    high:    'var(--severity-high,     #fb923c)',
    extreme: 'var(--severity-critical, #ef4444)',
  };
  return colors[t];
}

export function carbonDependencyLabel(t: CarbonDependencyTier): string {
  const labels: Record<CarbonDependencyTier, string> = {
    low:     'Low',
    medium:  'Medium',
    high:    'High',
    extreme: 'Extreme',
  };
  return labels[t];
}

export function installationRiskColor(r: InstallationRiskTier): string {
  const colors: Record<InstallationRiskTier, string> = {
    low:      'var(--severity-low,      #22c55e)',
    medium:   'var(--severity-medium,   #f59e0b)',
    high:     'var(--severity-high,     #fb923c)',
    critical: 'var(--severity-critical, #ef4444)',
  };
  return colors[r];
}

export function installationRiskLabel(r: InstallationRiskTier): string {
  const labels: Record<InstallationRiskTier, string> = {
    low:      'Low',
    medium:   'Medium',
    high:     'High',
    critical: 'Critical',
  };
  return labels[r];
}

// ── Band classifiers ──────────────────────────────────────────────────────

export function nexusStressLevel(water: number, food: number, energy: number): StressLevel {
  const avg = (water + food + energy) / 3;
  if (avg >= 80) return 'critical';
  if (avg >= 65) return 'severe';
  if (avg >= 50) return 'high';
  if (avg >= 30) return 'moderate';
  return 'low';
}

export function carbonDependencyTier(revenueSharePct: number): CarbonDependencyTier {
  if (revenueSharePct >= 60) return 'extreme';
  if (revenueSharePct >= 40) return 'high';
  if (revenueSharePct >= 20) return 'medium';
  return 'low';
}

export function installationRiskTier(elevationMeters: number, decadalRiseMm: number): InstallationRiskTier {
  // years until sea-level rise reaches mean elevation (assuming linear extrapolation)
  if (decadalRiseMm <= 0) return 'low';
  const yearsToInundation = (elevationMeters * 1000) / decadalRiseMm * 10;
  if (yearsToInundation <= 25) return 'critical';
  if (yearsToInundation <= 50) return 'high';
  if (yearsToInundation <= 100) return 'medium';
  return 'low';
}

// ── Sort comparators ──────────────────────────────────────────────────────

export function sortByPopulationDesc(a: ClimateConflictEvent, b: ClimateConflictEvent): number {
  return b.populationAffectedMillions - a.populationAffectedMillions;
}

export function sortByMigrantCountDesc(a: MigrationPressure, b: MigrationPressure): number {
  return b.estimatedMigrantsThousands - a.estimatedMigrantsThousands;
}

export function sortByAmplificationDesc(a: WeatherAmplifiedConflict, b: WeatherAmplifiedConflict): number {
  return b.amplificationFactor - a.amplificationFactor;
}

export function sortByFundingGapDesc(a: AdaptationFailureSignal, b: AdaptationFailureSignal): number {
  return b.fundingGapMillions - a.fundingGapMillions;
}

export function sortByFragilityDesc(a: CarbonStateFragility, b: CarbonStateFragility): number {
  return b.fragilityIndex - a.fragilityIndex;
}

// ── Aggregator counts ─────────────────────────────────────────────────────

export function countEscalatingConflicts(rows: ClimateConflictEvent[]): number {
  return rows.filter((r) => r.status === 'escalating' || r.status === 'ongoing').length;
}

export function countCriticalNexusRegions(rows: NexusStressScore[]): number {
  return rows.filter((r) => r.level === 'critical' || r.level === 'severe').length;
}

export function countHighMigrationFlows(rows: MigrationPressure[]): number {
  return rows.filter((r) => r.level === 'critical' || r.level === 'severe').length;
}

export function countAmplifiedConflicts(rows: WeatherAmplifiedConflict[]): number {
  return rows.filter((r) => r.amplificationFactor >= 1.5).length;
}

export function countFailingAdaptationPrograms(rows: AdaptationFailureSignal[]): number {
  return rows.filter((r) => r.status === 'failing' || r.status === 'reversed' || r.status === 'unfunded').length;
}

export function countExtremeCarbonDependents(rows: CarbonStateFragility[]): number {
  return rows.filter((r) => r.dependencyTier === 'extreme' || r.dependencyTier === 'high').length;
}

export function countCriticalSeaLevelInstallations(rows: SeaLevelInstallationRisk[]): number {
  return rows.filter((r) => r.risk === 'critical' || r.risk === 'high').length;
}

// ── Render helpers ────────────────────────────────────────────────────────

const SECTION_STYLE = 'margin-bottom:14px';
const HEADER_STYLE  = 'font-size:12px;font-weight:600;color:var(--text-primary,#e0e0e0);margin-bottom:4px;display:flex;align-items:center';
const HINT_STYLE    = 'font-size:11px;color:var(--text-secondary,#9e9e9e);margin-bottom:4px';
const TABLE_STYLE   = 'width:100%;border-collapse:collapse';
const CELL_STYLE    = 'padding:3px 6px;font-size:12px';
const SUB_CELL_STYLE = 'padding:0 6px 4px 6px;font-size:10px;color:var(--text-secondary,#9e9e9e);border-bottom:1px solid var(--border-subtle,#222)';
const EMPTY_STYLE   = 'padding:6px;font-size:11px;color:var(--text-secondary,#9e9e9e);font-style:italic';

function badgeHtml(count: number, label: string): string {
  const text = `${count} ${label}`;
  return `<span style="margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px">${escapeHtml(text)}</span>`;
}

function sectionHeaderHtml(title: string, badge?: string): string {
  return `<div style="${HEADER_STYLE}" data-section-header="${escapeHtml(title)}">${escapeHtml(title)}${badge ?? ''}</div>`;
}

export function renderConflictEventsSection(rows: ClimateConflictEvent[]): string {
  const escalating = countEscalatingConflicts(rows);
  const badge = escalating > 0 ? badgeHtml(escalating, 'active') : undefined;
  if (rows.length === 0) {
    return `<div data-section="climate-conflict" style="${SECTION_STYLE}">${sectionHeaderHtml('Climate-Conflict Causation', badge)}<div style="${EMPTY_STYLE}">No active climate-conflict events</div></div>`;
  }
  const sorted = [...rows].sort(sortByPopulationDesc);
  const body = sorted.map((row) => {
    const sColor = eventStatusColor(row.status);
    const sLabel = eventStatusLabel(row.status);
    const cLabel = causalChainLabel(row.chain);
    const pop = `${row.populationAffectedMillions.toFixed(1)}M affected`;
    return (
      `<tr>` +
        `<td style="${CELL_STYLE};font-weight:600;color:${sColor}">${escapeHtml(row.region)}</td>` +
        `<td style="${CELL_STYLE};color:#facc15">${escapeHtml(row.trigger)}</td>` +
        `<td style="${CELL_STYLE};color:var(--text-secondary,#cccccc);font-size:10px">${escapeHtml(cLabel)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;color:var(--text-primary,#e0e0e0)">${escapeHtml(pop)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;text-transform:uppercase;font-size:10px;color:${sColor}">${escapeHtml(sLabel)}</td>` +
      `</tr>` +
      `<tr><td colspan="5" style="${SUB_CELL_STYLE}">${escapeHtml(row.evidence)}</td></tr>`
    );
  }).join('');
  return (
    `<div data-section="climate-conflict" style="${SECTION_STYLE}">` +
      sectionHeaderHtml('Climate-Conflict Causation', badge) +
      `<div style="${HINT_STYLE}">Region · trigger · causal chain · population affected · status</div>` +
      `<table style="${TABLE_STYLE}"><tbody>${body}</tbody></table>` +
    `</div>`
  );
}

export function renderNexusStressSection(rows: NexusStressScore[]): string {
  const critical = countCriticalNexusRegions(rows);
  const badge = critical > 0 ? badgeHtml(critical, 'severe/critical') : undefined;
  if (rows.length === 0) {
    return `<div data-section="nexus-stress" style="${SECTION_STYLE}">${sectionHeaderHtml('Water-Food-Energy Nexus Stress', badge)}<div style="${EMPTY_STYLE}">No nexus stress data</div></div>`;
  }
  const body = rows.map((row) => {
    const color = stressLevelColor(row.level);
    const label = stressLevelLabel(row.level);
    return (
      `<tr>` +
        `<td style="${CELL_STYLE};font-weight:600;color:${color}">${escapeHtml(row.region)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;color:#60a5fa">W ${escapeHtml(row.waterStress.toFixed(0))}</td>` +
        `<td style="${CELL_STYLE};text-align:right;color:#facc15">F ${escapeHtml(row.foodStress.toFixed(0))}</td>` +
        `<td style="${CELL_STYLE};text-align:right;color:#f97316">E ${escapeHtml(row.energyStress.toFixed(0))}</td>` +
        `<td style="${CELL_STYLE};text-align:right;text-transform:uppercase;font-size:10px;color:${color}">${escapeHtml(label)}</td>` +
      `</tr>` +
      `<tr><td colspan="5" style="${SUB_CELL_STYLE}">${escapeHtml(row.notes)}</td></tr>`
    );
  }).join('');
  return (
    `<div data-section="nexus-stress" style="${SECTION_STYLE}">` +
      sectionHeaderHtml('Water-Food-Energy Nexus Stress', badge) +
      `<div style="${HINT_STYLE}">Region · water / food / energy stress (0-100) · combined level</div>` +
      `<table style="${TABLE_STYLE}"><tbody>${body}</tbody></table>` +
    `</div>`
  );
}

export function renderMigrationSection(rows: MigrationPressure[]): string {
  const high = countHighMigrationFlows(rows);
  const badge = high > 0 ? badgeHtml(high, 'severe/critical') : undefined;
  if (rows.length === 0) {
    return `<div data-section="climate-migration" style="${SECTION_STYLE}">${sectionHeaderHtml('Climate Migration Pressure', badge)}<div style="${EMPTY_STYLE}">No active migration flows tracked</div></div>`;
  }
  const sorted = [...rows].sort(sortByMigrantCountDesc);
  const body = sorted.map((row) => {
    const color = stressLevelColor(row.level);
    const label = stressLevelLabel(row.level);
    const triggerLabel = migrationTriggerLabel(row.trigger);
    const count = row.estimatedMigrantsThousands >= 1000
      ? `${(row.estimatedMigrantsThousands / 1000).toFixed(1)}M`
      : `${row.estimatedMigrantsThousands.toFixed(0)}K`;
    return (
      `<tr>` +
        `<td style="${CELL_STYLE};font-weight:600;color:${color}">${escapeHtml(row.origin)}</td>` +
        `<td style="${CELL_STYLE};color:var(--text-secondary,#cccccc)">→ ${escapeHtml(row.destinationRegion)}</td>` +
        `<td style="${CELL_STYLE};color:#facc15;font-size:10px">${escapeHtml(triggerLabel)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;color:var(--text-primary,#e0e0e0)">${escapeHtml(count)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;text-transform:uppercase;font-size:10px;color:${color}">${escapeHtml(label)}</td>` +
      `</tr>` +
      `<tr><td colspan="5" style="${SUB_CELL_STYLE}">${escapeHtml(row.notes)}</td></tr>`
    );
  }).join('');
  return (
    `<div data-section="climate-migration" style="${SECTION_STYLE}">` +
      sectionHeaderHtml('Climate Migration Pressure', badge) +
      `<div style="${HINT_STYLE}">Origin → destination · trigger · estimated migrants · level</div>` +
      `<table style="${TABLE_STYLE}"><tbody>${body}</tbody></table>` +
    `</div>`
  );
}

export function renderWeatherAmplificationSection(rows: WeatherAmplifiedConflict[]): string {
  const amplified = countAmplifiedConflicts(rows);
  const badge = amplified > 0 ? badgeHtml(amplified, 'amplified ≥1.5×') : undefined;
  if (rows.length === 0) {
    return `<div data-section="weather-amplification" style="${SECTION_STYLE}">${sectionHeaderHtml('Extreme Weather Conflict Amplification', badge)}<div style="${EMPTY_STYLE}">No weather-amplified conflicts tracked</div></div>`;
  }
  const sorted = [...rows].sort(sortByAmplificationDesc);
  const body = sorted.map((row) => {
    const sColor = eventStatusColor(row.status);
    const sLabel = eventStatusLabel(row.status);
    const factor = `${row.amplificationFactor.toFixed(1)}×`;
    return (
      `<tr>` +
        `<td style="${CELL_STYLE};font-weight:600;color:${sColor}">${escapeHtml(row.region)}</td>` +
        `<td style="${CELL_STYLE};color:#facc15">${escapeHtml(row.hazard)}</td>` +
        `<td style="${CELL_STYLE};color:var(--text-secondary,#cccccc);font-size:10px">${escapeHtml(row.preexistingConflict)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;color:${sColor};font-weight:600">${escapeHtml(factor)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;text-transform:uppercase;font-size:10px;color:${sColor}">${escapeHtml(sLabel)}</td>` +
      `</tr>` +
      `<tr><td colspan="5" style="${SUB_CELL_STYLE}">${escapeHtml(row.notes)}</td></tr>`
    );
  }).join('');
  return (
    `<div data-section="weather-amplification" style="${SECTION_STYLE}">` +
      sectionHeaderHtml('Extreme Weather Conflict Amplification', badge) +
      `<div style="${HINT_STYLE}">Region · hazard · pre-existing conflict · amplification factor · status</div>` +
      `<table style="${TABLE_STYLE}"><tbody>${body}</tbody></table>` +
    `</div>`
  );
}

export function renderAdaptationFailureSection(rows: AdaptationFailureSignal[]): string {
  const failing = countFailingAdaptationPrograms(rows);
  const badge = failing > 0 ? badgeHtml(failing, 'failing') : undefined;
  if (rows.length === 0) {
    return `<div data-section="adaptation-failure" style="${SECTION_STYLE}">${sectionHeaderHtml('Climate Adaptation Failure Signals', badge)}<div style="${EMPTY_STYLE}">No adaptation failure signals</div></div>`;
  }
  const sorted = [...rows].sort(sortByFundingGapDesc);
  const body = sorted.map((row) => {
    const color = adaptationStatusColor(row.status);
    const label = adaptationStatusLabel(row.status);
    const gap = row.fundingGapMillions >= 1000
      ? `$${(row.fundingGapMillions / 1000).toFixed(1)}B gap`
      : `$${row.fundingGapMillions.toFixed(0)}M gap`;
    return (
      `<tr>` +
        `<td style="${CELL_STYLE};font-weight:600;color:${color}">${escapeHtml(row.country)}</td>` +
        `<td style="${CELL_STYLE};color:var(--text-secondary,#cccccc)">${escapeHtml(row.programArea)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;color:${color}">${escapeHtml(gap)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;text-transform:uppercase;font-size:10px;color:${color}">${escapeHtml(label)}</td>` +
      `</tr>` +
      `<tr><td colspan="4" style="${SUB_CELL_STYLE}">${escapeHtml(row.notes)}</td></tr>`
    );
  }).join('');
  return (
    `<div data-section="adaptation-failure" style="${SECTION_STYLE}">` +
      sectionHeaderHtml('Climate Adaptation Failure Signals', badge) +
      `<div style="${HINT_STYLE}">Country · program area · funding gap · status</div>` +
      `<table style="${TABLE_STYLE}"><tbody>${body}</tbody></table>` +
    `</div>`
  );
}

export function renderCarbonStateSection(rows: CarbonStateFragility[]): string {
  const extreme = countExtremeCarbonDependents(rows);
  const badge = extreme > 0 ? badgeHtml(extreme, 'high/extreme') : undefined;
  if (rows.length === 0) {
    return `<div data-section="carbon-state" style="${SECTION_STYLE}">${sectionHeaderHtml('Carbon-Revenue State Fragility', badge)}<div style="${EMPTY_STYLE}">No carbon-dependent states tracked</div></div>`;
  }
  const sorted = [...rows].sort(sortByFragilityDesc);
  const body = sorted.map((row) => {
    const color = carbonDependencyColor(row.dependencyTier);
    const label = carbonDependencyLabel(row.dependencyTier);
    const rev = `${row.hydrocarbonRevenueSharePct.toFixed(0)}%`;
    const frag = `${row.fragilityIndex.toFixed(0)}/100`;
    return (
      `<tr>` +
        `<td style="${CELL_STYLE};font-weight:600;color:${color}">${escapeHtml(row.country)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;color:#facc15">${escapeHtml(rev)} HC rev</td>` +
        `<td style="${CELL_STYLE};text-align:right;color:${color};font-weight:600">${escapeHtml(frag)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;text-transform:uppercase;font-size:10px;color:${color}">${escapeHtml(label)}</td>` +
      `</tr>` +
      `<tr><td colspan="4" style="${SUB_CELL_STYLE}">${escapeHtml(row.notes)}</td></tr>`
    );
  }).join('');
  return (
    `<div data-section="carbon-state" style="${SECTION_STYLE}">` +
      sectionHeaderHtml('Carbon-Revenue State Fragility', badge) +
      `<div style="${HINT_STYLE}">Country · hydrocarbon-revenue share · fragility index · dependency tier</div>` +
      `<table style="${TABLE_STYLE}"><tbody>${body}</tbody></table>` +
    `</div>`
  );
}

export function renderSeaLevelInstallationsSection(rows: SeaLevelInstallationRisk[]): string {
  const critical = countCriticalSeaLevelInstallations(rows);
  const badge = critical > 0 ? badgeHtml(critical, 'high/critical') : undefined;
  if (rows.length === 0) {
    return `<div data-section="sea-level-installations" style="${SECTION_STYLE}">${sectionHeaderHtml('Sea Level Risk to Military Installations', badge)}<div style="${EMPTY_STYLE}">No installation risk data</div></div>`;
  }
  const body = rows.map((row) => {
    const color = installationRiskColor(row.risk);
    const label = installationRiskLabel(row.risk);
    const elev = `${row.meanElevationMeters.toFixed(1)} m`;
    const rise = `${row.decadalRiseMm.toFixed(0)} mm/decade`;
    return (
      `<tr>` +
        `<td style="${CELL_STYLE};font-weight:600;color:${color}">${escapeHtml(row.installation)}</td>` +
        `<td style="${CELL_STYLE};color:var(--text-secondary,#cccccc);font-size:10px">${escapeHtml(row.branch)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;color:var(--text-primary,#e0e0e0)">${escapeHtml(elev)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;color:#60a5fa">${escapeHtml(rise)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;text-transform:uppercase;font-size:10px;color:${color}">${escapeHtml(label)}</td>` +
      `</tr>` +
      `<tr><td colspan="5" style="${SUB_CELL_STYLE}">${escapeHtml(row.notes)}</td></tr>`
    );
  }).join('');
  return (
    `<div data-section="sea-level-installations" style="${SECTION_STYLE}">` +
      sectionHeaderHtml('Sea Level Risk to Military Installations', badge) +
      `<div style="${HINT_STYLE}">Installation · branch · mean elevation · decadal rise · risk tier</div>` +
      `<table style="${TABLE_STYLE}"><tbody>${body}</tbody></table>` +
    `</div>`
  );
}

// ── Static reference data ─────────────────────────────────────────────────

export const CLIMATE_CONFLICT_EVENTS: ClimateConflictEvent[] = [
  {
    region: 'Sahel (Mali, Burkina Faso, Niger)',
    trigger: 'Multi-year Sahelian drought',
    chain: 'drought_unrest',
    populationAffectedMillions: 23,
    status: 'escalating',
    evidence: 'Pastoralist-farmer violence intensifies as Lake Chad shrinks; jihadist recruitment correlates with drought severity (Kelley et al. 2015 framework)',
  },
  {
    region: 'Syria',
    trigger: '2006-2010 drought (worst in 900 years)',
    chain: 'drought_unrest',
    populationAffectedMillions: 1.5,
    status: 'ongoing',
    evidence: 'Rural-to-urban displacement of 1.5M farmers preceded 2011 protests; documented in Gleick (2014) and PNAS 2015',
  },
  {
    region: 'Pakistan',
    trigger: '2022 monsoon mega-flood',
    chain: 'flood_displacement_conflict',
    populationAffectedMillions: 33,
    status: 'ongoing',
    evidence: '1/3 of Pakistan underwater; 8M displaced; ongoing food-price riots in Sindh; weakening of state authority in flooded districts',
  },
  {
    region: 'Horn of Africa (Somalia, Ethiopia, Kenya)',
    trigger: 'Five consecutive failed rainy seasons',
    chain: 'drought_unrest',
    populationAffectedMillions: 36,
    status: 'escalating',
    evidence: 'Worst drought in 40 years; Al-Shabaab tax/recruitment surges in famine-affected regions',
  },
  {
    region: 'Yemen',
    trigger: 'Water table collapse + ongoing war',
    chain: 'heat_food_riot',
    populationAffectedMillions: 17,
    status: 'ongoing',
    evidence: 'Sana\'a aquifer expected to fully deplete; food insecurity drives Houthi-coalition recruitment cycles',
  },
  {
    region: 'Central America Dry Corridor',
    trigger: 'Repeated drought + hurricane season',
    chain: 'drought_unrest',
    populationAffectedMillions: 8.4,
    status: 'ongoing',
    evidence: 'Crop loss drives northward migration; cartel territorial expansion correlates with rural collapse',
  },
  {
    region: 'Lake Chad Basin',
    trigger: '90% lake shrinkage since 1960s',
    chain: 'drought_unrest',
    populationAffectedMillions: 11,
    status: 'escalating',
    evidence: 'Resource competition between herders, fishermen, farmers; Boko Haram recruitment in collapsed-fishery communities',
  },
  {
    region: 'Bay of Bengal (Bangladesh / Myanmar coast)',
    trigger: 'Cyclone Mocha + rising salinity',
    chain: 'flood_displacement_conflict',
    populationAffectedMillions: 4.2,
    status: 'emerging',
    evidence: 'Rohingya camp flooding stresses host-displaced relations; salt intrusion ruins rice paddies inland',
  },
  {
    region: 'South Sudan',
    trigger: 'Three years of unprecedented flooding',
    chain: 'flood_displacement_conflict',
    populationAffectedMillions: 1.1,
    status: 'ongoing',
    evidence: 'Cattle-raiding intensifies as grazing land floods; UN estimates climate adds 70% to displacement totals',
  },
  {
    region: 'Caribbean (Haiti, Cuba, DR)',
    trigger: 'Hurricane Beryl + chronic governance gap',
    chain: 'storm_governance_collapse',
    populationAffectedMillions: 5.8,
    status: 'emerging',
    evidence: 'Gang takeovers in Haiti accelerate post-storm; state response capacity overwhelmed',
  },
];

export const NEXUS_STRESS_SCORES: NexusStressScore[] = [
  {
    region: 'Middle East / North Africa',
    waterStress: 88,
    foodStress: 65,
    energyStress: 50,
    level: 'severe',
    notes: 'Per-capita water below 1,000 m³/yr; ~50% food import dependence; gas-export economies vulnerable to decarbonization',
  },
  {
    region: 'South Asia (India / Pakistan / Bangladesh)',
    waterStress: 82,
    foodStress: 72,
    energyStress: 78,
    level: 'critical',
    notes: 'Indus aquifer overdraft; heat waves cut wheat yields; coal-heavy grid increasingly stressed by demand spikes',
  },
  {
    region: 'Sahel',
    waterStress: 78,
    foodStress: 86,
    energyStress: 60,
    level: 'severe',
    notes: 'Rapidly declining groundwater; chronic food insecurity; biomass + unreliable grid dominates energy mix',
  },
  {
    region: 'Central Asia (Aral Basin)',
    waterStress: 91,
    foodStress: 58,
    energyStress: 55,
    level: 'severe',
    notes: 'Tajik-Uzbek-Turkmen water rivalry over Amu Darya; cotton-monoculture food risk; energy export shifts',
  },
  {
    region: 'US Southwest (Colorado Basin)',
    waterStress: 70,
    foodStress: 35,
    energyStress: 42,
    level: 'high',
    notes: 'Lake Mead at record lows; thermal generation curtailed by warm river water; alfalfa-irrigation politics',
  },
  {
    region: 'Western Europe',
    waterStress: 55,
    foodStress: 40,
    energyStress: 62,
    level: 'high',
    notes: 'Drier summers; gas-supply geopolitics post-Russia; nuclear river-cooling derating',
  },
  {
    region: 'Sub-Saharan Africa (general)',
    waterStress: 60,
    foodStress: 75,
    energyStress: 72,
    level: 'high',
    notes: 'Variable rainfall on rain-fed agriculture; weak grids; rapid demand growth amid stranded-coal risk',
  },
  {
    region: 'Southeast Asia',
    waterStress: 52,
    foodStress: 48,
    energyStress: 55,
    level: 'high',
    notes: 'Mekong upstream-damming threatens Vietnamese delta rice; coal generation phase-out lagging',
  },
];

export const MIGRATION_PRESSURES: MigrationPressure[] = [
  {
    origin: 'Central America Dry Corridor',
    destinationRegion: 'United States',
    trigger: 'crop_failure',
    estimatedMigrantsThousands: 700,
    level: 'severe',
    notes: 'Recurrent harvest failures + cartel violence drive northward flows; CBP encounters tracked in IPCC AR6 climate-migration annex',
  },
  {
    origin: 'Sahel',
    destinationRegion: 'North Africa → Europe',
    trigger: 'drought',
    estimatedMigrantsThousands: 450,
    level: 'severe',
    notes: 'Pastoral collapse + jihadist insecurity; Mediterranean crossing pipeline through Libya / Tunisia',
  },
  {
    origin: 'Pakistan (Sindh)',
    destinationRegion: 'Karachi / internal',
    trigger: 'flooding',
    estimatedMigrantsThousands: 8000,
    level: 'critical',
    notes: '2022 floods displaced 8M; many never returned to inundated villages; urban strain in Karachi',
  },
  {
    origin: 'Horn of Africa',
    destinationRegion: 'Kenya / Gulf states',
    trigger: 'drought',
    estimatedMigrantsThousands: 1200,
    level: 'critical',
    notes: 'Failed-rains migration to Dadaab camps and beyond; Gulf domestic-worker pipeline',
  },
  {
    origin: 'Bangladesh coastal districts',
    destinationRegion: 'Dhaka',
    trigger: 'sea_level_rise',
    estimatedMigrantsThousands: 4000,
    level: 'critical',
    notes: 'Salt intrusion + cyclones depopulate coastal districts; mega-city absorbs ~2,000 climate migrants daily',
  },
  {
    origin: 'Pacific Atolls (Tuvalu, Kiribati)',
    destinationRegion: 'New Zealand / Australia',
    trigger: 'sea_level_rise',
    estimatedMigrantsThousands: 18,
    level: 'high',
    notes: 'First "migration with dignity" treaties; first nation-state existential climate threat',
  },
  {
    origin: 'Vanuatu / Solomon Islands',
    destinationRegion: 'Australia / NZ',
    trigger: 'cyclone',
    estimatedMigrantsThousands: 22,
    level: 'high',
    notes: 'Category-5 cyclones now annual; relocation grants under Australian Pacific Engagement Visa',
  },
  {
    origin: 'Northern Mexico',
    destinationRegion: 'United States',
    trigger: 'water_scarcity',
    estimatedMigrantsThousands: 95,
    level: 'high',
    notes: 'Monterrey water crisis + Rio Grande over-allocation pressuring border-state agriculture',
  },
];

export const WEATHER_AMPLIFICATIONS: WeatherAmplifiedConflict[] = [
  {
    region: 'Sudan',
    hazard: 'Record-low Blue Nile flows + heat dome',
    preexistingConflict: 'RSF / SAF civil war',
    amplificationFactor: 1.8,
    status: 'escalating',
    notes: 'Drought collapses farm income → recruitment pool for both sides; humanitarian access blocked by heat',
  },
  {
    region: 'Ukraine',
    hazard: 'Black Sea storms + freezing winters',
    preexistingConflict: 'Russian invasion',
    amplificationFactor: 1.3,
    status: 'ongoing',
    notes: 'Targeted strikes on energy grid amplified by extreme cold; agricultural disruption from drought + war',
  },
  {
    region: 'Myanmar',
    hazard: 'Cyclone Mocha (Cat 4)',
    preexistingConflict: 'Junta vs. resistance + Rohingya',
    amplificationFactor: 1.7,
    status: 'ongoing',
    notes: 'Junta blocks aid to Rakhine; storm-affected populations radicalize toward resistance forces',
  },
  {
    region: 'Yemen',
    hazard: 'Persistent drought + heat',
    preexistingConflict: 'Houthi-coalition war',
    amplificationFactor: 1.6,
    status: 'ongoing',
    notes: 'Water scarcity strengthens Houthi water-rationing leverage; cholera outbreaks during heat extremes',
  },
  {
    region: 'Ethiopia (Tigray + Oromo)',
    hazard: 'Multi-season drought',
    preexistingConflict: 'Federal-regional ethnic conflict',
    amplificationFactor: 1.5,
    status: 'ongoing',
    notes: 'Famine-as-weapon during Tigray conflict; pastoralist-farmer violence in Oromia worsened by water shortage',
  },
  {
    region: 'Mozambique (Cabo Delgado)',
    hazard: 'Cyclones Idai / Kenneth legacy',
    preexistingConflict: 'IS-affiliated insurgency',
    amplificationFactor: 1.4,
    status: 'ongoing',
    notes: 'Storm-displaced populations swell into IDP camps where insurgent recruitment is documented',
  },
  {
    region: 'Sahel (Mali / Burkina Faso)',
    hazard: 'Sahelian heat extremes',
    preexistingConflict: 'JNIM / ISGS insurgency',
    amplificationFactor: 1.6,
    status: 'escalating',
    notes: 'Heat extremes amplify pastoralist-farmer competition that JNIM exploits as a recruitment frame',
  },
];

export const ADAPTATION_FAILURES: AdaptationFailureSignal[] = [
  {
    country: 'Pakistan',
    programArea: 'Flood-resilient agriculture + drainage',
    status: 'failing',
    fundingGapMillions: 16000,
    notes: 'Post-2022 reconstruction pledge of $16B; less than 20% disbursed',
  },
  {
    country: 'Bangladesh',
    programArea: 'Coastal embankments + cyclone shelters',
    status: 'lagging',
    fundingGapMillions: 4800,
    notes: 'Embankment repair backlog grows faster than monsoon cycle; adaptation finance shifts to mitigation',
  },
  {
    country: 'Somalia',
    programArea: 'Drought-resistant livelihoods',
    status: 'unfunded',
    fundingGapMillions: 2100,
    notes: 'Anticipatory-action funding model proven but chronically below pledge',
  },
  {
    country: 'Haiti',
    programArea: 'Watershed restoration + hurricane prep',
    status: 'reversed',
    fundingGapMillions: 1200,
    notes: 'Gang takeover of distribution hubs; pre-positioned shelters looted',
  },
  {
    country: 'Madagascar',
    programArea: 'Drought-resilient agriculture',
    status: 'unfunded',
    fundingGapMillions: 800,
    notes: 'First officially attributed climate famine; international response below WFP appeal',
  },
  {
    country: 'Mozambique',
    programArea: 'Cyclone early-warning + shelters',
    status: 'lagging',
    fundingGapMillions: 600,
    notes: 'Early-warning coverage gaps in Cabo Delgado where insurgent activity blocks deployment',
  },
  {
    country: 'Vanuatu',
    programArea: 'Loss-and-damage mechanism + relocation',
    status: 'lagging',
    fundingGapMillions: 350,
    notes: 'COP28 loss-and-damage facility pledged but disbursement protocol unfinished',
  },
  {
    country: 'Honduras',
    programArea: 'Dry-corridor smallholder support',
    status: 'failing',
    fundingGapMillions: 500,
    notes: 'USAID Feed-the-Future climate component repeatedly under-resourced relative to need',
  },
];

export const CARBON_STATE_FRAGILITY: CarbonStateFragility[] = [
  {
    country: 'Iraq',
    hydrocarbonRevenueSharePct: 92,
    fragilityIndex: 89,
    dependencyTier: 'extreme',
    notes: 'Federal budget ~92% oil; Basra summer temperatures exceeding human survivability thresholds',
  },
  {
    country: 'Libya',
    hydrocarbonRevenueSharePct: 94,
    fragilityIndex: 92,
    dependencyTier: 'extreme',
    notes: 'Divided government + 94% oil revenue + Mediterranean climate stress trifecta',
  },
  {
    country: 'Venezuela',
    hydrocarbonRevenueSharePct: 85,
    fragilityIndex: 88,
    dependencyTier: 'extreme',
    notes: 'Sanctioned oil economy + recurrent power crises + mass migration outflow',
  },
  {
    country: 'Nigeria',
    hydrocarbonRevenueSharePct: 78,
    fragilityIndex: 81,
    dependencyTier: 'high',
    notes: 'Delta oil dependence + northern climate-conflict spillover + currency stress',
  },
  {
    country: 'Algeria',
    hydrocarbonRevenueSharePct: 72,
    fragilityIndex: 64,
    dependencyTier: 'extreme',
    notes: 'European gas pivot; aging field decline; Saharan heat extremes north of population centers',
  },
  {
    country: 'Angola',
    hydrocarbonRevenueSharePct: 68,
    fragilityIndex: 68,
    dependencyTier: 'extreme',
    notes: 'Diversification stalled; southern Angola drought displaces pastoralists',
  },
  {
    country: 'Equatorial Guinea',
    hydrocarbonRevenueSharePct: 75,
    fragilityIndex: 75,
    dependencyTier: 'extreme',
    notes: 'Mature-field decline; near-zero non-oil GDP; vulnerable to demand peak',
  },
  {
    country: 'South Sudan',
    hydrocarbonRevenueSharePct: 89,
    fragilityIndex: 95,
    dependencyTier: 'extreme',
    notes: 'Oil = ~90% of government revenue; record flooding atop chronic conflict',
  },
  {
    country: 'Russia',
    hydrocarbonRevenueSharePct: 45,
    fragilityIndex: 58,
    dependencyTier: 'high',
    notes: 'Federal budget ~45% hydrocarbons; permafrost-thaw infrastructure damage + sanctions stranding pipelines',
  },
  {
    country: 'Saudi Arabia',
    hydrocarbonRevenueSharePct: 62,
    fragilityIndex: 38,
    dependencyTier: 'extreme',
    notes: 'Vision 2030 diversification underway but oil still dominant; extreme heat threatens labor + Hajj',
  },
];

export const SEA_LEVEL_INSTALLATIONS: SeaLevelInstallationRisk[] = [
  {
    installation: 'Naval Station Norfolk, VA',
    branch: 'US Navy',
    meanElevationMeters: 3.0,
    decadalRiseMm: 50,
    risk: 'critical',
    notes: 'Largest naval base in the world; documented 10+ "sunny day" flooding events per year; pier electrical infra repeatedly damaged',
  },
  {
    installation: 'Diego Garcia',
    branch: 'US/UK joint',
    meanElevationMeters: 1.8,
    decadalRiseMm: 40,
    risk: 'critical',
    notes: 'Indian Ocean strategic hub on a low coral atoll; long-term inundation risk drives discussions of relocation',
  },
  {
    installation: 'Eglin AFB, FL',
    branch: 'US Air Force',
    meanElevationMeters: 8.0,
    decadalRiseMm: 45,
    risk: 'medium',
    notes: 'Largest USAF base; storm-surge and salt-water intrusion to test ranges; hurricane Michael caused billions in damage',
  },
  {
    installation: 'Naval Base Guam',
    branch: 'US Navy',
    meanElevationMeters: 4.0,
    decadalRiseMm: 35,
    risk: 'high',
    notes: 'Critical Indo-Pacific node; typhoons + sea-level rise threaten infrastructure of strategic value',
  },
  {
    installation: 'Kwajalein Atoll',
    branch: 'US Army (Reagan Test Site)',
    meanElevationMeters: 2.0,
    decadalRiseMm: 45,
    risk: 'critical',
    notes: 'Pacific missile-defense range on atolls 2 m above sea level; entire test infrastructure at long-term risk',
  },
  {
    installation: 'MCAS Beaufort, SC',
    branch: 'US Marines',
    meanElevationMeters: 6.5,
    decadalRiseMm: 45,
    risk: 'medium',
    notes: 'F-35 training base; lowland coastal terrain; periodic flooding of taxiways and access roads',
  },
  {
    installation: 'NAS Key West, FL',
    branch: 'US Navy',
    meanElevationMeters: 1.5,
    decadalRiseMm: 50,
    risk: 'critical',
    notes: 'Joint Interagency Task Force South HQ; perimeter roads under threat from rising tides + hurricane surge',
  },
  {
    installation: 'Portsmouth Naval Base, UK',
    branch: 'Royal Navy',
    meanElevationMeters: 4.0,
    decadalRiseMm: 30,
    risk: 'high',
    notes: 'Carrier homeport; tidal flooding incidents documented in MoD climate-impact reports',
  },
  {
    installation: 'Hampton Roads complex (multi-installation)',
    branch: 'US Joint',
    meanElevationMeters: 3.5,
    decadalRiseMm: 48,
    risk: 'critical',
    notes: 'Norfolk + Langley + Little Creek; concentrated Atlantic-coast logistics + ports + air; identified as #1 SLR-vulnerable cluster',
  },
];
