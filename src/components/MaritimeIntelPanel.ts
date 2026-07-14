/* eslint-disable sonarjs/no-nested-conditional */
/**
 * Maritime Intelligence Panel — PR D in the maritime stack.
 *
 * Visualizes the 6 critical maritime chokepoints (Hormuz, Suez, Malacca,
 * Panama, Bosphorus, Bab-el-Mandeb), live freight cost stress (PR B),
 * and active dark-vessel gap events (PR C).
 *
 * Self-contained: inline chokepoint coords + graceful fallback when
 * sidecar endpoints aren't yet available. Pure DOM render.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { renderPanelEmpty, renderPanelError } from './ui/PanelStates';
import {
  filterAcledMaritimeIncidents,
  WAR_RISK_ZONES,
  type MaritimeIncident,
  type AcledEventRow,
} from '@/services/maritime/maritime-threats';
import type { VesselCategory, ZoneVessel, VesselSummary } from '@/services/maritime/vessel-classifier';

interface LiveVesselsResponse {
  vessels?: ZoneVessel[];
  summary?: VesselSummary;
  asOf?: string;
  sampleSize?: number;
  error?: string;
}

const VESSEL_CATEGORY_COLOR: Record<VesselCategory, string> = {
  tanker: '#ff5722',
  bulk_carrier: '#ffeb3b',
  container: '#2196f3',
  military: '#ff453a',
  other: '#9e9e9e',
};

const VESSEL_CATEGORY_LABEL: Record<VesselCategory, string> = {
  tanker: 'Tanker',
  bulk_carrier: 'Bulk',
  container: 'Container',
  military: 'Military',
  other: 'Other',
};

const REFRESH_MS = 60_000;

interface ChokepointDisplay {
  id: string;
  name: string;
  lat: number;
  lon: number;
  globalTradePctNote: string;
  primaryCommodities: string[];
}

const CHOKEPOINTS: ChokepointDisplay[] = [
  { id: 'hormuz', name: 'Strait of Hormuz', lat: 26.6, lon: 56.5,
    globalTradePctNote: '~21% of global petroleum',
    primaryCommodities: ['crude oil', 'LNG', 'refined products'] },
  { id: 'suez', name: 'Suez Canal', lat: 30.5, lon: 32.3,
    globalTradePctNote: '~12% of global trade',
    primaryCommodities: ['crude oil', 'containers', 'grain'] },
  { id: 'malacca', name: 'Strait of Malacca', lat: 1.5, lon: 104,
    globalTradePctNote: '~25% of global trade',
    primaryCommodities: ['crude oil', 'LNG', 'electronics'] },
  { id: 'panama', name: 'Panama Canal', lat: 9.1, lon: -79.7,
    globalTradePctNote: '~5% of global trade',
    primaryCommodities: ['containers', 'grain', 'LNG'] },
  { id: 'bosphorus', name: 'Bosphorus Strait', lat: 41.1, lon: 29,
    globalTradePctNote: 'critical for Russian Black Sea exports',
    primaryCommodities: ['crude oil', 'grain', 'fertilizer'] },
  { id: 'bab-el-mandeb', name: 'Bab-el-Mandeb', lat: 12.6, lon: 43.4,
    globalTradePctNote: '~10% of global trade (Yemen / Houthi threat zone)',
    primaryCommodities: ['crude oil', 'LNG', 'containers'] },
];

interface DarkVesselGapEvent {
  mmsi: string;
  vesselName?: string;
  lastKnownLat: number;
  lastKnownLon: number;
  lastSeenAt: number;
  gapDurationHours: number;
  nearestChokepoint: string | null;
  nearestChokepointKm: number | null;
  riskScore: number;
}

interface DarkVesselsResponse {
  events?: DarkVesselGapEvent[];
  sampleSize?: number;
  asOf?: string;
}

export interface FreightStressComponent {
  series: string;
  current: number | null;
  avg12m: number | null;
  deviationPct: number | null;
  zScore: number | null;
  trend: 'rising' | 'falling' | 'stable';
  stressScore: number;
  stressLevel: 'low' | 'medium' | 'high' | 'critical';
  asOf: string | null;
  error?: string;
}

export interface FreightStressResponse {
  components?: FreightStressComponent[];
  overallScore?: number;
  overallLevel?: 'low' | 'medium' | 'high' | 'critical';
  asOf?: string | null;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type ThreatLevel = 'green' | 'yellow' | 'orange' | 'red';

function riskScoreColor(score: number): string {
  if (score >= 75) return '#ff453a';
  if (score >= 50) return '#ff9800';
  if (score >= 25) return '#ffeb3b';
  return '#9e9e9e';
}

function threatRowColor(t: MaritimeIncident): string {
  if (t.fatalities >= 5) return '#ff453a';
  if (t.fatalities >= 1) return '#ff9800';
  if (t.warRiskZones.length > 0) return '#ffeb3b';
  return '#9e9e9e';
}

function warZoneCategoryColor(category: 'piracy' | 'state_conflict' | 'missile_drone' | 'mixed'): string {
  if (category === 'state_conflict' || category === 'missile_drone') return '#ff453a';
  if (category === 'piracy') return '#ff9800';
  return '#ffeb3b';
}

function chokepointThreatLevel(darkEventsAtChokepoint: number, hasCriticalRisk: boolean): ThreatLevel {
  if (hasCriticalRisk || darkEventsAtChokepoint >= 3) return 'red';
  if (darkEventsAtChokepoint >= 2) return 'orange';
  if (darkEventsAtChokepoint >= 1) return 'yellow';
  return 'green';
}

const THREAT_COLOR: Record<ThreatLevel, string> = {
  green: '#4caf50',
  yellow: '#ffeb3b',
  orange: '#ff9800',
  red: '#ff453a',
};

const STRESS_COLOR: Record<FreightStressComponent['stressLevel'], string> = {
  low: '#4caf50',
  medium: '#ffeb3b',
  high: '#ff9800',
  critical: '#ff453a',
};

export class MaritimeIntelPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private darkEvents: DarkVesselGapEvent[] = [];
  private freightStress: FreightStressResponse | null = null;
  /** Technical failure detail for the last freight fetch (tooltip/console only). */
  private freightError: string | null = null;
  private threats: MaritimeIncident[] = [];
  private liveVessels: ZoneVessel[] = [];
  private liveSummary: VesselSummary | null = null;
  private liveSampleSize: number | null = null;
  private lastFetchAt: number | null = null;
  private lastFetchError: string | null = null;

  constructor() {
    super({
      id: 'maritime-intel',
      title: 'Maritime Intel',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Six critical maritime chokepoints with threat-level color coding, freight cost stress (FRED PPIACO + PFOODINDEXM), active dark-vessel gap events from /api/dark-vessels, ACLED maritime incidents, and live AIS vessels in 4 risk zones (Red Sea, Hormuz, Black Sea, South China Sea) via /api/maritime/vessels.',
    });
    this.start();
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private start(): void {
    // Retry button in the freight error state (see renderFreightStress).
    this.content.addEventListener('maritime-intel:freight-retry', () => void this.refresh());
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  private async refresh(): Promise<void> {
    const [darkOk, freightOk, threatsOk, liveOk] = await Promise.all([
      this.refreshDark(),
      this.refreshFreight(),
      this.refreshThreats(),
      this.refreshLive(),
    ]);
    this.lastFetchAt = Date.now();
    this.lastFetchError = !darkOk && !freightOk && !threatsOk && !liveOk
      ? 'All endpoints unavailable'
      : null;
    this.render();
  }

  private async refreshDark(): Promise<boolean> {
    try {
      const resp = await fetch('/api/dark-vessels', { headers: { Accept: 'application/json' } });
      if (!resp.ok) return false;
      const body = (await resp.json()) as DarkVesselsResponse;
      this.darkEvents = Array.isArray(body.events) ? body.events : [];
      return true;
    } catch {
      this.darkEvents = [];
      return false;
    }
  }

  private async refreshFreight(): Promise<boolean> {
    try {
      const resp = await fetch('/api/freight-stress', { headers: { Accept: 'application/json' } });
      if (!resp.ok) {
        // Status codes stay in the tooltip detail, never in visible copy.
        this.freightError = `HTTP ${resp.status}`;
        return false;
      }
      this.freightStress = (await resp.json()) as FreightStressResponse;
      this.freightError = null;
      return true;
    } catch {
      this.freightStress = null;
      this.freightError = 'network unreachable';
      return false;
    }
  }

  private async refreshThreats(): Promise<boolean> {
    try {
      const resp = await fetch('/api/acled-events', { headers: { Accept: 'application/json' } });
      if (!resp.ok) return false;
      const body = (await resp.json()) as { events?: AcledEventRow[] };
      this.threats = filterAcledMaritimeIncidents(Array.isArray(body.events) ? body.events : []);
      return true;
    } catch {
      this.threats = [];
      return false;
    }
  }

  private async refreshLive(): Promise<boolean> {
    try {
      const resp = await fetch('/api/maritime/vessels', { headers: { Accept: 'application/json' } });
      if (!resp.ok) return false;
      const body = (await resp.json()) as LiveVesselsResponse;
      this.liveVessels = Array.isArray(body.vessels) ? body.vessels : [];
      this.liveSummary = body.summary ?? null;
      this.liveSampleSize = typeof body.sampleSize === 'number' ? body.sampleSize : null;
      return true;
    } catch {
      this.liveVessels = [];
      this.liveSummary = null;
      return false;
    }
  }

  private render(): void {
    const concerning = this.computeConcerningCount();
    this.setCount(concerning);
    this.setContent(this.buildHtml());
  }

  private computeConcerningCount(): number {
    let count = 0;
    for (const e of this.darkEvents) {
      if (e.riskScore >= 50) count += 1;
    }
    const overall = this.freightStress?.overallLevel;
    if (overall === 'high' || overall === 'critical') {
      count += 1;
    }
    // Threat events from the last 7 days are surfaced as concerning
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    for (const t of this.threats) {
      if (t.date >= cutoff) count += 1;
    }
    if (this.liveSummary && this.liveSummary.byCategory.military > 0) {
      count += this.liveSummary.byCategory.military;
    }
    return count;
  }

  private buildHtml(): string {
    const stressBlock = this.renderFreightStress();
    const chokepointsBlock = this.renderChokepoints();
    const threatsBlock = this.renderThreats();
    const liveBlock = this.renderLiveVessels();
    const darkBlock = this.renderDarkVessels();
    const footer = this.renderFooter();
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${stressBlock}
      ${chokepointsBlock}
      ${threatsBlock}
      ${liveBlock}
      ${darkBlock}
      ${footer}
    </div>`;
  }

  private renderLiveVessels(): string {
    const summary = this.liveSummary;
    const sample = this.liveSampleSize ?? 0;
    if (!summary || summary.total === 0) {
      const reason = sample === 0
        ? 'AIS feed not connected. Configure \`AISSTREAM_API_KEY\` in settings to populate live vessels.'
        : `${sample} vessels in feed but none currently inside the four risk zones.`;
      return `<div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Live Vessels (Risk Zones)</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);">${escapeHtml(reason)}</div>
      </div>`;
    }
    const zoneStrip = Object.entries(summary.byZone)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `<span style="display:inline-block;padding:2px 8px;border:1px solid var(--border-subtle,#333);border-radius:8px;font-size:10px;margin-right:4px;margin-bottom:4px;">${escapeHtml(name)} <strong>${count}</strong></span>`)
      .join('');
    const catStrip = (Object.keys(summary.byCategory) as VesselCategory[])
      .filter((cat) => summary.byCategory[cat] > 0)
      .map((cat) => {
        const color = VESSEL_CATEGORY_COLOR[cat];
        const label = VESSEL_CATEGORY_LABEL[cat];
        const count = summary.byCategory[cat];
        return `<span style="display:inline-block;padding:2px 8px;border:1px solid ${color};border-radius:8px;font-size:10px;color:${color};margin-right:4px;margin-bottom:4px;">${escapeHtml(label)} <strong>${count}</strong></span>`;
      })
      .join('');
    const rows = this.liveVessels.slice(0, 25).map((v) => this.renderVesselRow(v)).join('');
    const more = this.liveVessels.length > 25
      ? `<div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:4px;">+ ${this.liveVessels.length - 25} more</div>`
      : '';
    return `<div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Live Vessels (Risk Zones) · ${summary.total} of ${sample}</div>
      </div>
      <div style="margin-bottom:4px;">${zoneStrip}</div>
      <div style="margin-bottom:8px;">${catStrip}</div>
      <div style="display:flex;flex-direction:column;gap:3px;">${rows}</div>
      ${more}
    </div>`;
  }

  private renderVesselRow(v: ZoneVessel): string {
    const color = VESSEL_CATEGORY_COLOR[v.category];
    const label = VESSEL_CATEGORY_LABEL[v.category];
    const speed = v.speedKnots === null ? '—' : `${v.speedKnots.toFixed(1)} kn`;
    const heading = v.headingDeg === null ? '—' : `${Math.round(v.headingDeg)}°`;
    const name = v.name && v.name.length > 0 ? v.name : `MMSI ${v.mmsi}`;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;font-size:11px;gap:8px;">
      <div style="min-width:0;flex:1;">
        <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(name)} <span style="color:var(--text-secondary,#aaa);font-size:10px;font-weight:400;">${escapeHtml(v.flag)}</span></div>
        <div style="color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(v.zoneName)} · ${escapeHtml(speed)} · hdg ${escapeHtml(heading)}</div>
      </div>
      <div style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(label)}</div>
    </div>`;
  }

  private renderThreats(): string {
    const zoneBadges = WAR_RISK_ZONES.map((z) => {
      const color = warZoneCategoryColor(z.threatCategory);
      return `<span title="${escapeHtml(z.rationale)}" style="display:inline-block;padding:2px 6px;border:1px solid ${color};border-radius:8px;font-size:10px;color:${color};margin-right:4px;margin-bottom:4px;">${escapeHtml(z.name)}</span>`;
    }).join('');
    if (this.threats.length === 0) {
      return `<div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Maritime Threats</div>
        <div style="margin-bottom:6px;">${zoneBadges}</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);">No ACLED maritime incidents in the last 30 days. (Requires \`ACLED_ACCESS_TOKEN\` + \`ACLED_EMAIL\` for live data.)</div>
      </div>`;
    }
    const rows = this.threats.slice(0, 10).map((t) => this.renderThreatRow(t)).join('');
    const more = this.threats.length > 10
      ? `<div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:4px;">+ ${this.threats.length - 10} more</div>`
      : '';
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Maritime Threats (${this.threats.length})</div>
      <div style="margin-bottom:6px;">${zoneBadges}</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
      ${more}
    </div>`;
  }

  private renderThreatRow(t: MaritimeIncident): string {
    const color = threatRowColor(t);
    const cpTag = t.nearestChokepoint
      ? `<span style="color:var(--text-secondary,#aaa);">${escapeHtml(t.nearestChokepoint)} ${t.nearestChokepointKm}km</span>`
      : '';
    const zoneTag = t.warRiskZones.length > 0
      ? `<span style="color:${color};margin-left:6px;">${escapeHtml(t.warRiskZones.join(' · '))}</span>`
      : '';
    const fatLabel = t.fatalities > 0 ? `<span style="color:${color};">${t.fatalities} fatalit${t.fatalities === 1 ? 'y' : 'ies'}</span>` : '';
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;padding:6px 8px;font-size:11px;">
      <div style="display:flex;justify-content:space-between;align-items:start;">
        <div style="font-weight:600;">${escapeHtml(t.subEventType || t.eventType)} · ${escapeHtml(t.country)}</div>
        <div style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(t.date)}</div>
      </div>
      <div style="margin-top:2px;font-size:10px;">${cpTag}${zoneTag}</div>
      <div style="margin-top:2px;color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(t.location)} · ${escapeHtml(t.actor)} ${fatLabel}</div>
    </div>`;
  }

  private renderFreightStress(): string {
    const fs = this.freightStress;
    if (this.freightError !== null) {
      return `<div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Freight Cost Stress</div>
        ${renderPanelError({
          title: 'Freight data temporarily unavailable',
          detail: `${this.freightError} from the freight-stress endpoint`,
          onRetryEventName: 'maritime-intel:freight-retry',
        })}
      </div>`;
    }
    if (!fs?.components || fs.components.length === 0) {
      return `<div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Freight Cost Stress</div>
        ${renderPanelEmpty({
          message: 'No freight-stress data yet',
          hint: 'The freight monitor may still be warming up',
        })}
      </div>`;
    }
    const overallLevel = fs.overallLevel ?? 'low';
    const overallColor = STRESS_COLOR[overallLevel];
    const overallScore = fs.overallScore ?? 0;
    const componentRows = fs.components.map((c) => {
      const trendArrow = c.trend === 'rising' ? '↑' : (c.trend === 'falling' ? '↓' : '→');
      const dev = c.deviationPct == null ? '—' : `${c.deviationPct >= 0 ? '+' : ''}${c.deviationPct.toFixed(1)}%`;
      const z = c.zScore == null ? '—' : c.zScore.toFixed(2);
      const cur = c.current == null ? '—' : c.current.toFixed(1);
      const lvlColor = STRESS_COLOR[c.stressLevel];
      const errLine = c.error
        ? `<div style="font-size:10px;color:#ff9800;">⚠ ${escapeHtml(c.error)}</div>`
        : '';
      return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-subtle,#222);">
        <div>
          <span style="font-family:ui-monospace,monospace;font-weight:600;">${escapeHtml(c.series)}</span>
          <span style="margin-left:8px;color:var(--text-secondary,#aaa);">${trendArrow} ${escapeHtml(cur)}</span>
          <span style="margin-left:8px;color:var(--text-secondary,#aaa);">Δ ${escapeHtml(dev)} · z ${escapeHtml(z)}</span>
          ${errLine}
        </div>
        <div style="font-weight:600;color:${lvlColor};text-transform:uppercase;letter-spacing:0.05em;font-size:10px;">${escapeHtml(c.stressLevel)} · ${c.stressScore}</div>
      </div>`;
    }).join('');
    return `<div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Freight Cost Stress</div>
        <div style="font-size:12px;font-weight:700;color:${overallColor};text-transform:uppercase;">${escapeHtml(overallLevel)} · ${overallScore}</div>
      </div>
      <div>${componentRows}</div>
    </div>`;
  }

  private renderChokepoints(): string {
    const cards = CHOKEPOINTS.map((cp) => this.renderChokepointCard(cp)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Chokepoints</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px;">
        ${cards}
      </div>
    </div>`;
  }

  private renderChokepointCard(cp: ChokepointDisplay): string {
    const cpKey = cp.name.toLowerCase().split(' ').pop() ?? '';
    const events = this.darkEvents.filter((e) =>
      e.nearestChokepoint?.toLowerCase().includes(cpKey)
    );
    const nearbyDarkCount = events.length;
    const hasCritical = events.some((e) => e.riskScore >= 75);
    const level = chokepointThreatLevel(nearbyDarkCount, hasCritical);
    const color = THREAT_COLOR[level];
    const commoditiesText = cp.primaryCommodities.join(' · ');
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;padding:8px 10px;">
      <div style="display:flex;justify-content:space-between;align-items:start;">
        <div style="font-weight:700;font-size:12px;">${escapeHtml(cp.name)}</div>
        <div style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.05em;">${level}</div>
      </div>
      <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">${escapeHtml(cp.globalTradePctNote)}</div>
      <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:4px;">${escapeHtml(commoditiesText)}</div>
      <div style="font-size:10px;margin-top:4px;color:${nearbyDarkCount > 0 ? color : 'var(--text-secondary,#aaa)'};">
        ${nearbyDarkCount} dark vessel${nearbyDarkCount === 1 ? '' : 's'} nearby
      </div>
    </div>`;
  }

  private renderDarkVessels(): string {
    if (this.darkEvents.length === 0) {
      return `<div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Dark Vessel Alerts</div>
        ${renderPanelEmpty({
          message: 'No active dark-vessel events',
          hint: 'Alerts appear when a tracked vessel goes silent near a chokepoint',
        })}
      </div>`;
    }
    const rows = this.darkEvents.slice(0, 10).map((e) => {
      const color = riskScoreColor(e.riskScore);
      const name = e.vesselName ?? `MMSI ${e.mmsi}`;
      const cp = e.nearestChokepoint
        ? `${escapeHtml(e.nearestChokepoint)} (${e.nearestChokepointKm}km)`
        : 'no chokepoint';
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;font-size:11px;">
        <div>
          <div style="font-weight:600;">${escapeHtml(name)}</div>
          <div style="color:var(--text-secondary,#aaa);font-size:10px;">${cp} · gap ${e.gapDurationHours}h</div>
        </div>
        <div style="font-weight:700;color:${color};font-family:ui-monospace,monospace;">${e.riskScore}</div>
      </div>`;
    }).join('');
    const more = this.darkEvents.length > 10
      ? `<div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:4px;">+ ${this.darkEvents.length - 10} more</div>`
      : '';
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Dark Vessel Alerts (${this.darkEvents.length})</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
      ${more}
    </div>`;
  }

  private renderFooter(): string {
    if (this.lastFetchError) {
      return `<div style="font-size:10px;color:#ff9800;">⚠ ${escapeHtml(this.lastFetchError)}</div>`;
    }
    if (this.lastFetchAt === null) {
      return `<div style="font-size:10px;color:var(--text-secondary,#aaa);">Loading…</div>`;
    }
    const ageMs = Date.now() - this.lastFetchAt;
    const ageStr = ageMs < HOUR_MS
      ? `${Math.round(ageMs / 60_000)}m ago`
      : (ageMs < DAY_MS ? `${Math.round(ageMs / HOUR_MS)}h ago` : '>24h ago');
    return `<div style="font-size:10px;color:var(--text-secondary,#aaa);">Updated ${ageStr}</div>`;
  }
}

// Re-export the gap-event type for callers (graceful import path).
export type { DarkVesselGapEvent };
