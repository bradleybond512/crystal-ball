import { Panel } from './Panel';
import { buildRenderData } from './migration-crisis-helpers';
import type { MigrationRoute, DisplacementEvent, PushFactor } from './migration-crisis-helpers';

const REFRESH_MS = 5 * 60_000;

const RISK_COLOR: Record<'high' | 'med' | 'low', string> = {
  high: '#d50000',
  med: '#ff9800',
  low: '#4caf50',
};

const FACTOR_LABEL: Record<PushFactor, string> = {
  conflict: 'Conflict',
  persecution: 'Persecution',
  economic: 'Economic',
  climate: 'Climate',
  'natural-disaster': 'Nat. Disaster',
};

const TREND_ARROW: Record<'increasing' | 'stable' | 'decreasing', string> = {
  increasing: '↑',
  stable: '→',
  decreasing: '↓',
};

const TREND_COLOR: Record<'increasing' | 'stable' | 'decreasing', string> = {
  increasing: '#d50000',
  stable: '#ffeb3b',
  decreasing: '#4caf50',
};

function safe(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function riskBand(level: number): 'high' | 'med' | 'low' {
  if (level >= 75) return 'high';
  if (level >= 50) return 'med';
  return 'low';
}

function renderRouteRow(r: MigrationRoute): string {
  const band = riskBand(r.routeRiskLevel);
  const color = RISK_COLOR[band];
  const flowK = (r.monthlyFlow / 1000).toFixed(1);
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;font-size:11px;gap:8px;">
    <div style="min-width:0;flex:1;">
      <div style="font-weight:600;">${safe(r.id)}</div>
      <div style="color:var(--text-secondary,#aaa);font-size:10px;">${safe(r.origin)} → ${safe(r.destination)} · ${safe(FACTOR_LABEL[r.primaryPushFactor])}</div>
    </div>
    <div style="text-align:right;white-space:nowrap;">
      <div style="font-size:10px;color:var(--text-secondary,#aaa);">${flowK}k/mo</div>
      <div style="font-weight:700;color:${color};font-family:ui-monospace,monospace;font-size:11px;">${r.routeRiskLevel}</div>
    </div>
  </div>`;
}

function renderEventRow(e: DisplacementEvent): string {
  const dispM = (e.displacedCount / 1e6).toFixed(1);
  const trendColor = TREND_COLOR[e.trend];
  const trendArrow = TREND_ARROW[e.trend];
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border:1px solid var(--border-subtle,#333);border-left:3px solid var(--border-subtle,#555);border-radius:3px;font-size:11px;gap:8px;">
    <div style="min-width:0;flex:1;">
      <div style="font-weight:600;">${safe(e.region)}</div>
      <div style="color:var(--text-secondary,#aaa);font-size:10px;">${safe(FACTOR_LABEL[e.pushFactor])} · ${safe(e.date)}</div>
    </div>
    <div style="text-align:right;white-space:nowrap;">
      <div style="font-size:11px;font-weight:600;">${dispM}M</div>
      <div style="font-size:10px;color:${trendColor};">${trendArrow} ${safe(e.trend)}</div>
    </div>
  </div>`;
}

function renderPushFactorBar(totals: Record<PushFactor, number>): string {
  const entries = Object.entries(totals) as [PushFactor, number][];
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return '';
  const bars = [...entries]
    .sort((a, b) => b[1] - a[1])
    .map(([factor, count]) => {
      const pct = ((count / total) * 100).toFixed(1);
      const label = FACTOR_LABEL[factor];
      return `<div style="display:flex;align-items:center;gap:6px;font-size:10px;margin-bottom:3px;">
        <div style="width:80px;color:var(--text-secondary,#aaa);white-space:nowrap;">${safe(label)}</div>
        <div style="flex:1;background:var(--border-subtle,#333);border-radius:2px;height:6px;">
          <div style="width:${pct}%;background:#ff9800;height:6px;border-radius:2px;"></div>
        </div>
        <div style="width:40px;text-align:right;font-family:ui-monospace,monospace;">${pct}%</div>
      </div>`;
    })
    .join('');
  return `<div>
    <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Push Factor Breakdown</div>
    ${bars}
  </div>`;
}

export class MigrationCrisisPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'migration-crisis',
      title: 'Migration Crisis Monitor',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Active migration routes ranked by risk, displacement events by scale, and push-factor breakdown across conflict, persecution, economic, climate, and natural-disaster drivers.',
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
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  private render(): void {
    const data = buildRenderData();
    this.setCount(data.hotspots.length);
    this.setContent(this.buildHtml(data));
  }

  private buildHtml(data: ReturnType<typeof buildRenderData>): string {
    const totalM = (data.totalDisplaced / 1e6).toFixed(1);
    const header = `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--surface-raised,#1a1a1a);border-radius:4px;margin-bottom:2px;">
      <div>
        <div style="font-size:14px;font-weight:700;">${totalM}M displaced</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);">${data.hotspots.length} crisis hotspot${data.hotspots.length === 1 ? '' : 's'}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:10px;color:var(--text-secondary,#aaa);">${data.routes.length} active routes</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);">${data.events.length} displacement events</div>
      </div>
    </div>`;

    const routeRows = data.routes.slice(0, 6).map(r => renderRouteRow(r)).join('');
    const routesSection = `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Routes by Risk</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${routeRows}</div>
    </div>`;

    const eventRows = data.events.slice(0, 6).map(e => renderEventRow(e)).join('');
    const eventsSection = `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Displacement Events</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${eventRows}</div>
    </div>`;

    const pushFactorSection = renderPushFactorBar(data.pushFactorTotals);

    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${header}
      ${routesSection}
      ${eventsSection}
      ${pushFactorSection}
    </div>`;
  }
}
