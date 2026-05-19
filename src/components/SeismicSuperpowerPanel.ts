/**
 * SeismicSuperpowerPanel — deep intelligence view for the seismic/natural
 * disaster domain.
 *
 * Five sections:
 *   1. Active Earthquake Clusters (M4.0+, last 48h, grouped by region)
 *   2. Tsunami Risk Assessment (watches/warnings + coastal exposure)
 *   3. Volcanic Activity Monitor (eruption alerts, VEI, ash trajectory)
 *   4. Aftershock Sequence Tracker (Omori-Utsu decay curves per mainshock)
 *   5. Seismic Hazard Index (per-region recurrence × population composite)
 *
 * The exported SeismicSuperpowerEngine carries all computation so it can
 * be tested independently of the DOM.
 *
 * Panel ID: seismic-superpower. Refresh: 20 s.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { ObservationEvent } from '@/types/intelligence';
import { query } from '@/services/intelligence/observation-store';

// ── Engine types ──────────────────────────────────────────────────────

export interface EarthquakeCluster {
  region: string;
  eventCount: number;
  maxMagnitude: number;
  avgDepthKm: number;
}

export interface TsunamiRisk {
  id: string;
  warningLevel: 'watch' | 'advisory' | 'warning';
  region: string;
  coastalPopulationMillions: number;
}

export interface VolcanicAlert {
  id: string;
  name: string;
  vei: number | null;
  ashTrajectoryDeg: number | null;
  alertLevel: 'advisory' | 'watch' | 'warning' | 'eruption';
}

export interface AftershockPoint {
  hoursAfter: number;
  rate: number;
}

export interface HazardInput {
  region: string;
  recurrenceYears: number;
  populationMillions: number;
}

export interface HazardResult {
  region: string;
  hazardIndex: number;
}

// ── Engine ────────────────────────────────────────────────────────────

const CLUSTER_WINDOW_MS = 48 * 60 * 60 * 1000;
const MIN_CLUSTER_MAGNITUDE = 4;
// Omori-Utsu parameters: K scales with mainshock, c prevents singularity at t=0
const OMORI_C = 0.05;
const OMORI_P = 1.1;
const OMORI_K_BASE = 10;

function extractMagnitude(event: ObservationEvent): number | null {
  const r = event.raw as Record<string, unknown> | null;
  if (!r) return null;
  const mag = r.magnitude ?? r.mag;
  return typeof mag === 'number' ? mag : null;
}

function extractDepthKm(event: ObservationEvent): number {
  const r = event.raw as Record<string, unknown> | null;
  if (!r) return 10;
  const d = r.depthKm ?? r.depth;
  return typeof d === 'number' ? d : 10;
}

function extractRegion(event: ObservationEvent): string {
  const r = event.raw as Record<string, unknown> | null;
  if (r && typeof r.region === 'string') return r.region as string;
  const loc = event.location;
  if (!loc) return 'Unknown';
  return latLonToRegion(loc.lat, loc.lon);
}

function latLonToRegion(lat: number, lon: number): string {
  if (lon >= 60 && lon <= 180 && lat >= -50 && lat <= 70) return 'Asia-Pacific';
  if (lon >= -170 && lon <= -130) return 'Asia-Pacific';
  if (lon >= -170 && lon <= -30 && lat >= -60 && lat <= 75) return 'Americas';
  if (lon >= -25 && lon <= 60 && lat >= 35 && lat <= 72) return 'Europe';
  if (lon >= 25 && lon <= 65 && lat >= 12 && lat <= 42) return 'Middle East';
  return 'Other';
}

function tsunamiWarningLevel(tags: string[]): 'watch' | 'advisory' | 'warning' | null {
  if (tags.includes('tsunami-warning')) return 'warning';
  if (tags.includes('tsunami-watch')) return 'watch';
  if (tags.includes('tsunami-advisory')) return 'advisory';
  if (tags.includes('tsunami')) return 'advisory';
  return null;
}

function extractVei(event: ObservationEvent): number | null {
  const r = event.raw as Record<string, unknown> | null;
  if (!r) return null;
  const v = r.vei;
  return typeof v === 'number' ? v : null;
}

function extractAshTrajectory(event: ObservationEvent): number | null {
  const r = event.raw as Record<string, unknown> | null;
  if (!r) return null;
  const a = r.ashTrajectoryDeg;
  return typeof a === 'number' ? a : null;
}

function extractVolcanicAlertLevel(tags: string[]): VolcanicAlert['alertLevel'] {
  if (tags.includes('eruption')) return 'eruption';
  if (tags.includes('volcanic-warning')) return 'warning';
  if (tags.includes('volcanic-watch')) return 'watch';
  return 'advisory';
}

function extractVolcanicName(event: ObservationEvent): string {
  const r = event.raw as Record<string, unknown> | null;
  if (r && typeof r.volcanoName === 'string') return r.volcanoName as string;
  return event.title;
}

function extractCoastalPopulation(event: ObservationEvent): number {
  const r = event.raw as Record<string, unknown> | null;
  if (!r) return 0;
  const p = r.coastalPopulationMillions;
  return typeof p === 'number' ? p : 0;
}

export class SeismicSuperpowerEngine {
  /**
   * Groups M4.0+ events from the last 48h into regional clusters.
   * Clusters are sorted by maxMagnitude descending.
   */
  parseEarthquakeClusters(events: ObservationEvent[], nowMs: number): EarthquakeCluster[] {
    const cutoff = nowMs - CLUSTER_WINDOW_MS;
    const eligible = events.filter((e) => {
      const mag = extractMagnitude(e);
      return mag !== null && mag >= MIN_CLUSTER_MAGNITUDE && e.timestamp >= cutoff;
    });

    const byRegion = new Map<string, ObservationEvent[]>();
    for (const e of eligible) {
      const r = extractRegion(e);
      const bucket = byRegion.get(r);
      if (bucket) bucket.push(e);
      else byRegion.set(r, [e]);
    }

    return [...byRegion.entries()]
      .map(([region, evs]) => {
        const mags = evs.map((e) => extractMagnitude(e) ?? 0);
        const depths = evs.map((e) => extractDepthKm(e));
        return {
          region,
          eventCount: evs.length,
          maxMagnitude: Math.max(...mags),
          avgDepthKm: depths.reduce((s, d) => s + d, 0) / depths.length,
        };
      })
      .sort((a, b) => b.maxMagnitude - a.maxMagnitude);
  }

  /** Returns tsunami risk entries for events carrying tsunami tags. */
  parseTsunamiRisk(events: ObservationEvent[]): TsunamiRisk[] {
    const risks: TsunamiRisk[] = [];
    for (const e of events) {
      const level = tsunamiWarningLevel(e.tags);
      if (!level) continue;
      risks.push({
        id: e.id,
        warningLevel: level,
        region: extractRegion(e),
        coastalPopulationMillions: extractCoastalPopulation(e),
      });
    }
    return risks.sort((a, b) => warningOrdinal(b.warningLevel) - warningOrdinal(a.warningLevel));
  }

  /** Returns volcanic activity entries for events carrying volcanic tags. */
  parseVolcanicActivity(events: ObservationEvent[]): VolcanicAlert[] {
    return events
      .filter((e) => e.tags.some((t) => t.startsWith('volcanic') || t === 'eruption'))
      .map((e) => ({
        id: e.id,
        name: extractVolcanicName(e),
        vei: extractVei(e),
        ashTrajectoryDeg: extractAshTrajectory(e),
        alertLevel: extractVolcanicAlertLevel(e.tags),
      }))
      .sort((a, b) => (b.vei ?? 0) - (a.vei ?? 0));
  }

  /**
   * Returns Omori-Utsu aftershock rate curve for a given mainshock.
   * rate(t) = K / (t + c)^p  where t is hours since mainshock.
   * K = OMORI_K_BASE * 10^(0.5 * (magnitude - 5))
   * c = 0.05 h,  p = 1.1
   */
  computeOmoriAftershocks(
    mainshockMagnitude: number,
    mainshockMs: number,
    nowMs: number,
    steps = 10,
  ): AftershockPoint[] {
    if (nowMs <= mainshockMs) return [];
    const K = OMORI_K_BASE * Math.pow(10, 0.5 * (mainshockMagnitude - 5));
    const elapsedHours = (nowMs - mainshockMs) / 3_600_000;
    const points: AftershockPoint[] = [];
    for (let i = 0; i < steps; i++) {
      const t = elapsedHours + (i * elapsedHours) / steps;
      const rate = K / Math.pow(t + OMORI_C, OMORI_P);
      points.push({ hoursAfter: t, rate: Math.max(0, rate) });
    }
    return points;
  }

  /**
   * Computes a composite hazard index (0–1) from recurrence interval and
   * population exposure.
   * index = populationFactor × recurrenceFactor
   * populationFactor = min(1, populationMillions / 100)
   * recurrenceFactor = min(1, 500 / recurrenceYears)
   */
  computeHazardIndex(input: HazardInput): HazardResult {
    const populationFactor = Math.min(1, input.populationMillions / 100);
    const recurrenceFactor = input.recurrenceYears > 0
      ? Math.min(1, 500 / input.recurrenceYears)
      : 1;
    return {
      region: input.region,
      hazardIndex: populationFactor * recurrenceFactor,
    };
  }
}

// ── Panel ─────────────────────────────────────────────────────────────

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

const REFRESH_MS = 20_000;

const SEVERITY_COLOR: Record<string, string> = {
  warning: 'var(--severity-critical,#dc2626)',
  watch:   'var(--severity-medium,#facc15)',
  advisory:'#60a5fa',
  eruption:'var(--severity-critical,#dc2626)',
};

function warningOrdinal(level: string): number {
  if (level === 'warning') return 3;
  if (level === 'watch') return 2;
  return 1;
}

function magColor(mag: number): string {
  if (mag >= 7) return 'var(--severity-critical,#dc2626)';
  if (mag >= 5.5) return 'var(--severity-medium,#facc15)';
  return '#60a5fa';
}

function hazardColor(pct: number): string {
  if (pct >= 60) return 'var(--severity-critical,#dc2626)';
  if (pct >= 30) return 'var(--severity-medium,#facc15)';
  return '#60a5fa';
}

function emptyState(msg: string): string {
  return `<div style="font-size:11px;color:var(--text-secondary,#aaa);padding:6px 0;">${escapeHtml(msg)}</div>`;
}

function sectionHeader(title: string, count?: number): string {
  const badge = count === undefined
    ? ''
    : ` <span style="font-size:10px;color:var(--text-secondary,#aaa);">${count}</span>`;
  return `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary,#aaa);margin-bottom:6px;">${escapeHtml(title)}${badge}</div>`;
}

export class SeismicSuperpowerPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly engine = new SeismicSuperpowerEngine();
  private events: ObservationEvent[] = [];

  constructor() {
    super({
      id: 'seismic-superpower',
      title: 'Seismic Intelligence',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Deep seismic intelligence: active earthquake clusters, tsunami risk, volcanic activity, aftershock sequences, and regional hazard index. 20-second refresh.',
    });
    this.loadEvents();
    this.refreshTimer = setInterval(() => this.loadEvents(), REFRESH_MS);
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  // ── Data loading ──────────────────────────────────────────────────

  private loadEvents(): void {
    this.events = safe(() => this.readSeismicEvents()) ?? [];
    this.render();
  }

  private readSeismicEvents(): ObservationEvent[] {
    const seismic = query({ domain: 'seismic', limit: 200 });
    const earthquake = query({ domain: 'earthquake', limit: 200 });
    const volcanic = query({ domain: 'volcanic', limit: 100 });
    return [...seismic, ...earthquake, ...volcanic];
  }

  // ── Rendering ─────────────────────────────────────────────────────

  private render(): void {
    const now = Date.now();
    const clusters = this.engine.parseEarthquakeClusters(this.events, now);
    const tsunamis = this.engine.parseTsunamiRisk(this.events);
    const volcanic = this.engine.parseVolcanicActivity(this.events);
    const hazardInputs = this.buildHazardInputs(clusters);

    const totalActive = clusters.reduce((s, c) => s + c.eventCount, 0) + tsunamis.length + volcanic.length;
    this.setCount(totalActive);

    this.setContent(`
      <div style="padding:12px;display:flex;flex-direction:column;gap:14px;font-size:12px;">
        ${this.renderClusters(clusters)}
        ${this.renderTsunami(tsunamis)}
        ${this.renderVolcanic(volcanic)}
        ${this.renderAftershocks(now)}
        ${this.renderHazardIndex(hazardInputs)}
      </div>
    `);
  }

  private buildHazardInputs(clusters: EarthquakeCluster[]): HazardInput[] {
    const REGION_DATA: Record<string, { recurrenceYears: number; populationMillions: number }> = {
      'Asia-Pacific': { recurrenceYears: 10, populationMillions: 200 },
      'Americas':     { recurrenceYears: 50, populationMillions: 80 },
      'Europe':       { recurrenceYears: 200, populationMillions: 50 },
      'Middle East':  { recurrenceYears: 100, populationMillions: 40 },
      'Other':        { recurrenceYears: 500, populationMillions: 10 },
    };
    const regions = clusters.length > 0
      ? [...new Set(clusters.map((c) => c.region))]
      : Object.keys(REGION_DATA);
    return regions.map((region) => ({
      region,
      ...(REGION_DATA[region] ?? { recurrenceYears: 500, populationMillions: 10 }),
    }));
  }

  private renderClusters(clusters: EarthquakeCluster[]): string {
    const rows = clusters.length === 0
      ? emptyState('No M4.0+ activity in the last 48h.')
      : clusters.slice(0, 6).map((c) => `
        <div style="padding:6px 8px;border-left:3px solid ${magColor(c.maxMagnitude)};border-radius:3px;background:rgba(255,255,255,0.02);margin-bottom:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:11px;font-weight:600;">${escapeHtml(c.region)}</span>
            <span style="font-size:12px;font-weight:700;color:${magColor(c.maxMagnitude)};">M${c.maxMagnitude.toFixed(1)}</span>
          </div>
          <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">
            ${c.eventCount} event${c.eventCount === 1 ? '' : 's'} · avg depth ${c.avgDepthKm.toFixed(0)} km
          </div>
        </div>`).join('');
    return `<div>${sectionHeader('Active Earthquake Clusters', clusters.reduce((s, c) => s + c.eventCount, 0))}${rows}</div>`;
  }

  private renderTsunami(risks: TsunamiRisk[]): string {
    const rows = risks.length === 0
      ? emptyState('No active tsunami watches or warnings.')
      : risks.map((r) => {
        const color = SEVERITY_COLOR[r.warningLevel] ?? '#60a5fa';
        return `<div style="padding:6px 8px;border-left:3px solid ${color};border-radius:3px;background:rgba(255,255,255,0.02);margin-bottom:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:11px;font-weight:600;">${escapeHtml(r.region)}</span>
            <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${color}22;color:${color};font-weight:700;text-transform:uppercase;">${escapeHtml(r.warningLevel)}</span>
          </div>
          <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">
            Coastal exposure: ${r.coastalPopulationMillions.toFixed(1)}M
          </div>
        </div>`;
      }).join('');
    return `<div>${sectionHeader('Tsunami Risk', risks.length)}${rows}</div>`;
  }

  private renderVolcanic(alerts: VolcanicAlert[]): string {
    const rows = alerts.length === 0
      ? emptyState('No active volcanic alerts.')
      : alerts.slice(0, 5).map((v) => {
        const color = SEVERITY_COLOR[v.alertLevel] ?? '#60a5fa';
        const veiStr = v.vei === null ? 'VEI unknown' : `VEI ${v.vei}`;
        const ashStr = v.ashTrajectoryDeg === null ? '' : ` · ash ${v.ashTrajectoryDeg}°`;
        return `<div style="padding:6px 8px;border-left:3px solid ${color};border-radius:3px;background:rgba(255,255,255,0.02);margin-bottom:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:11px;font-weight:600;">${escapeHtml(v.name)}</span>
            <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${color}22;color:${color};font-weight:700;text-transform:uppercase;">${escapeHtml(v.alertLevel)}</span>
          </div>
          <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">${escapeHtml(veiStr + ashStr)}</div>
        </div>`;
      }).join('');
    return `<div>${sectionHeader('Volcanic Activity', alerts.length)}${rows}</div>`;
  }

  private renderAftershocks(nowMs: number): string {
    const mainshocks = this.events.filter((e) => {
      const mag = extractMagnitude(e);
      return mag !== null && mag >= 6;
    }).slice(0, 3);

    if (mainshocks.length === 0) {
      return `<div>${sectionHeader('Aftershock Sequences')}${emptyState('No M6.0+ mainshocks in current event window.')}</div>`;
    }

    const cards = mainshocks.map((m) => {
      const mag = extractMagnitude(m) ?? 6;
      const points = this.engine.computeOmoriAftershocks(mag, m.timestamp, nowMs, 5);
      const currentRate = points[0]?.rate ?? 0;
      return `<div style="padding:6px 8px;border-left:3px solid ${magColor(mag)};border-radius:3px;background:rgba(255,255,255,0.02);margin-bottom:4px;">
        <div style="display:flex;justify-content:space-between;">
          <span style="font-size:11px;font-weight:600;">${escapeHtml(m.title.slice(0, 40))}</span>
          <span style="font-size:11px;color:${magColor(mag)};font-weight:700;">M${mag.toFixed(1)}</span>
        </div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">
          ~${currentRate.toFixed(1)} aftershocks/day (Omori-Utsu)
        </div>
      </div>`;
    }).join('');

    return `<div>${sectionHeader('Aftershock Sequences', mainshocks.length)}${cards}</div>`;
  }

  private renderHazardIndex(inputs: HazardInput[]): string {
    const results = inputs
      .map((i) => this.engine.computeHazardIndex(i))
      .sort((a, b) => b.hazardIndex - a.hazardIndex)
      .slice(0, 5);

    const rows = results.map((r) => {
      const pct = Math.round(r.hazardIndex * 100);
      const color = hazardColor(pct);
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <span style="font-size:11px;flex:1;">${escapeHtml(r.region)}</span>
        <div style="flex:2;height:6px;border-radius:3px;background:rgba(255,255,255,0.08);">
          <div style="width:${pct}%;height:100%;border-radius:3px;background:${color};"></div>
        </div>
        <span style="font-size:11px;font-weight:600;color:${color};min-width:32px;text-align:right;">${pct}%</span>
      </div>`;
    }).join('');

    return `<div>${sectionHeader('Seismic Hazard Index')}${rows}</div>`;
  }
}
