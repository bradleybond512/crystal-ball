/* eslint-disable sonarjs/cognitive-complexity, sonarjs/no-nested-template-literals, sonarjs/no-nested-conditional */
/**
 * Cross-domain correlation engine (pure-deterministic).
 *
 * Detects when independent threat signals coincide and amplify each
 * other into emergent intelligence. Six detectors:
 *
 *   1. seismic-nuclear        — M ≥ 5.5 quake within 50 km of a top-20
 *                                nuclear facility
 *   2. space-weather-cascade  — Kp ≥ 7 + X-class flare (HF blackout)
 *                                + earthward CME with ETA inside ±48 h
 *   3. wildfire-air-quality   — FIRMS hotspot within 100 km of an
 *                                AirNow sensor reporting AQI > 150
 *   4. infra-cyber            — Cloudflare-Radar BGP hijack within
 *                                24 h alongside an OTX pulse mentioning
 *                                critical-infrastructure keywords
 *   5. hurricane-fuel         — NHC Cat 2+ storm within 200 km of a
 *                                Gulf-of-Mexico oil platform / refinery
 *   6. multi-hazard           — 3+ distinct threat domains elevated
 *                                above their baseline simultaneously
 *
 * Inputs are caller-provided typed bags. No DOM, no fetch, no globals
 * — sidecar at /api/synthesis/correlations does the live data fan-out
 * and runs this module mirrored for parity.
 */

// ── Domain + severity types ────────────────────────────────────────────────

export type CorrelationType =
  | 'seismic-nuclear'
  | 'space-weather-cascade'
  | 'wildfire-air-quality'
  | 'infra-cyber'
  | 'hurricane-fuel'
  | 'multi-hazard';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type ThreatDomain =
  | 'seismic' | 'nuclear' | 'space-weather' | 'wildfire' | 'air-quality'
  | 'cyber' | 'infrastructure' | 'hurricane' | 'fuel' | 'flood'
  | 'volcano' | 'disease';

export interface ThreatComponent {
  domain: ThreatDomain;
  source: string;
  description: string;
  severity?: Severity;
  metadata?: Record<string, unknown>;
}

export interface CorrelationEvent {
  type: CorrelationType;
  severity: Severity;
  domains: ThreatDomain[];
  description: string;
  triggeredAt: Date;
  components: ThreatComponent[];
}

// ── Raw inputs ─────────────────────────────────────────────────────────────

export interface SeismicEvent {
  id: string;
  lat: number;
  lon: number;
  magnitude: number;
  occurredAt: Date;
  place?: string;
}

export interface NuclearFacility {
  id: string;
  name: string;
  lat: number;
  lon: number;
  country: string;
  type: 'nuclear-plant' | 'research-reactor';
}

export interface SpaceWeatherSnapshot {
  kp: number | null;
  /** Peak X-ray flux in W/m² (long-band 0.1–0.8 nm). */
  xrayFlux: number | null;
  earthwardCmes: { id: string; estimatedArrival: string | null }[];
}

export interface FirePoint {
  id: string;
  lat: number;
  lon: number;
  /** Fire Radiative Power, MW. */
  frp: number;
  observedAt: Date;
}

export interface AirQualitySensor {
  id: string;
  lat: number;
  lon: number;
  /** US EPA AQI 0–500. */
  aqi: number;
  pollutant?: string;
  observedAt: Date;
}

export interface BgpHijack {
  id: string;
  asn: string;
  prefix: string;
  detectedAt: Date;
}

export interface CyberPulse {
  id: string;
  title: string;
  description: string;
  publishedAt: Date;
}

export interface Hurricane {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Saffir-Simpson 0–5. */
  category: number;
  observedAt: Date;
}

export interface FuelInfrastructure {
  id: string;
  name: string;
  lat: number;
  lon: number;
  region: string;
  type: 'platform' | 'refinery' | 'terminal' | 'pipeline-hub';
}

export interface DomainElevation {
  domain: ThreatDomain;
  elevated: boolean;
  detail?: string;
}

export interface CorrelationInput {
  earthquakes: SeismicEvent[];
  spaceWeather: SpaceWeatherSnapshot | null;
  firePoints: FirePoint[];
  airQuality: AirQualitySensor[];
  bgpHijacks: BgpHijack[];
  cyberPulses: CyberPulse[];
  hurricanes: Hurricane[];
  domainElevations: DomainElevation[];
  /** Now-ish; defaults to new Date() when missing. */
  now?: Date;
}

// ── Static catalogues ──────────────────────────────────────────────────────

/** Top 20 globally-significant nuclear facilities. Coordinates are
 *  centroids of the plant footprints from public sources (IAEA PRIS,
 *  WNA reactor pages); not survey-grade but well within the 50-km
 *  correlation radius. */
export const NUCLEAR_FACILITIES: NuclearFacility[] = [
  { id: 'us-palo-verde',     name: 'Palo Verde',          lat: 33.388, lon: -112.866, country: 'US', type: 'nuclear-plant' },
  { id: 'us-browns-ferry',   name: 'Browns Ferry',        lat: 34.704, lon: -87.118,  country: 'US', type: 'nuclear-plant' },
  { id: 'us-south-texas',    name: 'South Texas Project', lat: 28.795, lon: -96.048,  country: 'US', type: 'nuclear-plant' },
  { id: 'us-vogtle',         name: 'Vogtle',              lat: 33.143, lon: -81.762,  country: 'US', type: 'nuclear-plant' },
  { id: 'us-susquehanna',    name: 'Susquehanna',         lat: 41.09, lon: -76.142,  country: 'US', type: 'nuclear-plant' },
  { id: 'us-comanche-peak',  name: 'Comanche Peak',       lat: 32.298, lon: -97.787,  country: 'US', type: 'nuclear-plant' },
  { id: 'us-diablo-canyon',  name: 'Diablo Canyon',       lat: 35.211, lon: -120.854, country: 'US', type: 'nuclear-plant' },
  { id: 'us-calvert-cliffs', name: 'Calvert Cliffs',      lat: 38.434, lon: -76.442,  country: 'US', type: 'nuclear-plant' },
  { id: 'us-limerick',       name: 'Limerick',            lat: 40.226, lon: -75.586,  country: 'US', type: 'nuclear-plant' },
  { id: 'us-byron',          name: 'Byron',               lat: 42.075, lon: -89.281,  country: 'US', type: 'nuclear-plant' },
  { id: 'jp-fukushima',      name: 'Fukushima Daiichi',   lat: 37.421, lon: 141.033,  country: 'JP', type: 'nuclear-plant' },
  { id: 'jp-kashiwazaki',    name: 'Kashiwazaki-Kariwa',  lat: 37.428, lon: 138.602,  country: 'JP', type: 'nuclear-plant' },
  { id: 'ca-bruce',          name: 'Bruce',               lat: 44.323, lon: -81.601,  country: 'CA', type: 'nuclear-plant' },
  { id: 'ua-zaporizhzhia',   name: 'Zaporizhzhia',        lat: 47.512, lon: 34.585,   country: 'UA', type: 'nuclear-plant' },
  { id: 'ua-rivne',          name: 'Rivne',               lat: 51.325, lon: 25.892,   country: 'UA', type: 'nuclear-plant' },
  { id: 'gb-hinkley-point',  name: 'Hinkley Point',       lat: 51.208, lon: -3.13,   country: 'GB', type: 'nuclear-plant' },
  { id: 'fr-cattenom',       name: 'Cattenom',            lat: 49.416, lon: 6.219,    country: 'FR', type: 'nuclear-plant' },
  { id: 'se-ringhals',       name: 'Ringhals',            lat: 57.26, lon: 12.11,   country: 'SE', type: 'nuclear-plant' },
  { id: 'gb-heysham',        name: 'Heysham',             lat: 54.029, lon: -2.916,   country: 'GB', type: 'nuclear-plant' },
  { id: 'fi-olkiluoto',      name: 'Olkiluoto',           lat: 61.237, lon: 21.444,   country: 'FI', type: 'nuclear-plant' },
];

/** Key Gulf of Mexico oil + gas infrastructure. Bounding box
 *  [25–31°N, -98 to -82°W] keeps these unambiguously Gulf-coast. */
export const GULF_FUEL_INFRASTRUCTURE: FuelInfrastructure[] = [
  { id: 'gom-thunder-horse', name: 'Thunder Horse',           lat: 28.197, lon: -88.495, region: 'Mississippi Canyon', type: 'platform' },
  { id: 'gom-mars',          name: 'Mars',                    lat: 28.169, lon: -89.219, region: 'Mississippi Canyon', type: 'platform' },
  { id: 'gom-atlantis',      name: 'Atlantis',                lat: 27.197, lon: -90.03, region: 'Green Canyon',       type: 'platform' },
  { id: 'gom-mad-dog',       name: 'Mad Dog',                 lat: 27.171, lon: -90.275, region: 'Green Canyon',       type: 'platform' },
  { id: 'gom-olympus',       name: 'Olympus',                 lat: 28.142, lon: -89.245, region: 'Mississippi Canyon', type: 'platform' },
  { id: 'gom-loop',          name: 'LOOP (Louisiana Offshore Oil Port)', lat: 28.886, lon: -90.025, region: 'Louisiana shelf', type: 'terminal' },
  { id: 'gom-henry-hub',     name: 'Henry Hub',               lat: 30.022, lon: -92.139, region: 'Erath, LA',          type: 'pipeline-hub' },
  { id: 'gom-port-arthur',   name: 'Port Arthur Refinery',    lat: 29.866, lon: -93.972, region: 'TX',                 type: 'refinery' },
  { id: 'gom-galveston-bay', name: 'Galveston Bay Refinery',  lat: 29.35, lon: -94.916, region: 'TX',                 type: 'refinery' },
  { id: 'gom-baton-rouge',   name: 'Baton Rouge Refinery',    lat: 30.5, lon: -91.187, region: 'LA',                 type: 'refinery' },
];

// ── Geo + time helpers ─────────────────────────────────────────────────────

const EARTH_KM = 6371;
const DEG2RAD = Math.PI / 180;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const HOUR_MS = 60 * 60 * 1000;

// ── Constants ──────────────────────────────────────────────────────────────

const SEISMIC_NUCLEAR_RADIUS_KM = 50;
const SEISMIC_NUCLEAR_MIN_MAG = 5.5;

const SPACE_KP_THRESHOLD = 7;
const SPACE_XRAY_THRESHOLD = 1e-4;
const SPACE_CME_WINDOW_MS = 48 * HOUR_MS;

const FIRE_AQI_RADIUS_KM = 100;
const FIRE_AQI_MIN_AQI = 150;
const FIRE_AQI_CRIT_AQI = 200;

const INFRA_CYBER_WINDOW_MS = 24 * HOUR_MS;
const INFRA_KEYWORDS = [
  'critical infrastructure', 'power grid', 'electric grid', 'scada',
  'water utility', 'pipeline', 'energy sector', 'industrial control',
  'ics/scada', 'utility', 'substation', 'oil and gas', 'petrochemical',
];

const HURRICANE_FUEL_RADIUS_KM = 200;
const HURRICANE_MIN_CAT = 2;
const HURRICANE_CRIT_CAT = 4;

const MULTI_HAZARD_MIN_DOMAINS = 3;
const MULTI_HAZARD_CRIT_DOMAINS = 5;

// ── 1. Seismic + nuclear ───────────────────────────────────────────────────

export function detectSeismicNuclear(args: {
  earthquakes: readonly SeismicEvent[];
  now?: Date;
}): CorrelationEvent[] {
  const triggeredAt = args.now ?? new Date();
  const out: CorrelationEvent[] = [];
  for (const q of args.earthquakes) {
    if (q.magnitude < SEISMIC_NUCLEAR_MIN_MAG) continue;
    for (const plant of NUCLEAR_FACILITIES) {
      const km = haversineKm(q.lat, q.lon, plant.lat, plant.lon);
      if (km > SEISMIC_NUCLEAR_RADIUS_KM) continue;
      out.push({
        type: 'seismic-nuclear',
        severity: 'critical',
        domains: ['seismic', 'nuclear'],
        description:
          `M${q.magnitude.toFixed(1)} earthquake ${km.toFixed(0)} km from ${plant.name} (${plant.country}).`,
        triggeredAt,
        components: [
          {
            domain: 'seismic',
            source: `USGS event ${q.id}`,
            description: `M${q.magnitude.toFixed(1)} at (${q.lat.toFixed(2)}, ${q.lon.toFixed(2)})${q.place ? ` — ${q.place}` : ''}`,
            severity: q.magnitude >= 7 ? 'critical' : (q.magnitude >= 6 ? 'high' : 'medium'),
            metadata: { magnitude: q.magnitude, distanceKm: km, eventId: q.id },
          },
          {
            domain: 'nuclear',
            source: `Nuclear facility ${plant.name}`,
            description: `${plant.name}, ${plant.country} (${plant.type})`,
            metadata: { plantId: plant.id, lat: plant.lat, lon: plant.lon },
          },
        ],
      });
    }
  }
  return out;
}

// ── 2. Space weather cascade ───────────────────────────────────────────────

export function detectSpaceWeatherCascade(args: {
  spaceWeather: SpaceWeatherSnapshot | null;
  now?: Date;
}): CorrelationEvent[] {
  const triggeredAt = args.now ?? new Date();
  const sw = args.spaceWeather;
  if (!sw) return [];
  const kp = sw.kp;
  const flux = sw.xrayFlux;
  if (kp === null || kp < SPACE_KP_THRESHOLD) return [];
  if (flux === null || flux < SPACE_XRAY_THRESHOLD) return [];
  const matchingCmes = sw.earthwardCmes.filter((cme) => {
    if (!cme.estimatedArrival) return false;
    const t = Date.parse(cme.estimatedArrival);
    if (!Number.isFinite(t)) return false;
    return Math.abs(t - triggeredAt.getTime()) <= SPACE_CME_WINDOW_MS;
  });
  if (matchingCmes.length === 0) return [];
  return [{
    type: 'space-weather-cascade',
    severity: 'critical',
    domains: ['space-weather'],
    description:
      `Kp ${kp.toFixed(1)} geomagnetic storm + X-class flare (${flux.toExponential(1)} W/m²) + ${matchingCmes.length} earthward CME(s) within 48 h.`,
    triggeredAt,
    components: [
      {
        domain: 'space-weather',
        source: 'NOAA SWPC planetary Kp',
        description: `Kp ${kp.toFixed(2)} (G${Math.min(5, Math.max(0, Math.floor(kp - 4)))}+ storm)`,
        severity: kp >= 8 ? 'critical' : 'high',
        metadata: { kp },
      },
      {
        domain: 'space-weather',
        source: 'NOAA SWPC GOES X-ray',
        description: `Peak flux ${flux.toExponential(2)} W/m² (X-class HF blackout)`,
        severity: 'critical',
        metadata: { flux },
      },
      {
        domain: 'space-weather',
        source: 'NASA DONKI CME analyses',
        description: `${matchingCmes.length} earthward CME(s) inside ±48 h ETA`,
        severity: 'high',
        metadata: { cmeIds: matchingCmes.map((c) => c.id) },
      },
    ],
  }];
}

// ── 3. Wildfire + air quality ──────────────────────────────────────────────

export function detectWildfireAirQuality(args: {
  firePoints: readonly FirePoint[];
  airQuality: readonly AirQualitySensor[];
  now?: Date;
}): CorrelationEvent[] {
  const triggeredAt = args.now ?? new Date();
  const out: CorrelationEvent[] = [];
  for (const sensor of args.airQuality) {
    if (sensor.aqi <= FIRE_AQI_MIN_AQI) continue;
    let nearestFire: FirePoint | null = null;
    let nearestKm = Infinity;
    for (const f of args.firePoints) {
      const km = haversineKm(f.lat, f.lon, sensor.lat, sensor.lon);
      if (km <= FIRE_AQI_RADIUS_KM && km < nearestKm) {
        nearestKm = km;
        nearestFire = f;
      }
    }
    if (!nearestFire) continue;
    const severity: Severity = sensor.aqi > FIRE_AQI_CRIT_AQI ? 'critical' : 'high';
    out.push({
      type: 'wildfire-air-quality',
      severity,
      domains: ['wildfire', 'air-quality'],
      description:
        `FIRMS hotspot ${nearestKm.toFixed(0)} km from sensor ${sensor.id} reporting AQI ${sensor.aqi} (FRP ${nearestFire.frp.toFixed(0)} MW).`,
      triggeredAt,
      components: [
        {
          domain: 'wildfire',
          source: `FIRMS hotspot ${nearestFire.id}`,
          description: `FRP ${nearestFire.frp.toFixed(1)} MW at (${nearestFire.lat.toFixed(2)}, ${nearestFire.lon.toFixed(2)})`,
          metadata: { frp: nearestFire.frp, distanceKm: nearestKm },
        },
        {
          domain: 'air-quality',
          source: `AirNow sensor ${sensor.id}`,
          description: `AQI ${sensor.aqi}${sensor.pollutant ? ` (${sensor.pollutant})` : ''}`,
          severity,
          metadata: { aqi: sensor.aqi, pollutant: sensor.pollutant },
        },
      ],
    });
  }
  return out;
}

// ── 4. Infra + cyber ───────────────────────────────────────────────────────

export function detectInfraCyber(args: {
  bgpHijacks: readonly BgpHijack[];
  cyberPulses: readonly CyberPulse[];
  now?: Date;
}): CorrelationEvent[] {
  const triggeredAt = args.now ?? new Date();
  const cutoff = triggeredAt.getTime() - INFRA_CYBER_WINDOW_MS;
  const recentBgp = args.bgpHijacks.filter((b) => b.detectedAt.getTime() >= cutoff);
  if (recentBgp.length === 0) return [];
  const matchingPulses = args.cyberPulses.filter((p) => {
    if (p.publishedAt.getTime() < cutoff) return false;
    return mentionsCriticalInfra(p);
  });
  if (matchingPulses.length === 0) return [];
  const severity: Severity = recentBgp.length >= 3 ? 'critical' : 'high';
  return [{
    type: 'infra-cyber',
    severity,
    domains: ['cyber', 'infrastructure'],
    description:
      `${recentBgp.length} BGP hijack(s) within 24 h alongside ${matchingPulses.length} critical-infrastructure threat-intel pulse(s).`,
    triggeredAt,
    components: [
      ...recentBgp.slice(0, 5).map<ThreatComponent>((b) => ({
        domain: 'infrastructure',
        source: `Cloudflare Radar BGP ${b.id}`,
        description: `${b.asn} hijacked ${b.prefix}`,
        severity: 'high',
        metadata: { asn: b.asn, prefix: b.prefix },
      })),
      ...matchingPulses.slice(0, 5).map<ThreatComponent>((p) => ({
        domain: 'cyber',
        source: `OTX pulse ${p.id}`,
        description: p.title,
        severity: 'high',
        metadata: { publishedAt: p.publishedAt.toISOString() },
      })),
    ],
  }];
}

function mentionsCriticalInfra(p: CyberPulse): boolean {
  const haystack = `${p.title} ${p.description}`.toLowerCase();
  return INFRA_KEYWORDS.some((kw) => haystack.includes(kw));
}

// ── 5. Hurricane + fuel ────────────────────────────────────────────────────

export function detectHurricaneFuel(args: {
  hurricanes: readonly Hurricane[];
  now?: Date;
}): CorrelationEvent[] {
  const triggeredAt = args.now ?? new Date();
  const out: CorrelationEvent[] = [];
  for (const storm of args.hurricanes) {
    if (storm.category < HURRICANE_MIN_CAT) continue;
    let nearestPlatform: FuelInfrastructure | null = null;
    let nearestKm = Infinity;
    for (const p of GULF_FUEL_INFRASTRUCTURE) {
      const km = haversineKm(storm.lat, storm.lon, p.lat, p.lon);
      if (km <= HURRICANE_FUEL_RADIUS_KM && km < nearestKm) {
        nearestKm = km;
        nearestPlatform = p;
      }
    }
    if (!nearestPlatform) continue;
    const severity: Severity = storm.category >= HURRICANE_CRIT_CAT ? 'critical' : 'high';
    out.push({
      type: 'hurricane-fuel',
      severity,
      domains: ['hurricane', 'fuel'],
      description:
        `Cat ${storm.category} ${storm.name} ${nearestKm.toFixed(0)} km from ${nearestPlatform.name}.`,
      triggeredAt,
      components: [
        {
          domain: 'hurricane',
          source: `NHC ${storm.id}`,
          description: `${storm.name} Cat ${storm.category} at (${storm.lat.toFixed(2)}, ${storm.lon.toFixed(2)})`,
          severity,
          metadata: { category: storm.category, name: storm.name },
        },
        {
          domain: 'fuel',
          source: nearestPlatform.name,
          description: `${nearestPlatform.region} ${nearestPlatform.type}`,
          metadata: { facilityId: nearestPlatform.id, distanceKm: nearestKm },
        },
      ],
    });
  }
  return out;
}

// ── 6. Multi-hazard ────────────────────────────────────────────────────────

export function detectMultiHazard(args: {
  domainElevations: readonly DomainElevation[];
  now?: Date;
}): CorrelationEvent[] {
  const triggeredAt = args.now ?? new Date();
  const elevatedDomains = new Set<ThreatDomain>();
  const detailByDomain = new Map<ThreatDomain, string | undefined>();
  for (const e of args.domainElevations) {
    if (!e.elevated) continue;
    elevatedDomains.add(e.domain);
    if (e.detail) detailByDomain.set(e.domain, e.detail);
  }
  if (elevatedDomains.size < MULTI_HAZARD_MIN_DOMAINS) return [];
  const domains = [...elevatedDomains];
  const severity: Severity = elevatedDomains.size >= MULTI_HAZARD_CRIT_DOMAINS
    ? 'critical'
    : 'high';
  const components: ThreatComponent[] = domains.map((d) => ({
    domain: d,
    source: `Domain baseline tracker (${d})`,
    description: detailByDomain.get(d) ?? `${d} elevated above baseline`,
    metadata: { domain: d },
  }));
  return [{
    type: 'multi-hazard',
    severity,
    domains,
    description:
      `${elevatedDomains.size} threat domains elevated simultaneously: ${domains.join(', ')}.`,
    triggeredAt,
    components,
  }];
}

// ── Aggregator ─────────────────────────────────────────────────────────────

export function correlateThreats(input: CorrelationInput): CorrelationEvent[] {
  const now = input.now ?? new Date();
  return [
    ...detectSeismicNuclear({ earthquakes: input.earthquakes, now }),
    ...detectSpaceWeatherCascade({ spaceWeather: input.spaceWeather, now }),
    ...detectWildfireAirQuality({ firePoints: input.firePoints, airQuality: input.airQuality, now }),
    ...detectInfraCyber({ bgpHijacks: input.bgpHijacks, cyberPulses: input.cyberPulses, now }),
    ...detectHurricaneFuel({ hurricanes: input.hurricanes, now }),
    ...detectMultiHazard({ domainElevations: input.domainElevations, now }),
  ];
}

// ── Severity ranking helper (for UI sort + banner) ─────────────────────────

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function rankSeverity(s: Severity): number {
  return SEVERITY_RANK[s];
}

export function highestSeverity(events: readonly CorrelationEvent[]): Severity | null {
  if (events.length === 0) return null;
  let best: Severity = 'low';
  for (const e of events) {
    if (rankSeverity(e.severity) > rankSeverity(best)) best = e.severity;
  }
  return best;
}
