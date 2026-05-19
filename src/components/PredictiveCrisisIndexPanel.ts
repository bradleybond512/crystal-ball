/* eslint-disable sonarjs/no-nested-template-literals */
import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { getApiBaseUrl } from '@/services/runtime';
import { unifiedAlertStore } from '@/services/unified-alerts';
import { CrisisSignatureLibrary } from '@/services/intelligence/crisis-signature-library';
import {
  computePCI, pciToAlert,
  type PCIScore, type PCILevel, type PCIThreat, type PCIDomainScore,
} from '@/services/intelligence/predictive-crisis-index';

type Tab = 'overview' | 'threats';

const TAB_LABELS: Record<Tab, string> = { overview: 'Overview', threats: 'Threats' };

const LEVEL_COLOR: Record<PCILevel, string> = {
  low:      '#4caf50',
  moderate: '#cddc39',
  elevated: '#ff9800',
  high:     '#ef4444',
  critical: '#9c27b0',
};

const LEVEL_BG: Record<PCILevel, string> = {
  low:      'rgba(76,175,80,0.08)',
  moderate: 'rgba(205,220,57,0.08)',
  elevated: 'rgba(255,152,0,0.10)',
  high:     'rgba(239,68,68,0.12)',
  critical: 'rgba(156,39,176,0.16)',
};

const TREND_ARROW: Record<string, string> = { rising: '▲', stable: '→', falling: '▼' };
const TREND_COLOR: Record<string, string> = {
  rising: '#ef4444', stable: '#9e9e9e', falling: '#4caf50',
};

const REFRESH_MS = 30_000;
const SIDECAR_PUSH_TTL_MS = 5 * 60 * 1000;

function _trendArrow(trend: string): string { return TREND_ARROW[trend] ?? '→'; }
function _trendCol(trend: string): string { return TREND_COLOR[trend] ?? '#9e9e9e'; }

export class PredictiveCrisisIndexPanel extends Panel {
  private activeTab: Tab = 'overview';
  private score: PCIScore | null = null;
  private prevIndex: number | undefined = undefined;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private library = CrisisSignatureLibrary.getInstance();

  constructor() {
    super({
      id: 'predictive-crisis-index',
      title: 'Predictive Crisis Index',
      showCount: false,
      trackActivity: true,
      infoTooltip:
        'Aggregates active crisis signature matches into a composite 0–100 index. ' +
        'Built on the Crisis Signature Library (8 built-in patterns). ' +
        'Alerts fire on elevated threshold crossings with 30-min cooldown.',
    });
    this._refresh();
    this.refreshTimer = setInterval(() => this._refresh(), REFRESH_MS);
  }

  private _refresh(): void {
    const observations = this._getObservations();
    const matches = this.library.matchSignatures(observations);
    const score = computePCI(matches, this.prevIndex, Date.now());
    this.prevIndex = score.index;
    this.score = score;

    // Route alert to unified store
    const alert = pciToAlert(score);
    if (alert) {
      try { unifiedAlertStore.ingest([alert]); } catch { /* best-effort */ }
    }

    void this._pushToSidecar(score);
    this._render();
  }

  private _getObservations() {
    try {
      // Pull from unified alert store as ObservationEvent proxies
      const alerts = unifiedAlertStore.getAll();
      const cutoff = Date.now() - 6 * 60 * 60 * 1000; // 6h window
      return alerts
        .filter((a) => a.timestamp >= cutoff)
        .map((a) => ({
          id: a.id,
          sourceId: a.source,
          domain: a.source,
          timestamp: a.timestamp,
          location: a.location ? { lat: a.location.lat, lon: a.location.lon } : undefined,
          severity: _severityMap(a.severity),
          title: a.title,
          raw: a,
          entityIds: [],
          tags: [],
        }));
    } catch {
      return [];
    }
  }

  private async _pushToSidecar(score: PCIScore): Promise<void> {
    const base = getApiBaseUrl();
    if (!base) return;
    try {
      await fetch(`${base}/api/intelligence/pci`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...score, ttlMs: SIDECAR_PUSH_TTL_MS }),
        signal: AbortSignal.timeout(4000),
      });
    } catch { /* best-effort */ }
  }

  private _render(): void {
    this.setContent(this._buildHtml());
    this._bindTabClicks();
  }

  private _buildHtml(): string {
    const tabs = (Object.keys(TAB_LABELS) as Tab[]).map((t) => {
      const active = t === this.activeTab;
      return `<button class="pci-tab" data-tab="${t}" role="tab" aria-selected="${active}"
        style="padding:4px 10px;border:1px solid rgba(255,255,255,0.12);
          background:${active ? 'rgba(96,165,250,0.18)' : 'transparent'};
          color:inherit;border-radius:4px;cursor:pointer;font-size:12px">
        ${escapeHtml(TAB_LABELS[t])}
      </button>`;
    }).join('');

    const tabBar = `<div style="display:flex;gap:4px;margin-bottom:10px">${tabs}</div>`;
    const body = this.activeTab === 'overview' ? this._buildOverview() : this._buildThreats();
    return `<div style="padding:8px">${tabBar}${body}</div>`;
  }

  private _buildOverview(): string {
    if (!this.score) {
      return '<p style="color:rgba(255,255,255,0.4);font-size:12px">Computing…</p>';
    }
    const s = this.score;
    const color = LEVEL_COLOR[s.level];
    const bg = LEVEL_BG[s.level];

    // Gauge bar
    const gauge = `
      <div style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <div style="font-size:32px;font-weight:700;color:${color};line-height:1">${s.index}</div>
          <div>
            <div style="font-size:13px;font-weight:600;color:${color}">${s.level.toUpperCase()}</div>
            <div style="font-size:11px;color:${_trendCol(s.trend)}">
              ${_trendArrow(s.trend)} ${s.trend}
              ${_trendDeltaLabel(s.trendDelta)}
            </div>
          </div>
        </div>
        <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${s.index}%;background:${color};border-radius:3px;
            transition:width 0.4s ease"></div>
        </div>
      </div>`;

    // Domain breakdown
    const domainRows = s.domainBreakdown.length === 0
      ? '<p style="color:rgba(255,255,255,0.35);font-size:11px">No active signals.</p>'
      : s.domainBreakdown.map((d) => _domainRow(d)).join('');

    const domainSection = `
      <div>
        <div style="font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
          color:rgba(255,255,255,0.35);margin-bottom:6px">Domain Breakdown</div>
        ${domainRows}
      </div>`;

    const matchCount = s.topThreats.length;
    const footer = `<p style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:10px">
      ${matchCount} active pattern${matchCount === 1 ? '' : 's'} · 6h window
    </p>`;

    return `<div style="background:${bg};border-radius:8px;padding:10px;
      border:1px solid rgba(255,255,255,0.06)">${gauge}${domainSection}${footer}</div>`;
  }

  private _buildThreats(): string {
    if (!this.score || this.score.topThreats.length === 0) {
      return '<p style="color:rgba(255,255,255,0.4);font-size:12px">No active threats detected.</p>';
    }
    const rows = this.score.topThreats.map((t) => _threatRow(t)).join('');
    return `<div>${rows}</div>`;
  }

  private _bindTabClicks(): void {
    const container = this.getContentElement();
    container.querySelectorAll<HTMLButtonElement>('.pci-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab as Tab | undefined;
        if (!tab || tab === this.activeTab) return;
        this.activeTab = tab;
        this._render();
      }, { once: true });
    });
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) clearInterval(this.refreshTimer);
    super.destroy();
  }
}

// ── Module-level helpers ──────────────────────────────────────────────────

function _domainRow(d: PCIDomainScore): string {
  const pct = Math.min(100, d.score);
  return `
    <div style="margin-bottom:5px">
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px">
        <span>${escapeHtml(d.domain)}</span>
        <span style="color:rgba(255,255,255,0.45)">${d.score}/100 · ${d.matchCount} match${d.matchCount === 1 ? '' : 'es'}</span>
      </div>
      <div style="height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:rgba(255,152,0,0.6);border-radius:2px"></div>
      </div>
    </div>`;
}

function _leadLabel(hours: number): string {
  if (hours < 1) return '< 1h';
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function _trendDeltaLabel(delta: number): string {
  if (delta === 0) return '';
  return `(${delta > 0 ? '+' : ''}${delta})`;
}

function _threatRow(t: PCIThreat): string {
  const confPct = Math.round(t.confidence * 100);
  const leadLabel = _leadLabel(t.leadTimeHours);
  return `
    <div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);
      display:flex;align-items:flex-start;gap:8px">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:500">${escapeHtml(t.signatureName)}</div>
        <div style="font-size:10px;color:rgba(255,255,255,0.4)">
          ${escapeHtml(t.domain)} · conf ${confPct}% · match ${Math.round(t.matchScore * 100)}%
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:11px;font-weight:600;color:#ff9800">${Math.round(t.risk)}/100</div>
        <div style="font-size:10px;color:rgba(255,255,255,0.35)">~${leadLabel} lead</div>
      </div>
    </div>`;
}

type UASeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
import type { ObservationSeverity } from '@/types/intelligence';

function _severityMap(s: UASeverity): ObservationSeverity {
  const map: Record<UASeverity, ObservationSeverity> = {
    critical: 'CRITICAL', high: 'HIGH', medium: 'MEDIUM', low: 'LOW', info: 'INFO',
  };
  return map[s] ?? 'LOW';
}
