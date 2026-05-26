/**
 * Pure helpers, types, and static fixture data for the HybridWarfarePanel.
 *
 * Strictly analytical monitoring framing: this module classifies and
 * scores publicly reported hybrid-operation indicators. It does not
 * generate or recommend actions. Every record carries an `attribution`
 * tier reflecting the deniability profile of the reported activity.
 *
 * No DOM. No fetch. No singletons. Pure functions only — unit tests
 * import this module directly.
 */

// ── Severity ladder (shared across all sections) ────────────────────────

export type HybridSeverity = 1 | 2 | 3 | 4;

export function severityColor(s: HybridSeverity): string {
  switch (s) {
    case 1: { return '#ffc107'; }
    case 2: { return '#ff9800'; }
    case 3: { return '#f44336'; }
    case 4: { return '#b71c1c'; }
  }
}

export function severityLabel(s: HybridSeverity): string {
  switch (s) {
    case 1: { return 'Watch'; }
    case 2: { return 'Elevated'; }
    case 3: { return 'Alert'; }
    case 4: { return 'Critical'; }
  }
}

// ── Attribution tier ────────────────────────────────────────────────────

export type AttributionTier = 'unknown' | 'suspected' | 'likely' | 'confirmed';

export function attributionLabel(t: AttributionTier): string {
  switch (t) {
    case 'unknown':   { return 'Unknown'; }
    case 'suspected': { return 'Suspected'; }
    case 'likely':    { return 'Likely'; }
    case 'confirmed': { return 'Confirmed'; }
  }
}

export function attributionColor(t: AttributionTier): string {
  switch (t) {
    case 'confirmed': { return '#b71c1c'; }
    case 'likely':    { return '#f44336'; }
    case 'suspected': { return '#ff9800'; }
    case 'unknown':   { return '#9e9e9e'; }
  }
}

/** Map a 0–100 confidence to a deniability-aware attribution tier. */
export function attributionFromConfidence(conf: number): AttributionTier {
  if (conf >= 85) return 'confirmed';
  if (conf >= 60) return 'likely';
  if (conf >= 30) return 'suspected';
  return 'unknown';
}

// ── Hybrid vectors + coordination ───────────────────────────────────────

export type HybridVector =
  | 'cyber'
  | 'disinfo'
  | 'proxy_force'
  | 'economic_coercion'
  | 'lawfare'
  | 'kinetic_deniable';

export function vectorLabel(v: HybridVector): string {
  switch (v) {
    case 'cyber':             { return 'Cyber'; }
    case 'disinfo':           { return 'Disinfo'; }
    case 'proxy_force':       { return 'Proxy force'; }
    case 'economic_coercion': { return 'Economic coercion'; }
    case 'lawfare':           { return 'Lawfare'; }
    case 'kinetic_deniable':  { return 'Kinetic (deniable)'; }
  }
}

export interface HybridOperationIndicator {
  id: string;
  /** Short label of the target / theatre. */
  target: string;
  /** Suspected sponsor (or 'unknown'). */
  actor: string;
  attribution: AttributionTier;
  vectors: HybridVector[];
  severity: HybridSeverity;
  timestamp: number;
  summary: string;
}

/** Returns the count of distinct vectors present in an indicator. */
export function vectorCount(op: HybridOperationIndicator): number {
  return new Set(op.vectors).size;
}

/** Two or more vectors = the canonical "hybrid" coordination floor. */
export function isCoordinated(op: HybridOperationIndicator): boolean {
  return vectorCount(op) >= 2;
}

/**
 * Composite hybrid coordination score (0–100): rewards vector breadth,
 * attribution confidence, and recency. Used to rank the lead section.
 */
export function coordinationScore(op: HybridOperationIndicator, nowMs: number = Date.now()): number {
  const breadth = Math.min(4, vectorCount(op)) * 18; // up to 72
  const attrBoost: Record<AttributionTier, number> = {
    unknown: 0, suspected: 6, likely: 12, confirmed: 18,
  };
  const ageDays = Math.max(0, (nowMs - op.timestamp) / 86_400_000);
  const recency = Math.max(0, 10 - Math.floor(ageDays));
  return Math.min(100, breadth + attrBoost[op.attribution] + recency);
}

// ── Grey-zone activity ──────────────────────────────────────────────────

export type GreyZoneActivityKind =
  | 'gps_jamming'
  | 'cable_approach'
  | 'airspace_incursion'
  | 'exclave_pressure'
  | 'maritime_harassment'
  | 'fishing_fleet_swarm'
  | 'border_provocation';

export function greyZoneLabel(k: GreyZoneActivityKind): string {
  switch (k) {
    case 'gps_jamming':         { return 'GPS jamming'; }
    case 'cable_approach':      { return 'Cable approach'; }
    case 'airspace_incursion':  { return 'Airspace incursion'; }
    case 'exclave_pressure':    { return 'Exclave pressure'; }
    case 'maritime_harassment': { return 'Maritime harassment'; }
    case 'fishing_fleet_swarm': { return 'Fishing fleet swarm'; }
    case 'border_provocation':  { return 'Border provocation'; }
  }
}

export interface GreyZoneActivity {
  id: string;
  region: string;
  actor: string;
  kind: GreyZoneActivityKind;
  attribution: AttributionTier;
  severity: HybridSeverity;
  timestamp: number;
  detail: string;
}

// ── Election interference ───────────────────────────────────────────────

export type ElectionInterferenceKind =
  | 'disinfo_campaign'
  | 'hack_and_leak'
  | 'voter_suppression'
  | 'foreign_donations'
  | 'fake_amplification'
  | 'deepfake_circulation';

export function interferenceLabel(k: ElectionInterferenceKind): string {
  switch (k) {
    case 'disinfo_campaign':     { return 'Disinformation campaign'; }
    case 'hack_and_leak':        { return 'Hack-and-leak'; }
    case 'voter_suppression':    { return 'Voter suppression'; }
    case 'foreign_donations':    { return 'Foreign donations'; }
    case 'fake_amplification':   { return 'Fake amplification'; }
    case 'deepfake_circulation': { return 'Deepfake circulation'; }
  }
}

export interface ElectionInterferenceSignal {
  id: string;
  targetCountry: string;
  /** ISO date of the election the activity targets. */
  electionDate: string;
  kind: ElectionInterferenceKind;
  actor: string;
  attribution: AttributionTier;
  severity: HybridSeverity;
  detail: string;
}

// ── Infrastructure sabotage ─────────────────────────────────────────────

export type InfrastructureSabotageKind =
  | 'pipeline'
  | 'undersea_cable'
  | 'power_grid'
  | 'satellite'
  | 'water_supply'
  | 'rail_network'
  | 'gps_signal';

export function sabotageLabel(k: InfrastructureSabotageKind): string {
  switch (k) {
    case 'pipeline':       { return 'Pipeline'; }
    case 'undersea_cable': { return 'Undersea cable'; }
    case 'power_grid':     { return 'Power grid'; }
    case 'satellite':      { return 'Satellite'; }
    case 'water_supply':   { return 'Water supply'; }
    case 'rail_network':   { return 'Rail network'; }
    case 'gps_signal':     { return 'GPS signal'; }
  }
}

export interface InfrastructureSabotageEvent {
  id: string;
  region: string;
  asset: string;
  kind: InfrastructureSabotageKind;
  actor: string;
  attribution: AttributionTier;
  severity: HybridSeverity;
  timestamp: number;
  detail: string;
}

// ── Proxy force mobilization ────────────────────────────────────────────

export type ProxyForceKind =
  | 'pmc_deployment'
  | 'non_state_arming'
  | 'volunteer_legion'
  | 'paramilitary_buildup'
  | 'maritime_militia';

export function proxyLabel(k: ProxyForceKind): string {
  switch (k) {
    case 'pmc_deployment':       { return 'PMC deployment'; }
    case 'non_state_arming':     { return 'Non-state arming'; }
    case 'volunteer_legion':     { return 'Volunteer legion'; }
    case 'paramilitary_buildup': { return 'Paramilitary buildup'; }
    case 'maritime_militia':     { return 'Maritime militia'; }
  }
}

export interface ProxyForceMobilization {
  id: string;
  region: string;
  proxyName: string;
  patron: string;
  kind: ProxyForceKind;
  attribution: AttributionTier;
  /** Rough estimated head-count of the mobilization. */
  estimatedStrength: number;
  severity: HybridSeverity;
  detail: string;
}

// ── Per-actor attribution confidence ────────────────────────────────────

export interface ActorAttributionProfile {
  actor: string;
  /** 0–100 aggregate analytical confidence across recent activity. */
  confidence: number;
  /** Count of distinct vectors observed in the trailing window. */
  observedVectors: number;
  /** Count of recent indicators tied to this actor. */
  recentIndicators: number;
  notes: string;
}

export function actorTier(profile: ActorAttributionProfile): AttributionTier {
  return attributionFromConfidence(profile.confidence);
}

// ── Format helpers ──────────────────────────────────────────────────────

export function formatTimeAgo(epochMs: number, nowMs: number = Date.now()): string {
  const secs = Math.max(0, Math.floor((nowMs - epochMs) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 30 * 86_400) return `${Math.floor(secs / 86_400)}d ago`;
  return `${Math.floor(secs / (30 * 86_400))}mo ago`;
}

export function formatStrength(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ── Headline count for panel badge ──────────────────────────────────────

export function hybridHeadlineCount(
  ops: HybridOperationIndicator[],
  sabotage: InfrastructureSabotageEvent[],
  elections: ElectionInterferenceSignal[],
): number {
  const coordinatedCritical = ops.filter((o) => isCoordinated(o) && o.severity >= 3).length;
  const criticalSabotage = sabotage.filter((s) => s.severity >= 3).length;
  const criticalElection = elections.filter((e) => e.severity >= 3).length;
  return coordinatedCritical + criticalSabotage + criticalElection;
}

// ── Static fixture data ─────────────────────────────────────────────────
//
// Fixtures are built by factory functions that take a `nowMs` clock so the
// module has no `Date.now()` call at load time. The default-export arrays
// below are produced lazily on first read; tests pass an explicit clock to
// the builders for determinism.

const DAY_MS = 86_400_000;

export function buildHybridOperations(nowMs: number): HybridOperationIndicator[] {
  return [
    {
      id: 'op-baltic-1',
      target: 'Baltic states + Nordic infrastructure',
      actor: 'Russia (suspected)',
      attribution: 'likely',
      vectors: ['cyber', 'disinfo', 'kinetic_deniable'],
      severity: 4,
      timestamp: nowMs - 3 * DAY_MS,
      summary: 'Reported cable + pipeline approach incidents alongside coordinated disinfo wave around Nordic NATO accession.',
    },
    {
      id: 'op-taiwan-1',
      target: 'Taiwan election ecosystem',
      actor: 'PRC (suspected)',
      attribution: 'likely',
      vectors: ['cyber', 'disinfo', 'economic_coercion'],
      severity: 3,
      timestamp: nowMs - 10 * DAY_MS,
      summary: 'Open-source reports describe concurrent spear-phishing of campaigns, deepfake amplification, and tariff-style trade signals.',
    },
    {
      id: 'op-sahel-1',
      target: 'West African Sahel transition states',
      actor: 'Russia (Africa Corps)',
      attribution: 'confirmed',
      vectors: ['proxy_force', 'disinfo', 'economic_coercion'],
      severity: 3,
      timestamp: nowMs - 6 * DAY_MS,
      summary: 'Africa Corps redeployment reported alongside anti-Western messaging activity and rare-earth contract pressure.',
    },
    {
      id: 'op-moldova-1',
      target: 'Moldova / Transnistria corridor',
      actor: 'Russia (suspected)',
      attribution: 'suspected',
      vectors: ['disinfo', 'lawfare'],
      severity: 2,
      timestamp: nowMs - 14 * DAY_MS,
      summary: 'Coordinated narrative activity reported alongside constitutional court challenges to EU referendum result.',
    },
    {
      id: 'op-arctic-1',
      target: 'Svalbard + Arctic shipping lanes',
      actor: 'Russia (suspected)',
      attribution: 'suspected',
      vectors: ['kinetic_deniable', 'cyber'],
      severity: 2,
      timestamp: nowMs - 21 * DAY_MS,
      summary: 'GPS spoofing windows reported in correlation with research-vessel positioning near undersea sensor lines.',
    },
  ];
}

export function buildGreyZoneActivities(nowMs: number): GreyZoneActivity[] {
  return [
    { id: 'gz-1', region: 'Eastern Baltic Sea',        actor: 'Russia',        kind: 'gps_jamming',         attribution: 'likely',    severity: 3, timestamp: nowMs - 2 * DAY_MS,  detail: 'Aviation GPS interference reported by Finnish, Estonian, Latvian carriers.' },
    { id: 'gz-2', region: 'Gulf of Finland',           actor: 'Russia',        kind: 'cable_approach',      attribution: 'suspected', severity: 4, timestamp: nowMs - 5 * DAY_MS,  detail: 'Vessel reported anchored within proximity of Estlink-2; transponder gaps logged.' },
    { id: 'gz-3', region: 'Taiwan Strait',             actor: 'PRC',           kind: 'airspace_incursion',  attribution: 'confirmed', severity: 3, timestamp: nowMs - 1 * DAY_MS,  detail: 'PLA sortie volume crossing centre line reported at sustained 7-day average.' },
    { id: 'gz-4', region: 'Kaliningrad / Suwałki',     actor: 'Russia',        kind: 'exclave_pressure',    attribution: 'likely',    severity: 2, timestamp: nowMs - 9 * DAY_MS,  detail: 'Migrant routing via Belarus border resumed under MFA tour-window programme.' },
    { id: 'gz-5', region: 'South China Sea (Scarborough)', actor: 'PRC',       kind: 'maritime_harassment', attribution: 'confirmed', severity: 3, timestamp: nowMs - 4 * DAY_MS,  detail: 'Coast guard water-cannon engagements reported against PH resupply mission.' },
    { id: 'gz-6', region: 'Senkaku / Diaoyu',          actor: 'PRC',           kind: 'fishing_fleet_swarm', attribution: 'likely',    severity: 2, timestamp: nowMs - 7 * DAY_MS,  detail: 'Maritime militia concentration reported above seasonal baseline.' },
    { id: 'gz-7', region: 'Finland / Russia border',   actor: 'Russia',        kind: 'border_provocation',  attribution: 'likely',    severity: 2, timestamp: nowMs - 12 * DAY_MS, detail: 'Crossing-point closure cycle continues; instrumented border use reported elevated.' },
  ];
}

export function buildElectionInterference(): ElectionInterferenceSignal[] {
  return [
    { id: 'ei-1', targetCountry: 'Moldova',  electionDate: '2026-09-20', kind: 'disinfo_campaign',     actor: 'Russia',  attribution: 'likely',    severity: 3, detail: 'Telegram-driven narrative on EU accession costs traced to known network.' },
    { id: 'ei-2', targetCountry: 'Romania',  electionDate: '2026-11-15', kind: 'fake_amplification',   actor: 'Russia',  attribution: 'suspected', severity: 2, detail: 'Coordinated TikTok amplification of fringe candidate observed.' },
    { id: 'ei-3', targetCountry: 'Germany',  electionDate: '2026-09-26', kind: 'hack_and_leak',        actor: 'unknown', attribution: 'unknown',   severity: 2, detail: 'Doxxed Bundestag aide emails released via low-rep mirror network.' },
    { id: 'ei-4', targetCountry: 'Mexico',   electionDate: '2026-06-07', kind: 'deepfake_circulation', actor: 'unknown', attribution: 'suspected', severity: 3, detail: 'Synthetic audio attributed to candidate circulated 36h pre-debate.' },
    { id: 'ei-5', targetCountry: 'Georgia',  electionDate: '2026-10-04', kind: 'voter_suppression',    actor: 'Russia',  attribution: 'suspected', severity: 3, detail: 'Foreign-agent law expansion narrows civil-society monitoring footprint.' },
    { id: 'ei-6', targetCountry: 'Slovakia', electionDate: '2027-03-15', kind: 'foreign_donations',    actor: 'unknown', attribution: 'suspected', severity: 1, detail: 'Tracing of NGO inflows currently under journalist investigation.' },
  ];
}

export function buildSabotageEvents(nowMs: number): InfrastructureSabotageEvent[] {
  return [
    { id: 'sb-1', region: 'Baltic Sea',            asset: 'Balticconnector pipeline',  kind: 'pipeline',       actor: 'unknown', attribution: 'suspected', severity: 4, timestamp: nowMs - 60 * DAY_MS, detail: 'Earlier pipeline + cable incident reported under multi-state investigation.' },
    { id: 'sb-2', region: 'North Sea',             asset: 'Norway–UK fibre',           kind: 'undersea_cable', actor: 'unknown', attribution: 'unknown',   severity: 3, timestamp: nowMs - 18 * DAY_MS, detail: 'Cable break reported under investigation; AIS gaps within proximity window.' },
    { id: 'sb-3', region: 'Eastern Europe',        asset: 'Druzhba spur',              kind: 'pipeline',       actor: 'unknown', attribution: 'suspected', severity: 2, timestamp: nowMs - 9 * DAY_MS,  detail: 'Drone strike reported and attributed to non-state actor; flow not interrupted.' },
    { id: 'sb-4', region: 'Red Sea',               asset: 'IMEWE cable segment',       kind: 'undersea_cable', actor: 'unknown', attribution: 'suspected', severity: 3, timestamp: nowMs - 30 * DAY_MS, detail: 'Cable damage reported coincident with anchor-drag event.' },
    { id: 'sb-5', region: 'Western Europe',        asset: 'Rail signal hub',           kind: 'rail_network',   actor: 'unknown', attribution: 'unknown',   severity: 2, timestamp: nowMs - 25 * DAY_MS, detail: 'Arson at signal infrastructure delayed regional traffic.' },
    { id: 'sb-6', region: 'Eastern Mediterranean', asset: 'Reservoir control system',  kind: 'water_supply',   actor: 'unknown', attribution: 'suspected', severity: 2, timestamp: nowMs - 45 * DAY_MS, detail: 'Probe activity against control system network reported.' },
  ];
}

export function buildProxyForces(): ProxyForceMobilization[] {
  return [
    { id: 'pf-1', region: 'Sahel',           proxyName: 'Africa Corps',           patron: 'Russia', kind: 'pmc_deployment',       attribution: 'confirmed', estimatedStrength: 5500,    severity: 3, detail: 'Successor footprint to former Wagner deployments reported in open sources.' },
    { id: 'pf-2', region: 'Red Sea',         proxyName: 'Ansar Allah (Houthi)',   patron: 'Iran',   kind: 'non_state_arming',     attribution: 'likely',    estimatedStrength: 200_000, severity: 4, detail: 'Anti-shipping campaign continues; cruise-missile inventory reported intact.' },
    { id: 'pf-3', region: 'Levant',          proxyName: 'Hezbollah',              patron: 'Iran',   kind: 'paramilitary_buildup', attribution: 'confirmed', estimatedStrength: 50_000,  severity: 4, detail: 'Force structure reported rebuilt; precision-munition pipeline status disputed.' },
    { id: 'pf-4', region: 'South China Sea', proxyName: 'PAFMM maritime militia', patron: 'PRC',    kind: 'maritime_militia',     attribution: 'likely',    estimatedStrength: 12_000,  severity: 3, detail: 'Distributed fleet concentrations reported near contested shoals.' },
    { id: 'pf-5', region: 'Ukraine',         proxyName: 'Foreign volunteer cells', patron: 'multiple', kind: 'volunteer_legion',  attribution: 'suspected', estimatedStrength: 2500,    severity: 2, detail: 'Recruitment networks observed on both sides of front line.' },
  ];
}

export function buildActorProfiles(): ActorAttributionProfile[] {
  return [
    { actor: 'Russia',    confidence: 87, observedVectors: 6, recentIndicators: 14, notes: 'Multi-vector indicator pattern reported across Baltic/Sahel/Moldova theatres.' },
    { actor: 'PRC',       confidence: 78, observedVectors: 5, recentIndicators: 9,  notes: 'Concentrated cyber + maritime militia + economic-coercion indicator pattern reported.' },
    { actor: 'Iran',      confidence: 74, observedVectors: 4, recentIndicators: 7,  notes: 'Proxy-force-led indicator pattern; cyber and disinfo support layers active in open reporting.' },
    { actor: 'DPRK',      confidence: 55, observedVectors: 3, recentIndicators: 4,  notes: 'Cyber-financial focus reported; episodic proxy involvement.' },
    { actor: 'Non-state', confidence: 35, observedVectors: 3, recentIndicators: 5,  notes: 'Hacktivist + criminal overlap; attribution noisy in open reporting.' },
    { actor: 'Unknown',   confidence: 18, observedVectors: 2, recentIndicators: 6,  notes: 'Reserved for indicators where attribution remains open.' },
  ];
}
