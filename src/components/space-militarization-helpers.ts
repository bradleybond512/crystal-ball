/**
 * Pure helpers for SpaceMilitarizationPanel.
 *
 * Strictly analytical / space-domain monitoring. Static data is a synthetic
 * illustrative seed (the panel is a frame for live feeds; this file makes
 * sure the surface renders deterministically in tests).
 *
 * No DOM, no fetch — safe to import in Node.js tests.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type Severity = 0 | 1 | 2 | 3 | 4;
export type Confidence = 0 | 1 | 2 | 3;
export type SpaceActor = 'US' | 'Russia' | 'China' | 'India' | 'France' | 'UK' | 'Japan' | 'ESA' | 'Israel' | 'DPRK' | 'Iran';
export type AsatModality = 'kinetic-direct-ascent' | 'kinetic-co-orbital' | 'electronic-warfare' | 'directed-energy' | 'cyber';
export type Orbit = 'LEO' | 'MEO' | 'GEO' | 'HEO' | 'cislunar';
export type CoOrbitalBehavior = 'rendezvous' | 'proximity-operation' | 'shadowing' | 'capture-test' | 'inspection';
export type DualUseClass = 'rpo' | 'sigint' | 'eo-imagery' | 'sar-imagery' | 'comms-relay' | 'navigation';
export type DebrisRiskClass = 'tracked' | 'fragmenting' | 'critical-conjunction' | 'cascade-risk';
export type Treaty = 'Outer Space Treaty' | 'Moon Agreement' | 'Liability Convention' | 'Registration Convention' | 'Rescue Agreement';
export type ComplianceStatus = 'compliant' | 'concern' | 'apparent-violation' | 'disputed';
export type JammingBand = 'L1' | 'L2' | 'L5' | 'wideband' | 'spoofing';
export type DewClass = 'laser-dazzle' | 'high-power-microwave' | 'particle-beam' | 'rf-blinding';
export type TestOutcome = 'announced' | 'observed' | 'inferred' | 'denied';

export interface AsatTestEvent {
  actor: SpaceActor;
  modality: AsatModality;
  targetOrbit: Orbit;
  /** Estimated tracked debris pieces created, if any. */
  debrisGenerated: number;
  outcome: TestOutcome;
  severity: Severity;
  confidence: Confidence;
}

export interface CoOrbitalIncident {
  inspectorActor: SpaceActor;
  /** Foreign-flag target operator, anonymized as "operator". */
  targetOperator: string;
  targetOrbit: Orbit;
  behavior: CoOrbitalBehavior;
  closestApproachKm: number;
  durationDays: number;
  severity: Severity;
}

export interface DualUseSatellite {
  actor: SpaceActor;
  designation: string;
  classification: DualUseClass;
  orbit: Orbit;
  /** True if open-source attribution links the bird to a defense or
   *  intelligence agency rather than a civil/commercial entity. */
  militaryAttributed: boolean;
  severity: Severity;
}

export interface DebrisHazard {
  fragmentationEventName: string;
  orbit: Orbit;
  trackedPieces: number;
  riskClass: DebrisRiskClass;
  /** True when the event has prompted ISS or active-asset maneuvers. */
  forcedManeuver: boolean;
  severity: Severity;
}

export interface TreatyComplianceFlag {
  treaty: Treaty;
  article: string;
  actor: SpaceActor;
  /** Short summary of the concern, kept analytical (not legal opinion). */
  concern: string;
  status: ComplianceStatus;
  severity: Severity;
}

export interface GnssJammingEvent {
  region: string;
  band: JammingBand;
  /** Distinct devices/aircraft/vessels reporting position degradation. */
  reportsCount: number;
  /** True if the event coincides with an active military exercise. */
  exerciseLinked: boolean;
  severity: Severity;
  confidence: Confidence;
}

export interface DewTestEvent {
  actor: SpaceActor;
  type: DewClass;
  /** Target class — satellite, sensor, or open-source-disclosed test article. */
  targetClass: string;
  /** Disclosed or estimated peak power, in kilowatts. */
  powerKw: number;
  outcome: TestOutcome;
  severity: Severity;
}

// ── Severity / confidence shared helpers ─────────────────────────────────

export function severityColor(s: Severity): string {
  const colors: Record<Severity, string> = {
    0: 'var(--severity-none,     #9e9e9e)',
    1: 'var(--severity-low,      #4caf50)',
    2: 'var(--severity-medium,   #facc15)',
    3: 'var(--severity-high,     #fb923c)',
    4: 'var(--severity-critical, #ef4444)',
  };
  return colors[s];
}

export function severityLabel(s: Severity): string {
  const labels: Record<Severity, string> = {
    0: 'Minimal',
    1: 'Low',
    2: 'Moderate',
    3: 'High',
    4: 'Critical',
  };
  return labels[s];
}

export function confidenceLabel(c: Confidence): string {
  const labels: Record<Confidence, string> = {
    0: 'Unverified',
    1: 'Low',
    2: 'Moderate',
    3: 'High',
  };
  return labels[c];
}

// ── Label helpers ────────────────────────────────────────────────────────

export function asatModalityLabel(m: AsatModality): string {
  const labels: Record<AsatModality, string> = {
    'kinetic-direct-ascent': 'Kinetic — direct ascent',
    'kinetic-co-orbital':    'Kinetic — co-orbital',
    'electronic-warfare':    'Electronic warfare',
    'directed-energy':       'Directed energy',
    cyber:                   'Cyber',
  };
  return labels[m];
}

export function orbitLabel(o: Orbit): string {
  const labels: Record<Orbit, string> = {
    LEO:      'LEO',
    MEO:      'MEO',
    GEO:      'GEO',
    HEO:      'HEO',
    cislunar: 'Cislunar',
  };
  return labels[o];
}

export function coOrbitalBehaviorLabel(b: CoOrbitalBehavior): string {
  const labels: Record<CoOrbitalBehavior, string> = {
    rendezvous:            'Rendezvous',
    'proximity-operation': 'Proximity ops',
    shadowing:             'Shadowing',
    'capture-test':        'Capture test',
    inspection:            'Inspection',
  };
  return labels[b];
}

export function dualUseClassLabel(d: DualUseClass): string {
  const labels: Record<DualUseClass, string> = {
    rpo:           'RPO',
    sigint:        'SIGINT',
    'eo-imagery':  'EO imagery',
    'sar-imagery': 'SAR imagery',
    'comms-relay': 'Comms relay',
    navigation:    'Navigation',
  };
  return labels[d];
}

export function debrisRiskClassLabel(r: DebrisRiskClass): string {
  const labels: Record<DebrisRiskClass, string> = {
    tracked:                 'Tracked',
    fragmenting:             'Fragmenting',
    'critical-conjunction':  'Critical conjunction',
    'cascade-risk':          'Cascade risk',
  };
  return labels[r];
}

export function complianceStatusColor(s: ComplianceStatus): string {
  const colors: Record<ComplianceStatus, string> = {
    compliant:            'var(--severity-low,      #4caf50)',
    concern:              'var(--severity-medium,   #facc15)',
    'apparent-violation': 'var(--severity-critical, #ef4444)',
    disputed:             'var(--severity-high,     #fb923c)',
  };
  return colors[s];
}

export function complianceStatusLabel(s: ComplianceStatus): string {
  const labels: Record<ComplianceStatus, string> = {
    compliant:            'Compliant',
    concern:              'Concern',
    'apparent-violation': 'Apparent violation',
    disputed:             'Disputed',
  };
  return labels[s];
}

export function jammingBandLabel(b: JammingBand): string {
  const labels: Record<JammingBand, string> = {
    L1:        'L1',
    L2:        'L2',
    L5:        'L5',
    wideband:  'Wideband',
    spoofing:  'Spoofing',
  };
  return labels[b];
}

export function dewClassLabel(d: DewClass): string {
  const labels: Record<DewClass, string> = {
    'laser-dazzle':         'Laser dazzle',
    'high-power-microwave': 'High-power microwave',
    'particle-beam':        'Particle beam',
    'rf-blinding':          'RF blinding',
  };
  return labels[d];
}

export function testOutcomeColor(o: TestOutcome): string {
  const colors: Record<TestOutcome, string> = {
    announced: 'var(--severity-medium,   #facc15)',
    observed:  'var(--severity-critical, #ef4444)',
    inferred:  'var(--severity-high,     #fb923c)',
    denied:    'var(--severity-low,      #9e9e9e)',
  };
  return colors[o];
}

// ── Classifiers ──────────────────────────────────────────────────────────

/** Debris-risk class follows the count *and* whether the event is still
 *  fragmenting or has already forced active assets to maneuver. */
export function classifyDebrisRisk(
  trackedPieces: number,
  isFragmenting: boolean,
  forcedManeuver: boolean,
): DebrisRiskClass {
  if (trackedPieces >= 1500 && (isFragmenting || forcedManeuver)) return 'cascade-risk';
  if (forcedManeuver)                                              return 'critical-conjunction';
  if (isFragmenting)                                               return 'fragmenting';
  return 'tracked';
}

/** Approach distance + duration matrix for co-orbital severity. */
export function classifyCoOrbitalSeverity(
  closestApproachKm: number,
  durationDays: number,
): Severity {
  if (closestApproachKm <= 5  && durationDays >= 7)   return 4;
  if (closestApproachKm <= 25 && durationDays >= 14)  return 4;
  if (closestApproachKm <= 50 && durationDays >= 7)   return 3;
  if (closestApproachKm <= 100)                       return 2;
  return 1;
}

// ── Formatting helpers ──────────────────────────────────────────────────

export function formatPieces(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `${n}`;
}

export function formatKm(km: number): string {
  if (km >= 1000) return `${(km / 1000).toFixed(1)}k km`;
  if (km >= 10)   return `${km.toFixed(0)} km`;
  return `${km.toFixed(1)} km`;
}

export function formatDays(d: number): string {
  if (d >= 365) return `${(d / 365).toFixed(1)}y`;
  if (d >= 30)  return `${Math.round(d / 30)}mo`;
  return `${d}d`;
}

export function formatPowerKw(kw: number): string {
  if (kw >= 1000) return `${(kw / 1000).toFixed(1)} MW`;
  if (kw >= 1)    return `${kw.toFixed(0)} kW`;
  return `${(kw * 1000).toFixed(0)} W`;
}

// ── Count / aggregation helpers ──────────────────────────────────────────

export function countSevereAsatEvents(a: AsatTestEvent[]): number {
  return a.filter((x) => x.severity >= 3).length;
}

export function countCriticalCoOrbital(c: CoOrbitalIncident[]): number {
  return c.filter((x) => x.severity >= 3).length;
}

export function countMilitaryAttributedDualUse(d: DualUseSatellite[]): number {
  return d.filter((x) => x.militaryAttributed).length;
}

export function countDebrisHazards(d: DebrisHazard[]): number {
  return d.filter((x) => x.riskClass === 'critical-conjunction' || x.riskClass === 'cascade-risk').length;
}

export function countApparentViolations(t: TreatyComplianceFlag[]): number {
  return t.filter((x) => x.status === 'apparent-violation').length;
}

export function countActiveJamming(j: GnssJammingEvent[]): number {
  return j.filter((x) => x.severity >= 3).length;
}

export function countDewTests(d: DewTestEvent[]): number {
  return d.filter((x) => x.outcome === 'observed' || x.outcome === 'announced').length;
}

export function totalAsatDebrisGenerated(a: AsatTestEvent[]): number {
  let total = 0;
  for (const x of a) total += x.debrisGenerated;
  return total;
}

export function composeBadgeCount(
  asat: AsatTestEvent[],
  coOrbital: CoOrbitalIncident[],
  dualUse: DualUseSatellite[],
  debris: DebrisHazard[],
  treaties: TreatyComplianceFlag[],
  jamming: GnssJammingEvent[],
  dew: DewTestEvent[],
): number {
  return (
    countSevereAsatEvents(asat)
    + countCriticalCoOrbital(coOrbital)
    + countMilitaryAttributedDualUse(dualUse)
    + countDebrisHazards(debris)
    + countApparentViolations(treaties)
    + countActiveJamming(jamming)
    + countDewTests(dew)
  );
}

// ── Static seed data (synthetic, illustrative) ───────────────────────────

export const ASAT_TESTS: AsatTestEvent[] = [
  { actor: 'Russia', modality: 'kinetic-direct-ascent', targetOrbit: 'LEO', debrisGenerated: 1500, outcome: 'observed',  severity: 4, confidence: 3 },
  { actor: 'China',  modality: 'kinetic-direct-ascent', targetOrbit: 'LEO', debrisGenerated: 3000, outcome: 'observed',  severity: 4, confidence: 3 },
  { actor: 'India',  modality: 'kinetic-direct-ascent', targetOrbit: 'LEO', debrisGenerated:  400, outcome: 'announced', severity: 3, confidence: 3 },
  { actor: 'US',     modality: 'kinetic-direct-ascent', targetOrbit: 'LEO', debrisGenerated:    0, outcome: 'announced', severity: 2, confidence: 3 },
  { actor: 'Russia', modality: 'electronic-warfare',    targetOrbit: 'LEO', debrisGenerated:    0, outcome: 'inferred',  severity: 3, confidence: 2 },
  { actor: 'China',  modality: 'kinetic-co-orbital',    targetOrbit: 'GEO', debrisGenerated:    0, outcome: 'inferred',  severity: 3, confidence: 2 },
];

export const CO_ORBITAL_INCIDENTS: CoOrbitalIncident[] = [
  { inspectorActor: 'Russia', targetOperator: 'commercial GEO comms operator', targetOrbit: 'GEO', behavior: 'shadowing',           closestApproachKm: 10,  durationDays: 90, severity: classifyCoOrbitalSeverity(10,  90) },
  { inspectorActor: 'China',  targetOperator: 'US imagery satellite',          targetOrbit: 'LEO', behavior: 'proximity-operation', closestApproachKm: 3,   durationDays: 21, severity: classifyCoOrbitalSeverity(3,   21) },
  { inspectorActor: 'Russia', targetOperator: 'EU comms satellite',            targetOrbit: 'GEO', behavior: 'inspection',          closestApproachKm: 30,  durationDays: 14, severity: classifyCoOrbitalSeverity(30,  14) },
  { inspectorActor: 'US',     targetOperator: 'foreign GEO comms satellite',   targetOrbit: 'GEO', behavior: 'inspection',          closestApproachKm: 80,  durationDays:  7, severity: classifyCoOrbitalSeverity(80,   7) },
  { inspectorActor: 'China',  targetOperator: 'defunct upper stage',           targetOrbit: 'GEO', behavior: 'capture-test',        closestApproachKm: 1,   durationDays:  3, severity: classifyCoOrbitalSeverity(1,    3) },
  { inspectorActor: 'Russia', targetOperator: 'commercial LEO smallsat',       targetOrbit: 'LEO', behavior: 'rendezvous',          closestApproachKm: 150, durationDays:  2, severity: classifyCoOrbitalSeverity(150,  2) },
];

export const DUAL_USE_SATELLITES: DualUseSatellite[] = [
  { actor: 'Russia', designation: 'Kosmos-series RPO platform',        classification: 'rpo',         orbit: 'LEO', militaryAttributed: true,  severity: 4 },
  { actor: 'China',  designation: 'Yaogan-series SAR cluster',         classification: 'sar-imagery', orbit: 'LEO', militaryAttributed: true,  severity: 4 },
  { actor: 'US',     designation: 'GSSAP-class GEO patrol platform',   classification: 'rpo',         orbit: 'GEO', militaryAttributed: true,  severity: 3 },
  { actor: 'China',  designation: 'Shijian-series inspection platform', classification: 'rpo',        orbit: 'GEO', militaryAttributed: true,  severity: 4 },
  { actor: 'Russia', designation: 'Tundra-series early-warning',       classification: 'sigint',      orbit: 'HEO', militaryAttributed: true,  severity: 3 },
  { actor: 'Israel', designation: 'Ofek-series EO platform',           classification: 'eo-imagery',  orbit: 'LEO', militaryAttributed: true,  severity: 2 },
  { actor: 'India',  designation: 'Cartosat dual-use imagery',         classification: 'eo-imagery',  orbit: 'LEO', militaryAttributed: false, severity: 2 },
  { actor: 'France', designation: 'CSO defense-imagery platform',      classification: 'eo-imagery',  orbit: 'LEO', militaryAttributed: true,  severity: 2 },
];

export const DEBRIS_HAZARDS: DebrisHazard[] = [
  { fragmentationEventName: 'Kinetic ASAT debris field (LEO ~500km)', orbit: 'LEO', trackedPieces: 1800, riskClass: classifyDebrisRisk(1800, false, true),  forcedManeuver: true,  severity: 4 },
  { fragmentationEventName: 'High-energy collision residue',          orbit: 'LEO', trackedPieces: 2500, riskClass: classifyDebrisRisk(2500, true,  true),  forcedManeuver: true,  severity: 4 },
  { fragmentationEventName: 'Upper-stage breakup',                    orbit: 'LEO', trackedPieces:  600, riskClass: classifyDebrisRisk(600,  false, false), forcedManeuver: false, severity: 2 },
  { fragmentationEventName: 'Spent-rocket-body fragmentation',        orbit: 'MEO', trackedPieces:  120, riskClass: classifyDebrisRisk(120,  true,  false), forcedManeuver: false, severity: 2 },
  { fragmentationEventName: 'Geostationary anomaly cloud',            orbit: 'GEO', trackedPieces:   45, riskClass: classifyDebrisRisk(45,   false, false), forcedManeuver: false, severity: 2 },
];

export const TREATY_FLAGS: TreatyComplianceFlag[] = [
  { treaty: 'Outer Space Treaty',     article: 'Article IV',  actor: 'Russia', concern: 'Reported on-orbit weapon system testing',                       status: 'concern',              severity: 3 },
  { treaty: 'Outer Space Treaty',     article: 'Article IX',  actor: 'China',  concern: 'Debris-generating test affected peaceful uses by other states', status: 'apparent-violation',   severity: 4 },
  { treaty: 'Liability Convention',   article: 'Article II',  actor: 'Russia', concern: 'Cross-jurisdictional damage from kinetic ASAT debris',          status: 'disputed',             severity: 3 },
  { treaty: 'Registration Convention', article: 'Article IV', actor: 'DPRK',   concern: 'Late or absent registration filings for launched payloads',     status: 'apparent-violation',   severity: 2 },
  { treaty: 'Moon Agreement',         article: 'Article 11',  actor: 'US',     concern: 'Commercial lunar resource framework predates broad ratification',status: 'disputed',             severity: 2 },
  { treaty: 'Outer Space Treaty',     article: 'Article VII', actor: 'India',  concern: 'Liability for short-lived ASAT debris elements',                 status: 'concern',              severity: 2 },
  { treaty: 'Outer Space Treaty',     article: 'Article IV',  actor: 'Iran',   concern: 'Open-source attribution links launch vehicle to dual-use program',status: 'concern',             severity: 2 },
];

export const GNSS_JAMMING: GnssJammingEvent[] = [
  { region: 'Eastern Mediterranean',  band: 'L1',       reportsCount:  9000, exerciseLinked: false, severity: 4, confidence: 3 },
  { region: 'Black Sea',              band: 'L1',       reportsCount:  6500, exerciseLinked: true,  severity: 4, confidence: 3 },
  { region: 'Baltic / Kaliningrad',   band: 'wideband', reportsCount:  4200, exerciseLinked: true,  severity: 3, confidence: 3 },
  { region: 'Persian Gulf',           band: 'spoofing', reportsCount:  3800, exerciseLinked: false, severity: 4, confidence: 3 },
  { region: 'Korean Peninsula',       band: 'L1',       reportsCount:  2100, exerciseLinked: true,  severity: 3, confidence: 3 },
  { region: 'Taiwan Strait',          band: 'L1',       reportsCount:  1600, exerciseLinked: true,  severity: 3, confidence: 2 },
  { region: 'Sahel',                  band: 'spoofing', reportsCount:   400, exerciseLinked: false, severity: 2, confidence: 1 },
];

export const DEW_TESTS: DewTestEvent[] = [
  { actor: 'China',  type: 'laser-dazzle',         targetClass: 'EO imagery satellite (foreign-flag)', powerKw:    5, outcome: 'inferred',  severity: 3 },
  { actor: 'Russia', type: 'laser-dazzle',         targetClass: 'Reconnaissance overflight',           powerKw:    2, outcome: 'inferred',  severity: 3 },
  { actor: 'US',     type: 'high-power-microwave', targetClass: 'Open-source disclosed test article',  powerKw:  100, outcome: 'announced', severity: 2 },
  { actor: 'China',  type: 'high-power-microwave', targetClass: 'Open-source disclosed test article',  powerKw:  150, outcome: 'announced', severity: 3 },
  { actor: 'Russia', type: 'rf-blinding',          targetClass: 'Foreign SIGINT satellite',            powerKw:   30, outcome: 'inferred',  severity: 3 },
  { actor: 'UK',     type: 'laser-dazzle',         targetClass: 'Maritime sensor test article',        powerKw:    1, outcome: 'announced', severity: 1 },
];
