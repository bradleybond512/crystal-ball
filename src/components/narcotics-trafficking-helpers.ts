/**
 * Pure helpers for NarcoticsTraffickingPanel.
 *
 * No DOM, no fetch — safe to import in Node.js tests. The panel
 * itself is a thin DOM layer; everything scoreable, sortable, or
 * thresholdable lives here so tests can exercise it without
 * spinning up the Panel base class.
 *
 * Framing is strictly analytical / security-intelligence: route
 * disruptions, cartel territorial conflict, regional interdictions,
 * precursor supply-chain monitoring, narco-state corruption indices,
 * and trafficking-volume trend indicators. No operational detail.
 */

// ── Types ─────────────────────────────────────────────────────────

export type Substance =
  | 'cocaine' | 'heroin' | 'methamphetamine'
  | 'fentanyl' | 'cannabis' | 'synthetic-opioid';

export type RouteRegion =
  | 'Central America' | 'Andean Ridge' | 'Caribbean' | 'West Africa'
  | 'Maghreb' | 'Balkans' | 'Golden Triangle' | 'Golden Crescent';

export type DisruptionCause = 'interdiction' | 'territorial-conflict' | 'natural-event' | 'sanctions';

export type ConflictIntensity = 'dormant' | 'skirmish' | 'contested' | 'open-warfare';

export type InterdictionMethod = 'maritime' | 'aerial' | 'land' | 'postal';

export type PrecursorChemical =
  | 'ephedrine' | 'pseudoephedrine' | 'N-phenethyl-4-piperidone'
  | 'acetic-anhydride' | 'NPP' | 'ANPP';

export type VolumeTrend = 'rising' | 'falling' | 'flat';

export type RiskBand = 'low' | 'moderate' | 'high' | 'critical';

export interface RouteDisruption {
  routeRegion: RouteRegion;
  substance: Substance;
  cause: DisruptionCause;
  /** Estimated % of route throughput affected. */
  throughputImpactPct: number;
  detectedAt: number;
  /** Open-source rollup; analytical, no operational specifics. */
  summary: string;
}

export interface CartelTerritorialEvent {
  region: string;
  primaryActor: string;
  rivalActor: string;
  intensity: ConflictIntensity;
  recentClashes30d: number;
  notable: string;
}

export interface InterdictionEvent {
  region: RouteRegion;
  method: InterdictionMethod;
  substance: Substance;
  /** Estimated seizure in kg (rounded to nearest 100). */
  seizureKg: number;
  detectedAt: number;
}

export interface PrecursorSignal {
  chemical: PrecursorChemical;
  originRegion: string;
  destinationRegion: string;
  /** 0–1 confidence that the flow is diverting toward illicit synthesis. */
  diversionConfidence: number;
  reportedAt: number;
  rationale: string;
}

export interface NarcoStateIndex {
  country: string;
  /** 0–100; aggregate of corruption / institutional capture / impunity. */
  corruptionScore: number;
  band: RiskBand;
  /** Brief analytic note; no operational detail. */
  driver: string;
}

export interface VolumeTrendRow {
  substance: Substance;
  /** Last-30d est. volume in metric tonnes (analytical estimate). */
  volume30dTonnes: number;
  /** Trend vs prior 30d. */
  trend: VolumeTrend;
  /** -1..+1 — relative shift. */
  relativeShift: number;
}

export interface NarcoticsCompositeScore {
  /** 0–100 composite. */
  total: number;
  band: RiskBand;
  contributions: {
    routeDisruption: number;
    cartelConflict: number;
    precursorDiversion: number;
    narcoStateCorruption: number;
    volumeAccel: number;
  };
}

// ── Color + label helpers ────────────────────────────────────────

export function bandColor(b: RiskBand): string {
  const map: Record<RiskBand, string> = {
    low:      'var(--severity-low,      #4caf50)',
    moderate: 'var(--severity-medium,   #facc15)',
    high:     'var(--severity-high,     #fb923c)',
    critical: 'var(--severity-critical, #ef4444)',
  };
  return map[b];
}

export function bandLabel(b: RiskBand): string {
  const map: Record<RiskBand, string> = {
    low: 'Low', moderate: 'Moderate', high: 'High', critical: 'Critical',
  };
  return map[b];
}

export function intensityColor(i: ConflictIntensity): string {
  const map: Record<ConflictIntensity, string> = {
    dormant:       'var(--severity-none,     #9e9e9e)',
    skirmish:      'var(--severity-low,      #4caf50)',
    contested:     'var(--severity-medium,   #facc15)',
    'open-warfare':'var(--severity-critical, #ef4444)',
  };
  return map[i];
}

export function intensityLabel(i: ConflictIntensity): string {
  const map: Record<ConflictIntensity, string> = {
    dormant: 'Dormant', skirmish: 'Skirmish',
    contested: 'Contested', 'open-warfare': 'Open warfare',
  };
  return map[i];
}

export function substanceLabel(s: Substance): string {
  const map: Record<Substance, string> = {
    cocaine: 'Cocaine',
    heroin: 'Heroin',
    methamphetamine: 'Methamphetamine',
    fentanyl: 'Fentanyl',
    cannabis: 'Cannabis',
    'synthetic-opioid': 'Synthetic opioid',
  };
  return map[s];
}

export function disruptionCauseLabel(c: DisruptionCause): string {
  const map: Record<DisruptionCause, string> = {
    interdiction:           'Interdiction',
    'territorial-conflict': 'Territorial conflict',
    'natural-event':        'Natural event',
    sanctions:              'Sanctions',
  };
  return map[c];
}

export function methodLabel(m: InterdictionMethod): string {
  const map: Record<InterdictionMethod, string> = {
    maritime: 'Maritime', aerial: 'Aerial', land: 'Land', postal: 'Postal',
  };
  return map[m];
}

export function precursorLabel(p: PrecursorChemical): string {
  const map: Record<PrecursorChemical, string> = {
    ephedrine:                    'Ephedrine',
    pseudoephedrine:              'Pseudoephedrine',
    'N-phenethyl-4-piperidone':   'N-phenethyl-4-piperidone',
    'acetic-anhydride':           'Acetic anhydride',
    NPP:                          'NPP',
    ANPP:                         'ANPP',
  };
  return map[p];
}

export function volumeTrendArrow(t: VolumeTrend): string {
  const map: Record<VolumeTrend, string> = { rising: '▲', falling: '▼', flat: '→' };
  return map[t];
}

/** Map 0..1 diversion confidence to a band color. */
export function precursorConfidenceColor(confidence: number): string {
  if (confidence >= 0.7) return bandColor('critical');
  if (confidence >= 0.5) return bandColor('high');
  return bandColor('moderate');
}

export function volumeTrendColor(t: VolumeTrend): string {
  const map: Record<VolumeTrend, string> = {
    rising:  'var(--severity-critical, #ef4444)',
    falling: 'var(--severity-low,      #4caf50)',
    flat:    'var(--severity-none,     #9e9e9e)',
  };
  return map[t];
}

// ── Relative time ─────────────────────────────────────────────────

export function timeAgo(ts: number, now: number = Date.now()): string {
  const deltaMs = now - ts;
  if (deltaMs < 0) return 'future';
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Score math ────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export function bandForScore(score: number): RiskBand {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'moderate';
  return 'low';
}

/** Composite 0–100 narcotics-threat score. Each axis saturates at its
 *  own scale so no single contributor can dominate. Weights:
 *    route disruption       25
 *    cartel conflict        20
 *    precursor diversion    20
 *    narco-state corruption 20
 *    volume acceleration    15
 */
export function computeNarcoticsScore(input: {
  activeDisruptions: number;
  openWarfareConflicts: number;
  highConfidencePrecursorSignals: number;
  criticalNarcoStates: number;
  risingVolumeSubstances: number;
}): NarcoticsCompositeScore {
  const routeDisruption     = clamp(input.activeDisruptions / 6,                  0, 1) * 25;
  const cartelConflict      = clamp(input.openWarfareConflicts / 4,                0, 1) * 20;
  const precursorDiversion  = clamp(input.highConfidencePrecursorSignals / 4,      0, 1) * 20;
  const narcoStateCorruption = clamp(input.criticalNarcoStates / 5,                0, 1) * 20;
  const volumeAccel         = clamp(input.risingVolumeSubstances / 3,              0, 1) * 15;
  const total = Math.round(routeDisruption + cartelConflict + precursorDiversion + narcoStateCorruption + volumeAccel);
  return {
    total,
    band: bandForScore(total),
    contributions: {
      routeDisruption:      Math.round(routeDisruption),
      cartelConflict:       Math.round(cartelConflict),
      precursorDiversion:   Math.round(precursorDiversion),
      narcoStateCorruption: Math.round(narcoStateCorruption),
      volumeAccel:          Math.round(volumeAccel),
    },
  };
}

// ── Aggregations ──────────────────────────────────────────────────

const ACTIVE_DISRUPTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_INTERDICTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const RECENT_PRECURSOR_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function countActiveDisruptions(rows: readonly RouteDisruption[], now: number = Date.now()): number {
  const cutoff = now - ACTIVE_DISRUPTION_WINDOW_MS;
  return rows.filter((r) => r.detectedAt >= cutoff && r.throughputImpactPct >= 20).length;
}

export function countOpenWarfareConflicts(rows: readonly CartelTerritorialEvent[]): number {
  return rows.filter((r) => r.intensity === 'open-warfare').length;
}

export function countHighConfidencePrecursorSignals(rows: readonly PrecursorSignal[], now: number = Date.now()): number {
  const cutoff = now - RECENT_PRECURSOR_WINDOW_MS;
  return rows.filter((r) => r.reportedAt >= cutoff && r.diversionConfidence >= 0.7).length;
}

export function countCriticalNarcoStates(rows: readonly NarcoStateIndex[]): number {
  return rows.filter((r) => r.band === 'critical').length;
}

export function countRisingVolumeSubstances(rows: readonly VolumeTrendRow[]): number {
  return rows.filter((r) => r.trend === 'rising').length;
}

/** Latest seizure rollup over the last 30d, grouped by region. */
export function summarizeInterdictionsByRegion(rows: readonly InterdictionEvent[], now: number = Date.now()):
  { region: RouteRegion; seizureKg: number; eventCount: number }[] {
  const cutoff = now - RECENT_INTERDICTION_WINDOW_MS;
  const buckets = new Map<RouteRegion, { seizureKg: number; eventCount: number }>();
  for (const r of rows) {
    if (r.detectedAt < cutoff) continue;
    const bucket = buckets.get(r.region) ?? { seizureKg: 0, eventCount: 0 };
    bucket.seizureKg += r.seizureKg;
    bucket.eventCount += 1;
    buckets.set(r.region, bucket);
  }
  return [...buckets.entries()]
    .map(([region, b]) => ({ region, seizureKg: b.seizureKg, eventCount: b.eventCount }))
    .sort((a, b) => b.seizureKg - a.seizureKg);
}

export function formatSeizure(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`;
  return `${Math.round(kg)} kg`;
}

// ── Static reference catalogues ───────────────────────────────────

export const ROUTE_DISRUPTIONS_BASE: readonly RouteDisruption[] = [
  { routeRegion: 'Caribbean',       substance: 'cocaine',         cause: 'interdiction',         throughputImpactPct: 22, detectedAt: Date.now() -  2 * 24 * 60 * 60 * 1000, summary: 'Multi-agency posture in transit corridor; throughput briefly compressed.' },
  { routeRegion: 'Central America', substance: 'fentanyl',        cause: 'territorial-conflict', throughputImpactPct: 35, detectedAt: Date.now() -  4 * 24 * 60 * 60 * 1000, summary: 'Inter-organisation territorial friction along key transit zone.' },
  { routeRegion: 'West Africa',     substance: 'cocaine',         cause: 'sanctions',            throughputImpactPct: 28, detectedAt: Date.now() -  6 * 24 * 60 * 60 * 1000, summary: 'Designations against intermediary network shift transhipment pattern.' },
  { routeRegion: 'Balkans',         substance: 'heroin',          cause: 'interdiction',         throughputImpactPct: 18, detectedAt: Date.now() - 12 * 24 * 60 * 60 * 1000, summary: 'Sustained customs posture; below alerting threshold.' },
  { routeRegion: 'Golden Triangle', substance: 'methamphetamine', cause: 'interdiction',         throughputImpactPct: 41, detectedAt: Date.now() -  1 * 24 * 60 * 60 * 1000, summary: 'Significant land-route seizure cluster compresses regional throughput.' },
  { routeRegion: 'Maghreb',         substance: 'cannabis',        cause: 'natural-event',        throughputImpactPct: 12, detectedAt: Date.now() -  5 * 24 * 60 * 60 * 1000, summary: 'Severe-weather disruption to overland transit; minor impact.' },
];

export const CARTEL_TERRITORIAL_EVENTS: readonly CartelTerritorialEvent[] = [
  { region: 'NW Mexico',           primaryActor: 'Faction A', rivalActor: 'Faction B', intensity: 'open-warfare', recentClashes30d: 18, notable: 'Sustained street-level friction; institutional response strained.' },
  { region: 'Pacific Colombia',    primaryActor: 'Faction C', rivalActor: 'Faction D', intensity: 'contested',    recentClashes30d:  9, notable: 'Cross-border riverine corridor contested by rival groups.' },
  { region: 'Northern Triangle',   primaryActor: 'Faction E', rivalActor: 'Faction F', intensity: 'contested',    recentClashes30d: 12, notable: 'Urban territorial disputes drive displacement signal.' },
  { region: 'Andean foothills',    primaryActor: 'Faction G', rivalActor: 'Faction H', intensity: 'skirmish',     recentClashes30d:  4, notable: 'Sporadic friction along production-zone access routes.' },
  { region: 'Rio Grande corridor', primaryActor: 'Faction I', rivalActor: 'Faction J', intensity: 'open-warfare', recentClashes30d: 21, notable: 'High-intensity territorial dispute along smuggling corridor.' },
  { region: 'Caribbean basin',     primaryActor: 'Faction K', rivalActor: 'Faction L', intensity: 'dormant',      recentClashes30d:  1, notable: 'Negotiated arrangement appears to be holding.' },
];

export const INTERDICTION_EVENTS_BASE: readonly InterdictionEvent[] = [
  { region: 'Caribbean',       method: 'maritime', substance: 'cocaine',         seizureKg: 2400, detectedAt: Date.now() -  3 * 24 * 60 * 60 * 1000 },
  { region: 'Central America', method: 'land',     substance: 'fentanyl',        seizureKg:   80, detectedAt: Date.now() -  9 * 24 * 60 * 60 * 1000 },
  { region: 'West Africa',     method: 'maritime', substance: 'cocaine',         seizureKg: 1100, detectedAt: Date.now() - 11 * 24 * 60 * 60 * 1000 },
  { region: 'Balkans',         method: 'land',     substance: 'heroin',          seizureKg:  640, detectedAt: Date.now() - 14 * 24 * 60 * 60 * 1000 },
  { region: 'Golden Triangle', method: 'land',     substance: 'methamphetamine', seizureKg: 5800, detectedAt: Date.now() -  2 * 24 * 60 * 60 * 1000 },
  { region: 'Andean Ridge',    method: 'aerial',   substance: 'cocaine',         seizureKg:  900, detectedAt: Date.now() - 21 * 24 * 60 * 60 * 1000 },
  { region: 'Golden Crescent', method: 'land',     substance: 'heroin',          seizureKg: 1400, detectedAt: Date.now() - 25 * 24 * 60 * 60 * 1000 },
];

export const PRECURSOR_SIGNALS_BASE: readonly PrecursorSignal[] = [
  { chemical: 'NPP',                          originRegion: 'East Asia',      destinationRegion: 'NW Mexico',    diversionConfidence: 0.86, reportedAt: Date.now() -  5 * 24 * 60 * 60 * 1000, rationale: 'Trade-flow anomaly + repeated routing through known intermediary.' },
  { chemical: 'ANPP',                         originRegion: 'East Asia',      destinationRegion: 'NW Mexico',    diversionConfidence: 0.78, reportedAt: Date.now() -  9 * 24 * 60 * 60 * 1000, rationale: 'Bill-of-lading mismatch with declared end-use.' },
  { chemical: 'acetic-anhydride',             originRegion: 'Europe',         destinationRegion: 'Golden Crescent', diversionConfidence: 0.82, reportedAt: Date.now() -  3 * 24 * 60 * 60 * 1000, rationale: 'Volume above legitimate market demand for stated importer.' },
  { chemical: 'pseudoephedrine',              originRegion: 'South Asia',     destinationRegion: 'Golden Triangle', diversionConfidence: 0.71, reportedAt: Date.now() - 12 * 24 * 60 * 60 * 1000, rationale: 'Repeat suspected diversion via mislabelled bulk shipment.' },
  { chemical: 'N-phenethyl-4-piperidone',     originRegion: 'East Asia',      destinationRegion: 'NW Mexico',    diversionConfidence: 0.62, reportedAt: Date.now() - 18 * 24 * 60 * 60 * 1000, rationale: 'Mid-confidence diversion signal; under continued monitoring.' },
];

export const NARCO_STATE_INDICES: readonly NarcoStateIndex[] = [
  { country: 'Country A', corruptionScore: 82, band: 'critical', driver: 'Documented institutional capture in producing regions.' },
  { country: 'Country B', corruptionScore: 76, band: 'critical', driver: 'Customs / port-control compromise indicators.' },
  { country: 'Country C', corruptionScore: 68, band: 'high',     driver: 'Judicial impunity for senior trafficking figures.' },
  { country: 'Country D', corruptionScore: 61, band: 'high',     driver: 'Security-services tasking diverted by political pressure.' },
  { country: 'Country E', corruptionScore: 54, band: 'high',     driver: 'Border-state governance gaps along transit corridor.' },
  { country: 'Country F', corruptionScore: 41, band: 'moderate', driver: 'Local-level corruption persistent but contained.' },
  { country: 'Country G', corruptionScore: 22, band: 'low',      driver: 'Strong institutional response and prosecutions.' },
];

export const VOLUME_TRENDS_BASE: readonly VolumeTrendRow[] = [
  { substance: 'fentanyl',         volume30dTonnes: 12,  trend: 'rising',  relativeShift: +0.38 },
  { substance: 'methamphetamine',  volume30dTonnes: 460, trend: 'rising',  relativeShift: +0.21 },
  { substance: 'cocaine',          volume30dTonnes: 220, trend: 'flat',    relativeShift: +0.04 },
  { substance: 'heroin',           volume30dTonnes:  64, trend: 'falling', relativeShift: -0.17 },
  { substance: 'synthetic-opioid', volume30dTonnes:   3, trend: 'rising',  relativeShift: +0.55 },
  { substance: 'cannabis',         volume30dTonnes: 980, trend: 'flat',    relativeShift: -0.02 },
];
