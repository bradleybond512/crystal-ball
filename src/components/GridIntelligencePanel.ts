/* eslint-disable sonarjs/no-nested-conditional */
import { Panel } from './Panel';
import type {
  GridSnapshot,
  OutageSummary,
  BgpSummary,
  RadSummary,
  RegionBalance,
  CountyOutage,
  BgpEvent,
  RadStation,
  Severity,
} from '@/services/infrastructure/grid-monitor';
import { escapeHtml } from '@/utils/sanitize';

type Tab = 'grid' | 'outages' | 'internet' | 'radiation';

const TAB_STORAGE_KEY = 'cb:grid-intel-tab';
const TAB_LABELS: Record<Tab, string> = {
  grid: 'Power Grid',
  outages: 'Outages',
  internet: 'Internet',
  radiation: 'Radiation',
};

export class GridIntelligencePanel extends Panel {
  private grid: GridSnapshot | null = null;
  private outages: OutageSummary | null = null;
  private bgp: BgpSummary | null = null;
  private radiation: RadSummary | null = null;
  private activeTab: Tab = readStoredTab();

  constructor() {
    super({
      id: 'grid-intelligence',
      title: 'Grid & Internet Intelligence',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'EIA grid balance, PowerOutage.us outages, Cloudflare Radar BGP hijacks, EPA RadNet gross gamma. Updated 5–30 min depending on source.',
    });
    this.showLoading('Loading infrastructure intelligence…');
  }

  public update(input: {
    grid?: GridSnapshot | null;
    outages?: OutageSummary | null;
    bgp?: BgpSummary | null;
    radiation?: RadSummary | null;
  }): void {
    if (input.grid !== undefined) this.grid = input.grid;
    if (input.outages !== undefined) this.outages = input.outages;
    if (input.bgp !== undefined) this.bgp = input.bgp;
    if (input.radiation !== undefined) this.radiation = input.radiation;
    this.setCount(this.computeAlertCount());
    this.render();
  }

  /** Headline alert count: deficit regions + state outages ≥ elevated +
   *  critical/elevated BGP events + radiation stations ≥ elevated. */
  private computeAlertCount(): number {
    const deficits = this.grid?.regions.filter((r) => r.status === 'deficit').length ?? 0;
    const outageStates = this.outages?.byState.filter((s) => s.severity !== 'normal').length ?? 0;
    const bgpAlerts = this.bgp?.criticalCount ?? 0;
    const bgpElevated = this.bgp?.elevatedCount ?? 0;
    const radElevated = this.radiation?.elevatedStations.length ?? 0;
    return deficits + outageStates + bgpAlerts + bgpElevated + radElevated;
  }

  private renderTabStrip(): string {
    const tabs: Tab[] = ['grid', 'outages', 'internet', 'radiation'];
    return `<div class="gi-tab-strip" role="tablist" style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">${tabs
      .map((tab) => {
        const active = tab === this.activeTab ? 'gi-tab-active' : '';
        return `<button class="gi-tab ${active}" data-tab="${tab}" role="tab" aria-selected="${tab === this.activeTab}" type="button" style="padding:4px 10px;border:1px solid rgba(255,255,255,0.12);background:${tab === this.activeTab ? 'rgba(96,165,250,0.18)' : 'transparent'};color:inherit;border-radius:4px;cursor:pointer;font-size:12px">${escapeHtml(TAB_LABELS[tab])}</button>`;
      })
      .join('')}</div>`;
  }

  private renderGridTab(): string {
    if (!this.grid) return emptyState('Power-grid data not yet loaded.');
    const { regions, isComplete, badge } = this.grid;
    if (regions.every((r) => r.demandMwh === null)) {
      return emptyState('No EIA balancing-authority data available — check EIA_API_KEY in Settings → API Keys.');
    }
    const maxValue = Math.max(
      ...regions.flatMap((r) => [r.demandMwh ?? 0, r.generationMwh ?? 0]),
      1,
    );
    const rows = regions.map((r) => renderRegionRow(r, maxValue)).join('');
    const completeBadge = isComplete ? '' : ' <span style="opacity:0.7">· partial data</span>';
    return `<div class="gi-grid-tab">
      <table class="eq-table" style="width:100%;font-size:12px">
        <thead><tr>
          <th style="text-align:left">Region</th>
          <th style="text-align:right">Demand (MWh)</th>
          <th style="text-align:right">Generation (MWh)</th>
          <th style="text-align:left">Balance</th>
          <th style="text-align:left">Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${renderFooter(`EIA Grid Monitor · ${regions.length} regions${completeBadge}`, badge)}
    </div>`;
  }

  private renderOutagesTab(): string {
    if (!this.outages) return emptyState('Outage data not yet loaded.');
    const { nationalCustomersAffected, countyCount, topCounties, byState, severity, badge } = this.outages;
    if (countyCount === 0) {
      return `<div class="gi-outages-tab">
        <div class="gi-headline" style="padding:8px 0;font-size:14px">No active outages reported nationally.</div>
        ${renderFooter('PowerOutage.us', badge)}
      </div>`;
    }
    const trend = compareToPrev(nationalCustomersAffected);
    const headline = `<div class="gi-headline" style="padding:8px 12px;border-radius:6px;background:${severityBackground(severity)};margin-bottom:8px">
      <strong>${nationalCustomersAffected.toLocaleString()}</strong> customers affected nationally
      <span style="margin-left:8px;opacity:0.85">${severityBadge(severity)}</span>
      <span style="margin-left:8px;opacity:0.65">${trend}</span>
    </div>`;
    const counties = topCounties.map((c) => renderCountyRow(c)).join('');
    const states = byState
      .filter((s) => s.severity !== 'normal')
      .slice(0, 8)
      .map((s) => `<li><strong>${escapeHtml(s.state)}</strong> · ${s.customersAffected.toLocaleString()} affected · ${severityBadge(s.severity)}</li>`)
      .join('');
    return `<div class="gi-outages-tab">
      ${headline}
      <h4 style="margin:6px 0 4px;font-size:12px;text-transform:uppercase;opacity:0.7">Top counties</h4>
      <table class="eq-table" style="width:100%;font-size:12px">
        <thead><tr><th>County</th><th>State</th><th style="text-align:right">Affected</th><th style="text-align:right">% Tracked</th></tr></thead>
        <tbody>${counties}</tbody>
      </table>
      ${states ? `<h4 style="margin:10px 0 4px;font-size:12px;text-transform:uppercase;opacity:0.7">Elevated states</h4><ul style="padding-left:20px;margin:4px 0">${states}</ul>` : ''}
      ${renderFooter('PowerOutage.us · 5-min refresh', badge)}
    </div>`;
  }

  private renderInternetTab(): string {
    if (!this.bgp) return emptyState('BGP/internet data not yet loaded.');
    const { events, criticalCount, elevatedCount, badge } = this.bgp;
    if (events.length === 0) {
      return `<div class="gi-internet-tab">
        <div class="gi-headline" style="padding:8px 0;font-size:14px">No BGP hijack events in the last 24h.</div>
        ${renderFooter('Cloudflare Radar', badge)}
      </div>`;
    }
    const headline = `<div class="gi-headline" style="padding:8px 12px;border-radius:6px;background:${criticalCount > 0 ? severityBackground('major') : (elevatedCount > 0 ? severityBackground('elevated') : 'rgba(255,255,255,0.04)')};margin-bottom:8px">
      <strong>${criticalCount}</strong> critical · <strong>${elevatedCount}</strong> elevated · ${events.length} total events (24h)
    </div>`;
    const rows = events.slice(0, 12).map((e) => renderBgpRow(e)).join('');
    return `<div class="gi-internet-tab">
      ${headline}
      <table class="eq-table" style="width:100%;font-size:11px">
        <thead><tr>
          <th>Sev</th>
          <th>Prefix</th>
          <th>Expected</th>
          <th>Detected</th>
          <th>Tags</th>
          <th>Started</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${renderFooter('Cloudflare Radar · 10-min refresh', badge)}
    </div>`;
  }

  private renderRadiationTab(): string {
    if (!this.radiation) return emptyState('Radiation data not yet loaded.');
    const { stationCount, elevatedStations, maxCpm, maxCpmStation, severity, badge } = this.radiation;
    const headline = `<div class="gi-headline" style="padding:8px 12px;border-radius:6px;background:${severityBackground(severity)};margin-bottom:8px">
      <strong>${stationCount}</strong> stations · max ${maxCpm === null ? 'n/a' : `${maxCpm.toFixed(0)} CPM`}
      ${maxCpmStation ? `<span style="opacity:0.85;margin-left:6px">(${escapeHtml(maxCpmStation)})</span>` : ''}
      <span style="margin-left:8px">${severityBadge(severity)}</span>
    </div>`;
    if (elevatedStations.length === 0) {
      return `<div class="gi-radiation-tab">
        ${headline}
        <div class="panel-empty" style="margin-top:8px">All stations within background (≤100 CPM).</div>
        ${renderFooter('EPA RadNet · 30-min refresh', badge)}
      </div>`;
    }
    const rows = elevatedStations.slice(0, 15).map((s) => renderRadRow(s)).join('');
    return `<div class="gi-radiation-tab">
      ${headline}
      <h4 style="margin:6px 0 4px;font-size:12px;text-transform:uppercase;opacity:0.7">Stations above background</h4>
      <table class="eq-table" style="width:100%;font-size:12px">
        <thead><tr><th>Station</th><th>State</th><th style="text-align:right">CPM</th><th>Severity</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${renderFooter('EPA RadNet · 30-min refresh', badge)}
    </div>`;
  }

  private render(): void {
    let body = '';
    switch (this.activeTab) {
      case 'grid': { body = this.renderGridTab(); break; }
      case 'outages': { body = this.renderOutagesTab(); break; }
      case 'internet': { body = this.renderInternetTab(); break; }
      case 'radiation': { body = this.renderRadiationTab(); break; }
    }
    this.setContent(`${this.renderTabStrip()}${body}`);
    this.wireTabHandlers();
  }

  private wireTabHandlers(): void {
    const root = this.getElement();
    if (!root) return;
    const buttons = root.querySelectorAll<HTMLButtonElement>('.gi-tab');
    for (const btn of buttons) {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab as Tab | undefined;
        if (!tab || tab === this.activeTab) return;
        this.activeTab = tab;
        try { localStorage.setItem(TAB_STORAGE_KEY, tab); } catch { /* noop */ }
        this.render();
      });
    }
  }
}

// ─── Renderers ────────────────────────────────────────────────────────

function renderRegionRow(r: RegionBalance, maxValue: number): string {
  const dPct = r.demandMwh === null ? 0 : Math.round((r.demandMwh / maxValue) * 100);
  const gPct = r.generationMwh === null ? 0 : Math.round((r.generationMwh / maxValue) * 100);
  const deltaText = r.deltaMwh === null
    ? '—'
    : `${r.deltaMwh >= 0 ? '+' : ''}${r.deltaMwh.toLocaleString()} MWh`;
  const deltaColor = r.status === 'surplus' ? '#34d399' : (r.status === 'deficit' ? '#f87171' : 'inherit');
  const statusBadge = renderRegionStatus(r.status);
  const demandBar = `<div style="background:rgba(96,165,250,0.6);height:6px;width:${dPct}%"></div>`;
  const genBar = `<div style="background:rgba(34,197,94,0.6);height:6px;width:${gPct}%"></div>`;
  return `<tr>
    <td><strong>${escapeHtml(r.region)}</strong> <span style="opacity:0.65;font-size:10px">${escapeHtml(r.displayName)}</span></td>
    <td style="text-align:right">${r.demandMwh === null ? '—' : r.demandMwh.toLocaleString()}<br/>${demandBar}</td>
    <td style="text-align:right">${r.generationMwh === null ? '—' : r.generationMwh.toLocaleString()}<br/>${genBar}</td>
    <td style="color:${deltaColor};font-weight:600">${deltaText}</td>
    <td>${statusBadge}</td>
  </tr>`;
}

function renderCountyRow(c: CountyOutage): string {
  const pct = c.customersTracked > 0 ? `${(c.affectedRatio * 100).toFixed(1)}%` : '—';
  return `<tr>
    <td>${escapeHtml(c.county)}</td>
    <td>${escapeHtml(c.state)}</td>
    <td style="text-align:right">${c.customersAffected.toLocaleString()}</td>
    <td style="text-align:right">${pct}</td>
  </tr>`;
}

function renderBgpRow(e: BgpEvent): string {
  const prefix = e.prefixes[0] ?? '—';
  const more = e.prefixes.length > 1 ? ` <span style="opacity:0.6">+${e.prefixes.length - 1}</span>` : '';
  const detected = e.detectedOriginAsns.slice(0, 2).map((asn) => escapeHtml(asn)).join(', ') || '—';
  const tags = e.tags.length === 0 ? '—' : e.tags.map((t) => `<span style="padding:1px 4px;border-radius:3px;background:rgba(248,113,113,0.18);font-size:10px;margin-right:2px">${escapeHtml(t)}</span>`).join('');
  const started = e.startedAt ? timeAgoMs(e.startedAt) : '—';
  return `<tr>
    <td>${bgpSeverityBadge(e.severity)}</td>
    <td><code style="font-size:10px">${escapeHtml(prefix)}</code>${more}</td>
    <td>${e.expectedOriginAsn ? `AS${escapeHtml(e.expectedOriginAsn)}` : '—'}</td>
    <td>${detected}</td>
    <td>${tags}</td>
    <td>${started}</td>
  </tr>`;
}

function renderRadRow(s: RadStation): string {
  return `<tr>
    <td>${escapeHtml(s.name)}</td>
    <td>${escapeHtml(s.state ?? '—')}</td>
    <td style="text-align:right;font-weight:600">${s.cpm === null ? '—' : s.cpm.toFixed(0)}</td>
    <td>${severityBadge(s.severity)}</td>
  </tr>`;
}

function renderRegionStatus(status: RegionBalance['status']): string {
  const colors: Record<RegionBalance['status'], string> = {
    surplus: 'rgba(34,197,94,0.22)',
    balanced: 'rgba(255,255,255,0.08)',
    deficit: 'rgba(248,113,113,0.22)',
    unknown: 'rgba(255,255,255,0.04)',
  };
  return `<span style="padding:2px 6px;border-radius:3px;background:${colors[status]};font-size:10px;text-transform:uppercase">${escapeHtml(status)}</span>`;
}

function renderFooter(label: string, badge: { observedAt: number | null; isStale: boolean; ageSeconds: number }): string {
  const fresh = badge.observedAt === null
    ? 'no data'
    : (badge.isStale
      ? `<span style="color:#f59e0b">stale · ${humanAge(badge.ageSeconds)} ago</span>`
      : `${humanAge(badge.ageSeconds)} ago`);
  return `<div class="fires-footer" style="display:flex;justify-content:space-between;margin-top:8px;font-size:11px;opacity:0.7">
    <span>${escapeHtml(label)}</span>
    <span>${fresh}</span>
  </div>`;
}

function severityBadge(s: Severity): string {
  return `<span style="padding:1px 5px;border-radius:3px;background:${severityBackground(s)};font-size:10px;text-transform:uppercase">${escapeHtml(s)}</span>`;
}

function bgpSeverityBadge(s: 'info' | 'elevated' | 'critical'): string {
  const bg = s === 'critical' ? 'rgba(248,113,113,0.32)' : (s === 'elevated' ? 'rgba(245,158,11,0.28)' : 'rgba(255,255,255,0.08)');
  return `<span style="padding:1px 5px;border-radius:3px;background:${bg};font-size:10px;text-transform:uppercase">${escapeHtml(s)}</span>`;
}

function severityBackground(s: Severity): string {
  switch (s) {
    case 'extreme': { return 'rgba(220,38,38,0.36)';
    }
    case 'major': { return 'rgba(248,113,113,0.32)';
    }
    case 'high': { return 'rgba(251,146,60,0.28)';
    }
    case 'elevated': { return 'rgba(250,204,21,0.22)';
    }
    case 'normal': { return 'rgba(34,197,94,0.18)';
    }
  }
}

function emptyState(message: string): string {
  return `<div class="panel-empty" style="padding:18px 0;text-align:center;opacity:0.75">${escapeHtml(message)}</div>`;
}

function humanAge(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'unknown';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

function timeAgoMs(epoch: number): string {
  return `${humanAge(Math.floor((Date.now() - epoch) / 1000))} ago`;
}

let _lastNationalAffected: number | null = null;
function compareToPrev(current: number): string {
  const prev = _lastNationalAffected;
  _lastNationalAffected = current;
  if (prev === null) return '';
  if (current > prev * 1.1) return '↑ worsening';
  if (current < prev * 0.9) return '↓ improving';
  return '→ steady';
}

function readStoredTab(): Tab {
  try {
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    if (stored === 'grid' || stored === 'outages' || stored === 'internet' || stored === 'radiation') return stored;
  } catch { /* noop */ }
  return 'grid';
}
