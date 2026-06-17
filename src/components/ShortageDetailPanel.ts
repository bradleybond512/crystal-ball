/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Shortage Detail Panel — per-commodity drill-down.
 *
 * Shared template: instantiate once per commodity. The panel id is
 * `shortage-detail-{commodity}`. It renders the full forecast from the
 * sidecar cache (/api/shortage/{commodity}), falling back to a direct
 * service call when the sidecar hasn't been populated yet.
 *
 * Shows: risk score + sparkline (stored history), top 5 drivers with
 * magnitude bars, confidence badge, data gaps, freshness dot.
 */

import { Panel } from './Panel';
import {
  computeShortageDetail,
  riskLevelFor,
  type FullSetCommodity,
  type RiskLevel,
} from '@/services/shortage/shortage-fullset';
import type { ShortageForecast, ShortageDriver } from '@/services/shortage/shortage-types';
import { getApiBaseUrl } from '@/services/runtime';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 60_000; // slower refresh than overview
const HISTORY_CAP = 20;    // sparkline buckets

// ── Sparkline history ─────────────────────────────────────────────────────
// Per-commodity ring buffer of { score, at } stored in module-level memory.

const _history = new Map<FullSetCommodity, { score: number; at: number }[]>();

function pushHistory(commodity: FullSetCommodity, score: number): void {
  const ring = _history.get(commodity) ?? [];
  ring.push({ score, at: Date.now() });
  if (ring.length > HISTORY_CAP) ring.shift();
  _history.set(commodity, ring);
}

function getHistory(commodity: FullSetCommodity): { score: number; at: number }[] {
  return _history.get(commodity) ?? [];
}

// ── Risk colors ───────────────────────────────────────────────────────────

const RISK_COLOR: Record<RiskLevel, string> = {
  CRITICAL: '#d50000',
  HIGH:     '#ff9800',
  MODERATE: '#ffeb3b',
  LOW:      '#4caf50',
};

// ── Sparkline SVG ──────────────────────────────────────────────────────────

function buildSparkline(history: { score: number; at: number }[], color: string): string {
  if (history.length < 2) {
    return `<div style="height:36px;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--text-secondary,#aaa);">collecting data…</div>`;
  }
  const W = 200;
  const H = 36;
  const maxScore = 100;
  const points = history.map((h, i) => {
    const x = Math.round((i / (history.length - 1)) * W);
    const y = Math.round(H - (h.score / maxScore) * H);
    return `${x},${y}`;
  });
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible;" aria-hidden="true">
    <polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="${points[points.length - 1]?.split(',')[0] ?? '0'}" cy="${points[points.length - 1]?.split(',')[1] ?? '0'}" r="2.5" fill="${color}"/>
  </svg>`;
}

// ── Driver magnitude bar ──────────────────────────────────────────────────

function buildDriverRow(d: ShortageDriver): string {
  const isProtective = d.polarity === 'protective';
  const barColor = isProtective ? '#4caf50' : '#ff9800';
  const pct = Math.min(100, Math.max(0, d.score));
  const kindLabel = d.kind.replace(/_/g, ' ');
  return `<div style="margin-bottom:6px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;">
      <span style="font-size:11px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(d.label)}">${escapeHtml(d.label)}</span>
      <span style="font-size:10px;color:var(--text-secondary,#aaa);margin-left:8px;white-space:nowrap;">${escapeHtml(kindLabel)} · ${d.score.toFixed(0)}</span>
    </div>
    <div style="height:4px;border-radius:2px;background:rgba(255,255,255,0.08);overflow:hidden;">
      <div style="height:100%;width:${pct}%;background:${barColor};border-radius:2px;transition:width 0.3s;"></div>
    </div>
  </div>`;
}

// ── Freshness ─────────────────────────────────────────────────────────────

function freshnessLabel(lastUpdated: string): string {
  const ms = Date.now() - new Date(lastUpdated).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

// ── Panel class ───────────────────────────────────────────────────────────

export class ShortageDetailPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly commodity: FullSetCommodity;

  private readonly onDrillDown = (ev: Event): void => {
    const detail = (ev as CustomEvent<{ commodity: string }>).detail;
    if (detail?.commodity === this.commodity) {
      this.getElement().scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  constructor(commodity: FullSetCommodity) {
    const name = commodity.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    super({
      id: `shortage-detail-${commodity}`,
      title: `${name} Shortage`,
      showCount: false,
      trackActivity: false,
      infoTooltip: `Full shortage risk model for ${name}. Drivers, confidence, data gaps, and score history.`,
    });
    this.commodity = commodity;
    this.start();
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    document.removeEventListener('wm:shortage-drill-down', this.onDrillDown);
  }

  private start(): void {
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_MS);

    // Listen for drill-down event so the panel can scroll into view.
    document.addEventListener('wm:shortage-drill-down', this.onDrillDown);
  }

  private async refresh(): Promise<void> {
    this.showLoading();
    const forecast = await this.fetchForecast();
    if (!forecast) {
      this.showError('No forecast available');
      return;
    }
    pushHistory(this.commodity, forecast.riskScore);
    this.setDataBadge('live');
    this.setContent(this.buildHtml(forecast));
  }

  private async fetchForecast(): Promise<ShortageForecast | null> {
    const base = getApiBaseUrl();
    if (base) {
      try {
        const res = await fetch(`${base}/api/shortage/${this.commodity}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const json = await res.json() as { forecast?: ShortageForecast };
          if (json && typeof json === 'object' && json.forecast) return json.forecast;
        }
      } catch {
        // Fall through to direct service call.
      }
    }
    // Direct service call (sidecar not populated yet or web build).
    return computeShortageDetail(this.commodity, {}) ?? null;
  }

  private buildHtml(forecast: ShortageForecast): string {
    const level = riskLevelFor(forecast.riskScore);
    const color = RISK_COLOR[level];
    const history = getHistory(this.commodity);
    const sparkline = buildSparkline(history, color);
    const freshness = freshnessLabel(forecast.lastUpdated);
    const CONF_COLORS: Record<string, string> = { high: '#4caf50', medium: '#ff9800', low: '#f44336' };
    const confColor = CONF_COLORS[forecast.confidence] ?? '#f44336';

    const topDrivers = [...forecast.drivers]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const driverRows = topDrivers.map((d) => buildDriverRow(d)).join('');

    const gapsHtml = forecast.dataGaps.length === 0
      ? ''
      : `<div style="margin-top:10px;padding:8px;background:rgba(255,152,0,0.08);border-radius:4px;border-left:2px solid #ff9800;">
           <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#ff9800;margin-bottom:4px;">Data Gaps (${forecast.dataGaps.length})</div>
           <ul style="margin:0;padding-left:16px;">${forecast.dataGaps.map((g) => `<li style="font-size:11px;color:var(--text-secondary,#aaa);">${escapeHtml(g)}</li>`).join('')}</ul>
         </div>`;

    const confirmingHtml = forecast.confirmingIndicators.length === 0
      ? ''
      : `<div style="margin-top:10px;">
           <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">Watch for confirmation</div>
           <ul style="margin:0;padding-left:16px;">${forecast.confirmingIndicators.slice(0, 4).map((s) => `<li style="font-size:11px;color:var(--text-secondary,#aaa);">${escapeHtml(s)}</li>`).join('')}</ul>
         </div>`;

    return `<div style="padding:12px;">

      <!-- Score + level -->
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
        <span style="font-size:36px;font-weight:700;color:${color};font-family:ui-monospace,monospace;line-height:1;">${forecast.riskScore.toFixed(0)}</span>
        <div>
          <div style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.06em;padding:2px 6px;border:1px solid ${color};border-radius:3px;display:inline-block;">${level}</div>
          <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">
            <span style="color:${confColor};">${escapeHtml(forecast.confidence)} confidence</span>
            · ${escapeHtml(forecast.region)}
            · ${forecast.horizonDays}d horizon
            · updated ${escapeHtml(freshness)}
          </div>
        </div>
      </div>

      <!-- Sparkline -->
      <div style="margin-bottom:10px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">Score history (last ${history.length} readings)</div>
        ${sparkline}
      </div>

      <!-- Drivers -->
      <div style="margin-bottom:4px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Top drivers (${forecast.drivers.length} total)</div>
        ${driverRows || '<div style="font-size:11px;color:var(--text-secondary,#aaa);">No drivers scored above zero.</div>'}
      </div>

      ${gapsHtml}
      ${confirmingHtml}
    </div>`;
  }
}

/** Reset sparkline history — used in tests. */
export function _resetDetailHistory(): void {
  _history.clear();
}
