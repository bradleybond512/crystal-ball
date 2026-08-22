import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { getApiBaseUrl } from '@/services/runtime';
import {
  fetchInfraRisks,
  ageInfraRiskState,
  INFRA_RISK_STATE_MAX_AGE_MS,
  type InfraRiskState,
  type InfraSeverity,
  type CisaKevEntry,
  type BgpAnomalyRecord,
  type AcledEvent,
} from '@/services/infrarisks/infra-risk-service';

type Tab = 'power' | 'kev' | 'bgp' | 'acled';

const TAB_STORAGE_KEY = 'cb:infra-risk-tab';
const TAB_LABELS: Record<Tab, string> = {
  power: 'Power',
  kev: 'CISA KEV',
  bgp: 'AS3356 / Lumen',
  acled: 'ACLED',
};

const REFRESH_MS = 60_000;

export class InfraRiskMatrixPanel extends Panel {
  private activeTab: Tab = readStoredTab();
  private state: InfraRiskState | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private freshnessTimer: ReturnType<typeof setTimeout> | null = null;
  private loading = false;
  private stopped = false;
  private loadGeneration = 0;
  private loadAbort: AbortController | null = null;

  constructor() {
    super({
      id: 'infra-risk-matrix',
      title: 'Infrastructure Risk Matrix',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Cross-domain infrastructure risk from current CISA KEV evidence. RIPE NCC data is scoped only to AS3356 / Lumen and is displayed as exact-resource evidence, not scored as the whole BGP domain. National power-outage and current-window ACLED coverage are unavailable here and excluded from the composite; exact-county ODIN context is in Disaster Lifelines.',
    });
    this.render();
    queueMicrotask(() => { void this.load(); });
    this.refreshTimer = setInterval(() => { void this.load(); }, REFRESH_MS);
  }

  public destroy(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.loadGeneration += 1;
    this.loadAbort?.abort();
    this.loadAbort = null;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.freshnessTimer) {
      clearTimeout(this.freshnessTimer);
      this.freshnessTimer = null;
    }
    super.destroy();
  }

  private async load(): Promise<void> {
    if (this.loading || this.stopped) return;
    const generation = ++this.loadGeneration;
    const controller = new AbortController();
    this.loadAbort = controller;
    this.loading = true;
    try {
      const nextState = await fetchInfraRisks({
        baseUrl: `${getApiBaseUrl()}/api/infrarisks`,
        signal: controller.signal,
      });
      if (this.stopped || controller.signal.aborted || generation !== this.loadGeneration) return;
      this.state = nextState;
      this.scheduleFreshnessTransition();
      this.render();
    } catch (error) {
      if (!this.stopped && !controller.signal.aborted && generation === this.loadGeneration) throw error;
    } finally {
      if (this.loadAbort === controller) this.loadAbort = null;
      if (generation === this.loadGeneration) this.loading = false;
    }
  }

  private scheduleFreshnessTransition(): void {
    if (this.freshnessTimer) clearTimeout(this.freshnessTimer);
    this.freshnessTimer = null;
    if (this.stopped || !this.state) return;
    const delayMs = Math.max(0, this.state.fetchedAt + INFRA_RISK_STATE_MAX_AGE_MS + 1 - Date.now());
    this.freshnessTimer = setTimeout(() => {
      this.freshnessTimer = null;
      if (this.stopped) return;
      this.render();
    }, delayMs);
  }

  // ─── Rendering ─────────────────────────────────────────────────────

  private renderHeader(): string {
    if (!this.state) return '<div style="padding:6px 0;opacity:0.65;font-size:12px">Loading composite risk…</div>';
    if (this.state.compositeScore === null || this.state.compositeSeverity === null) {
      return `<div class="infra-header" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:6px;background:var(--overlay-light);margin-bottom:8px">
        <div>
          <div style="font-size:11px;text-transform:uppercase;opacity:0.7">Composite Risk</div>
          <div style="font-size:20px;font-weight:600;color:var(--text-tertiary)">Unavailable</div>
          <div style="font-size:10px;opacity:0.65">0 of ${this.state.expectedDomainCount} scored source domains reporting · power unknown · AS3356 / Lumen scoped evidence excluded</div>
        </div>
        <div style="text-align:right">
          <span style="padding:3px 10px;border-radius:4px;background:var(--text-tertiary);color:var(--surface-0);font-size:11px;font-weight:600;text-transform:uppercase">Unknown</span>
          <div style="font-size:11px;opacity:0.65;margin-top:4px">Checked ${timeAgo(this.state.fetchedAt)}</div>
        </div>
      </div>`;
    }
    const color = severityColor(this.state.compositeSeverity);
    const unknownCount = this.state.expectedDomainCount - this.state.observedDomainCount;
    const coverage = this.state.compositeCoverage === 'partial'
      ? `${this.state.observedDomainCount} of ${this.state.expectedDomainCount} source domains reporting · ${unknownCount} unknown`
      : `${this.state.observedDomainCount} of ${this.state.expectedDomainCount} source domains reporting`;
    return `<div class="infra-header" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:6px;background:${severityBg(this.state.compositeSeverity)};margin-bottom:8px">
      <div>
        <div style="font-size:11px;text-transform:uppercase;opacity:0.7">Composite Risk</div>
        <div style="font-size:20px;font-weight:600;color:${color}">${this.state.compositeScore}/100</div>
        <div style="font-size:10px;opacity:0.65">${coverage} · power unknown · AS3356 / Lumen scoped evidence excluded</div>
      </div>
      <div style="text-align:right">
        <span style="padding:3px 10px;border-radius:4px;background:${color};color:#000;font-size:11px;font-weight:600;text-transform:uppercase">${escapeHtml(this.state.compositeSeverity)}</span>
        <div style="font-size:11px;opacity:0.65;margin-top:4px">Checked ${timeAgo(this.state.fetchedAt)}</div>
      </div>
    </div>`;
  }

  private renderTabStrip(): string {
    const tabs: Tab[] = ['power', 'kev', 'bgp', 'acled'];
    return `<div class="infra-tab-strip" role="tablist" style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">${tabs
      .map((tab) => {
        const active = tab === this.activeTab;
        const sev = this.state ? severityForTab(this.state, tab) : null;
        const statusColor = !this.state || coverageForTab(this.state, tab) === 'unknown' || sev === null
          ? 'var(--text-tertiary)' : severityColor(sev);
        return `<button class="infra-tab" data-tab="${tab}" role="tab" aria-selected="${active}" type="button" style="padding:4px 10px;border:1px solid rgba(255,255,255,0.12);background:${active ? 'rgba(96,165,250,0.18)' : 'transparent'};color:inherit;border-radius:4px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px"><span>${escapeHtml(TAB_LABELS[tab])}</span><span style="width:8px;height:8px;border-radius:50%;background:${statusColor}"></span></button>`;
      }).join('')}</div>`;
  }

  private renderPowerTab(): string {
    const power = this.state?.power;
    if (!power) return emptyState('Loading power coverage status…');
    return `<div class="panel-empty" style="padding:16px 0;text-align:center">
      <strong>Power outage coverage unknown.</strong>
      <div style="margin-top:6px;font-size:11px;opacity:0.75">No supported national redistribution feed is queried by this panel. Exact-county ORNL ODIN reports are available in Disaster Lifelines when a saved place resolves to a county. Missing coverage is not an all-clear and does not mean power is on.</div>
    </div>`;
  }

  private renderKevTab(): string {
    const kev = this.state?.kev;
    if (!kev) return emptyState('Loading CISA KEV feed…');
    if (kev.coverage === 'unknown' || kev.score === null) return unknownCoverageState('CISA KEV');
    if (kev.entries.length === 0) return emptyState('The latest reported CISA KEV response contains no new entries from the last 7 days.');
    const rows = kev.entries.slice(0, 30).map((e) => renderKevRow(e)).join('');
    return `<div style="font-size:12px;opacity:0.75;margin-bottom:4px">${escapeHtml(kev.score.headline)}</div>
      <table class="eq-table" style="width:100%;font-size:12px">
        <thead><tr><th>CVE</th><th>Vendor</th><th>Product</th><th>Added</th><th>Ransomware</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  private renderBgpTab(): string {
    const bgp = this.state?.bgp;
    if (!bgp) return emptyState('Loading RIPE NCC routing-consistency evidence for AS3356 / Lumen…');
    if (bgp.coverage === 'unknown' || bgp.score === null) return unknownCoverageState(`${bgp.scopeLabel} RIPE NCC routing evidence`);
    if (bgp.records.length === 0) return emptyState(`The latest exact-resource RIPE NCC response for ${bgp.scopeLabel} contains no routing inconsistencies.`);
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
    if (acled.coverage === 'unknown' || acled.score === null) {
      return unknownCoverageState('Current-window ACLED (historical rows are not scored as current risk)');
    }
    if (acled.events.length === 0) return emptyState('The latest reported ACLED response contains no violence-against-civilians events.');
    const rows = acled.events.slice(0, 30).map((e) => renderAcledRow(e)).join('');
    return `<div style="font-size:12px;opacity:0.75;margin-bottom:4px">${escapeHtml(acled.score.headline)}</div>
      <table class="eq-table" style="width:100%;font-size:12px">
        <thead><tr><th>Country</th><th>Location</th><th style="text-align:right">Fatalities</th><th>Severity</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  private render(): void {
    if (this.state) this.state = ageInfraRiskState(this.state, Date.now());
    if (this.state?.compositeScore === null || this.state?.compositeScore === undefined) {
      if (this.countEl) this.countEl.textContent = '—';
    } else {
      this.setCount(this.state.compositeScore);
    }
    let body = '';
    switch (this.activeTab) {
      case 'power': { body = this.renderPowerTab(); break; }
      case 'kev': { body = this.renderKevTab(); break; }
      case 'bgp': { body = this.renderBgpTab(); break; }
      case 'acled': { body = this.renderAcledTab(); break; }
    }
    const sourceStatus = this.state
      ? `${this.state.observedDomainCount}/${this.state.expectedDomainCount} scored sources reporting`
      : 'Source coverage loading';
    const footer = `<div style="opacity:0.65;font-size:11px;margin-top:6px">${sourceStatus} · CISA KEV · AS3356 / Lumen: scoped RIPE NCC evidence, excluded from composite · ACLED: unknown/excluded · 60s refresh · Power: unknown/excluded</div>`;
    this.setContent(`${this.renderHeader()}${this.renderTabStrip()}${body}${footer}`, () => this.wireHandlers());
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

function severityForTab(state: InfraRiskState, tab: Tab): InfraSeverity | null {
  switch (tab) {
    case 'power': { return state.power.score?.severity ?? null;
    }
    case 'kev': { return state.kev.score?.severity ?? null;
    }
    case 'bgp': { return state.bgp.score?.severity ?? null;
    }
    case 'acled': { return state.acled.score?.severity ?? null;
    }
  }
}

function coverageForTab(state: InfraRiskState, tab: Tab): 'reported' | 'unknown' {
  return state[tab].coverage;
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

function unknownCoverageState(source: string): string {
  return `<div class="panel-empty" style="padding:16px 0;text-align:center">
    <strong>${escapeHtml(source)} coverage unknown.</strong>
    <div style="margin-top:6px;font-size:11px;opacity:0.75">The latest refresh did not produce a usable source response. Missing coverage is not an all-clear.</div>
  </div>`;
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
