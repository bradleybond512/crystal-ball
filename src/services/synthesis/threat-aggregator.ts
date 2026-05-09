/**
 * Threat-level aggregator — pure-deterministic core + polling shell.
 *
 * Every domain has a `compute*Threat(snapshot)` function that takes a
 * typed input and returns a `DomainThreat` (level + topAlert + lastUpdated).
 * The polling shell wires sidecar fetches to those functions and dispatches
 * the `wm:threat-levels-updated` CustomEvent every 30 s.
 *
 * Pure invariants:
 *   - Heuristics are total functions: any partial / null / undefined input
 *     returns level 'NONE' rather than throwing.
 *   - The combine function returns a stable object shape with all 11
 *     domains present, even when their snapshots are empty.
 *   - No DOM, no fetch, no globals at module scope. The polling adapter
 *     at the bottom is the only function that touches the network.
 */

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

export type AggregatedThreats = Record<ThreatDomain, DomainThreat>;

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

export function aggregateThreats(input: AggregatorInput): AggregatedThreats {
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

// Empty state — used by the panel before the first poll completes.

export function emptyAggregatedThreats(nowMs = Date.now()): AggregatedThreats {
  const domains: ThreatDomain[] = [
    'seismic',
    'space_weather',
    'wildfire',
    'weather',
    'aviation',
    'infrastructure',
    'maritime',
    'biosurveillance',
    'economic',
    'cyber',
    'geopolitical',
  ];
  const out = {} as AggregatedThreats;
  for (const d of domains) out[d] = emptyThreat(d, nowMs);
  return out;
}

// Polling adapter — the only function in this module that touches the network.

export interface ThreatAggregatorAdapters {
  fetchSeismic?: () => Promise<SeismicSnapshot>;
  fetchSpaceWeather?: () => Promise<SpaceWeatherSnapshot>;
  fetchWildfire?: () => Promise<WildfireSnapshot>;
  fetchWeather?: () => Promise<WeatherSnapshot>;
  fetchAviation?: () => Promise<AviationSnapshot>;
  fetchInfrastructure?: () => Promise<InfrastructureSnapshot>;
  fetchMaritime?: () => Promise<MaritimeSnapshot>;
  fetchBiosurveillance?: () => Promise<BiosurveillanceSnapshot>;
  fetchEconomic?: () => Promise<EconomicSnapshot>;
  fetchCyber?: () => Promise<CyberSnapshot>;
  fetchGeopolitical?: () => Promise<GeopoliticalSnapshot>;
  /** Polling cadence; defaults to 30 s. Tests pass a smaller value. */
  intervalMs?: number;
  /** Side-effect sink. Defaults to `document.dispatchEvent(...)`. */
  emit?: (detail: ThreatLevelsEventDetail) => void;
  /** Optional clock for tests. */
  now?: () => number;
}

export interface ThreatAggregatorHandle {
  stop: () => void;
  /** Force one poll cycle. Useful for tests + initial render. */
  pollNow: () => Promise<AggregatedThreats>;
  /** Latest snapshot — null before the first poll completes. */
  latest: () => AggregatedThreats | null;
}

export function startThreatAggregator(
  adapters: ThreatAggregatorAdapters = {},
): ThreatAggregatorHandle {
  const intervalMs = adapters.intervalMs ?? 30_000;
  const now = adapters.now ?? Date.now;
  const emit = adapters.emit ?? defaultEmit;
  let latest: AggregatedThreats | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function pollOnce(): Promise<AggregatedThreats> {
    const t = now();
    const empty = emptyAggregatedThreats(t);
    const [
      seismic,
      spaceWeather,
      wildfire,
      weather,
      aviation,
      infrastructure,
      maritime,
      biosurveillance,
      economic,
      cyber,
      geopolitical,
    ] = await Promise.all([
      safeCall(adapters.fetchSeismic, { quakes: [], nowMs: t }),
      safeCall(adapters.fetchSpaceWeather, { kpIndex: null, recentFlareClass: null, nowMs: t }),
      safeCall(adapters.fetchWildfire, { activeFires: [], nowMs: t }),
      safeCall(adapters.fetchWeather, { alerts: [], nowMs: t }),
      safeCall(adapters.fetchAviation, { sigmets: [], groundStops: [], nowMs: t }),
      safeCall(adapters.fetchInfrastructure, { outages: [], nowMs: t }),
      safeCall(adapters.fetchMaritime, { vesselsInRedZone: [], nowMs: t }),
      safeCall(adapters.fetchBiosurveillance, { outbreaks: [], nowMs: t }),
      safeCall(adapters.fetchEconomic, { vix: null, ofrFsiZ: null, nowMs: t }),
      safeCall(adapters.fetchCyber, { pulseCount24h: null, bgpHijackActive: false, nowMs: t }),
      safeCall(adapters.fetchGeopolitical, { highSeverityEvents24h: null, topHeadline: null, nowMs: t }),
    ]);
    const threats = aggregateThreats({
      seismic,
      spaceWeather,
      wildfire,
      weather,
      aviation,
      infrastructure,
      maritime,
      biosurveillance,
      economic,
      cyber,
      geopolitical,
    });
    latest = { ...empty, ...threats };
    emit({ threats: latest, generatedAt: t });
    return latest;
  }

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(() => {
      void pollOnce().finally(() => schedule());
    }, intervalMs);
  }

  // Kick off the first poll immediately so the dashboard isn't blank.
  void pollOnce().finally(() => schedule());

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    pollNow: () => pollOnce(),
    latest: () => latest,
  };
}

async function safeCall<T>(
  fetcher: (() => Promise<T>) | undefined,
  fallback: T,
): Promise<T> {
  if (!fetcher) return fallback;
  try {
    return await fetcher();
  } catch {
    return fallback;
  }
}

function defaultEmit(detail: ThreatLevelsEventDetail): void {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(
    new CustomEvent<ThreatLevelsEventDetail>(THREAT_LEVELS_EVENT, { detail }),
  );
}
