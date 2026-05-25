/**
 * Pure helpers powering GeopoliticalSuperpowerPanel.
 *
 * Split out so unit tests can import these without dragging in the Panel
 * base class (which transitively pulls Vite-only `?worker` imports). The
 * panel file re-exports these for backward compatibility.
 */

import type { Situation, SituationSeverity } from '@/services/intelligence/situation-store-v2';
import type { CalendarEvent } from '@/services/intelligence/geopolitical-event-calendar';
import type { Entity } from '@/services/intelligence/entity-registry';
import { escapeHtml } from '@/utils/sanitize';

export const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const RECENT_DESIGNATION_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export interface GeopoliticalSuperpowerDeps {
  /** Source of all situations. Defaults to SituationStoreV2 singleton at runtime. */
  getSituations: () => readonly Situation[];
  /** Source of all entities. Defaults to EntityRegistry.allEntities(). */
  getEntities: () => readonly Entity[];
  /** Source of upcoming calendar events. */
  getCalendarEvents: (withinMs: number) => readonly CalendarEvent[];
  /** Clock injection for deterministic tests. */
  now?: () => number;
}

const SEVERITY_WEIGHT: Record<SituationSeverity, number> = {
  low: 5,
  medium: 15,
  high: 30,
  critical: 50,
};

const GEOPOLITICAL_DOMAINS = new Set([
  'geopolitical', 'conflict', 'diplomacy', 'sanctions', 'gdelt', 'intelligence',
]);

const CONFLICT_DOMAINS = new Set(['conflict', 'geopolitical', 'military']);

const ALLIANCE_TAGS = new Set(['alliance', 'treaty', 'summit', 'diplomacy', 'embassy']);

const REGION_LABELS: Record<string, string> = {
  americas: 'Americas',
  europe: 'Europe',
  africa: 'Africa',
  asia: 'Asia-Pacific',
  unknown: 'Unknown',
};

/** Wrap a thunk in try/catch and return undefined on throw. */
export function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

function severityToScore(s: SituationSeverity): number {
  return SEVERITY_WEIGHT[s] ?? 0;
}

const LONGITUDE_BUCKETS: { min: number; maxExclusive: number; region: string }[] = [
  { min: -170, maxExclusive: -30, region: 'americas' },
  { min: -30,  maxExclusive: 40,  region: 'europe' },
  { min: 40,   maxExclusive: 70,  region: 'africa' },
  { min: 70,   maxExclusive: 180.0001, region: 'asia' },
];

function regionFromLongitude(lon: number): string | undefined {
  for (const b of LONGITUDE_BUCKETS) {
    if (lon >= b.min && lon < b.maxExclusive) return b.region;
  }
  return undefined;
}

function regionFromTags(tags: readonly string[]): string | undefined {
  for (const tag of tags) {
    if (tag.startsWith('region:')) return tag.slice('region:'.length).toLowerCase();
  }
  return undefined;
}

/**
 * Derive a coarse region key from a situation. Prefers an explicit `region:*`
 * tag, then falls back to longitude bucketing on the situation's location,
 * then 'unknown'.
 */
export function regionOf(s: Situation): string {
  const tagged = regionFromTags(s.tags);
  if (tagged) return tagged;
  if (s.location) {
    const fromLon = regionFromLongitude(s.location.lon);
    if (fromLon) return fromLon;
  }
  return 'unknown';
}

export interface RegionHeat {
  region: string;
  label: string;
  score: number;
  activeCount: number;
  criticalCount: number;
}

interface HeatBucket { score: number; active: number; critical: number; }

function getOrInitBucket(buckets: Map<string, HeatBucket>, region: string): HeatBucket {
  const existing = buckets.get(region);
  if (existing) return existing;
  const fresh: HeatBucket = { score: 0, active: 0, critical: 0 };
  buckets.set(region, fresh);
  return fresh;
}

function applySituationToBucket(s: Situation, buckets: Map<string, HeatBucket>): void {
  if (s.status === 'resolved') return;
  if (!CONFLICT_DOMAINS.has(s.domain)) return;
  const bucket = getOrInitBucket(buckets, regionOf(s));
  bucket.score += severityToScore(s.severity);
  bucket.active += 1;
  if (s.severity === 'critical') bucket.critical += 1;
}

export function computeConflictHeat(
  situations: readonly Situation[],
  sanctionsByRegion: ReadonlyMap<string, number>,
): RegionHeat[] {
  const buckets = new Map<string, HeatBucket>();
  for (const s of situations) applySituationToBucket(s, buckets);
  for (const [region, count] of sanctionsByRegion) {
    getOrInitBucket(buckets, region).score += Math.min(20, count * 2);
  }
  const out: RegionHeat[] = [];
  for (const [region, bucket] of buckets) {
    out.push({
      region,
      label: REGION_LABELS[region] ?? region,
      score: Math.max(0, Math.min(100, Math.round(bucket.score))),
      activeCount: bucket.active,
      criticalCount: bucket.critical,
    });
  }
  out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return out;
}

export interface SanctionsView {
  totalDesignated: number;
  topCountries: { iso: string; count: number }[];
  recentDesignations: { id: string; name: string; designatedAt: number }[];
  sanctionsByRegion: Map<string, number>;
}

export function computeSanctionsView(
  entities: readonly Entity[],
  now: number,
): SanctionsView {
  const designated = entities.filter(e =>
    Boolean(e.identifiers['ofac-sdn']) || e.domains.includes('sanctions'),
  );
  const countryCounts = new Map<string, number>();
  const regionCounts = new Map<string, number>();
  for (const e of designated) {
    const iso = e.identifiers.iso3 ?? e.identifiers['country-iso'] ?? '';
    if (iso) countryCounts.set(iso, (countryCounts.get(iso) ?? 0) + 1);
    const regionAttr = typeof e.attributes.region === 'string' ? e.attributes.region.toLowerCase() : 'unknown';
    regionCounts.set(regionAttr, (regionCounts.get(regionAttr) ?? 0) + 1);
  }
  const topCountries = [...countryCounts]
    .map(([iso, count]) => ({ iso, count }))
    .sort((a, b) => b.count - a.count || a.iso.localeCompare(b.iso))
    .slice(0, 5);
  const recentDesignations = designated
    .filter(e => now - e.lastSeen <= RECENT_DESIGNATION_WINDOW_MS)
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, 5)
    .map(e => ({ id: e.id, name: e.canonicalName, designatedAt: e.lastSeen }));
  return {
    totalDesignated: designated.length,
    topCountries,
    recentDesignations,
    sanctionsByRegion: regionCounts,
  };
}

export interface StreamEntry {
  id: string;
  title: string;
  domain: string;
  severity: SituationSeverity;
  updatedAt: number;
}

export function computeEventStream(situations: readonly Situation[], limit = 10): StreamEntry[] {
  return situations
    .filter(s => GEOPOLITICAL_DOMAINS.has(s.domain))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, limit)
    .map(s => ({
      id: s.id,
      title: s.name,
      domain: s.domain,
      severity: s.severity,
      updatedAt: s.updatedAt.getTime(),
    }));
}

export interface AllianceSignal {
  id: string;
  title: string;
  kind: 'summit' | 'treaty-deadline' | 'situation';
  riskOrSeverity: string;
  whenMs: number;
}

export function computeAllianceMonitor(
  situations: readonly Situation[],
  calendar: readonly CalendarEvent[],
): AllianceSignal[] {
  const out: AllianceSignal[] = [];
  for (const e of calendar) {
    if (e.type !== 'summit' && e.type !== 'treaty-deadline') continue;
    out.push({
      id: e.id,
      title: e.title,
      kind: e.type,
      riskOrSeverity: e.riskLevel,
      whenMs: e.scheduledAt,
    });
  }
  for (const s of situations) {
    if (s.status === 'resolved') continue;
    if (!s.tags.some(t => ALLIANCE_TAGS.has(t))) continue;
    out.push({
      id: s.id,
      title: s.name,
      kind: 'situation',
      riskOrSeverity: s.severity,
      whenMs: s.updatedAt.getTime(),
    });
  }
  out.sort((a, b) => a.whenMs - b.whenMs);
  return out.slice(0, 10);
}

export interface Flashpoint {
  id: string;
  title: string;
  region: string;
  severity: SituationSeverity;
  lat: number;
  lon: number;
  updatedAt: number;
}

export function computeFlashpoints(situations: readonly Situation[], now: number): Flashpoint[] {
  const fps: (Flashpoint & { weight: number })[] = [];
  for (const s of situations) {
    if (s.status === 'resolved') continue;
    if (s.severity !== 'high' && s.severity !== 'critical') continue;
    if (!s.location) continue;
    const ageHrs = Math.max(0, (now - s.updatedAt.getTime()) / (60 * 60 * 1000));
    const recencyFactor = Math.max(0.1, 1 - ageHrs / 168);
    const weight = severityToScore(s.severity) * recencyFactor;
    fps.push({
      id: s.id,
      title: s.name,
      region: REGION_LABELS[regionOf(s)] ?? 'Unknown',
      severity: s.severity,
      lat: s.location.lat,
      lon: s.location.lon,
      updatedAt: s.updatedAt.getTime(),
      weight,
    });
  }
  fps.sort((a, b) => b.weight - a.weight);
  return fps.slice(0, 8).map((fp): Flashpoint => ({
    id: fp.id,
    title: fp.title,
    region: fp.region,
    severity: fp.severity,
    lat: fp.lat,
    lon: fp.lon,
    updatedAt: fp.updatedAt,
  }));
}

export interface PanelViewModel {
  conflictHeat: RegionHeat[];
  sanctions: SanctionsView;
  eventStream: StreamEntry[];
  alliance: AllianceSignal[];
  flashpoints: Flashpoint[];
  errors: string[];
}

export function buildViewModel(deps: GeopoliticalSuperpowerDeps): PanelViewModel {
  const errors: string[] = [];
  const now = (deps.now ?? Date.now)();
  const situationsRaw = safe(() => deps.getSituations());
  if (situationsRaw === undefined) errors.push('Situations unavailable');
  const situations = situationsRaw ?? [];
  const entitiesRaw = safe(() => deps.getEntities());
  if (entitiesRaw === undefined) errors.push('Entities unavailable');
  const entities = entitiesRaw ?? [];
  const calendarRaw = safe(() => deps.getCalendarEvents(NINETY_DAYS_MS));
  if (calendarRaw === undefined) errors.push('Calendar unavailable');
  const calendar = calendarRaw ?? [];

  const sanctions = computeSanctionsView(entities, now);
  return {
    conflictHeat: computeConflictHeat(situations, sanctions.sanctionsByRegion),
    sanctions,
    eventStream: computeEventStream(situations),
    alliance: computeAllianceMonitor(situations, calendar),
    flashpoints: computeFlashpoints(situations, now),
    errors,
  };
}

// ── Rendering ─────────────────────────────────────────────────────────────

const SEVERITY_BADGE: Record<SituationSeverity, string> = {
  low: 'background:#9ca3af20; color:#9ca3af',
  medium: 'background:#f5a52420; color:#f5a524',
  high: 'background:#e07b3020; color:#e07b30',
  critical: 'background:#e94f3720; color:#e94f37',
};

function fmtAgo(now: number, ts: number): string {
  const diffMs = Math.max(0, now - ts);
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtUntil(now: number, ts: number): string {
  const diffMs = ts - now;
  if (diffMs <= 0) return 'now';
  const hrs = Math.floor(diffMs / (60 * 60 * 1000));
  if (hrs < 24) return `in ${hrs}h`;
  return `in ${Math.floor(hrs / 24)}d`;
}

function heatColor(score: number): string {
  if (score >= 75) return '#e94f37';
  if (score >= 50) return '#e07b30';
  if (score >= 25) return '#f5a524';
  return '#9ca3af';
}

function renderConflictHeat(rows: RegionHeat[]): string {
  if (rows.length === 0) {
    return '<div class="geo-empty">No active conflict signal across tracked regions.</div>';
  }
  return rows.map(r => `
    <div class="geo-heat-row">
      <span class="geo-heat-label">${escapeHtml(r.label)}</span>
      <span class="geo-heat-meter" style="background:${heatColor(r.score)}20;">
        <span class="geo-heat-fill" style="width:${r.score}%; background:${heatColor(r.score)};"></span>
      </span>
      <span class="geo-heat-score" style="color:${heatColor(r.score)};">${r.score}</span>
      <span class="geo-heat-meta">${r.activeCount} active${r.criticalCount > 0 ? ` · ${r.criticalCount} critical` : ''}</span>
    </div>
  `).join('');
}

function renderSanctionsRadar(view: SanctionsView, now: number): string {
  if (view.totalDesignated === 0) {
    return '<div class="geo-empty">No designated entities tracked.</div>';
  }
  const countries = view.topCountries.length === 0
    ? '<span class="geo-muted">No country breakdown</span>'
    : view.topCountries.map(c => `<span class="geo-chip">${escapeHtml(c.iso)} · ${c.count}</span>`).join(' ');
  const recent = view.recentDesignations.length === 0
    ? '<div class="geo-muted">No additions in last 14 days</div>'
    : view.recentDesignations.map(r => `
        <div class="geo-recent-row">
          <span class="geo-recent-name">${escapeHtml(r.name)}</span>
          <span class="geo-muted">${fmtAgo(now, r.designatedAt)}</span>
        </div>
      `).join('');
  return `
    <div class="geo-sanctions-summary"><strong>${view.totalDesignated}</strong> designated entities</div>
    <div class="geo-sanctions-countries">${countries}</div>
    <div class="geo-sanctions-recent">${recent}</div>
  `;
}

function renderEventStream(entries: StreamEntry[], now: number): string {
  if (entries.length === 0) {
    return '<div class="geo-empty">No recent geopolitical events.</div>';
  }
  return entries.map(e => `
    <div class="geo-stream-row" data-situation-id="${escapeHtml(e.id)}">
      <span class="geo-badge" style="${SEVERITY_BADGE[e.severity]}">${e.severity}</span>
      <span class="geo-stream-title">${escapeHtml(e.title)}</span>
      <span class="geo-muted">${escapeHtml(e.domain)} · ${fmtAgo(now, e.updatedAt)}</span>
    </div>
  `).join('');
}

function renderAlliance(signals: AllianceSignal[], now: number): string {
  if (signals.length === 0) {
    return '<div class="geo-empty">No alliance signals pending.</div>';
  }
  return signals.map(a => `
    <div class="geo-alliance-row">
      <span class="geo-alliance-kind">${escapeHtml(a.kind)}</span>
      <span class="geo-alliance-title">${escapeHtml(a.title)}</span>
      <span class="geo-muted">${escapeHtml(a.riskOrSeverity)} · ${fmtUntil(now, a.whenMs)}</span>
    </div>
  `).join('');
}

function renderFlashpoints(fps: Flashpoint[], now: number): string {
  if (fps.length === 0) {
    return '<div class="geo-empty">No flashpoints — quiet on the high-severity front.</div>';
  }
  return fps.map(f => `
    <div class="geo-flash-row">
      <span class="geo-badge" style="${SEVERITY_BADGE[f.severity]}">${f.severity}</span>
      <span class="geo-flash-title">${escapeHtml(f.title)}</span>
      <span class="geo-muted">${escapeHtml(f.region)} · ${f.lat.toFixed(2)}, ${f.lon.toFixed(2)} · ${fmtAgo(now, f.updatedAt)}</span>
    </div>
  `).join('');
}

export function renderHtml(vm: PanelViewModel, now: number): string {
  const errorRow = vm.errors.length === 0
    ? ''
    : `<div class="geo-error-row">⚠ ${vm.errors.map(e => escapeHtml(e)).join(' · ')}</div>`;
  return `
    <div class="geo-superpower">
      ${errorRow}
      <section class="geo-section">
        <h3 class="geo-section-title">Conflict Heat Index</h3>
        ${renderConflictHeat(vm.conflictHeat)}
      </section>
      <section class="geo-section">
        <h3 class="geo-section-title">Sanctions Radar</h3>
        ${renderSanctionsRadar(vm.sanctions, now)}
      </section>
      <section class="geo-section">
        <h3 class="geo-section-title">GDELT Event Stream</h3>
        ${renderEventStream(vm.eventStream, now)}
      </section>
      <section class="geo-section">
        <h3 class="geo-section-title">Alliance Stability Monitor</h3>
        ${renderAlliance(vm.alliance, now)}
      </section>
      <section class="geo-section">
        <h3 class="geo-section-title">Flashpoint Watch</h3>
        ${renderFlashpoints(vm.flashpoints, now)}
      </section>
    </div>
  `;
}
