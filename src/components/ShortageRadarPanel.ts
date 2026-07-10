 
/**
 * Shortage Radar Panel — overview table for 8 commodity shortage models.
 *
 * Commodities: wheat · corn · rice · soybeans · diesel · gasoline ·
 *              natural-gas · jet-fuel
 *
 * Layout: a sorted table (highest risk first). Each row shows name, risk
 * score, risk-level badge, top driver, and a trend arrow. Clicking a row
 * (or pressing Enter on it) toggles an inline drill-down panel with the
 * full driver list, data gaps, time-to-impact, and confidence band.
 *
 * Refresh: every 5 minutes. Alerts: any commodity that *crosses* the HIGH
 * threshold (score > 70) or the CRITICAL threshold (> 85) on a refresh
 * gets emitted as a UnifiedAlert, gated through `shouldNotify('supply', ...)`
 * so users can mute the domain or raise the floor in notification settings.
 */

import { Panel } from './Panel';
import {
  computeShortageFullSet,
  computeShortageDetail,
  type ShortageSummaryEntry,
  type FullSetCommodity,
  type RiskLevel,
} from '@/services/shortage/shortage-fullset';
import {
  buildOverviewRows,
  countByRiskLevel,
  type OverviewRow,
} from '@/services/shortage/shortage-overview-helpers';
import {
  emitShortageAlerts,
  severityFromScore,
} from '@/services/shortage/shortage-alert-emitter';
import type { ShortageInputBag } from '@/services/shortage/shortage-types';
import { unifiedAlertStore } from '@/services/unified-alerts';
import { shouldNotify } from '@/services/notifications/notification-settings-service';
import { getApiBaseUrl } from '@/services/runtime';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 5 * 60 * 1000; // 5 minutes per spec

// ── Risk level palette ─────────────────────────────────────────────────────

const RISK_COLOR: Record<RiskLevel, string> = {
  CRITICAL: '#d50000',
  HIGH:     '#ff9800',
  MODERATE: '#ffeb3b',
  LOW:      '#4caf50',
};

const TREND_COLOR: Record<OverviewRow['trendArrow'], string> = {
  '↑': '#f44336',
  '↓': '#4caf50',
  '→': '#9e9e9e',
};

// ── Sidecar push ──────────────────────────────────────────────────────────

const SIDECAR_TTL_MS = 30 * 60 * 1000;

async function pushToSidecar(entries: readonly ShortageSummaryEntry[]): Promise<void> {
  const base = getApiBaseUrl();
  if (!base) return;
  try {
    await fetch(`${base}/api/shortage/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entries: entries.map((e) => ({
          commodity: e.commodity,
          riskScore: e.riskScore,
          riskLevel: e.riskLevel,
          primaryDrivers: e.primaryDrivers,
          timeToImpact: e.timeToImpact,
          trend: e.trend,
          forecast: e.forecast,
        })),
        updatedAt: Date.now(),
        ttlMs: SIDECAR_TTL_MS,
      }),
      signal: AbortSignal.timeout(4000),
    });
  } catch { /* best-effort — local render is the source of truth */ }
}

// ── Panel class ───────────────────────────────────────────────────────────

export class ShortageRadarPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private inputs: Partial<Record<FullSetCommodity, ShortageInputBag>> = {};
  private expanded = new Set<FullSetCommodity>();
  private previousScores = new Map<FullSetCommodity, number>();

  constructor() {
    super({
      id: 'shortage-radar',
      title: 'Shortage Radar',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Shortage risk across 8 commodities, sorted by current risk. Click a row to expand the full driver breakdown. Alerts fire when a commodity crosses HIGH (>70) or CRITICAL (>85).',
    });
    this.start();
  }

  /** Inject live commodity inputs from the data loader. */
  public setInputs(inputs: Partial<Record<FullSetCommodity, ShortageInputBag>>): void {
    this.inputs = { ...inputs };
    this.render();
  }

  /** Legacy compat — previous callers used setRequests(). */
  public setRequests(requests: readonly { commodity: FullSetCommodity; inputs: ShortageInputBag }[]): void {
    const map: Partial<Record<FullSetCommodity, ShortageInputBag>> = {};
    for (const r of requests) map[r.commodity] = r.inputs;
    this.setInputs(map);
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('click', this.onRowToggle);
      document.removeEventListener('keydown', this.onRowKey);
    }
    super.destroy();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('click', this.onRowToggle);
      document.addEventListener('keydown', this.onRowKey);
    }
  }

  private readonly onRowToggle = (ev: Event): void => {
    const row = (ev.target as Element | null)?.closest('[data-shortage-row]');
    if (!row) return;
    const commodity = row.getAttribute('data-shortage-row');
    if (!commodity) return;
    this.toggleExpanded(commodity as FullSetCommodity);
  };

  private readonly onRowKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const row = (ev.target as Element | null)?.closest('[data-shortage-row]');
    if (!row) return;
    ev.preventDefault();
    const commodity = row.getAttribute('data-shortage-row');
    if (!commodity) return;
    this.toggleExpanded(commodity as FullSetCommodity);
  };

  private toggleExpanded(commodity: FullSetCommodity): void {
    if (this.expanded.has(commodity)) this.expanded.delete(commodity);
    else this.expanded.add(commodity);
    this.render();
  }

  private render(): void {
    const entries = computeShortageFullSet(this.inputs);
    const rows = buildOverviewRows(entries);
    const counts = countByRiskLevel(rows);
    this.setCount(counts.CRITICAL + counts.HIGH);

    // Emit alerts on upward crossings.
    const { alerts, nextPreviousScores } = emitShortageAlerts(entries, this.previousScores);
    this.previousScores = nextPreviousScores;
    if (alerts.length > 0) {
      const accepted = alerts.filter((a) => shouldNotify('supply', a.severity));
      if (accepted.length > 0) {
        try { unifiedAlertStore.ingest(accepted); } catch { /* alert store failure must not break the panel */ }
      }
    }

    void pushToSidecar(entries);
    this.setContent(this.buildHtml(rows, entries, counts));
  }

  private buildHtml(
    rows: readonly OverviewRow[],
    entries: readonly ShortageSummaryEntry[],
    counts: Record<RiskLevel, number>,
  ): string {
    const banner = (counts.CRITICAL + counts.HIGH) > 0 ? this.buildBanner(counts) : '';
    const tableRows = rows.map((r) => this.buildRow(r, entries)).join('');

    return `${banner}
      <div style="padding:8px 10px;font-size:11px;color:var(--text-secondary,#888);">
        ${rows.length} commodities · sorted by current risk · alert threshold: HIGH 70 / CRITICAL 85
      </div>
      <table role="table" style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="text-align:left;color:var(--text-secondary,#888);border-bottom:1px solid var(--border-subtle,#333);">
            <th scope="col" style="padding:6px 10px;font-weight:600;">Commodity</th>
            <th scope="col" style="padding:6px 10px;font-weight:600;text-align:right;">Risk</th>
            <th scope="col" style="padding:6px 10px;font-weight:600;">Level</th>
            <th scope="col" style="padding:6px 10px;font-weight:600;">Top driver</th>
            <th scope="col" style="padding:6px 10px;font-weight:600;text-align:center;">Trend</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>`;
  }

  private buildBanner(counts: Record<RiskLevel, number>): string {
    const bits: string[] = [];
    if (counts.CRITICAL > 0) bits.push(`${counts.CRITICAL} CRITICAL`);
    if (counts.HIGH > 0)     bits.push(`${counts.HIGH} HIGH`);
    const text = bits.join(' · ');
    return `<div style="padding:6px 12px;background:rgba(213,0,0,0.12);border-bottom:1px solid rgba(213,0,0,0.3);font-size:11px;font-weight:700;color:#d50000;letter-spacing:0.04em;">
      ⚠ SHORTAGE ALERTS: ${escapeHtml(text)}
    </div>`;
  }

  private buildRow(r: OverviewRow, entries: readonly ShortageSummaryEntry[]): string {
    const isOpen = this.expanded.has(r.commodity);
    const drillHtml = isOpen ? this.buildDrillDown(r, entries) : '';
    // When the model ran with empty inputs, render NO DATA in grey instead
    // of the misleading green LOW that the raw model would suggest.
    const color = r.unwired ? '#777' : RISK_COLOR[r.riskLevel];
    const levelText = r.unwired ? 'NO DATA' : r.riskLevel;
    const scoreText = r.unwired ? '—' : String(r.riskScore);
    const topDriverText = r.unwired ? 'No live data wired' : r.topDriver;
    const arrowColor = TREND_COLOR[r.trendArrow];
    return `<tr
      data-shortage-row="${escapeHtml(r.commodity)}"
      role="button"
      tabindex="0"
      aria-expanded="${isOpen ? 'true' : 'false'}"
      style="border-bottom:1px solid var(--border-subtle,#222);cursor:pointer;"
    >
      <td style="padding:7px 10px;font-weight:600;">${escapeHtml(r.displayName)}</td>
      <td style="padding:7px 10px;text-align:right;font-family:ui-monospace,monospace;font-weight:700;color:${color};">${scoreText}</td>
      <td style="padding:7px 10px;">
        <span style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.06em;padding:1px 5px;border:1px solid ${color};border-radius:2px;">${escapeHtml(levelText)}</span>
      </td>
      <td style="padding:7px 10px;color:var(--text-secondary,#aaa);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(topDriverText)}">${escapeHtml(topDriverText)}</td>
      <td style="padding:7px 10px;text-align:center;color:${arrowColor};font-weight:700;" aria-label="${escapeHtml(r.trend)}">${r.trendArrow}</td>
    </tr>${drillHtml}`;
  }

  private buildDrillDown(r: OverviewRow, entries: readonly ShortageSummaryEntry[]): string {
    const entry = entries.find((e) => e.commodity === r.commodity);
    // computeShortageDetail requires a concrete input bag; only call it when
    // the user has provided live inputs for this commodity. Otherwise fall
    // back to the entry's already-computed forecast.
    const liveInputs = this.inputs[r.commodity];
    const detail = liveInputs ? computeShortageDetail(r.commodity, liveInputs) : undefined;
    const driverList = (detail?.drivers ?? entry?.forecast.drivers ?? []).slice(0, 6);
    const drivers = driverList.length === 0
      ? '<li style="color:var(--text-secondary,#777);">No drivers reported.</li>'
      : driverList.map((d) => `<li style="padding:2px 0;color:var(--text-primary,#ddd);">${escapeHtml(d.label)} <span style="color:var(--text-secondary,#777);font-family:ui-monospace,monospace;">(+${d.score.toFixed(0)})</span></li>`).join('');
    const gapsList = detail?.dataGaps ?? entry?.forecast.dataGaps ?? [];
    const gaps = gapsList.length === 0
      ? '<li style="color:var(--text-secondary,#777);">No data gaps.</li>'
      : gapsList.map((g) => `<li style="color:#ff9800;">${escapeHtml(g)}</li>`).join('');
    const confidence = detail?.confidence ?? entry?.forecast.confidence ?? 'low';
    const timeToImpact = entry?.timeToImpact ?? '—';
    return `<tr data-shortage-drilldown="${escapeHtml(r.commodity)}">
      <td colspan="5" style="background:var(--bg-elevated,rgba(255,255,255,0.02));padding:12px 16px;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;">
          <div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary,#888);margin-bottom:4px;">Top drivers</div>
            <ul style="margin:0;padding-left:14px;">${drivers}</ul>
          </div>
          <div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary,#888);margin-bottom:4px;">Data gaps</div>
            <ul style="margin:0;padding-left:14px;">${gaps}</ul>
          </div>
          <div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary,#888);margin-bottom:4px;">Forecast</div>
            <div style="font-size:11px;color:var(--text-primary,#ddd);">Confidence: <strong>${escapeHtml(confidence)}</strong></div>
            <div style="font-size:11px;color:var(--text-primary,#ddd);">Time to impact: <strong>${escapeHtml(timeToImpact)}</strong></div>
            <div style="font-size:11px;color:var(--text-secondary,#999);margin-top:4px;">Notification severity if persists: ${escapeHtml(severityFromScore(r.riskScore))}</div>
          </div>
        </div>
      </td>
    </tr>`;
  }
}

// Re-export types so panel consumers don't need a second import.
export {
  type ShortageSummaryEntry,
  type FullSetCommodity,
  type RiskLevel,
  type Trend,
} from '@/services/shortage/shortage-fullset';
