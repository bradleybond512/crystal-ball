/**
 * Pure helpers for MaritimeBoundaryPanel.
 *
 * No DOM, no fetch — safe to import in Node.js tests. The panel itself
 * is a thin DOM layer; everything scoreable, sortable, or thresholdable
 * lives here so tests can exercise it without spinning up the Panel
 * base class.
 *
 * Framing is strictly analytical / security-intelligence: EEZ and
 * territorial-sea disputes, UNCLOS arbitration dockets, island and reef
 * militarization tracking, fisheries incursion events, maritime law
 * enforcement incidents, regional dispute heat, and naval patrol
 * confrontations. Observer / analyst view only — no operational detail.
 *
 * Open-source analogs the framing tracks (without reproducing them):
 *   CSIS Asia Maritime Transparency Initiative · USNI bulletins ·
 *   IMO maritime incident notices · ICJ / PCA case docket ·
 *   UNCLOS Annex VII arbitral awards.
 */

// ── Types ─────────────────────────────────────────────────────────

export type MaritimeRegion =
  | 'South China Sea' | 'East China Sea' | 'Arctic'
  | 'Eastern Mediterranean' | 'Persian Gulf' | 'Gulf of Guinea'
  | 'Sea of Japan' | 'Black Sea' | 'Caribbean' | 'Aegean';

export type DisputeKind =
  | 'eez-overlap' | 'territorial-sea' | 'continental-shelf'
  | 'island-sovereignty' | 'baseline-claim' | 'transit-passage';

export type DisputeStatus = 'dormant' | 'active' | 'escalating' | 'arbitration-pending';

export type ArbitrationVenue = 'ICJ' | 'ITLOS' | 'PCA' | 'Annex-VII-Tribunal' | 'Conciliation-Commission';

export type CasePhase = 'filed' | 'pleadings' | 'hearings' | 'deliberation' | 'award-issued' | 'compliance-monitoring';

export type MilitarizationKind =
  | 'runway-construction' | 'radar-emplacement' | 'missile-deployment'
  | 'garrison-rotation' | 'port-expansion' | 'reclamation-fill';

export type IncursionKind = 'unlicensed-fishing' | 'flag-state-violation' | 'IUU-fleet-presence' | 'gear-incident';

export type EnforcementKind =
  | 'vessel-boarding' | 'detention' | 'vessel-seizure'
  | 'fine-issued' | 'release' | 'diplomatic-protest';

export type ConfrontationIntensity = 'observed' | 'shadowing' | 'unsafe-maneuver' | 'live-fire-warning';

export type RiskBand = 'low' | 'moderate' | 'high' | 'critical';

export interface BoundaryDisputeEvent {
  region: MaritimeRegion;
  partyA: string;
  partyB: string;
  kind: DisputeKind;
  status: DisputeStatus;
  /** 0–100 analytic dispute-heat index. */
  heatIndex: number;
  reportedAt: number;
  summary: string;
}

export interface UnclosCaseRow {
  caseName: string;
  venue: ArbitrationVenue;
  applicant: string;
  respondent: string;
  phase: CasePhase;
  filedAt: number;
  region: MaritimeRegion;
  note: string;
}

export interface MilitarizationSignal {
  feature: string;
  region: MaritimeRegion;
  controllingClaimant: string;
  kind: MilitarizationKind;
  /** 0–100 analytic intensity (open-source observation). */
  intensity: number;
  observedAt: number;
  rationale: string;
}

export interface FisheriesIncursionEvent {
  region: MaritimeRegion;
  flagState: string;
  hostState: string;
  kind: IncursionKind;
  vesselCount: number;
  reportedAt: number;
  notable: string;
}

export interface MaritimeEnforcementIncident {
  region: MaritimeRegion;
  hostState: string;
  flagState: string;
  kind: EnforcementKind;
  vesselCount: number;
  reportedAt: number;
  outcome: string;
}

export interface RegionalHeatRow {
  region: MaritimeRegion;
  /** 0–100 aggregate dispute-heat for the region. */
  heat: number;
  band: RiskBand;
  contributingClaims: number;
}

export interface NavalConfrontationEvent {
  region: MaritimeRegion;
  partyA: string;
  partyB: string;
  intensity: ConfrontationIntensity;
  observedAt: number;
  summary: string;
}

export interface MaritimeBoundaryCompositeScore {
  /** 0–100 composite. */
  total: number;
  band: RiskBand;
  contributions: {
    boundaryDisputes: number;
    arbitrationLoad: number;
    militarization: number;
    fisheriesIncursions: number;
    enforcementIncidents: number;
    navalConfrontations: number;
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

export function disputeKindLabel(d: DisputeKind): string {
  const map: Record<DisputeKind, string> = {
    'eez-overlap':         'EEZ overlap',
    'territorial-sea':     'Territorial sea',
    'continental-shelf':   'Continental shelf',
    'island-sovereignty':  'Island sovereignty',
    'baseline-claim':      'Baseline claim',
    'transit-passage':     'Transit passage',
  };
  return map[d];
}

export function disputeStatusLabel(s: DisputeStatus): string {
  const map: Record<DisputeStatus, string> = {
    dormant:                'Dormant',
    active:                 'Active',
    escalating:             'Escalating',
    'arbitration-pending':  'Arbitration pending',
  };
  return map[s];
}

export function disputeStatusColor(s: DisputeStatus): string {
  const map: Record<DisputeStatus, string> = {
    dormant:                'var(--severity-none,     #9e9e9e)',
    active:                 'var(--severity-medium,   #facc15)',
    escalating:             'var(--severity-critical, #ef4444)',
    'arbitration-pending':  'var(--severity-high,     #fb923c)',
  };
  return map[s];
}

export function venueLabel(v: ArbitrationVenue): string {
  const map: Record<ArbitrationVenue, string> = {
    ICJ:                    'ICJ',
    ITLOS:                  'ITLOS',
    PCA:                    'PCA',
    'Annex-VII-Tribunal':   'Annex VII Tribunal',
    'Conciliation-Commission': 'Conciliation Commission',
  };
  return map[v];
}

export function casePhaseLabel(p: CasePhase): string {
  const map: Record<CasePhase, string> = {
    filed:                  'Filed',
    pleadings:              'Pleadings',
    hearings:               'Hearings',
    deliberation:           'Deliberation',
    'award-issued':         'Award issued',
    'compliance-monitoring':'Compliance monitoring',
  };
  return map[p];
}

export function militarizationKindLabel(m: MilitarizationKind): string {
  const map: Record<MilitarizationKind, string> = {
    'runway-construction': 'Runway construction',
    'radar-emplacement':   'Radar emplacement',
    'missile-deployment':  'Missile deployment',
    'garrison-rotation':   'Garrison rotation',
    'port-expansion':      'Port expansion',
    'reclamation-fill':    'Reclamation / fill',
  };
  return map[m];
}

export function incursionKindLabel(k: IncursionKind): string {
  const map: Record<IncursionKind, string> = {
    'unlicensed-fishing':  'Unlicensed fishing',
    'flag-state-violation':'Flag-state violation',
    'IUU-fleet-presence':  'IUU fleet presence',
    'gear-incident':       'Gear incident',
  };
  return map[k];
}

export function enforcementKindLabel(e: EnforcementKind): string {
  const map: Record<EnforcementKind, string> = {
    'vessel-boarding':   'Vessel boarding',
    detention:           'Detention',
    'vessel-seizure':    'Vessel seizure',
    'fine-issued':       'Fine issued',
    release:             'Release',
    'diplomatic-protest':'Diplomatic protest',
  };
  return map[e];
}

export function confrontationIntensityLabel(c: ConfrontationIntensity): string {
  const map: Record<ConfrontationIntensity, string> = {
    observed:           'Observed',
    shadowing:          'Shadowing',
    'unsafe-maneuver':  'Unsafe maneuver',
    'live-fire-warning':'Live-fire warning',
  };
  return map[c];
}

export function confrontationIntensityColor(c: ConfrontationIntensity): string {
  const map: Record<ConfrontationIntensity, string> = {
    observed:           'var(--severity-none,     #9e9e9e)',
    shadowing:          'var(--severity-medium,   #facc15)',
    'unsafe-maneuver':  'var(--severity-high,     #fb923c)',
    'live-fire-warning':'var(--severity-critical, #ef4444)',
  };
  return map[c];
}

/** Map 0..100 heat to a band color. */
export function heatColor(heat: number): string {
  return bandColor(bandForScore(heat));
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

/** Composite 0–100 maritime-boundary-pressure score. Each axis saturates
 *  at its own scale so no single contributor can dominate. Weights:
 *    boundary disputes      20
 *    arbitration load       15
 *    militarization         20
 *    fisheries incursions   15
 *    enforcement incidents  15
 *    naval confrontations   15
 */
export function computeMaritimeBoundaryScore(input: {
  escalatingDisputes: number;
  activeArbitrations: number;
  highIntensityMilitarization: number;
  recentIncursionEvents: number;
  recentEnforcementIncidents: number;
  unsafeConfrontations: number;
}): MaritimeBoundaryCompositeScore {
  const boundaryDisputes      = clamp(input.escalatingDisputes / 4,             0, 1) * 20;
  const arbitrationLoad       = clamp(input.activeArbitrations / 5,             0, 1) * 15;
  const militarization        = clamp(input.highIntensityMilitarization / 4,    0, 1) * 20;
  const fisheriesIncursions   = clamp(input.recentIncursionEvents / 6,          0, 1) * 15;
  const enforcementIncidents  = clamp(input.recentEnforcementIncidents / 6,     0, 1) * 15;
  const navalConfrontations   = clamp(input.unsafeConfrontations / 3,           0, 1) * 15;
  const total = Math.round(
    boundaryDisputes + arbitrationLoad + militarization +
    fisheriesIncursions + enforcementIncidents + navalConfrontations,
  );
  return {
    total,
    band: bandForScore(total),
    contributions: {
      boundaryDisputes:      Math.round(boundaryDisputes),
      arbitrationLoad:       Math.round(arbitrationLoad),
      militarization:        Math.round(militarization),
      fisheriesIncursions:   Math.round(fisheriesIncursions),
      enforcementIncidents:  Math.round(enforcementIncidents),
      navalConfrontations:   Math.round(navalConfrontations),
    },
  };
}

// ── Aggregations / counters ──────────────────────────────────────

const RECENT_INCURSION_WINDOW_MS    = 30 * 24 * 60 * 60 * 1000;
const RECENT_ENFORCEMENT_WINDOW_MS  = 30 * 24 * 60 * 60 * 1000;
const RECENT_CONFRONTATION_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function countEscalatingDisputes(rows: readonly BoundaryDisputeEvent[]): number {
  return rows.filter((r) => r.status === 'escalating').length;
}

export function countActiveArbitrations(rows: readonly UnclosCaseRow[]): number {
  return rows.filter((r) => r.phase !== 'award-issued' && r.phase !== 'compliance-monitoring').length;
}

export function countHighIntensityMilitarization(rows: readonly MilitarizationSignal[]): number {
  return rows.filter((r) => r.intensity >= 70).length;
}

export function countRecentIncursionEvents(rows: readonly FisheriesIncursionEvent[], now: number = Date.now()): number {
  const cutoff = now - RECENT_INCURSION_WINDOW_MS;
  return rows.filter((r) => r.reportedAt >= cutoff).length;
}

export function countRecentEnforcementIncidents(rows: readonly MaritimeEnforcementIncident[], now: number = Date.now()): number {
  const cutoff = now - RECENT_ENFORCEMENT_WINDOW_MS;
  return rows.filter((r) => r.reportedAt >= cutoff).length;
}

export function countUnsafeConfrontations(rows: readonly NavalConfrontationEvent[], now: number = Date.now()): number {
  const cutoff = now - RECENT_CONFRONTATION_WINDOW_MS;
  return rows.filter((r) => {
    if (r.observedAt < cutoff) return false;
    return r.intensity === 'unsafe-maneuver' || r.intensity === 'live-fire-warning';
  }).length;
}

/** Aggregate dispute heat by region, sorted by heat desc. */
export function summarizeHeatByRegion(rows: readonly BoundaryDisputeEvent[]): RegionalHeatRow[] {
  const buckets = new Map<MaritimeRegion, { heatSum: number; count: number }>();
  for (const r of rows) {
    const bucket = buckets.get(r.region) ?? { heatSum: 0, count: 0 };
    bucket.heatSum += r.heatIndex;
    bucket.count   += 1;
    buckets.set(r.region, bucket);
  }
  return [...buckets.entries()]
    .map(([region, b]) => {
      const heat = b.count > 0 ? Math.round(b.heatSum / b.count) : 0;
      return {
        region,
        heat,
        band: bandForScore(heat),
        contributingClaims: b.count,
      };
    })
    .sort((a, b) => b.heat - a.heat);
}

/** Aggregate incursion vessel-count by region (last 30d), sorted desc. */
export function summarizeIncursionsByRegion(
  rows: readonly FisheriesIncursionEvent[],
  now: number = Date.now(),
): { region: MaritimeRegion; vesselCount: number; eventCount: number }[] {
  const cutoff = now - RECENT_INCURSION_WINDOW_MS;
  const buckets = new Map<MaritimeRegion, { vesselCount: number; eventCount: number }>();
  for (const r of rows) {
    if (r.reportedAt < cutoff) continue;
    const bucket = buckets.get(r.region) ?? { vesselCount: 0, eventCount: 0 };
    bucket.vesselCount += r.vesselCount;
    bucket.eventCount  += 1;
    buckets.set(r.region, bucket);
  }
  return [...buckets.entries()]
    .map(([region, b]) => ({ region, vesselCount: b.vesselCount, eventCount: b.eventCount }))
    .sort((a, b) => b.vesselCount - a.vesselCount);
}

// ── Static reference catalogues ───────────────────────────────────
//
// All dates are derived from Date.now() so the data ages naturally
// with the panel. Content is strictly observational / analytical —
// no operational specifics, no tactical detail. Each row is the
// kind of summary you'd see in a CSIS / IISS / USNI public bulletin.

export const BOUNDARY_DISPUTE_EVENTS: readonly BoundaryDisputeEvent[] = [
  { region: 'South China Sea',       partyA: 'Claimant A',  partyB: 'Claimant B',  kind: 'eez-overlap',        status: 'escalating',           heatIndex: 84, reportedAt: Date.now() -  2 * 24 * 60 * 60 * 1000, summary: 'Overlapping EEZ claim around contested feature; survey-ship activity reported.' },
  { region: 'East China Sea',        partyA: 'Claimant A',  partyB: 'Claimant C',  kind: 'island-sovereignty', status: 'active',               heatIndex: 67, reportedAt: Date.now() -  5 * 24 * 60 * 60 * 1000, summary: 'Sovereignty dispute over uninhabited island chain; routine patrol presence on both sides.' },
  { region: 'Arctic',                partyA: 'Claimant D',  partyB: 'Claimant E',  kind: 'continental-shelf',  status: 'arbitration-pending',  heatIndex: 52, reportedAt: Date.now() - 11 * 24 * 60 * 60 * 1000, summary: 'Continental-shelf extension filing under review; legal dispute, low kinetic risk.' },
  { region: 'Eastern Mediterranean', partyA: 'Claimant F',  partyB: 'Claimant G',  kind: 'eez-overlap',        status: 'escalating',           heatIndex: 78, reportedAt: Date.now() -  3 * 24 * 60 * 60 * 1000, summary: 'Hydrocarbon-survey block overlap reignites EEZ delimitation dispute.' },
  { region: 'Aegean',                partyA: 'Claimant F',  partyB: 'Claimant H',  kind: 'territorial-sea',    status: 'active',               heatIndex: 58, reportedAt: Date.now() -  7 * 24 * 60 * 60 * 1000, summary: 'Disagreement over territorial-sea breadth around contested islets.' },
  { region: 'Persian Gulf',          partyA: 'Claimant I',  partyB: 'Claimant J',  kind: 'baseline-claim',     status: 'active',               heatIndex: 49, reportedAt: Date.now() -  9 * 24 * 60 * 60 * 1000, summary: 'Straight-baseline claim disputed by neighbouring coastal state.' },
  { region: 'Sea of Japan',          partyA: 'Claimant C',  partyB: 'Claimant K',  kind: 'island-sovereignty', status: 'dormant',              heatIndex: 28, reportedAt: Date.now() - 18 * 24 * 60 * 60 * 1000, summary: 'Long-standing sovereignty claim; no recent activity.' },
  { region: 'Black Sea',             partyA: 'Claimant L',  partyB: 'Claimant M',  kind: 'eez-overlap',        status: 'escalating',           heatIndex: 71, reportedAt: Date.now() -  4 * 24 * 60 * 60 * 1000, summary: 'Wartime-overlay EEZ contestation; civilian shipping disruption signal.' },
  { region: 'Caribbean',             partyA: 'Claimant N',  partyB: 'Claimant O',  kind: 'transit-passage',    status: 'dormant',              heatIndex: 22, reportedAt: Date.now() - 25 * 24 * 60 * 60 * 1000, summary: 'Innocent / transit-passage interpretation dispute; legal-only.' },
  { region: 'Gulf of Guinea',        partyA: 'Claimant P',  partyB: 'Claimant Q',  kind: 'continental-shelf',  status: 'active',               heatIndex: 44, reportedAt: Date.now() - 13 * 24 * 60 * 60 * 1000, summary: 'Continental-shelf segment subject to overlapping concession licensing.' },
];

export const UNCLOS_CASE_DOCKET: readonly UnclosCaseRow[] = [
  { caseName: 'Case Alpha v. Bravo',   venue: 'Annex-VII-Tribunal', applicant: 'Applicant Alpha',  respondent: 'Respondent Bravo',  phase: 'hearings',     filedAt: Date.now() - 180 * 24 * 60 * 60 * 1000, region: 'South China Sea',       note: 'Annex VII tribunal hearings underway; jurisdictional objections resolved.' },
  { caseName: 'Case Charlie v. Delta', venue: 'ITLOS',              applicant: 'Applicant Charlie',respondent: 'Respondent Delta',  phase: 'pleadings',    filedAt: Date.now() -  90 * 24 * 60 * 60 * 1000, region: 'Eastern Mediterranean', note: 'Provisional measures requested; written pleadings phase.' },
  { caseName: 'Case Echo v. Foxtrot',  venue: 'ICJ',                applicant: 'Applicant Echo',   respondent: 'Respondent Foxtrot',phase: 'deliberation', filedAt: Date.now() - 540 * 24 * 60 * 60 * 1000, region: 'Caribbean',             note: 'Maritime delimitation deliberation phase; award expected next year.' },
  { caseName: 'Case Golf v. Hotel',    venue: 'PCA',                applicant: 'Applicant Golf',   respondent: 'Respondent Hotel',  phase: 'filed',        filedAt: Date.now() -  21 * 24 * 60 * 60 * 1000, region: 'Arctic',                note: 'Continental-shelf overlap filing; tribunal constitution pending.' },
  { caseName: 'Case India v. Juliet',  venue: 'Conciliation-Commission', applicant: 'Applicant India', respondent: 'Respondent Juliet', phase: 'award-issued',  filedAt: Date.now() - 730 * 24 * 60 * 60 * 1000, region: 'Sea of Japan',          note: 'Award issued; compliance phase under way.' },
  { caseName: 'Case Kilo v. Lima',     venue: 'Annex-VII-Tribunal', applicant: 'Applicant Kilo',   respondent: 'Respondent Lima',   phase: 'pleadings',    filedAt: Date.now() - 120 * 24 * 60 * 60 * 1000, region: 'Black Sea',             note: 'Wartime EEZ access dispute under arbitration.' },
];

export const MILITARIZATION_SIGNALS: readonly MilitarizationSignal[] = [
  { feature: 'Feature Subi',     region: 'South China Sea',       controllingClaimant: 'Claimant A', kind: 'runway-construction', intensity: 82, observedAt: Date.now() -  6 * 24 * 60 * 60 * 1000, rationale: 'Imagery shows extended runway hardstand and refuelling capacity.' },
  { feature: 'Feature Mischief', region: 'South China Sea',       controllingClaimant: 'Claimant A', kind: 'radar-emplacement',   intensity: 74, observedAt: Date.now() -  9 * 24 * 60 * 60 * 1000, rationale: 'New radar dome consistent with broad-area surveillance role.' },
  { feature: 'Feature Fiery',    region: 'South China Sea',       controllingClaimant: 'Claimant A', kind: 'missile-deployment',  intensity: 88, observedAt: Date.now() -  4 * 24 * 60 * 60 * 1000, rationale: 'Open-source imagery suggests coastal-defence cruise-missile transporter on feature.' },
  { feature: 'Feature Itu Aba',  region: 'South China Sea',       controllingClaimant: 'Claimant R', kind: 'garrison-rotation',   intensity: 41, observedAt: Date.now() - 17 * 24 * 60 * 60 * 1000, rationale: 'Routine garrison rotation reported; below escalation threshold.' },
  { feature: 'Feature Reed',     region: 'South China Sea',       controllingClaimant: 'Claimant B', kind: 'reclamation-fill',    intensity: 63, observedAt: Date.now() - 12 * 24 * 60 * 60 * 1000, rationale: 'Suction-dredger activity expanding reef footprint over recent months.' },
  { feature: 'Feature Senkaku-W',region: 'East China Sea',        controllingClaimant: 'Claimant A', kind: 'garrison-rotation',   intensity: 33, observedAt: Date.now() - 22 * 24 * 60 * 60 * 1000, rationale: 'Routine presence reported by both claimants.' },
  { feature: 'Feature Kastellorizo', region: 'Eastern Mediterranean', controllingClaimant: 'Claimant H', kind: 'port-expansion',  intensity: 55, observedAt: Date.now() -  8 * 24 * 60 * 60 * 1000, rationale: 'Civilian-dual-use port expansion noted in maritime trade journals.' },
];

export const FISHERIES_INCURSIONS: readonly FisheriesIncursionEvent[] = [
  { region: 'South China Sea',   flagState: 'Flag Alpha', hostState: 'Host Bravo',  kind: 'IUU-fleet-presence',   vesselCount: 140, reportedAt: Date.now() -  2 * 24 * 60 * 60 * 1000, notable: 'Large dark-fleet cluster observed inside contested EEZ.' },
  { region: 'Gulf of Guinea',    flagState: 'Flag Charlie', hostState: 'Host Delta', kind: 'unlicensed-fishing',   vesselCount:  18, reportedAt: Date.now() -  5 * 24 * 60 * 60 * 1000, notable: 'Foreign trawlers reported by coastal-state surveillance flight.' },
  { region: 'Eastern Mediterranean', flagState: 'Flag Echo', hostState: 'Host Foxtrot', kind: 'flag-state-violation', vesselCount: 6,  reportedAt: Date.now() -  9 * 24 * 60 * 60 * 1000, notable: 'Reflagging anomaly tracked across AIS-off intervals.' },
  { region: 'Caribbean',         flagState: 'Flag Golf', hostState: 'Host Hotel',  kind: 'unlicensed-fishing',   vesselCount:  11, reportedAt: Date.now() - 12 * 24 * 60 * 60 * 1000, notable: 'Patrol asset documented unlicensed activity inside EEZ.' },
  { region: 'Arctic',            flagState: 'Flag India', hostState: 'Host Juliet', kind: 'gear-incident',         vesselCount:   1, reportedAt: Date.now() - 16 * 24 * 60 * 60 * 1000, notable: 'Bottom-gear damage to subsea cable reported by operator.' },
  { region: 'Sea of Japan',      flagState: 'Flag Kilo', hostState: 'Host Lima',  kind: 'IUU-fleet-presence',     vesselCount:  60, reportedAt: Date.now() - 21 * 24 * 60 * 60 * 1000, notable: 'Recurring dark-fleet cluster documented over multiple seasons.' },
];

export const ENFORCEMENT_INCIDENTS: readonly MaritimeEnforcementIncident[] = [
  { region: 'South China Sea',       hostState: 'Host Bravo',   flagState: 'Flag Alpha', kind: 'vessel-boarding',   vesselCount: 3, reportedAt: Date.now() -  3 * 24 * 60 * 60 * 1000, outcome: 'Vessels boarded by coast-guard; documentation review.' },
  { region: 'Persian Gulf',          hostState: 'Host Mike',    flagState: 'Flag November', kind: 'detention',       vesselCount: 2, reportedAt: Date.now() -  7 * 24 * 60 * 60 * 1000, outcome: 'Detained pending crew interviews; flag state lodged protest.' },
  { region: 'Gulf of Guinea',        hostState: 'Host Delta',   flagState: 'Flag Charlie', kind: 'vessel-seizure',   vesselCount: 1, reportedAt: Date.now() - 11 * 24 * 60 * 60 * 1000, outcome: 'Vessel seized; cargo manifest under judicial review.' },
  { region: 'Eastern Mediterranean', hostState: 'Host Foxtrot', flagState: 'Flag Echo',  kind: 'fine-issued',        vesselCount: 1, reportedAt: Date.now() - 14 * 24 * 60 * 60 * 1000, outcome: 'Administrative fine issued; vessel released.' },
  { region: 'Caribbean',             hostState: 'Host Hotel',   flagState: 'Flag Golf',  kind: 'release',            vesselCount: 4, reportedAt: Date.now() - 19 * 24 * 60 * 60 * 1000, outcome: 'Vessels released after documentation regularised.' },
  { region: 'Aegean',                hostState: 'Host Hotel-2', flagState: 'Flag Foxtrot', kind: 'diplomatic-protest', vesselCount: 0, reportedAt: Date.now() -  6 * 24 * 60 * 60 * 1000, outcome: 'Formal note delivered through embassy channel.' },
];

export const NAVAL_CONFRONTATIONS: readonly NavalConfrontationEvent[] = [
  { region: 'South China Sea',       partyA: 'Patrol Alpha',  partyB: 'Patrol Bravo',   intensity: 'unsafe-maneuver',   observedAt: Date.now() -  1 * 24 * 60 * 60 * 1000, summary: 'Close-approach maneuver documented during freedom-of-navigation transit.' },
  { region: 'Black Sea',             partyA: 'Patrol Lima',   partyB: 'Patrol Mike',    intensity: 'live-fire-warning', observedAt: Date.now() -  2 * 24 * 60 * 60 * 1000, summary: 'Warning shots fired across bow of merchant in disputed exclusion zone.' },
  { region: 'Persian Gulf',          partyA: 'Patrol November', partyB: 'Patrol Oscar', intensity: 'shadowing',         observedAt: Date.now() -  4 * 24 * 60 * 60 * 1000, summary: 'Sustained shadowing of survey vessel by coastal patrol craft.' },
  { region: 'East China Sea',        partyA: 'Patrol Papa',   partyB: 'Patrol Quebec',  intensity: 'observed',          observedAt: Date.now() -  6 * 24 * 60 * 60 * 1000, summary: 'Routine patrol presence around contested feature; no escalation.' },
  { region: 'Eastern Mediterranean', partyA: 'Patrol Romeo',  partyB: 'Patrol Sierra',  intensity: 'unsafe-maneuver',   observedAt: Date.now() -  5 * 24 * 60 * 60 * 1000, summary: 'Bow-crossing maneuver during energy-survey escort.' },
  { region: 'Aegean',                partyA: 'Patrol Tango',  partyB: 'Patrol Uniform', intensity: 'observed',          observedAt: Date.now() - 10 * 24 * 60 * 60 * 1000, summary: 'Mutual observation along disputed delimitation line.' },
];
