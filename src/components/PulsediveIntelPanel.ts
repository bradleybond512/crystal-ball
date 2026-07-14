/**
 * Pulsedive Intel panel — three tabs:
 *   - Indicators: high-risk explore feed (table)
 *   - Lookup:     search any IP / domain / URL for threat context
 *   - Feeds:      active threat feeds + their last-seen timestamps
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  fetchPulsediveIndicators,
  type PulsediveEnvelope,
} from '@/services/security/pulsedive-service';
import {
  riskColor,
  type PulsediveIndicator,
  type PulsediveRisk,
} from '@/services/security/pulsedive-classify';

const REFRESH_MS = 60 * 60 * 1000;
const TAB_STORAGE_KEY = 'cb:pulsedive-tab';

type Tab = 'indicators' | 'lookup' | 'feeds';

const TAB_LABELS: Record<Tab, string> = {
  indicators: 'High Risk Indicators',
  lookup: 'Lookup',
  feeds: 'Feeds',
};

function readStoredTab(): Tab {
  try {
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    if (stored === 'indicators' || stored === 'lookup' || stored === 'feeds') return stored;
  } catch { /* noop */ }
  return 'indicators';
}

export class PulsediveIntelPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private activeTab: Tab = readStoredTab();
  private explore: PulsediveEnvelope | null = null;
  private lookup: PulsediveEnvelope | null = null;
  private lookupQuery = '';

  constructor() {
    super({
      id: 'pulsedive-intel',
      title: 'Pulsedive Intel',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Pulsedive threat indicators (free public API). High-risk feed refreshes hourly; Lookup queries are cached per indicator.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    void this.refreshExplore();
    this.refreshTimer = setInterval(() => void this.refreshExplore(), REFRESH_MS);
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async refreshExplore(): Promise<void> {
    try {
      this.explore = await fetchPulsediveIndicators({ risk: 'high', type: 'all', limit: 50 });
    } catch { /* service surfaces degraded */ }
    this.render();
  }

  private async runLookup(value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) {
      this.lookup = null;
      this.render();
      return;
    }
    this.lookupQuery = trimmed;
    this.render();
    try {
      this.lookup = await fetchPulsediveIndicators({ indicator: trimmed });
    } catch { /* degraded */ }
    this.render();
  }

  private setTab(tab: Tab): void {
    if (tab === this.activeTab) return;
    this.activeTab = tab;
    try { localStorage.setItem(TAB_STORAGE_KEY, tab); } catch { /* noop */ }
    this.render();
  }

  private render(): void {
    const env = this.explore;
    if (env) this.setCount(env.stats.total);

    let body = '';
    switch (this.activeTab) {
      case 'indicators': { body = this.renderIndicatorsTab(); break; }
      case 'lookup': { body = this.renderLookupTab(); break; }
      case 'feeds': { body = this.renderFeedsTab(); break; }
    }
    this.setContent(`
      <div style="padding:8px;font-size:12px;line-height:1.45;">
        ${this.renderTabBar()}
        <div style="margin-top:8px;">${body}</div>
      </div>
    `, () => this.wireHandlers());
  }

  private renderTabBar(): string {
    const tabs: Tab[] = ['indicators', 'lookup', 'feeds'];
    return `<div style="display:flex;gap:4px;border-bottom:1px solid rgba(255,255,255,0.1);">
      ${tabs.map((tab) => {
        const active = tab === this.activeTab;
        return `<button class="pd-tab" data-tab="${tab}" type="button"
          style="background:${active ? 'rgba(74,158,255,0.15)' : 'transparent'};
                 border:none;border-bottom:2px solid ${active ? '#4a9eff' : 'transparent'};
                 color:inherit;padding:4px 10px;font-size:12px;cursor:pointer;">${escapeHtml(TAB_LABELS[tab])}</button>`;
      }).join('')}
    </div>`;
  }

  private renderIndicatorsTab(): string {
    const env = this.explore;
    if (!env) return `<div style="opacity:0.6;">Loading indicators…</div>`;
    const banner = env.degraded
      ? `<div style="padding:4px 6px;background:rgba(255, 69, 58,0.10);border-left:3px solid #ff453a;margin-bottom:6px;font-size:11px;">Degraded: ${escapeHtml(env.reason ?? 'unknown')}</div>`
      : '';
    if (env.indicators.length === 0) {
      return `${banner}<div style="opacity:0.6;">No indicators in the high-risk feed.</div>`;
    }
    const summary = this.renderRiskStrip(env.stats.byRisk);
    const rows = env.indicators.slice(0, 50).map((i) => this.renderIndicatorRow(i)).join('');
    return `${banner}${summary}
      <table class="eq-table" style="width:100%;font-size:11px;margin-top:6px;">
        <thead><tr>
          <th style="text-align:left;">Indicator</th>
          <th style="text-align:left;">Type</th>
          <th style="text-align:left;">Risk</th>
          <th style="text-align:left;">Threats</th>
          <th style="text-align:right;">Last seen</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  private renderLookupTab(): string {
    const inputHtml = `<input type="search" class="pd-lookup-input" placeholder="Look up IP / domain / URL…"
      value="${escapeHtml(this.lookupQuery)}"
      style="width:100%;padding:6px 10px;background:rgba(255,255,255,0.04);color:inherit;border:1px solid rgba(255,255,255,0.12);border-radius:4px;font-size:12px;font-family:ui-monospace,monospace;" />
      <div style="font-size:10px;opacity:0.6;margin-top:3px;">Press Enter to look up. Results cached for 1 hour.</div>`;
    if (!this.lookupQuery) {
      return `${inputHtml}<div style="margin-top:8px;opacity:0.6;">Enter an indicator to query Pulsedive.</div>`;
    }
    const env = this.lookup;
    if (!env) {
      return `${inputHtml}<div style="margin-top:8px;opacity:0.6;">Looking up <code>${escapeHtml(this.lookupQuery)}</code>…</div>`;
    }
    if (env.degraded) {
      return `${inputHtml}<div style="margin-top:8px;padding:4px 6px;background:rgba(255, 69, 58,0.10);border-left:3px solid #ff453a;font-size:11px;">Lookup failed: ${escapeHtml(env.reason ?? 'unknown')}</div>`;
    }
    if (env.indicators.length === 0) {
      return `${inputHtml}<div style="margin-top:8px;opacity:0.6;">No record for <code>${escapeHtml(this.lookupQuery)}</code>.</div>`;
    }
    const ind = env.indicators[0]!;
    const color = riskColor(ind.risk);
    const threats = ind.threats.length === 0 ? '<span style="opacity:0.6;">none</span>'
      : ind.threats.map((t) => `<span style="padding:1px 5px;border-radius:3px;background:rgba(255, 69, 58,0.12);font-size:10px;margin-right:3px;color:${color};">${escapeHtml(t)}</span>`).join('');
    const feeds = ind.feeds.length === 0 ? '<span style="opacity:0.6;">none</span>'
      : ind.feeds.slice(0, 12).map((f) => `<span style="padding:1px 5px;border-radius:3px;background:rgba(255,255,255,0.08);font-size:10px;margin-right:3px;">${escapeHtml(f)}</span>`).join('');
    return `${inputHtml}
      <div style="margin-top:10px;padding:8px;border:1px solid rgba(255,255,255,0.08);border-left:3px solid ${color};border-radius:3px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <code style="font-size:13px;font-weight:600;">${escapeHtml(ind.indicator)}</code>
          <span style="color:${color};text-transform:uppercase;font-weight:700;font-size:11px;">${ind.risk}</span>
        </div>
        <div style="font-size:11px;opacity:0.8;margin-top:2px;">${escapeHtml(ind.type)} · last seen ${formatTimestamp(ind.lastSeen)}</div>
        <div style="margin-top:6px;font-size:11px;"><strong style="opacity:0.7;">Threats:</strong> ${threats}</div>
        <div style="margin-top:4px;font-size:11px;"><strong style="opacity:0.7;">Feeds:</strong> ${feeds}</div>
      </div>`;
  }

  private renderFeedsTab(): string {
    const env = this.explore;
    if (!env) return `<div style="opacity:0.6;">Loading feeds…</div>`;
    if (env.stats.topFeeds.length === 0) {
      return `<div style="opacity:0.6;">No active feeds in the high-risk window.</div>`;
    }
    const latest = env.stats.latestSeen ? formatTimestamp(env.stats.latestSeen) : '—';
    const rows = env.stats.topFeeds.map((f) => `<tr>
      <td>${escapeHtml(f.feed)}</td>
      <td style="text-align:right;font-weight:600;">${f.count}</td>
    </tr>`).join('');
    return `<div style="font-size:11px;opacity:0.7;margin-bottom:6px;">Latest indicator activity: ${latest}</div>
      <table class="eq-table" style="width:100%;font-size:11px;">
        <thead><tr><th style="text-align:left;">Feed</th><th style="text-align:right;">Indicators</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  private renderRiskStrip(byRisk: Record<PulsediveRisk, number>): string {
    return `<div style="display:flex;flex-wrap:wrap;gap:4px;">
      ${(['critical', 'high', 'medium', 'low', 'none', 'unknown'] as PulsediveRisk[])
        .filter((r) => byRisk[r] > 0)
        .map((r) => `<span style="display:inline-block;padding:2px 8px;border:1px solid ${riskColor(r)};border-radius:8px;font-size:10px;color:${riskColor(r)};">${escapeHtml(r)} <strong>${byRisk[r]}</strong></span>`)
        .join('')}
    </div>`;
  }

  private renderIndicatorRow(ind: PulsediveIndicator): string {
    const color = riskColor(ind.risk);
    const threats = ind.threats.slice(0, 3).map((t) => escapeHtml(t)).join(', ') || '—';
    return `<tr>
      <td style="border-left:3px solid ${color};padding-left:6px;font-family:ui-monospace,monospace;font-size:10px;">${escapeHtml(ind.indicator)}</td>
      <td>${escapeHtml(ind.type)}</td>
      <td style="color:${color};text-transform:uppercase;font-weight:600;">${ind.risk}</td>
      <td style="font-size:10px;">${threats}</td>
      <td style="text-align:right;font-family:ui-monospace,monospace;opacity:0.7;font-size:10px;">${formatTimestamp(ind.lastSeen)}</td>
    </tr>`;
  }

  private wireHandlers(): void {
    const root = this.getElement();
    if (!root) return;
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.pd-tab')) {
      btn.addEventListener('click', () => {
        const t = btn.dataset.tab as Tab | undefined;
        if (t) this.setTab(t);
      });
    }
    const input = root.querySelector<HTMLInputElement>('.pd-lookup-input');
    if (input) {
      // Restore focus + caret on re-render so typing stays smooth.
      const len = input.value.length;
      input.focus();
      try { input.setSelectionRange(len, len); } catch { /* noop */ }
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void this.runLookup(input.value);
        }
      });
    }
  }
}

function formatTimestamp(ts: number | null): string {
  if (ts === null) return '—';
  return new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
}
