/* eslint-disable sonarjs/no-nested-conditional */
import { Panel } from './Panel';
import {
  countActiveBgpAlerts,
  countActiveRadiationAlerts,
  isGridSnapshotFresh,
  isBgpSummaryFresh,
  isRadSummaryFresh,
} from '@/services/infrastructure/grid-monitor';
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
      infoTooltip: 'Descriptive EIA demand and net generation, ORNL ODIN exact-county outage reports from Disaster Lifelines, Cloudflare Radar BGP hijacks, and EPA RadNet gross gamma. EIA total net interchange is not ingested, so the panel does not infer supply adequacy or transfer direction from D versus NG.',
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

  /** Headline alert count: a positive saved-county report + active
   *  critical/elevated BGP events + fresh radiation stations ≥ elevated. */
  private computeAlertCount(): number {
    const outageReport = this.outages?.coverage === 'reported'
      && (this.outages.reportedCustomersOut ?? 0) > 0 ? 1 : 0;
    const bgpAlerts = countActiveBgpAlerts(this.bgp, Date.now());
    const radElevated = countActiveRadiationAlerts(this.radiation, Date.now());
    return outageReport + bgpAlerts.critical + bgpAlerts.elevated + radElevated;
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
      return emptyState('No current EIA balancing-authority data available. Missing, invalid, or future-dated rows cannot establish grid conditions; check EIA_API_KEY in Settings → API Keys.');
    }
    const now = Date.now();
    if (!isGridSnapshotFresh(this.grid, now)) {
      const currentAgeSeconds = badge.observedAt === null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, Math.floor((now - badge.observedAt) / 1000));
      return `<div class="gi-grid-tab">
        <div class="gi-headline" style="padding:8px 12px;border-radius:6px;background:var(--overlay-light);font-size:14px">
          <strong>Power-grid evidence stale.</strong> Current EIA demand and net-generation observations are unknown until EIA refreshes.
        </div>
        ${renderFooter('EIA Grid Monitor · current observations unavailable', {
          ...badge, isStale: true, ageSeconds: currentAgeSeconds,
        })}
      </div>`;
    }
    const maxValue = Math.max(
      ...regions.flatMap((r) => [r.demandMwh ?? 0, r.generationMwh ?? 0]),
      1,
    );
    const rows = regions.map((r) => renderRegionRow(r, maxValue)).join('');
    const completeBadge = isComplete ? '' : ' <span style="opacity:0.7">· partial data</span>';
    return `<div class="gi-grid-tab">
      <div style="margin:0 0 8px;font-size:11px;opacity:0.78">Demand and net generation are descriptive EIA observations. Differences do not establish shortage, surplus, or import/export direction because total net interchange is not ingested.</div>
      <table class="eq-table" style="width:100%;font-size:12px">
        <thead><tr>
          <th style="text-align:left">Region</th>
          <th style="text-align:right">Demand (MWh)</th>
          <th style="text-align:right">Net generation (MWh)</th>
          <th style="text-align:left">Observation</th>
          <th style="text-align:left">Import/export context</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${renderFooter(`EIA Grid Monitor · ${regions.length} regions${completeBadge}`, badge)}
    </div>`;
  }

  private renderOutagesTab(): string {
    if (!this.outages) return emptyState('Outage data not yet loaded.');
    const {
      coverage, completeness, placeName, countyFips, county, state,
      reportedCustomersOut, reportCount, reports, severity, badge, unknownReason,
    } = this.outages;
    if (coverage !== 'reported' || reportedCustomersOut === null) {
      const countyScope = countyFips ? ` · county FIPS ${escapeHtml(countyFips)}` : '';
      const scope = placeName
        ? ` Saved place: ${escapeHtml(placeName)}${countyScope}.`
        : '';
      return `<div class="gi-outages-tab">
        <div class="gi-headline" style="padding:8px 12px;border-radius:6px;background:var(--overlay-light);font-size:14px">
          <strong>Coverage unknown.</strong> ${escapeHtml(outageUnknownMessage(unknownReason))}
        </div>
        <div style="margin-top:8px;font-size:11px;opacity:0.78">${scope} Empty, missing, or expired ODIN data is not an all-clear.</div>
        ${renderOutageFooter(badge)}
      </div>`;
    }
    const scope = county && state
      ? `${escapeHtml(county)}, ${escapeHtml(state)}`
      : `county FIPS ${escapeHtml(countyFips ?? 'unknown')}`;
    const coverageLabel = reportedCustomersOut === 0
      ? 'reported zero'
      : (completeness === 'partial' ? 'partial accepted coverage' : 'accepted reports');
    const headlineBackground = reportedCustomersOut === 0
      ? 'color-mix(in srgb, var(--text-tertiary) 14%, transparent)'
      : severityBackground(severity);
    const headline = `<div class="gi-headline" style="padding:8px 12px;border-radius:6px;background:${headlineBackground};margin-bottom:8px">
      <strong>${reportedCustomersOut.toLocaleString()}</strong> customers out across ${reportCount} accepted ODIN report${reportCount === 1 ? '' : 's'} · ${scope}
      <span style="margin-left:8px;opacity:0.85">${escapeHtml(coverageLabel)}</span>
    </div>`;
    const reportRows = reports.map((report) => renderOutageReportRow(report)).join('');
    return `<div class="gi-outages-tab">
      ${headline}
      <div style="margin:0 0 8px;font-size:11px;opacity:0.78">Reported zero is preserved, but it is not a countywide all-clear. County context does not establish power at any facility.</div>
      <h4 style="margin:6px 0 4px;font-size:12px;text-transform:uppercase;opacity:0.7">Accepted utility reports</h4>
      <table class="eq-table" style="width:100%;font-size:12px">
        <thead><tr><th>Utility/report</th><th style="text-align:right">Customers out</th><th style="text-align:right">Restored</th><th>Retrieved</th></tr></thead>
        <tbody>${reportRows}</tbody>
      </table>
      ${renderOutageFooter(badge)}
    </div>`;
  }

  private renderInternetTab(): string {
    if (!this.bgp) return emptyState('BGP/internet data not yet loaded.');
    const { coverage, error, events, droppedRows, badge } = this.bgp;
    if (coverage !== 'reported') {
      return `<div class="gi-internet-tab">
        <div class="gi-headline" style="padding:8px 12px;border-radius:6px;background:var(--overlay-light);font-size:14px">
          <strong>BGP coverage unknown.</strong> ${escapeHtml(error ?? 'Cloudflare Radar evidence is unavailable.')}
        </div>
        <div style="margin-top:8px;font-size:11px;opacity:0.78">Missing or invalid provider evidence is not proof that no hijacks occurred.</div>
        ${renderFooter('Cloudflare Radar · 10-min refresh', badge)}
      </div>`;
    }
    const now = Date.now();
    if (!isBgpSummaryFresh(this.bgp, now)) {
      const currentAgeSeconds = badge.observedAt === null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, Math.floor((now - badge.observedAt) / 1000));
      return `<div class="gi-internet-tab">
        <div class="gi-headline" style="padding:8px 12px;border-radius:6px;background:var(--overlay-light);font-size:14px">
          <strong>BGP evidence stale.</strong> Active-event status is unknown until Cloudflare Radar refreshes.
        </div>
        <div style="margin-top:8px;font-size:11px;opacity:0.78">Historical events are not counted as active alerts after evidence expires.</div>
        ${renderFooter('Cloudflare Radar · 10-min refresh', {
          ...badge, isStale: true, ageSeconds: currentAgeSeconds,
        })}
      </div>`;
    }
    if (events.length === 0) {
      return `<div class="gi-internet-tab">
        <div class="gi-headline" style="padding:8px 0;font-size:14px">Cloudflare Radar reported 0 BGP hijack events in its latest 24-hour query.</div>
        <div style="margin-top:8px;font-size:11px;opacity:0.78">Reported zero is preserved, but it is not proof that internet connectivity is healthy.</div>
        ${renderFooter('Cloudflare Radar · 10-min refresh', badge)}
      </div>`;
    }
    const activeAlerts = countActiveBgpAlerts(this.bgp, now);
    const headline = `<div class="gi-headline" style="padding:8px 12px;border-radius:6px;background:${activeAlerts.critical > 0 ? severityBackground('major') : (activeAlerts.elevated > 0 ? severityBackground('elevated') : 'rgba(255,255,255,0.04)')};margin-bottom:8px">
      <strong>${activeAlerts.critical}</strong> active critical · <strong>${activeAlerts.elevated}</strong> active elevated · ${events.length} total provider events (24h)
    </div>`;
    const rows = events.slice(0, 12).map((e) => renderBgpRow(e)).join('');
    return `<div class="gi-internet-tab">
      ${headline}
      ${droppedRows > 0 ? `<div style="margin-bottom:8px;font-size:11px;opacity:0.78">${droppedRows} invalid provider row${droppedRows === 1 ? '' : 's'} discarded.</div>` : ''}
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
    const {
      coverage, error, stationCount, elevatedStations, maxCpm, maxCpmStation,
      severity, droppedRows, badge,
    } = this.radiation;
    if (coverage !== 'reported' || severity === null) {
      return `<div class="gi-radiation-tab">
        <div class="gi-headline" style="padding:8px 12px;border-radius:6px;background:var(--overlay-light);font-size:14px">
          <strong>Radiation coverage unknown.</strong> ${escapeHtml(error ?? 'EPA RadNet evidence is unavailable.')}
        </div>
        <div style="margin-top:8px;font-size:11px;opacity:0.78">Missing or invalid station readings cannot establish background conditions.</div>
        ${renderFooter('EPA RadNet · 30-min refresh', badge)}
      </div>`;
    }
    if (!isRadSummaryFresh(this.radiation, Date.now())) {
      return `<div class="gi-radiation-tab">
        <div class="gi-headline" style="padding:8px 12px;border-radius:6px;background:var(--overlay-light);font-size:14px">
          <strong>Radiation evidence stale.</strong> Current background and alert conditions are unknown until EPA RadNet refreshes.
        </div>
        ${renderFooter('EPA RadNet · 30-min refresh', badge)}
      </div>`;
    }
    if (stationCount === 0) {
      return `<div class="gi-radiation-tab">
        <div class="gi-headline" style="padding:8px 0;font-size:14px">EPA RadNet reported 0 valid station readings in its latest response.</div>
        <div style="margin-top:8px;font-size:11px;opacity:0.78">A reported empty response is not evidence that radiation is within background.</div>
        ${renderFooter('EPA RadNet · 30-min refresh', badge)}
      </div>`;
    }
    const headline = `<div class="gi-headline" style="padding:8px 12px;border-radius:6px;background:${severityBackground(severity)};margin-bottom:8px">
      <strong>${stationCount}</strong> stations · max ${maxCpm === null ? 'n/a' : `${maxCpm.toFixed(0)} CPM`}
      ${maxCpmStation ? `<span style="opacity:0.85;margin-left:6px">(${escapeHtml(maxCpmStation)})</span>` : ''}
      <span style="margin-left:8px">${severityBadge(severity)}</span>
    </div>`;
    if (elevatedStations.length === 0) {
      return `<div class="gi-radiation-tab">
        ${headline}
        <div class="panel-empty" style="margin-top:8px">All ${stationCount} valid readings in this reported response were below the configured alert threshold (100 CPM).</div>
        ${droppedRows > 0 ? `<div style="margin-top:8px;font-size:11px;opacity:0.78">${droppedRows} invalid provider row${droppedRows === 1 ? '' : 's'} discarded.</div>` : ''}
        ${renderFooter('EPA RadNet · 30-min refresh', badge)}
      </div>`;
    }
    const rows = elevatedStations.slice(0, 15).map((s) => renderRadRow(s)).join('');
    return `<div class="gi-radiation-tab">
      ${headline}
      ${droppedRows > 0 ? `<div style="margin-bottom:8px;font-size:11px;opacity:0.78">${droppedRows} invalid provider row${droppedRows === 1 ? '' : 's'} discarded.</div>` : ''}
      <h4 style="margin:6px 0 4px;font-size:12px;text-transform:uppercase;opacity:0.7">Stations at or above alert threshold</h4>
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
  const demandBar = `<div style="background:rgba(96,165,250,0.6);height:6px;width:${dPct}%"></div>`;
  const genBar = `<div style="background:rgba(34,197,94,0.6);height:6px;width:${gPct}%"></div>`;
  return `<tr>
    <td><strong>${escapeHtml(r.region)}</strong> <span style="opacity:0.65;font-size:10px">${escapeHtml(r.displayName)}</span></td>
    <td style="text-align:right">${r.demandMwh === null ? '—' : r.demandMwh.toLocaleString()}<br/>${demandBar}</td>
    <td style="text-align:right">${r.generationMwh === null ? '—' : r.generationMwh.toLocaleString()}<br/>${genBar}</td>
    <td>${escapeHtml(r.observedDate ?? '—')}</td>
    <td>${r.balanceInterpretation === 'unknown' ? 'Unknown · total net interchange unavailable' : '—'}</td>
  </tr>`;
}

function renderOutageReportRow(report: CountyOutage): string {
  return `<tr>
    <td>${escapeHtml(report.utility ?? report.utilityId ?? 'Unnamed ODIN report')}</td>
    <td style="text-align:right">${report.customersOut.toLocaleString()}</td>
    <td style="text-align:right">${report.customersRestored === null ? 'not reported' : report.customersRestored.toLocaleString()}</td>
    <td>${escapeHtml(timeAgoMs(report.retrievedAt))}</td>
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

function renderOutageFooter(badge: { observedAt: number | null; isStale: boolean; ageSeconds: number }): string {
  const retrieval = badge.observedAt === null
    ? 'no accepted retrieval'
    : (badge.isStale
      ? `<span style="color:var(--status-stale)">retrieval stale · ${humanAge(badge.ageSeconds)} ago</span>`
      : `retrieved ${humanAge(badge.ageSeconds)} ago`);
  return `<div class="fires-footer" style="display:flex;justify-content:space-between;margin-top:8px;font-size:11px;opacity:0.7">
    <span>ORNL ODIN · exact-county reports</span>
    <span>${retrieval}</span>
  </div>`;
}

function outageUnknownMessage(reason: OutageSummary['unknownReason']): string {
  switch (reason) {
    case 'awaiting_lifeline_context': { return 'Open or refresh Disaster Lifelines for a saved place.';
    }
    case 'county_fips_unknown': { return 'The selected saved place could not be matched to an exact county.';
    }
    case 'no_accepted_reports': { return 'ODIN returned no accepted report for this exact county.';
    }
    case 'expired_reports': { return 'The last accepted county reports have expired.';
    }
    case 'malformed_snapshot': { return 'The county report failed validation and was discarded.';
    }
    case 'provider_unavailable':
    case null: { return 'ORNL ODIN is unavailable for this county context.';
    }
  }
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

function readStoredTab(): Tab {
  try {
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    if (stored === 'grid' || stored === 'outages' || stored === 'internet' || stored === 'radiation') return stored;
  } catch { /* noop */ }
  return 'grid';
}
