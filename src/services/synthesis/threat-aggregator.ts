// Public types

export type ThreatLevel = 'NONE' | 'LOW' | 'ELEVATED' | 'HIGH' | 'CRITICAL';

export type ThreatDomain =
  | 'seismic'
  | 'space_weather'
  | 'wildfire'
  | 'weather'
  | 'aviation'
  | 'infrastructure'
  | 'maritime'
  | 'biosurveillance'
  | 'economic'
  | 'cyber'
  | 'geopolitical';

export interface DomainThreat {
  domain: ThreatDomain;
  level: ThreatLevel;
  /** Short label for the highest-severity active item, e.g. "M5.4 Fiji 2h ago". */
  topAlert: string | null;
  /** ms timestamp of the snapshot that produced this verdict. */
  lastUpdatedMs: number;
}

export interface ThreatReceipt {
  evidenceAtMs: number;
  expiresAtMs: number;
  ageKind: 'observed' | 'fetched' | 'received';
  /** Identity of the normalized mutable reading, independent of its acquisition clock. */
  revisionKey?: string;
  /** Ordered upstream acquisition of this reading, including when the observation time is unchanged. */
  revisionAtMs?: number;
  /** Membership can change independently of the newest item's time, e.g. a vessel leaving a sampled zone. */
  snapshotMembership?: true;
  scope: 'partial' | 'complete';
  degraded?: boolean;
  evaluate: (nowMs: number) => DomainThreat;
}

export interface ThreatSource {
  source: string;
  state: 'current' | 'degraded' | 'stale' | 'unavailable' | 'pending';
  reporting: boolean;
  evidenceAtMs: number | null;
  ageKind: ThreatReceipt['ageKind'] | null;
  attemptedAtMs: number;
  lastAttempt: 'pending' | 'reported' | 'failed';
  signal?: Pick<DomainThreat, 'level' | 'topAlert'>;
}

export interface CoveredThreat extends DomainThreat {
  coverage: 'unknown' | 'partial' | 'complete' | 'stale' | 'unavailable';
  sources: ThreatSource[];
  lastKnown: boolean;
  signalSource: string | null;
}

export type AggregatedThreats = Record<ThreatDomain, CoveredThreat>;

export const THREAT_LEVELS_EVENT = 'wm:threat-levels-updated' as const;

export interface ThreatLevelsEventDetail {
  threats: AggregatedThreats;
  generatedAt: number;
}

// Snapshot inputs - one per domain, kept narrow so tests can build fixtures
// without dragging in entire upstream payload shapes.

export interface SeismicQuake {
  magnitude: number;
  place?: string;
  timeMs: number;
}
export interface SeismicSnapshot {
  quakes: readonly SeismicQuake[];
  /** ms; cutoff age — quakes older than this are ignored. Default 24 h. */
  windowMs?: number;
  nowMs: number;
}

export interface SpaceWeatherSnapshot {
  /** Current planetary K-index. null when not yet observed. */
  kpIndex: number | null;
  /** Most recent X-ray flare class, e.g. "M5", "X1.2", "C9". null when none. */
  recentFlareClass: string | null;
  nowMs: number;
}

export interface WildfireFire {
  brightness?: number;
  confidence?: number;
  state?: string;
}
export interface WildfireSnapshot {
  activeFires: readonly WildfireFire[];
  nowMs: number;
}

export type NwsSeverity = 'Minor' | 'Moderate' | 'Severe' | 'Extreme' | 'Unknown';
export interface NwsAlert {
  event: string;
  severity: NwsSeverity;
  headline?: string;
  effectiveMs?: number;
}
export interface WeatherSnapshot {
  alerts: readonly NwsAlert[];
  nowMs: number;
}

export interface AviationSigmetMinimal {
  hazard: string;
  text?: string;
}
export interface AviationGroundStop {
  airport: string;
  reason?: string;
}
export interface AviationSnapshot {
  sigmets: readonly AviationSigmetMinimal[];
  groundStops: readonly AviationGroundStop[];
  nowMs: number;
}

export interface InfrastructureOutage {
  provider?: string;
  customersAffected: number;
  region?: string;
}
export interface InfrastructureSnapshot {
  outages: readonly InfrastructureOutage[];
  nowMs: number;
}

export interface MaritimeVessel {
  mmsi?: string;
  name?: string;
  inRedZone?: boolean;
  zone?: string;
}
export interface MaritimeSnapshot {
  vesselsInRedZone: readonly MaritimeVessel[];
  nowMs: number;
}

export interface BiosurveillanceOutbreak {
  disease: string;
  caseCount?: number;
  region?: string;
}
export interface BiosurveillanceSnapshot {
  outbreaks: readonly BiosurveillanceOutbreak[];
  nowMs: number;
}

export interface EconomicSnapshot {
  /** CBOE VIX. */
  vix: number | null;
  /** OFR Financial Stress Index in standard deviations. */
  ofrFsiZ: number | null;
  nowMs: number;
}

export interface CyberSnapshot {
  /** OTX pulse count over the last 24 h. */
  pulseCount24h: number | null;
  /** True when a BGP hijack has been detected in the last 6 h. */
  bgpHijackActive: boolean;
  nowMs: number;
}

export interface GeopoliticalSnapshot {
  /** ACLED-classified high-severity events in the last 24 h. */
  highSeverityEvents24h: number | null;
  /** Free-text top headline for the card. */
  topHeadline: string | null;
  nowMs: number;
}

export interface AggregatorInput {
  seismic: SeismicSnapshot;
  spaceWeather: SpaceWeatherSnapshot;
  wildfire: WildfireSnapshot;
  weather: WeatherSnapshot;
  aviation: AviationSnapshot;
  infrastructure: InfrastructureSnapshot;
  maritime: MaritimeSnapshot;
  biosurveillance: BiosurveillanceSnapshot;
  economic: EconomicSnapshot;
  cyber: CyberSnapshot;
  geopolitical: GeopoliticalSnapshot;
}

// Heuristic helpers

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function emptyThreat(domain: ThreatDomain, nowMs: number): DomainThreat {
  return { domain, level: 'NONE', topAlert: null, lastUpdatedMs: nowMs };
}

function maxLevel(...levels: ThreatLevel[]): ThreatLevel {
  const order: ThreatLevel[] = ['NONE', 'LOW', 'ELEVATED', 'HIGH', 'CRITICAL'];
  let best: ThreatLevel = 'NONE';
  for (const level of levels) {
    if (order.indexOf(level) > order.indexOf(best)) best = level;
  }
  return best;
}

function formatAge(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'now';
  const minutes = Math.round(ageMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// Seismic

export function computeSeismicThreat(snapshot: SeismicSnapshot): DomainThreat {
  const { quakes, nowMs } = snapshot;
  const windowMs = snapshot.windowMs ?? ONE_DAY_MS;
  const recent = quakes.filter((q) => nowMs - q.timeMs <= windowMs && q.magnitude > 0);
  if (recent.length === 0) return emptyThreat('seismic', nowMs);
  const top = recent.reduce(
    (a, b) => (a.magnitude >= b.magnitude ? a : b),
    recent[0]!,
  );
  let level: ThreatLevel = 'LOW';
  if (top.magnitude >= 7) level = 'CRITICAL';
  else if (top.magnitude >= 6) level = 'HIGH';
  else if (top.magnitude >= 5) level = 'ELEVATED';
  const place = top.place ? ` ${top.place}` : '';
  const topAlert = `M${top.magnitude.toFixed(1)}${place} • ${formatAge(nowMs - top.timeMs)}`;
  return { domain: 'seismic', level, topAlert, lastUpdatedMs: nowMs };
}

// Space weather

const FLARE_CLASS_RE = /^([ABCMX])(\d+(?:\.\d+)?)?$/i;

function flareLevel(flare: string | null): ThreatLevel {
  if (!flare) return 'NONE';
  // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec, sonarjs/prefer-regexp-exec
  const m = flare.toUpperCase().match(FLARE_CLASS_RE);
  if (!m) return 'NONE';
  const cls = m[1]!;
  if (cls === 'X') return 'CRITICAL';
  if (cls === 'M') return 'ELEVATED';
  return 'NONE';
}

function kpLevel(kp: number | null): ThreatLevel {
  if (kp === null || !Number.isFinite(kp)) return 'NONE';
  if (kp >= 9) return 'CRITICAL';
  if (kp >= 7) return 'HIGH';
  if (kp >= 5) return 'ELEVATED';
  return 'NONE';
}

export function computeSpaceWeatherThreat(snapshot: SpaceWeatherSnapshot): DomainThreat {
  const { kpIndex, recentFlareClass, nowMs } = snapshot;
  const level = maxLevel(kpLevel(kpIndex), flareLevel(recentFlareClass));
  if (level === 'NONE') return emptyThreat('space_weather', nowMs);
  const parts: string[] = [];
  if (kpIndex !== null && Number.isFinite(kpIndex) && kpIndex >= 5) {
    parts.push(`Kp${kpIndex.toFixed(1)}`);
  }
  if (recentFlareClass) parts.push(`${recentFlareClass} flare`);
  return {
    domain: 'space_weather',
    level,
    topAlert: parts.length === 0 ? 'quiet' : parts.join(' • '),
    lastUpdatedMs: nowMs,
  };
}

// Wildfire

export function computeWildfireThreat(snapshot: WildfireSnapshot): DomainThreat {
  const count = snapshot.activeFires.length;
  if (count === 0) return emptyThreat('wildfire', snapshot.nowMs);
  let level: ThreatLevel = 'LOW';
  if (count >= 20) level = 'HIGH';
  else if (count >= 5) level = 'ELEVATED';
  return {
    domain: 'wildfire',
    level,
    topAlert: `${count} active fire${count === 1 ? '' : 's'}`,
    lastUpdatedMs: snapshot.nowMs,
  };
}

// Weather (NWS)

const TORNADO_WARNING_RE = /tornado\s+warning/i;

export function computeWeatherThreat(snapshot: WeatherSnapshot): DomainThreat {
  const alerts = snapshot.alerts.filter((a) => a.severity !== 'Unknown');
  if (alerts.length === 0) return emptyThreat('weather', snapshot.nowMs);
  const tornado = alerts.find((a) => TORNADO_WARNING_RE.test(a.event));
  if (tornado) {
    const headline = tornado.headline ? ` — ${tornado.headline}` : '';
    return {
      domain: 'weather',
      level: 'CRITICAL',
      topAlert: `Tornado warning${headline}`,
      lastUpdatedMs: snapshot.nowMs,
    };
  }
  const hasExtreme = alerts.some((a) => a.severity === 'Extreme');
  const hasSevere = alerts.some((a) => a.severity === 'Severe');
  let level: ThreatLevel = 'LOW';
  if (hasExtreme) level = 'HIGH';
  else if (hasSevere) level = 'ELEVATED';
  // Pick the most-severe alert for the headline.
  const order: NwsSeverity[] = ['Extreme', 'Severe', 'Moderate', 'Minor'];
  const top = [...alerts].sort(
    (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
  )[0]!;
  const sevSuffix = top.severity === 'Minor' ? '' : ` (${top.severity})`;
  return {
    domain: 'weather',
    level,
    topAlert: `${top.event}${sevSuffix}`,
    lastUpdatedMs: snapshot.nowMs,
  };
}

// Aviation

export function computeAviationThreat(snapshot: AviationSnapshot): DomainThreat {
  const sigmetCount = snapshot.sigmets.length;
  const stopCount = snapshot.groundStops.length;
  if (sigmetCount === 0 && stopCount === 0) {
    return emptyThreat('aviation', snapshot.nowMs);
  }
  let level: ThreatLevel = 'LOW';
  if (stopCount > 0) level = 'HIGH';
  else if (sigmetCount > 0) level = 'ELEVATED';
  const parts: string[] = [];
  if (sigmetCount > 0) {
    const ashCount = snapshot.sigmets.filter(
      (s) => /volcanic.?ash|ash/i.test(s.hazard ?? ''),
    ).length;
    const plural = sigmetCount === 1 ? '' : 's';
    const ashSuffix = ashCount > 0 ? ` (${ashCount} ash)` : '';
    parts.push(`${sigmetCount} SIGMET${plural}${ashSuffix}`);
  }
  if (stopCount > 0) {
    const top = snapshot.groundStops[0]!;
    parts.push(`${top.airport} ground stop`);
  }
  return {
    domain: 'aviation',
    level,
    topAlert: parts.join(' • '),
    lastUpdatedMs: snapshot.nowMs,
  };
}

// Infrastructure

export function computeInfrastructureThreat(snapshot: InfrastructureSnapshot): DomainThreat {
  if (snapshot.outages.length === 0) {
    return emptyThreat('infrastructure', snapshot.nowMs);
  }
  const top = snapshot.outages.reduce(
    (a, b) => (a.customersAffected >= b.customersAffected ? a : b),
    snapshot.outages[0]!,
  );
  let level: ThreatLevel = 'LOW';
  if (top.customersAffected > 500_000) level = 'HIGH';
  else if (top.customersAffected > 100_000) level = 'ELEVATED';
  const provider = top.provider ?? 'outage';
  const regionSuffix = top.region ? ` (${top.region})` : '';
  return {
    domain: 'infrastructure',
    level,
    topAlert: `${provider}: ${formatCustomers(top.customersAffected)}${regionSuffix}`,
    lastUpdatedMs: snapshot.nowMs,
  };
}

function formatCustomers(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M customers`;
  if (n >= 1000) return `${Math.round(n / 1000)}k customers`;
  return `${n} customers`;
}

// Maritime

export function computeMaritimeThreat(snapshot: MaritimeSnapshot): DomainThreat {
  const count = snapshot.vesselsInRedZone.length;
  if (count === 0) return emptyThreat('maritime', snapshot.nowMs);
  let level: ThreatLevel = 'LOW';
  if (count > 5) level = 'HIGH';
  else if (count > 0) level = 'ELEVATED';
  const top = snapshot.vesselsInRedZone[0]!;
  const label = top.name ?? top.mmsi ?? 'vessel';
  const labelSuffix = count > 1 ? ` (incl. ${label})` : `: ${label}`;
  return {
    domain: 'maritime',
    level,
    topAlert: `${count} in red zone${labelSuffix}`,
    lastUpdatedMs: snapshot.nowMs,
  };
}

// Biosurveillance

export function computeBiosurveillanceThreat(
  snapshot: BiosurveillanceSnapshot,
): DomainThreat {
  if (snapshot.outbreaks.length === 0) {
    return emptyThreat('biosurveillance', snapshot.nowMs);
  }
  const top = snapshot.outbreaks.reduce(
    (a, b) => ((a.caseCount ?? 0) >= (b.caseCount ?? 0) ? a : b),
    snapshot.outbreaks[0]!,
  );
  const cases = top.caseCount ?? 0;
  let level: ThreatLevel = 'LOW';
  if (cases >= 1000) level = 'HIGH';
  else if (cases >= 100) level = 'ELEVATED';
  const caseSuffix = cases > 0 ? ` — ${cases} cases` : '';
  const regionSuffix = top.region ? ` (${top.region})` : '';
  return {
    domain: 'biosurveillance',
    level,
    topAlert: `${top.disease}${caseSuffix}${regionSuffix}`,
    lastUpdatedMs: snapshot.nowMs,
  };
}

// Economic

function vixLevelFor(vix: number | null): ThreatLevel {
  if (vix === null || !Number.isFinite(vix)) return 'NONE';
  if (vix > 35) return 'HIGH';
  if (vix > 25) return 'ELEVATED';
  return 'NONE';
}

function fsiLevelFor(z: number | null): ThreatLevel {
  if (z === null || !Number.isFinite(z)) return 'NONE';
  if (z > 2) return 'HIGH';
  return 'NONE';
}

export function computeEconomicThreat(snapshot: EconomicSnapshot): DomainThreat {
  const { vix, ofrFsiZ, nowMs } = snapshot;
  const level = maxLevel(vixLevelFor(vix), fsiLevelFor(ofrFsiZ));
  if (level === 'NONE') return emptyThreat('economic', nowMs);
  const parts: string[] = [];
  if (vix !== null && Number.isFinite(vix)) parts.push(`VIX ${vix.toFixed(1)}`);
  if (ofrFsiZ !== null && Number.isFinite(ofrFsiZ)) parts.push(`OFR FSI ${ofrFsiZ.toFixed(2)}σ`);
  return {
    domain: 'economic',
    level,
    topAlert: parts.join(' • '),
    lastUpdatedMs: nowMs,
  };
}

// Cyber

function pulseLevelFor(count: number | null): ThreatLevel {
  if (count === null || !Number.isFinite(count)) return 'NONE';
  if (count > 50) return 'HIGH';
  if (count > 10) return 'ELEVATED';
  return 'NONE';
}

export function computeCyberThreat(snapshot: CyberSnapshot): DomainThreat {
  const { pulseCount24h, bgpHijackActive, nowMs } = snapshot;
  const bgpLevel: ThreatLevel = bgpHijackActive ? 'HIGH' : 'NONE';
  const level = maxLevel(pulseLevelFor(pulseCount24h), bgpLevel);
  if (level === 'NONE') return emptyThreat('cyber', nowMs);
  const parts: string[] = [];
  if (pulseCount24h !== null && Number.isFinite(pulseCount24h)) {
    parts.push(`${pulseCount24h} OTX pulses/24h`);
  }
  if (bgpHijackActive) parts.push('BGP hijack');
  return {
    domain: 'cyber',
    level,
    topAlert: parts.join(' • '),
    lastUpdatedMs: nowMs,
  };
}

// Geopolitical

export function computeGeopoliticalThreat(snapshot: GeopoliticalSnapshot): DomainThreat {
  const { highSeverityEvents24h, topHeadline, nowMs } = snapshot;
  const events = highSeverityEvents24h ?? 0;
  let level: ThreatLevel = 'NONE';
  if (events >= 25) level = 'HIGH';
  else if (events >= 10) level = 'ELEVATED';
  else if (events > 0) level = 'LOW';
  if (level === 'NONE' && !topHeadline) return emptyThreat('geopolitical', nowMs);
  const parts: string[] = [];
  if (topHeadline) parts.push(topHeadline);
  if (events > 0) parts.push(`${events} high-severity events/24h`);
  return {
    domain: 'geopolitical',
    level,
    topAlert: parts.join(' • '),
    lastUpdatedMs: nowMs,
  };
}

// Combine

export function aggregateThreats(input: AggregatorInput): Record<ThreatDomain, DomainThreat> {
  return {
    seismic: computeSeismicThreat(input.seismic),
    space_weather: computeSpaceWeatherThreat(input.spaceWeather),
    wildfire: computeWildfireThreat(input.wildfire),
    weather: computeWeatherThreat(input.weather),
    aviation: computeAviationThreat(input.aviation),
    infrastructure: computeInfrastructureThreat(input.infrastructure),
    maritime: computeMaritimeThreat(input.maritime),
    biosurveillance: computeBiosurveillanceThreat(input.biosurveillance),
    economic: computeEconomicThreat(input.economic),
    cyber: computeCyberThreat(input.cyber),
    geopolitical: computeGeopoliticalThreat(input.geopolitical),
  };
}

const DOMAINS: readonly ThreatDomain[] = [
  'seismic', 'space_weather', 'wildfire', 'weather', 'aviation', 'infrastructure',
  'maritime', 'biosurveillance', 'economic', 'cyber', 'geopolitical',
];

function unknownThreat(domain: ThreatDomain): CoveredThreat {
  return { ...emptyThreat(domain, 0), coverage: 'unknown', sources: [], lastKnown: false, signalSource: null };
}

export function emptyAggregatedThreats(): AggregatedThreats {
  return Object.fromEntries(DOMAINS.map(domain => [domain, unknownThreat(domain)])) as AggregatedThreats;
}

interface SourceSlot {
  receipt?: ThreatReceipt;
  pending?: symbol;
  attemptedAtMs: number;
  settledAtMs?: number;
  failed: boolean;
}

export interface ThreatAttempt {
  isCurrent: () => boolean;
  report: (receipt: ThreatReceipt) => void;
  fail: () => void;
  cancel: () => void;
}

function describeSource(source: string, slot: SourceSlot, nowMs: number): ThreatSource {
  const { receipt, failed } = slot;
  const fresh = !!receipt && receipt.evidenceAtMs <= nowMs && nowMs < receipt.expiresAtMs;
  let state: ThreatSource['state'];
  if (receipt && fresh) state = failed || receipt.degraded ? 'degraded' : 'current';
  else if (receipt) state = 'stale';
  else state = failed ? 'unavailable' : 'pending';
  let lastAttempt: ThreatSource['lastAttempt'] = failed ? 'failed' : 'reported';
  if (slot.pending) lastAttempt = 'pending';
  return {
    source, state, reporting: fresh && !failed, evidenceAtMs: receipt?.evidenceAtMs ?? null,
    ageKind: receipt?.ageKind ?? null, attemptedAtMs: slot.attemptedAtMs,
    lastAttempt,
  };
}

function coverageOf(sources: ThreatSource[], complete: boolean): CoveredThreat['coverage'] {
  if (complete) return 'complete';
  if (sources.some(s => s.reporting)) return 'partial';
  if (sources.some(s => s.state === 'stale')) return 'stale';
  if (sources.some(s => s.state !== 'pending')) return 'unavailable';
  return 'unknown';
}

function preferSignal(row: CoveredThreat, signalAtMs: number, signal: DomainThreat, source: ThreatSource): boolean {
  if (!row.signalSource) return true;
  const currentWinnerReporting = !row.lastKnown;
  if (source.reporting !== currentWinnerReporting) return source.reporting;
  if (signal.level !== row.level) return maxLevel(row.level, signal.level) === signal.level;
  if (source.evidenceAtMs !== signalAtMs) return source.evidenceAtMs! > signalAtMs;
  return source.source < row.signalSource;
}

function sampleDomain(domain: ThreatDomain, slots: Map<string, SourceSlot>, nowMs: number): CoveredThreat {
  const row = unknownThreat(domain);
  let complete = slots.size > 0;
  let oldest = Infinity;
  let latest = 0;
  let signalAtMs = 0;
  for (const [source, slot] of slots) {
    const detail = describeSource(source, slot, nowMs);
    row.sources.push(detail);
    const receipt = slot.receipt;
    complete &&= detail.state === 'current' && receipt?.scope === 'complete';
    if (!receipt) continue;
    latest = Math.max(latest, receipt.evidenceAtMs);
    if (detail.state === 'stale') continue;
    oldest = Math.min(oldest, receipt.evidenceAtMs);
    const signal = receipt.evaluate(nowMs);
    if (signal.level === 'NONE') continue;
    detail.signal = { level: signal.level, topAlert: signal.topAlert };
    if (!preferSignal(row, signalAtMs, signal, detail)) continue;
    row.level = signal.level;
    row.topAlert = signal.topAlert;
    row.signalSource = source;
    row.lastKnown = !detail.reporting;
    signalAtMs = receipt.evidenceAtMs;
  }
  row.coverage = coverageOf(row.sources, complete);
  row.lastUpdatedMs = complete ? oldest : signalAtMs || latest;
  return row;
}

function validReceipt(receipt: ThreatReceipt, nowMs: number): boolean {
  const { evidenceAtMs, expiresAtMs, revisionAtMs, revisionKey } = receipt;
  if (!Number.isFinite(evidenceAtMs) || evidenceAtMs <= 0 || evidenceAtMs > nowMs
    || !Number.isFinite(expiresAtMs) || expiresAtMs <= evidenceAtMs || revisionKey === '') return false;
  if (revisionAtMs === undefined) return !receipt.snapshotMembership;
  return revisionKey !== undefined && Number.isSafeInteger(revisionAtMs)
    && revisionAtMs >= evidenceAtMs && revisionAtMs <= nowMs;
}

function orderedChange(previous: ThreatReceipt, incoming: ThreatReceipt): boolean {
  return previous.revisionKey !== incoming.revisionKey
    && previous.revisionAtMs !== undefined && incoming.revisionAtMs !== undefined
    && incoming.revisionAtMs > previous.revisionAtMs;
}

function reviseReceipt(slot: SourceSlot, previous: ThreatReceipt, incoming: ThreatReceipt, nowMs: number): boolean {
  const expiresAtMs = Math.min(previous.expiresAtMs, incoming.expiresAtMs);
  const scope = previous.scope === 'partial' ? 'partial' : incoming.scope;
  if (previous.revisionKey !== incoming.revisionKey) {
    if (!orderedChange(previous, incoming) || previous.expiresAtMs <= nowMs) return false;
    slot.receipt = { ...incoming, scope, expiresAtMs };
    return expiresAtMs > nowMs;
  }

  // A newer acquisition of identical content orders later corrections, but cannot recover an outage.
  const revisionAtMs = Math.max(previous.revisionAtMs ?? 0, incoming.revisionAtMs ?? 0);
  slot.receipt = {
    ...previous, scope, expiresAtMs, revisionAtMs: revisionAtMs || undefined,
    degraded: previous.degraded === true || incoming.degraded,
  };
  return !slot.failed;
}

function admitReceipt(slot: SourceSlot, incoming: ThreatReceipt, nowMs: number): boolean {
  if (!validReceipt(incoming, nowMs)) return false;
  const previous = slot.receipt;
  if (!previous) {
    slot.receipt = incoming;
    return true;
  }

  if (previous.snapshotMembership !== incoming.snapshotMembership) return false;
  if (previous.evidenceAtMs === incoming.evidenceAtMs) return reviseReceipt(slot, previous, incoming, nowMs);
  if (previous.snapshotMembership && !orderedChange(previous, incoming)) return false;
  if (incoming.evidenceAtMs < previous.evidenceAtMs) {
    // An ordered removal can move the newest remaining sample backwards, keeping its actual age.
    return previous.snapshotMembership === true && reviseReceipt(slot, previous, incoming, nowMs);
  }
  slot.receipt = incoming;
  return true;
}

export class ThreatEvidenceStore {
  private readonly domains = new Map<ThreatDomain, Map<string, SourceSlot>>();
  constructor(private readonly now: () => number = Date.now) {}

  begin(domain: ThreatDomain, source: string): ThreatAttempt {
    let slots = this.domains.get(domain);
    if (!slots) {
      slots = new Map();
      this.domains.set(domain, slots);
    }
    const slot: SourceSlot = slots.get(source) ?? { failed: false, attemptedAtMs: 0 };
    const token = Symbol();
    slot.pending = token;
    slot.attemptedAtMs = this.now();
    slots.set(source, slot);
    const settle = (failed: boolean) => {
      slot.pending = undefined;
      slot.settledAtMs = slot.attemptedAtMs;
      slot.failed = failed;
    };
    return {
      isCurrent: () => slot.pending === token,
      report: (receipt) => {
        if (slot.pending !== token) return;
        settle(!admitReceipt(slot, receipt, this.now()));
      },
      fail: () => {
        if (slot.pending === token) settle(true);
      },
      cancel: () => {
        if (slot.pending !== token) return;
        slot.pending = undefined;
        if (slot.settledAtMs === undefined) slots.delete(source);
        else slot.attemptedAtMs = slot.settledAtMs;
      },
    };
  }

  sample(nowMs = this.now()): AggregatedThreats {
    const result = emptyAggregatedThreats();
    for (const [domain, slots] of this.domains) {
      result[domain] = sampleDomain(domain, slots, nowMs);
    }
    return result;
  }
}

export const threatEvidence = new ThreatEvidenceStore();

interface ThreatAggregatorOptions {
  store?: ThreatEvidenceStore;
  intervalMs?: number;
  emit?: (detail: ThreatLevelsEventDetail) => void;
  now?: () => number;
}

export interface ThreatAggregatorHandle {
  stop: () => void;
  pollNow: () => Promise<AggregatedThreats>;
  latest: () => AggregatedThreats;
}

export function startThreatAggregator(options: ThreatAggregatorOptions = {}): ThreatAggregatorHandle {
  const store = options.store ?? threatEvidence;
  const now = options.now ?? Date.now;
  const emit = options.emit ?? defaultEmit;
  let latest = emptyAggregatedThreats();
  let stopped = false;
  function publish(): AggregatedThreats {
    if (!stopped) {
      const generatedAt = now();
      latest = store.sample(generatedAt);
      emit({ threats: latest, generatedAt });
    }
    return latest;
  }
  publish();
  const timer = setInterval(publish, options.intervalMs ?? 30_000);
  return {
    stop: () => { stopped = true; clearInterval(timer); },
    pollNow: () => Promise.resolve(publish()),
    latest: () => latest,
  };
}

function defaultEmit(detail: ThreatLevelsEventDetail): void {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(
    new CustomEvent<ThreatLevelsEventDetail>(THREAT_LEVELS_EVENT, { detail }),
  );
}
