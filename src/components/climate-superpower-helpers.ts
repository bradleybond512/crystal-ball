/**
 * Pure helpers for ClimateSuperpowerPanel. No DOM, no fetch, no globals —
 * each function takes plain ObservationEvent inputs and returns a view
 * model. Pure helpers keep the panel logic testable in isolation.
 *
 * Five sections:
 *   - Extreme Event Tracker       → active wildfire/drought/heatwave/flood/blizzard events
 *   - Sea Level & Ice Monitor     → anomalous readings (sea level cm, ice extent anomaly)
 *   - Climate Migration Risk      → regions at risk of climate-driven displacement
 *   - Tipping Point Watch         → known tipping elements (AMOC, Greenland, Amazon, Permafrost)
 *   - Climate Security Index      → per-region composite 0-4 security risk
 */

import type {
  ObservationEvent,
  ObservationSeverity,
} from '@/types/intelligence';
import { escapeHtml } from '@/utils/sanitize';

// ── Severity helpers ───────────────────────────────────────────────

const OBS_SEVERITY_SCORE: Record<ObservationSeverity, number> = {
  INFO: 0, LOW: 2, MEDIUM: 5, HIGH: 7, CRITICAL: 9,
};

export function obsSeverityScore(s: ObservationSeverity): number {
  return OBS_SEVERITY_SCORE[s] ?? 0;
}

export function severityToBadgeClass(s: ObservationSeverity): string {
  switch (s) {
    case 'CRITICAL': { return 'sev-4'; }
    case 'HIGH':     { return 'sev-3'; }
    case 'MEDIUM':   { return 'sev-2'; }
    case 'LOW':      { return 'sev-1'; }
    case 'INFO':     { return 'sev-0'; }
  }
}

// ── Extreme Event Tracker ──────────────────────────────────────────

export type ExtremeEventKind =
  | 'wildfire'
  | 'drought'
  | 'heatwave'
  | 'flood'
  | 'blizzard'
  | 'storm'
  | 'other';

export interface ExtremeEventEntry {
  id: string;
  kind: ExtremeEventKind;
  region: string;
  title: string;
  severity: ObservationSeverity;
  areaAffectedKm2?: number;
  durationDays?: number;
  startedAt: number;
  timestamp: number;
}

const EXTREME_KIND_TAGS: Record<ExtremeEventKind, string[]> = {
  wildfire: ['wildfire', 'fire', 'bushfire', 'forest-fire'],
  drought: ['drought', 'dry-spell', 'water-stress'],
  heatwave: ['heatwave', 'heat-wave', 'extreme-heat'],
  flood: ['flood', 'flooding', 'flash-flood', 'inundation'],
  blizzard: ['blizzard', 'snowstorm', 'winter-storm', 'ice-storm'],
  storm: ['storm', 'cyclone', 'hurricane', 'typhoon', 'tornado'],
  other: [],
};

export function classifyExtremeEvent(ev: ObservationEvent): ExtremeEventKind {
  const tagsLc = ev.tags.map((t) => t.toLowerCase());
  for (const kind of Object.keys(EXTREME_KIND_TAGS) as ExtremeEventKind[]) {
    if (kind === 'other') continue;
    const hints = EXTREME_KIND_TAGS[kind];
    if (tagsLc.some((t) => hints.includes(t))) return kind;
  }
  const titleLc = ev.title.toLowerCase();
  for (const kind of Object.keys(EXTREME_KIND_TAGS) as ExtremeEventKind[]) {
    if (kind === 'other') continue;
    if (EXTREME_KIND_TAGS[kind].some((hint) => titleLc.includes(hint))) return kind;
  }
  return 'other';
}

export function buildExtremeEvents(
  events: readonly ObservationEvent[],
  options: { limit?: number; now?: number } = {},
): ExtremeEventEntry[] {
  const limit = options.limit ?? 10;
  const now = options.now ?? Date.now();
  const matched: ExtremeEventEntry[] = [];
  for (const ev of events) {
    const kind = classifyExtremeEvent(ev);
    if (kind === 'other') continue;
    const meta = rawAsRecord(ev.raw);
    const area = readNumber(meta, 'areaAffectedKm2') ?? readNumber(meta, 'area_km2');
    const startedAt = readNumber(meta, 'startedAt') ?? ev.timestamp;
    const durationDays = startedAt > 0
      ? Math.max(0, Math.round((now - startedAt) / 86_400_000))
      : undefined;
    matched.push({
      id: ev.id,
      kind,
      region: deriveRegion(ev) ?? 'Unknown',
      title: ev.title,
      severity: ev.severity,
      areaAffectedKm2: area ?? undefined,
      durationDays,
      startedAt,
      timestamp: ev.timestamp,
    });
  }
  matched.sort((a, b) =>
    obsSeverityScore(b.severity) - obsSeverityScore(a.severity)
    || b.timestamp - a.timestamp,
  );
  return matched.slice(0, limit);
}

// ── Sea Level & Ice Monitor ────────────────────────────────────────

export type SeaIceTrend = 'rising' | 'falling' | 'steady';

export interface SeaIceReading {
  id: string;
  kind: 'sea-level' | 'arctic-ice' | 'antarctic-ice';
  location: string;
  deviation: number;       // sea level: cm vs baseline; ice: million km² vs baseline
  unit: 'cm' | 'million_km2';
  trend: SeaIceTrend;
  severity: ObservationSeverity;
  timestamp: number;
}

const SEA_ICE_TAGS: Record<SeaIceReading['kind'], string[]> = {
  'sea-level': ['sea-level', 'sea-level-rise', 'tide-gauge', 'altimetry'],
  'arctic-ice': ['arctic-ice', 'arctic-sea-ice', 'arctic-extent'],
  'antarctic-ice': ['antarctic-ice', 'antarctic-sea-ice', 'antarctic-extent'],
};

function classifySeaIce(ev: ObservationEvent): SeaIceReading['kind'] | null {
  const tagsLc = ev.tags.map((t) => t.toLowerCase());
  for (const k of Object.keys(SEA_ICE_TAGS) as SeaIceReading['kind'][]) {
    if (tagsLc.some((t) => SEA_ICE_TAGS[k].includes(t))) return k;
  }
  return null;
}

export function buildSeaIceMonitor(
  events: readonly ObservationEvent[],
  limit = 10,
): SeaIceReading[] {
  const out: SeaIceReading[] = [];
  for (const ev of events) {
    const kind = classifySeaIce(ev);
    if (!kind) continue;
    const meta = rawAsRecord(ev.raw);
    const deviation = kind === 'sea-level'
      ? readNumber(meta, 'deviationCm') ?? readNumber(meta, 'deviation_cm') ?? 0
      : readNumber(meta, 'anomalyMillionKm2') ?? readNumber(meta, 'anomaly_million_km2') ?? 0;
    const trend = trendFromDeviation(deviation);
    out.push({
      id: ev.id,
      kind,
      location: deriveRegion(ev) ?? 'Global',
      deviation: round1(deviation),
      unit: kind === 'sea-level' ? 'cm' : 'million_km2',
      trend,
      severity: ev.severity,
      timestamp: ev.timestamp,
    });
  }
  out.sort((a, b) =>
    Math.abs(b.deviation) - Math.abs(a.deviation)
    || b.timestamp - a.timestamp,
  );
  return out.slice(0, limit);
}

// ── Climate Migration Risk ─────────────────────────────────────────

export type MigrationDriver = 'drought' | 'flooding' | 'heat' | 'storm' | 'mixed';

export interface MigrationRiskEntry {
  region: string;
  riskScore: number;          // 0–100
  primaryDriver: MigrationDriver;
  displacedEstimate: number;
  contributingEvents: number;
}

const DRIVER_FROM_KIND: Record<ExtremeEventKind, MigrationDriver | null> = {
  wildfire: 'heat',
  drought: 'drought',
  heatwave: 'heat',
  flood: 'flooding',
  blizzard: null,
  storm: 'storm',
  other: null,
};

export function buildMigrationRisk(
  events: readonly ObservationEvent[],
  limit = 8,
): MigrationRiskEntry[] {
  const perRegion = new Map<string, {
    score: number;
    drivers: Map<MigrationDriver, number>;
    displaced: number;
    count: number;
  }>();
  for (const ev of events) {
    const kind = classifyExtremeEvent(ev);
    const driver = DRIVER_FROM_KIND[kind];
    if (!driver) continue;
    const region = deriveRegion(ev);
    if (!region) continue;
    const meta = rawAsRecord(ev.raw);
    const displaced = readNumber(meta, 'displacedEstimate')
      ?? readNumber(meta, 'displaced')
      ?? readNumber(meta, 'affectedPopulation')
      ?? 0;
    const sevContribution = obsSeverityScore(ev.severity);
    const entry = perRegion.get(region) ?? {
      score: 0,
      drivers: new Map<MigrationDriver, number>(),
      displaced: 0,
      count: 0,
    };
    entry.score += sevContribution;
    entry.drivers.set(driver, (entry.drivers.get(driver) ?? 0) + sevContribution);
    entry.displaced += displaced;
    entry.count += 1;
    perRegion.set(region, entry);
  }

  const rows: MigrationRiskEntry[] = [...perRegion.entries()].map(([region, data]) => {
    const topDriver = [...data.drivers.entries()]
      .sort((a, b) => b[1] - a[1])[0];
    const isMixed = data.drivers.size >= 3;
    return {
      region,
      riskScore: clamp(Math.round(data.score * 5), 0, 100),
      primaryDriver: isMixed ? 'mixed' : (topDriver?.[0] ?? 'mixed'),
      displacedEstimate: Math.round(data.displaced),
      contributingEvents: data.count,
    };
  });
  rows.sort((a, b) =>
    b.riskScore - a.riskScore
    || b.displacedEstimate - a.displacedEstimate
    || a.region.localeCompare(b.region),
  );
  return rows.slice(0, limit);
}

// ── Tipping Point Watch ────────────────────────────────────────────

export type TippingElement = 'AMOC' | 'Greenland' | 'Amazon' | 'Permafrost' | 'WAIS' | 'Coral';
export type TippingStatus = 'stable' | 'stressed' | 'critical';

export interface TippingPointEntry {
  element: TippingElement;
  status: TippingStatus;
  anomalyScore: number;        // 0–10
  lastObservedAt: number;
  evidenceCount: number;
}

const TIPPING_TAGS: Record<TippingElement, string[]> = {
  AMOC: ['amoc', 'gulf-stream', 'thermohaline'],
  Greenland: ['greenland-ice-sheet', 'greenland-melt', 'gris'],
  Amazon: ['amazon-dieback', 'amazon-deforestation', 'amazon-tipping'],
  Permafrost: ['permafrost', 'permafrost-thaw', 'methane-release'],
  WAIS: ['wais', 'west-antarctic-ice-sheet', 'antarctic-glacier'],
  Coral: ['coral-bleaching', 'reef-collapse', 'ocean-heat'],
};

function matchTippingElement(ev: ObservationEvent): TippingElement | null {
  const tagsLc = ev.tags.map((t) => t.toLowerCase());
  for (const el of Object.keys(TIPPING_TAGS) as TippingElement[]) {
    if (tagsLc.some((t) => TIPPING_TAGS[el].includes(t))) return el;
  }
  return null;
}

export function buildTippingPoints(
  events: readonly ObservationEvent[],
): TippingPointEntry[] {
  const perElement = new Map<TippingElement, {
    severitySum: number;
    count: number;
    lastTs: number;
  }>();
  for (const ev of events) {
    const el = matchTippingElement(ev);
    if (!el) continue;
    const entry = perElement.get(el) ?? { severitySum: 0, count: 0, lastTs: 0 };
    entry.severitySum += obsSeverityScore(ev.severity);
    entry.count += 1;
    if (ev.timestamp > entry.lastTs) entry.lastTs = ev.timestamp;
    perElement.set(el, entry);
  }

  const elements: TippingElement[] = ['AMOC', 'Greenland', 'Amazon', 'Permafrost', 'WAIS', 'Coral'];
  return elements.map((el): TippingPointEntry => {
    const data = perElement.get(el);
    if (!data || data.count === 0) {
      return {
        element: el,
        status: 'stable',
        anomalyScore: 0,
        lastObservedAt: 0,
        evidenceCount: 0,
      };
    }
    const mean = data.severitySum / data.count;
    const status = tippingStatusFromMean(mean);
    return {
      element: el,
      status,
      anomalyScore: round1(mean),
      lastObservedAt: data.lastTs,
      evidenceCount: data.count,
    };
  });
}

// ── Climate Security Index ─────────────────────────────────────────

export interface ClimateSecurityRow {
  region: ClimateSecurityRegion;
  index: 0 | 1 | 2 | 3 | 4;
  eventCount: number;
  driverSummary: string;
}

export type ClimateSecurityRegion =
  | 'Sub-Saharan Africa'
  | 'South Asia'
  | 'Middle East'
  | 'Central America'
  | 'Pacific Islands'
  | 'Arctic';

const SECURITY_REGION_KEYS: Record<ClimateSecurityRegion, string[]> = {
  'Sub-Saharan Africa': ['sub-saharan-africa', 'ssa', 'africa-south'],
  'South Asia': ['south-asia', 'south_asia', 'india', 'pakistan', 'bangladesh'],
  'Middle East': ['middle-east', 'mena', 'levant'],
  'Central America': ['central-america', 'mesoamerica'],
  'Pacific Islands': ['pacific-islands', 'oceania-small-states', 'sids'],
  'Arctic': ['arctic'],
};

const SECURITY_REGION_FROM_DERIVED: Record<string, ClimateSecurityRegion> = {
  'Africa': 'Sub-Saharan Africa',
  'Asia': 'South Asia',
  'Oceania': 'Pacific Islands',
  'Arctic': 'Arctic',
};

function matchSecurityRegion(ev: ObservationEvent): ClimateSecurityRegion | null {
  const tagsLc = ev.tags.map((t) => t.toLowerCase());
  for (const region of Object.keys(SECURITY_REGION_KEYS) as ClimateSecurityRegion[]) {
    if (tagsLc.some((t) => SECURITY_REGION_KEYS[region].includes(t))) return region;
  }
  const derived = deriveRegion(ev);
  if (derived && SECURITY_REGION_FROM_DERIVED[derived]) {
    return SECURITY_REGION_FROM_DERIVED[derived];
  }
  return null;
}

export function buildClimateSecurityIndex(
  events: readonly ObservationEvent[],
): ClimateSecurityRow[] {
  const perRegion = new Map<ClimateSecurityRegion, {
    sum: number;
    count: number;
    drivers: Set<ExtremeEventKind>;
  }>();
  for (const ev of events) {
    const region = matchSecurityRegion(ev);
    if (!region) continue;
    const entry = perRegion.get(region) ?? { sum: 0, count: 0, drivers: new Set<ExtremeEventKind>() };
    entry.sum += obsSeverityScore(ev.severity);
    entry.count += 1;
    const kind = classifyExtremeEvent(ev);
    if (kind !== 'other') entry.drivers.add(kind);
    perRegion.set(region, entry);
  }
  const regions: ClimateSecurityRegion[] = [
    'Sub-Saharan Africa',
    'South Asia',
    'Middle East',
    'Central America',
    'Pacific Islands',
    'Arctic',
  ];
  return regions.map((r): ClimateSecurityRow => {
    const data = perRegion.get(r);
    if (!data || data.count === 0) {
      return { region: r, index: 0, eventCount: 0, driverSummary: '—' };
    }
    const mean = data.sum / data.count;
    const index = securityIndexFromMean(mean);
    const driverSummary = [...data.drivers].sort((a, b) => a.localeCompare(b)).join(', ') || '—';
    return { region: r, index, eventCount: data.count, driverSummary };
  });
}

// ── Internals ──────────────────────────────────────────────────────

function deriveRegion(ev: ObservationEvent): string | undefined {
  const meta = rawAsRecord(ev.raw);
  const explicit = typeof meta.region === 'string' ? (meta.region as string) : undefined;
  if (explicit) return explicit;
  const tagRegion = ev.tags.find((t) => t.startsWith('region:'));
  if (tagRegion) return tagRegion.slice('region:'.length);
  const loc = ev.location;
  if (!loc || typeof loc.lat !== 'number' || typeof loc.lon !== 'number') return undefined;
  return regionFromLatLon(loc.lat, loc.lon);
}

function regionFromLatLon(lat: number, lon: number): string {
  if (lat > 66) return 'Arctic';
  if (lat > 35 && lon > -25 && lon < 65) return 'Europe';
  if (lat > 0 && lon >= 65 && lon < 150) return 'Asia';
  if (lat < 0 && lon >= 110 && lon < 180) return 'Oceania';
  if (lat >= 15 && lon >= -170 && lon < -50) return 'North America';
  if (lat < 15 && lon >= -90 && lon < -30) return 'South America';
  if (lat < 35 && lon > -20 && lon < 55) return 'Africa';
  return 'Other';
}

function trendFromDeviation(d: number): SeaIceTrend {
  if (d > 0.5) return 'rising';
  if (d < -0.5) return 'falling';
  return 'steady';
}

function tippingStatusFromMean(mean: number): TippingStatus {
  if (mean >= 7) return 'critical';
  if (mean >= 4) return 'stressed';
  return 'stable';
}

function securityIndexFromMean(mean: number): ClimateSecurityRow['index'] {
  if (mean >= 8) return 4;
  if (mean >= 6) return 3;
  if (mean >= 4) return 2;
  if (mean >= 2) return 1;
  return 0;
}

function arrowFromTrend(t: SeaIceTrend): string {
  switch (t) {
    case 'rising': { return '↑'; }
    case 'falling': { return '↓'; }
    case 'steady': { return '→'; }
  }
}

function dotFromTippingStatus(s: TippingStatus): string {
  switch (s) {
    case 'critical': { return '●'; }
    case 'stressed': { return '◐'; }
    case 'stable': { return '○'; }
  }
}

function rawAsRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
}

function readNumber(attrs: unknown, key: string): number | null {
  if (!attrs || typeof attrs !== 'object') return null;
  const v = (attrs as Record<string, unknown>)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Renderer ───────────────────────────────────────────────────────

export interface ClimatePanelState {
  extreme: ExtremeEventEntry[];
  seaIce: SeaIceReading[];
  migration: MigrationRiskEntry[];
  tipping: TippingPointEntry[];
  security: ClimateSecurityRow[];
  generatedAt: number;
}

export function renderClimateSuperpowerHtml(
  state: ClimatePanelState,
  nowFn: () => number = Date.now,
): string {
  return `<div class="climate-superpower">
    ${renderExtreme(state.extreme)}
    ${renderSeaIce(state.seaIce)}
    ${renderMigration(state.migration)}
    ${renderTipping(state.tipping)}
    ${renderSecurity(state.security)}
    <div class="climate-sp-footer" style="margin-top:8px;font-size:11px;opacity:0.6">Updated ${escapeHtml(timeAgo(state.generatedAt, nowFn()))}</div>
  </div>`;
}

function renderExtreme(items: ExtremeEventEntry[]): string {
  if (items.length === 0) {
    return `<section class="climate-sp-section" data-section="extreme-events">
      <h3 style="margin:0 0 6px 0;font-size:13px">Extreme Event Tracker</h3>
      <div class="climate-sp-empty" style="opacity:0.6;font-size:12px">No active extreme climate events.</div>
    </section>`;
  }
  const rows = items.map((e) => {
    const areaHtml = typeof e.areaAffectedKm2 === 'number'
      ? ` · ${escapeHtml(formatArea(e.areaAffectedKm2))}`
      : '';
    const durHtml = typeof e.durationDays === 'number' && e.durationDays > 0
      ? ` · ${e.durationDays}d`
      : '';
    return `<li style="padding:4px 0;font-size:12px">
      <span class="${escapeHtml(severityToBadgeClass(e.severity))}" style="display:inline-block;width:72px;font-weight:600">${escapeHtml(e.severity)}</span>
      <span style="display:inline-block;width:70px;opacity:0.85">${escapeHtml(e.kind)}</span>
      <strong>${escapeHtml(e.title)}</strong>
      <span style="opacity:0.6">· ${escapeHtml(e.region)}${areaHtml}${durHtml}</span>
    </li>`;
  }).join('');
  return `<section class="climate-sp-section" data-section="extreme-events">
    <h3 style="margin:0 0 6px 0;font-size:13px">Extreme Event Tracker</h3>
    <ul style="list-style:none;padding:0;margin:0">${rows}</ul>
  </section>`;
}

function renderSeaIce(items: SeaIceReading[]): string {
  if (items.length === 0) {
    return `<section class="climate-sp-section" data-section="sea-ice">
      <h3 style="margin:8px 0 6px 0;font-size:13px">Sea Level &amp; Ice Monitor</h3>
      <div class="climate-sp-empty" style="opacity:0.6;font-size:12px">No anomalous readings.</div>
    </section>`;
  }
  const rows = items.map((r) => {
    const arrow = arrowFromTrend(r.trend);
    const unitLabel = r.unit === 'cm' ? 'cm' : 'M km²';
    return `<li style="padding:4px 0;font-size:12px">
      <span style="display:inline-block;width:96px;opacity:0.85">${escapeHtml(r.kind)}</span>
      <strong>${arrow} ${r.deviation} ${escapeHtml(unitLabel)}</strong>
      <span style="opacity:0.6">· ${escapeHtml(r.location)} · ${escapeHtml(r.trend)}</span>
    </li>`;
  }).join('');
  return `<section class="climate-sp-section" data-section="sea-ice">
    <h3 style="margin:8px 0 6px 0;font-size:13px">Sea Level &amp; Ice Monitor</h3>
    <ul style="list-style:none;padding:0;margin:0">${rows}</ul>
  </section>`;
}

function renderMigration(items: MigrationRiskEntry[]): string {
  if (items.length === 0) {
    return `<section class="climate-sp-section" data-section="migration-risk">
      <h3 style="margin:8px 0 6px 0;font-size:13px">Climate Migration Risk</h3>
      <div class="climate-sp-empty" style="opacity:0.6;font-size:12px">No regions flagged.</div>
    </section>`;
  }
  const rows = items.map((m) => `<li style="padding:4px 0;font-size:12px">
    <span style="display:inline-block;width:48px;font-weight:600">${m.riskScore}</span>
    <strong>${escapeHtml(m.region)}</strong>
    <span style="opacity:0.65">· ${escapeHtml(m.primaryDriver)} · ${formatCount(m.displacedEstimate)} displaced · ${m.contributingEvents} obs</span>
  </li>`).join('');
  return `<section class="climate-sp-section" data-section="migration-risk">
    <h3 style="margin:8px 0 6px 0;font-size:13px">Climate Migration Risk</h3>
    <ul style="list-style:none;padding:0;margin:0">${rows}</ul>
  </section>`;
}

function renderTipping(items: TippingPointEntry[]): string {
  const rows = items.map((t) => {
    const dot = dotFromTippingStatus(t.status);
    return `<li style="padding:4px 0;font-size:12px">
      <span style="display:inline-block;width:18px">${dot}</span>
      <strong style="display:inline-block;width:96px">${escapeHtml(t.element)}</strong>
      <span style="opacity:0.85">${escapeHtml(t.status)}</span>
      <span style="opacity:0.6">· anomaly ${t.anomalyScore} · ${t.evidenceCount} obs</span>
    </li>`;
  }).join('');
  return `<section class="climate-sp-section" data-section="tipping-points">
    <h3 style="margin:8px 0 6px 0;font-size:13px">Tipping Point Watch</h3>
    <ul style="list-style:none;padding:0;margin:0">${rows}</ul>
  </section>`;
}

function renderSecurity(items: ClimateSecurityRow[]): string {
  const rows = items.map((s) => `<li style="padding:4px 0;font-size:12px">
    <span style="display:inline-block;width:24px;text-align:right;font-weight:600;color:var(--severity-${s.index})">${s.index}</span>
    <strong style="display:inline-block;width:170px">${escapeHtml(s.region)}</strong>
    <span style="opacity:0.65">${escapeHtml(s.driverSummary)} · ${s.eventCount} obs</span>
  </li>`).join('');
  return `<section class="climate-sp-section" data-section="security-index">
    <h3 style="margin:8px 0 6px 0;font-size:13px">Climate Security Index</h3>
    <ul style="list-style:none;padding:0;margin:0">${rows}</ul>
  </section>`;
}

function formatArea(km2: number): string {
  if (km2 >= 1_000_000) return `${round1(km2 / 1_000_000)}M km²`;
  if (km2 >= 1000) return `${round1(km2 / 1000)}k km²`;
  return `${Math.round(km2)} km²`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${round1(n / 1_000_000)}M`;
  if (n >= 1000) return `${round1(n / 1000)}k`;
  return `${n}`;
}

function timeAgo(ts: number, now: number): string {
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}
