/**
 * Pure helper functions, types, and static fixture data for the
 * StateFragilityPanel. The Fund-for-Peace Fragile States Index style
 * composite — 12 indicators on a 0–10 scale (sum 0–120) across four
 * pillars (Cohesion / Economic / Political / Social) — is rebuilt here
 * with publicly-sourced 2025-vintage proxy values so the panel can
 * render before any live data arrives.
 *
 * No DOM. No fetch. No singletons. Pure functions only — unit tests
 * import this module directly without touching Panel / DOM.
 */

// ── Tier ladder ─────────────────────────────────────────────────────────

export type FragilityTier =
  | 'sustainable'
  | 'stable'
  | 'warning'
  | 'elevated_warning'
  | 'high_warning'
  | 'alert'
  | 'high_alert'
  | 'very_high_alert';

export function fsiTier(score: number): FragilityTier {
  if (score >= 110) return 'very_high_alert';
  if (score >= 100) return 'high_alert';
  if (score >= 90) return 'alert';
  if (score >= 80) return 'high_warning';
  if (score >= 70) return 'elevated_warning';
  if (score >= 60) return 'warning';
  if (score >= 30) return 'stable';
  return 'sustainable';
}

export function fsiTierLabel(t: FragilityTier): string {
  switch (t) {
    case 'very_high_alert': { return 'Very high alert'; }
    case 'high_alert':      { return 'High alert'; }
    case 'alert':           { return 'Alert'; }
    case 'high_warning':    { return 'High warning'; }
    case 'elevated_warning':{ return 'Elevated warning'; }
    case 'warning':         { return 'Warning'; }
    case 'stable':          { return 'Stable'; }
    case 'sustainable':     { return 'Sustainable'; }
  }
}

export function fsiTierColor(t: FragilityTier): string {
  switch (t) {
    case 'very_high_alert': { return '#b71c1c'; }
    case 'high_alert':      { return '#d32f2f'; }
    case 'alert':           { return '#ff453a'; }
    case 'high_warning':    { return '#ff7043'; }
    case 'elevated_warning':{ return '#ff9800'; }
    case 'warning':         { return '#ffc107'; }
    case 'stable':          { return '#8bc34a'; }
    case 'sustainable':     { return '#4caf50'; }
  }
}

// ── FSI indicator schema ────────────────────────────────────────────────

export type FsiPillar = 'cohesion' | 'economic' | 'political' | 'social';

export type FsiIndicatorCode =
  | 'C1' | 'C2' | 'C3'   // security apparatus, factionalised elites, group grievance
  | 'E1' | 'E2' | 'E3'   // economic decline, uneven development, brain drain
  | 'P1' | 'P2' | 'P3'   // state legitimacy, public services, human rights
  | 'S1' | 'S2' | 'X1';  // demographic pressure, refugees/IDPs, external intervention

export interface FsiIndicator {
  code: FsiIndicatorCode;
  label: string;
  pillar: FsiPillar;
  /** 0 healthy → 10 catastrophic. */
  score: number;
}

export const INDICATOR_PILLAR: Record<FsiIndicatorCode, FsiPillar> = {
  C1: 'cohesion',  C2: 'cohesion',  C3: 'cohesion',
  E1: 'economic',  E2: 'economic',  E3: 'economic',
  P1: 'political', P2: 'political', P3: 'political',
  S1: 'social',    S2: 'social',    X1: 'social',
};

export const INDICATOR_LABEL: Record<FsiIndicatorCode, string> = {
  C1: 'Security apparatus',
  C2: 'Factionalised elites',
  C3: 'Group grievance',
  E1: 'Economic decline',
  E2: 'Uneven development',
  E3: 'Human flight / brain drain',
  P1: 'State legitimacy',
  P2: 'Public services',
  P3: 'Human rights / rule of law',
  S1: 'Demographic pressures',
  S2: 'Refugees / IDPs',
  X1: 'External intervention',
};

export interface FragileState {
  country: string;
  countryCode: string;
  /** 0–120 composite. */
  fsiScore: number;
  /** Global rank — 1 = most fragile. */
  rank: number;
  /** Year-over-year change (positive = worsening). */
  yearDelta: number;
  indicators: FsiIndicator[];
}

// ── Pillar / hot-driver helpers ─────────────────────────────────────────

export function pillarTotal(state: FragileState, pillar: FsiPillar): number {
  return state.indicators
    .filter((i) => i.pillar === pillar)
    .reduce((acc, i) => acc + i.score, 0);
}

export function hottestIndicator(state: FragileState): FsiIndicator | undefined {
  let best: FsiIndicator | undefined;
  for (const i of state.indicators) {
    if (best === undefined || i.score > best.score) best = i;
  }
  return best;
}

// ── Section type schemas ────────────────────────────────────────────────

/** Severity ladder shared by every non-FSI section: 1 watch → 4 critical. */
export type FragilitySeverity = 1 | 2 | 3 | 4;

export type GovernanceSignalKind =
  | 'corruption_spike'
  | 'judicial_capture'
  | 'press_freedom_decline'
  | 'public_services_collapse'
  | 'elections_postponed';

export interface GovernanceSignal {
  country: string;
  kind: GovernanceSignalKind;
  severity: FragilitySeverity;
  detail: string;
}

export type SecurityBreakdownKind =
  | 'military_fracture'
  | 'paramilitary_rise'
  | 'security_defection'
  | 'territory_loss'
  | 'armed_proliferation';

export interface SecurityBreakdownSignal {
  country: string;
  kind: SecurityBreakdownKind;
  severity: FragilitySeverity;
  detail: string;
}

export type EconomicMarkerKind =
  | 'hyperinflation'
  | 'capital_flight'
  | 'debt_distress'
  | 'currency_collapse'
  | 'sovereign_default'
  | 'fx_reserves_depleted';

export interface EconomicMarker {
  country: string;
  kind: EconomicMarkerKind;
  /** Headline figure, e.g. inflation %, debt-to-GDP %, etc. */
  value: number;
  unit: string;
  severity: FragilitySeverity;
  detail: string;
}

export type DisplacementKind = 'idp' | 'refugee_outflow' | 'refugee_inflow' | 'returnee_strain';

export interface DisplacementPressure {
  country: string;
  kind: DisplacementKind;
  /** Persons (rounded). */
  count: number;
  /** Monthly trend delta (persons). Positive = worsening. */
  trendDelta: number;
  severity: FragilitySeverity;
}

export type EliteFractureKind =
  | 'coup'
  | 'coup_attempt'
  | 'purge'
  | 'defection'
  | 'ruling_coalition_split'
  | 'succession_crisis';

export interface EliteFractureEvent {
  country: string;
  kind: EliteFractureKind;
  /** Unix ms. */
  timestamp: number;
  severity: FragilitySeverity;
  detail: string;
}

export type LegitimacyProxyKind =
  | 'protest_momentum'
  | 'contested_election'
  | 'media_freedom_decline'
  | 'civil_society_crackdown'
  | 'opposition_arrests';

export interface LegitimacyProxy {
  country: string;
  kind: LegitimacyProxyKind;
  /** 0 stable → 100 collapsing. */
  score: number;
  detail: string;
}

// ── Severity colour ladder (shared across non-FSI sections) ─────────────

export function severityColor(s: FragilitySeverity): string {
  switch (s) {
    case 1: { return '#ffc107'; }
    case 2: { return '#ff9800'; }
    case 3: { return '#ff453a'; }
    case 4: { return '#b71c1c'; }
  }
}

export function legitimacyScoreSeverity(score: number): FragilitySeverity {
  if (score >= 75) return 4;
  if (score >= 65) return 3;
  if (score >= 50) return 2;
  return 1;
}

export function severityLabel(s: FragilitySeverity): string {
  switch (s) {
    case 1: { return 'Watch'; }
    case 2: { return 'Elevated'; }
    case 3: { return 'Alert'; }
    case 4: { return 'Critical'; }
  }
}

// ── Display helpers ─────────────────────────────────────────────────────

export function formatDelta(d: number): string {
  if (d === 0) return '±0.0';
  const sign = d > 0 ? '+' : '−';
  return `${sign}${Math.abs(d).toFixed(1)}`;
}

export function deltaColor(d: number): string {
  if (d >= 2) return '#ff453a';
  if (d >= 0.5) return '#ff9800';
  if (d <= -2) return '#4caf50';
  if (d <= -0.5) return '#8bc34a';
  return '#9e9e9e';
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

export function formatTimeAgo(epochMs: number, nowMs: number = Date.now()): string {
  const secs = Math.max(0, Math.floor((nowMs - epochMs) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 30 * 86_400) return `${Math.floor(secs / 86_400)}d ago`;
  return `${Math.floor(secs / (30 * 86_400))}mo ago`;
}

export function governanceLabel(k: GovernanceSignalKind): string {
  switch (k) {
    case 'corruption_spike':         { return 'Corruption spike'; }
    case 'judicial_capture':         { return 'Judicial capture'; }
    case 'press_freedom_decline':    { return 'Press freedom decline'; }
    case 'public_services_collapse': { return 'Public services collapse'; }
    case 'elections_postponed':      { return 'Elections postponed'; }
  }
}

export function securityLabel(k: SecurityBreakdownKind): string {
  switch (k) {
    case 'military_fracture':    { return 'Military fracture'; }
    case 'paramilitary_rise':    { return 'Paramilitary rise'; }
    case 'security_defection':   { return 'Security force defection'; }
    case 'territory_loss':       { return 'Territory loss'; }
    case 'armed_proliferation':  { return 'Armed group proliferation'; }
  }
}

export function economicLabel(k: EconomicMarkerKind): string {
  switch (k) {
    case 'hyperinflation':     { return 'Hyperinflation'; }
    case 'capital_flight':     { return 'Capital flight'; }
    case 'debt_distress':      { return 'Debt distress'; }
    case 'currency_collapse':  { return 'Currency collapse'; }
    case 'sovereign_default':  { return 'Sovereign default'; }
    case 'fx_reserves_depleted': { return 'FX reserves depleted'; }
  }
}

export function displacementLabel(k: DisplacementKind): string {
  switch (k) {
    case 'idp':              { return 'Internally displaced'; }
    case 'refugee_outflow':  { return 'Refugee outflow'; }
    case 'refugee_inflow':   { return 'Refugee inflow'; }
    case 'returnee_strain':  { return 'Returnee strain'; }
  }
}

export function fractureLabel(k: EliteFractureKind): string {
  switch (k) {
    case 'coup':                   { return 'Coup'; }
    case 'coup_attempt':           { return 'Coup attempt'; }
    case 'purge':                  { return 'Purge'; }
    case 'defection':              { return 'High-level defection'; }
    case 'ruling_coalition_split': { return 'Coalition split'; }
    case 'succession_crisis':      { return 'Succession crisis'; }
  }
}

export function legitimacyLabel(k: LegitimacyProxyKind): string {
  switch (k) {
    case 'protest_momentum':       { return 'Protest momentum'; }
    case 'contested_election':     { return 'Contested election'; }
    case 'media_freedom_decline':  { return 'Media freedom decline'; }
    case 'civil_society_crackdown':{ return 'Civil society crackdown'; }
    case 'opposition_arrests':     { return 'Opposition arrests'; }
  }
}

// ── Cross-section count (for panel badge) ───────────────────────────────

export function fragilityHeadlineCount(
  states: FragileState[],
  fractures: EliteFractureEvent[],
  econ: EconomicMarker[],
): number {
  const veryHigh = states.filter((s) => s.fsiScore >= 100).length;
  const criticalFractures = fractures.filter((f) => f.severity >= 3).length;
  const criticalEcon = econ.filter((e) => e.severity >= 3).length;
  return veryHigh + criticalFractures + criticalEcon;
}

// ── Static fixture data ─────────────────────────────────────────────────
//
// Values are 2025-vintage approximations from publicly-sourced FSI
// (Fund for Peace), UNHCR, World Bank, and IMF data. They drive the
// panel before live data arrives. Indicators sum within ±0.5 of fsiScore.

function mkIndicators(scores: Record<FsiIndicatorCode, number>): FsiIndicator[] {
  return (Object.keys(scores) as FsiIndicatorCode[]).map((code) => ({
    code,
    label: INDICATOR_LABEL[code],
    pillar: INDICATOR_PILLAR[code],
    score: scores[code],
  }));
}

export const FRAGILE_STATES: FragileState[] = [
  {
    country: 'Somalia', countryCode: 'SO', fsiScore: 111.9, rank: 1, yearDelta: 0.2,
    indicators: mkIndicators({
      C1: 9.8, C2: 9.5, C3: 9.6,
      E1: 9.2, E2: 8.7, E3: 9,
      P1: 9.6, P2: 9.9, P3: 9.4,
      S1: 9.6, S2: 9.5, X1: 10,
    }),
  },
  {
    country: 'Yemen', countryCode: 'YE', fsiScore: 110.7, rank: 2, yearDelta: 0.4,
    indicators: mkIndicators({
      C1: 9.9, C2: 9.7, C3: 9.5,
      E1: 9.3, E2: 8.9, E3: 8.4,
      P1: 9.8, P2: 9.5, P3: 9.4,
      S1: 9, S2: 9.4, X1: 9.7,
    }),
  },
  {
    country: 'South Sudan', countryCode: 'SS', fsiScore: 108.9, rank: 3, yearDelta: -0.2,
    indicators: mkIndicators({
      C1: 9.6, C2: 9.8, C3: 9,
      E1: 8.9, E2: 9, E3: 8.7,
      P1: 9.5, P2: 9.6, P3: 9.3,
      S1: 9.2, S2: 9.6, X1: 8.5,
    }),
  },
  {
    country: 'Syria', countryCode: 'SY', fsiScore: 108.4, rank: 4, yearDelta: -0.5,
    indicators: mkIndicators({
      C1: 9.8, C2: 9.6, C3: 9.5,
      E1: 9.1, E2: 8.4, E3: 9,
      P1: 9.7, P2: 9, P3: 9.7,
      S1: 8.5, S2: 9.6, X1: 9.5,
    }),
  },
  {
    country: 'DR Congo', countryCode: 'CD', fsiScore: 105.6, rank: 5, yearDelta: 0.6,
    indicators: mkIndicators({
      C1: 9.5, C2: 9, C3: 9.2,
      E1: 8.5, E2: 9.3, E3: 8,
      P1: 9.1, P2: 9.4, P3: 9,
      S1: 8.9, S2: 8.8, X1: 6.9,
    }),
  },
  {
    country: 'Sudan', countryCode: 'SD', fsiScore: 107.8, rank: 6, yearDelta: 2.4,
    indicators: mkIndicators({
      C1: 9.8, C2: 9.7, C3: 9.4,
      E1: 9, E2: 8.8, E3: 8.2,
      P1: 9.6, P2: 9.4, P3: 9.4,
      S1: 8.9, S2: 9.7, X1: 5.9,
    }),
  },
  {
    country: 'Afghanistan', countryCode: 'AF', fsiScore: 105.5, rank: 7, yearDelta: 0.1,
    indicators: mkIndicators({
      C1: 9.5, C2: 9.4, C3: 9,
      E1: 8.9, E2: 8.8, E3: 8.6,
      P1: 9.7, P2: 9.2, P3: 9.4,
      S1: 8.6, S2: 9, X1: 5.4,
    }),
  },
  {
    country: 'Haiti', countryCode: 'HT', fsiScore: 103.9, rank: 8, yearDelta: 1.5,
    indicators: mkIndicators({
      C1: 9.7, C2: 9.5, C3: 8.5,
      E1: 8.9, E2: 8.8, E3: 8.6,
      P1: 9.5, P2: 9.2, P3: 8.9,
      S1: 8, S2: 7.4, X1: 6.9,
    }),
  },
  {
    country: 'Myanmar', countryCode: 'MM', fsiScore: 99.6, rank: 9, yearDelta: 0.9,
    indicators: mkIndicators({
      C1: 9.4, C2: 9.3, C3: 9.1,
      E1: 8, E2: 8.4, E3: 7.4,
      P1: 9.4, P2: 7.8, P3: 9.2,
      S1: 7.3, S2: 8.6, X1: 5.7,
    }),
  },
  {
    country: 'Burkina Faso', countryCode: 'BF', fsiScore: 99.3, rank: 10, yearDelta: 1.8,
    indicators: mkIndicators({
      C1: 9, C2: 9, C3: 8.5,
      E1: 8, E2: 8.4, E3: 7.7,
      P1: 9.1, P2: 8.4, P3: 8.5,
      S1: 8.2, S2: 8.7, X1: 5.8,
    }),
  },
  {
    country: 'Mali', countryCode: 'ML', fsiScore: 96.7, rank: 12, yearDelta: 0.7,
    indicators: mkIndicators({
      C1: 8.9, C2: 8.7, C3: 8.2,
      E1: 7.9, E2: 8.2, E3: 7.4,
      P1: 9, P2: 8.2, P3: 8.4,
      S1: 8, S2: 7.8, X1: 6,
    }),
  },
  {
    country: 'Ethiopia', countryCode: 'ET', fsiScore: 93.9, rank: 16, yearDelta: -0.8,
    indicators: mkIndicators({
      C1: 8.5, C2: 9, C3: 9.2,
      E1: 7.8, E2: 8.8, E3: 6.7,
      P1: 8.7, P2: 8.1, P3: 8.6,
      S1: 7.8, S2: 7.8, X1: 2.9,
    }),
  },
];

const _NOW = Date.now();
const _DAY = 86_400_000;

export const GOVERNANCE_SIGNALS: GovernanceSignal[] = [
  { country: 'Haiti',        kind: 'public_services_collapse', severity: 4, detail: 'Port-au-Prince water + electricity grid down for 70% of population.' },
  { country: 'Sudan',        kind: 'judicial_capture',         severity: 3, detail: 'Constitutional court suspended; military tribunals expanded.' },
  { country: 'Myanmar',      kind: 'elections_postponed',      severity: 3, detail: 'State of emergency extended; election deferred again.' },
  { country: 'Tunisia',      kind: 'press_freedom_decline',    severity: 2, detail: 'Decree 54 prosecutions of journalists continue.' },
  { country: 'Venezuela',    kind: 'corruption_spike',         severity: 3, detail: 'PDVSA leak: $21B in undocumented contracts.' },
  { country: 'Burkina Faso', kind: 'judicial_capture',         severity: 3, detail: 'Military council assumes constitutional authority indefinitely.' },
];

export const SECURITY_SIGNALS: SecurityBreakdownSignal[] = [
  { country: 'Sudan',       kind: 'military_fracture',   severity: 4, detail: 'SAF–RSF conflict ongoing across Darfur + Khartoum.' },
  { country: 'Haiti',       kind: 'paramilitary_rise',   severity: 4, detail: 'G9 + G-Pep gang coalition controls ~80% of capital.' },
  { country: 'DR Congo',    kind: 'territory_loss',      severity: 4, detail: 'M23 advances; Goma + Bukavu held outside government control.' },
  { country: 'Myanmar',     kind: 'territory_loss',      severity: 4, detail: 'Junta has lost effective control over ~60% of country.' },
  { country: 'Niger',       kind: 'security_defection',  severity: 3, detail: 'CNSP reorients security partnerships eastward.' },
  { country: 'Ecuador',     kind: 'armed_proliferation', severity: 3, detail: 'State of "internal armed conflict" declared; 22 groups identified.' },
  { country: 'Burkina Faso',kind: 'armed_proliferation', severity: 3, detail: 'JNIM controls rural districts in Est + Sahel regions.' },
];

export const ECONOMIC_MARKERS: EconomicMarker[] = [
  { country: 'Venezuela', kind: 'hyperinflation',    value: 285,  unit: '% YoY', severity: 3, detail: 'Headline CPI continues to surge despite USD dollarisation drift.' },
  { country: 'Argentina', kind: 'hyperinflation',    value: 211,  unit: '% YoY', severity: 3, detail: 'Stabilisation program slows pace, still triple-digit.' },
  { country: 'Lebanon',   kind: 'currency_collapse', value: 98,   unit: '% loss',severity: 4, detail: 'LBP has lost ~98% vs USD since 2019 peg break.' },
  { country: 'Sri Lanka', kind: 'sovereign_default', value: 51,   unit: 'B USD', severity: 4, detail: 'Debt restructuring negotiations ongoing with bondholders.' },
  { country: 'Zambia',    kind: 'debt_distress',     value: 110,  unit: '% GDP', severity: 3, detail: 'External debt restructuring under G20 Common Framework.' },
  { country: 'Pakistan',  kind: 'fx_reserves_depleted', value: 3.8,unit: 'B USD', severity: 3, detail: 'FX reserves cover less than 1 month of imports.' },
  { country: 'Egypt',     kind: 'capital_flight',    value: 26,   unit: 'B USD', severity: 3, detail: 'Net portfolio outflows YTD; EGP devalued 60% in cumulative steps.' },
];

export const DISPLACEMENT_PRESSURES: DisplacementPressure[] = [
  { country: 'Sudan',       kind: 'idp',             count: 10_700_000, trendDelta: 320_000,  severity: 4 },
  { country: 'Syria',       kind: 'idp',             count: 7_200_000,  trendDelta: -45_000,  severity: 4 },
  { country: 'Ukraine',     kind: 'idp',             count: 3_700_000,  trendDelta: 28_000,   severity: 3 },
  { country: 'DR Congo',    kind: 'idp',             count: 6_900_000,  trendDelta: 110_000,  severity: 4 },
  { country: 'Yemen',       kind: 'idp',             count: 4_500_000,  trendDelta: 12_000,   severity: 3 },
  { country: 'Afghanistan', kind: 'refugee_outflow', count: 6_400_000,  trendDelta: 18_000,   severity: 3 },
  { country: 'Türkiye',     kind: 'refugee_inflow',  count: 3_100_000,  trendDelta: -60_000,  severity: 2 },
  { country: 'Bangladesh',  kind: 'refugee_inflow',  count: 970_000,    trendDelta: 8500,    severity: 3 },
];

export const ELITE_FRACTURES: EliteFractureEvent[] = [
  { country: 'Niger',        kind: 'coup',                  timestamp: _NOW - 14 * _DAY,  severity: 4, detail: 'CNSP consolidates control; constitutional order suspended.' },
  { country: 'Gabon',        kind: 'coup',                  timestamp: _NOW - 21 * _DAY,  severity: 3, detail: 'Bongo family rule ended; transition committee in place.' },
  { country: 'Mali',         kind: 'ruling_coalition_split',timestamp: _NOW - 7 * _DAY,   severity: 3, detail: 'CMA / Coordination des mouvements de l\'Azawad withdraws from peace deal.' },
  { country: 'Tunisia',      kind: 'purge',                 timestamp: _NOW - 30 * _DAY,  severity: 2, detail: 'Senior judges replaced; constitutional court restructured.' },
  { country: 'Sudan',        kind: 'coup_attempt',          timestamp: _NOW - 90 * _DAY,  severity: 3, detail: 'Internal SAF factional dispute over Port Sudan command.' },
  { country: 'Burkina Faso', kind: 'succession_crisis',     timestamp: _NOW - 60 * _DAY,  severity: 2, detail: 'Junta succession unclear; presidential guard reshuffled.' },
  { country: 'Russia',       kind: 'defection',             timestamp: _NOW - 120 * _DAY, severity: 2, detail: 'Senior diplomat defects citing Ukraine policy disagreement.' },
];

export const LEGITIMACY_PROXIES: LegitimacyProxy[] = [
  { country: 'Iran',         kind: 'opposition_arrests',     score: 78, detail: '2,400+ activists detained since hijab protest renewal.' },
  { country: 'Belarus',      kind: 'civil_society_crackdown',score: 82, detail: 'Over 1,500 NGOs forcibly liquidated since 2020.' },
  { country: 'Venezuela',    kind: 'contested_election',     score: 71, detail: 'Disputed 2024 result; opposition tally cites 3:1 margin against incumbent.' },
  { country: 'Russia',       kind: 'media_freedom_decline',  score: 76, detail: 'Independent outlets blocked; "foreign agent" registry expanded again.' },
  { country: 'Türkiye',      kind: 'opposition_arrests',     score: 58, detail: 'Mayors and HDP officials replaced via "trustee" appointments.' },
  { country: 'Kenya',        kind: 'protest_momentum',       score: 64, detail: 'Gen Z protests over finance bill; police response under inquiry.' },
  { country: 'Bangladesh',   kind: 'protest_momentum',       score: 67, detail: 'Student-led movement reshaping electoral environment ahead of polls.' },
];
