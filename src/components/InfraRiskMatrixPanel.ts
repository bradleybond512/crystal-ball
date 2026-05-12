import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { getApiBaseUrl } from '@/services/runtime';
import {
  fetchInfraRisks,
  type InfraRiskState,
  type InfraSeverity,
  type PowerOutageRecord,
  type CisaKevEntry,
  type BgpAnomalyRecord,
  type AcledEvent,
} from '@/services/infrarisks/infra-risk-service';

type Tab = 'power' | 'kev' | 'bgp' | 'acled';

const TAB_STORAGE_KEY = 'cb:infra-risk-tab';
const TAB_LABELS: Record<Tab, string> = {
  power: 'Power',
  kev: 'CISA KEV',
  bgp: 'BGP',
  acled: 'ACLED',
};

const REFRESH_MS = 60_000;

export class InfraRiskMatrixPanel extends Panel {
  private activeTab: Tab = readStoredTab();
  private state: InfraRiskState | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private loading = false;

  constructor() {
    super({
      id: 'infra-risk-matrix',
      title: 'Infrastructure Risk Matrix',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Cross-domain infrastructure risk: power outages (PowerOutage.us), CISA KEVs, BGP anomalies (RIPE NCC), ACLED violence. 60-second refresh.',
    });
    this.render();
    queueMicrotask(() => { void this.load(); });
    this.refreshTimer = setInterval(() => { void this.load(); }, REFRESH_MS);
  }

  public destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      this.state = await fetchInfraRisks({
        baseUrl: `${getApiBaseUrl()}/api/infrarisks`,
      });
      this.setCount(this.state.compositeScore);
      this.render();
    } finally {
      this.loading = false;
    }
  }

  // ─── Rendering ─────────────────────────────────────────────────────

  private renderHeader(): string {
    if (!this.state) return '<div style="padding:6px 0;opacity:0.65;font-size:12px">Loading composite risk…</div>';
    const color = severityColor(this.state.compositeSeverity);
    return `<div class="infra-header" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:6px;background:${severityBg(this.state.compositeSeverity)};margin-bottom:8px">
      <div>
        <div style="font-size:11px;text-transform:uppercase;opacity:0.7">Composite Risk</div>
        <div style="font-size:20px;font-weight:600;color:${color}">${this.state.compositeScore}/100</div>
      </div>
      <div style="text-align:right">
        <span style="padding:3px 10px;border-radius:4px;background:${color};color:#000;font-size:11px;font-weight:600;text-transform:uppercase">${escapeHtml(this.state.compositeSeverity)}</span>
        <div style="font-size:11px;opacity:0.65;margin-top:4px">Updated ${timeAgo(this.state.fetchedAt)}</div>
      </div>
    </div>`;
  }

  private renderTabStrip(): string {
    const tabs: Tab[] = ['power', 'kev', 'bgp', 'acled'];
    return `<div class="infra-tab-strip" role="tablist" style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">${tabs
      .map((tab) => {
        const active = tab === this.activeTab;
        const sev = this.state ? severityForTab(this.state, tab) : 'INFO';
        return `<button class="infra-tab" data-tab="${tab}" role="tab" aria-selected="${active}" type="button" style="padding:4px 10px;border:1px solid rgba(255,255,255,0.12);background:${active ? 'rgba(96,165,250,0.18)' : 'transparent'};color:inherit;border-radius:4px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px"><span>${escapeHtml(TAB_LABELS[tab])}</span><span style="width:8px;height:8px;border-radius:50%;background:${severityColor(sev)}"></span></button>`;
      }).join('')}</div>`;
  }

  private renderPowerTab(): string {
    const power = this.state?.power;
    if (!power) return emptyState('Loading power-grid data…');
    if (power.records.length === 0) return emptyState('No active power outages reported.');
    const rows = power.records.slice(0, 30).map((r) => renderPowerRow(r)).join('');
    return `<div style="font-size:12px;opacity:0.75;margin-bottom:4px">${escapeHtml(power.score.headline)}</div>
      <table class="eq-table" style="width:100%;font-size:12px">
        <thead><tr><th>County</th><th>State</th><th style="text-align:right">Customers Out</th><th style="text-align:right">%</th><th>Severity</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  private renderKevTab(): string {
    const kev = this.state?.kev;
    if (!kev) return emptyState('Loading CISA KEV feed…');
    if (kev.entries.length === 0) return emptyState('No new KEVs in the last 7 days.');
    const rows = kev.entries.slice(0, 30).map((e) => renderKevRow(e)).join('');
    return `<div style="font-size:12px;opacity:0.75;margin-bottom:4px">${escapeHtml(kev.score.headline)}</div>
      <table class="eq-table" style="width:100%;font-size:12px">
        <thead><tr><th>CVE</th><th>Vendor</th><th>Product</th><th>Added</th><th>Ransomware</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  private renderBgpTab(): string {
    const bgp = this.state?.bgp;
    if (!bgp) return emptyState('Loading BGP routing-consistency data…');
    if (bgp.records.length === 0) return emptyState('No BGP routing inconsistencies detected.');
    const rows = bgp.records.slice(0, 30).map((r) => renderBgpRow(r)).join('');
    return `<div style="font-size:12px;opacity:0.75;margin-bottom:4px">${escapeHtml(bgp.score.headline)}</div>
      <table class="eq-table" style="width:100%;font-size:12px">
        <thead><tr><th>Resource</th><th style="text-align:right">Count</th><th>Severity</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  private renderAcledTab(): string {
    const acled = this.state?.acled;
    if (!acled) return emptyState('Loading ACLED events…');
    if (acled.events.length === 0) return emptyState('No reported violence events (auth may be required for full feed).');
    const rows = acled.events.slice(0, 30).map((e) => renderAcledRow(e)).join('');
    return `<div style="font-size:12px;opacity:0.75;margin-bottom:4px">${escapeHtml(acled.score.headline)}</div>
      <table class="eq-table" style="width:100%;font-size:12px">
        <thead><tr><th>Country</th><th>Location</th><th style="text-align:right">Fatalities</th><th>Severity</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  private render(): void {
    let body = '';
    switch (this.activeTab) {
      case 'power': { body = this.renderPowerTab(); break; }
      case 'kev': { body = this.renderKevTab(); break; }
      case 'bgp': { body = this.renderBgpTab(); break; }
      case 'acled': { body = this.renderAcledTab(); break; }
    }
    const footer = '<div style="opacity:0.65;font-size:11px;margin-top:6px">Sources: poweroutage.us · CISA KEV · RIPE NCC · ACLED · 60s refresh</div>';
    this.setContent(`${this.renderHeader()}${this.renderTabStrip()}${body}${footer}`);
    this.wireHandlers();
  }

  private wireHandlers(): void {
    const root = this.getElement();
    if (!root) return;
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.infra-tab')) {
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

// ─── Row renderers ─────────────────────────────────────────────────────

function renderPowerRow(r: PowerOutageRecord): string {
  const pct = r.outageRatio > 0 ? `${Math.round(r.outageRatio * 100)}%` : '—';
  return `<tr>
    <td>${escapeHtml(r.county)}</td>
    <td>${escapeHtml(r.state)}</td>
    <td style="text-align:right">${r.customersOut.toLocaleString()}</td>
    <td style="text-align:right">${pct}</td>
    <td>${severityBadge(r.severity)}</td>
  </tr>`;
}

function renderKevRow(e: CisaKevEntry): string {
  const ransomware = e.knownRansomware ? '<span style="color:#f87171">⚠</span>' : '—';
  return `<tr>
    <td><code style="font-size:10px">${escapeHtml(e.cveId)}</code></td>
    <td>${escapeHtml(e.vendor)}</td>
    <td>${escapeHtml(e.product)}</td>
    <td style="opacity:0.7">${escapeHtml(e.dateAddedRaw)}</td>
    <td style="text-align:center">${ransomware}</td>
  </tr>`;
}

function renderBgpRow(r: BgpAnomalyRecord): string {
  return `<tr>
    <td><code style="font-size:10px">${escapeHtml(r.resource)}</code></td>
    <td style="text-align:right">${r.inconsistencyCount}</td>
    <td>${severityBadge(r.severity)}</td>
  </tr>`;
}

function renderAcledRow(e: AcledEvent): string {
  return `<tr>
    <td>${escapeHtml(e.country)}</td>
    <td style="opacity:0.85">${escapeHtml(e.location || '—')}</td>
    <td style="text-align:right;font-weight:600">${e.fatalities}</td>
    <td>${severityBadge(e.severity)}</td>
  </tr>`;
}

// ─── Style helpers ─────────────────────────────────────────────────────

function severityForTab(state: InfraRiskState, tab: Tab): InfraSeverity {
  switch (tab) {
    case 'power': { return state.power.score.severity;
    }
    case 'kev': { return state.kev.score.severity;
    }
    case 'bgp': { return state.bgp.score.severity;
    }
    case 'acled': { return state.acled.score.severity;
    }
  }
}

function severityColor(s: InfraSeverity): string {
  switch (s) {
    case 'CRITICAL': { return '#dc2626';
    }
    case 'HIGH': { return '#f87171';
    }
    case 'MEDIUM': { return '#fb923c';
    }
    case 'LOW': { return '#facc15';
    }
    case 'INFO': { return '#22c55e';
    }
  }
}

function severityBg(s: InfraSeverity): string {
  switch (s) {
    case 'CRITICAL': { return 'rgba(220,38,38,0.22)';
    }
    case 'HIGH': { return 'rgba(248,113,113,0.18)';
    }
    case 'MEDIUM': { return 'rgba(251,146,60,0.18)';
    }
    case 'LOW': { return 'rgba(250,204,21,0.15)';
    }
    case 'INFO': { return 'rgba(34,197,94,0.12)';
    }
  }
}

function severityBadge(s: InfraSeverity): string {
  return `<span style="padding:1px 5px;border-radius:3px;background:${severityBg(s)};color:${severityColor(s)};font-size:10px;text-transform:uppercase;font-weight:600">${escapeHtml(s)}</span>`;
}

function emptyState(message: string): string {
  return `<div class="panel-empty" style="padding:16px 0;text-align:center;opacity:0.75">${escapeHtml(message)}</div>`;
}

function timeAgo(epoch: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - epoch) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function readStoredTab(): Tab {
  try {
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    if (stored === 'power' || stored === 'kev' || stored === 'bgp' || stored === 'acled') return stored;
  } catch { /* noop */ }
  return 'power';
}
