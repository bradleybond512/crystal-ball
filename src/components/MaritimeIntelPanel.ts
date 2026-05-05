/* eslint-disable sonarjs/no-nested-template-literals, sonarjs/no-nested-conditional */
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

interface FreightStressComponent {
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

interface FreightStressResponse {
  components?: FreightStressComponent[];
  overallScore?: number;
  overallLevel?: 'low' | 'medium' | 'high' | 'critical';
  asOf?: string | null;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type ThreatLevel = 'green' | 'yellow' | 'orange' | 'red';

function riskScoreColor(score: number): string {
  if (score >= 75) return '#d50000';
  if (score >= 50) return '#ff9800';
  if (score >= 25) return '#ffeb3b';
  return '#9e9e9e';
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
  red: '#d50000',
};

const STRESS_COLOR: Record<FreightStressComponent['stressLevel'], string> = {
  low: '#4caf50',
  medium: '#ffeb3b',
  high: '#ff9800',
  critical: '#d50000',
};

export class MaritimeIntelPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private darkEvents: DarkVesselGapEvent[] = [];
  private freightStress: FreightStressResponse | null = null;
  private lastFetchAt: number | null = null;
  private lastFetchError: string | null = null;

  constructor() {
    super({
      id: 'maritime-intel',
      title: 'Maritime Intel',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Six critical maritime chokepoints with threat-level color coding, freight cost stress (FRED PPIACO + PFOODINDEXM), and active dark-vessel gap events from /api/dark-vessels.',
    });
    this.start();
  }

  public dispose(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private start(): void {
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  private async refresh(): Promise<void> {
    let darkOk = false;
    let freightOk = false;
    try {
      const resp = await fetch('/api/dark-vessels', {
        headers: { Accept: 'application/json' },
      });
      if (resp.ok) {
        const body = (await resp.json()) as DarkVesselsResponse;
        this.darkEvents = Array.isArray(body.events) ? body.events : [];
        darkOk = true;
      }
    } catch {
      this.darkEvents = [];
    }
    try {
      const resp = await fetch('/api/freight-stress', {
        headers: { Accept: 'application/json' },
      });
      if (resp.ok) {
        this.freightStress = (await resp.json()) as FreightStressResponse;
        freightOk = true;
      }
    } catch {
      this.freightStress = null;
    }
    this.lastFetchAt = Date.now();
    this.lastFetchError = !darkOk && !freightOk ? 'Both endpoints unavailable' : null;
    this.render();
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
    return count;
  }

  private buildHtml(): string {
    const stressBlock = this.renderFreightStress();
    const chokepointsBlock = this.renderChokepoints();
    const darkBlock = this.renderDarkVessels();
    const footer = this.renderFooter();
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${stressBlock}
      ${chokepointsBlock}
      ${darkBlock}
      ${footer}
    </div>`;
  }

  private renderFreightStress(): string {
    const fs = this.freightStress;
    if (!fs?.components || fs.components.length === 0) {
      return `<div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Freight Cost Stress</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);">No freight signal yet — \`/api/freight-stress\` returned no data.</div>
      </div>`;
    }
    const overallLevel = fs.overallLevel ?? 'low';
    const overallColor = STRESS_COLOR[overallLevel];
    const overallScore = fs.overallScore ?? 0;
    const componentRows = fs.components.map((c) => {
      const trendArrow = c.trend === 'rising' ? '↑' : (c.trend === 'falling' ? '↓' : '→');
      const dev = c.deviationPct === null ? '—' : `${c.deviationPct >= 0 ? '+' : ''}${c.deviationPct.toFixed(1)}%`;
      const z = c.zScore === null ? '—' : c.zScore.toFixed(2);
      const cur = c.current === null ? '—' : c.current.toFixed(1);
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
        <div style="font-size:11px;color:var(--text-secondary,#aaa);">No active dark-vessel events from \`/api/dark-vessels\`.</div>
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
